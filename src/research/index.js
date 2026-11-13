import { readFile } from 'node:fs/promises';
import { fetchCandidates, normalizeCandidates } from '../interview-research.js';
import { searchRequests, dedupeSearchResults } from '../services.js';
import { filterSearchRelevance } from '../search-relevance.js';
import { searchContentHint } from '../search-quality.js';
import { parseSourceCandidates, isVerifiableEvidence } from '../source-extraction.js';
import { articleUrl, readArticle } from './read-source.js';

export const LIMITS = Object.freeze({rounds:2, search:4, read:2, model:3, outputTokens:800, totalOutputTokens:2400, modelInputBytes:48000, milliseconds:75000});
const skillNames = ['search-strategy','interview-extraction','source-verification','quality-evaluation'];
const skills = () => Promise.all(skillNames.map(name=>readFile(new URL(`./skills/${name}/SKILL.md`,import.meta.url),'utf8')));
const contains = (value, part) => value.normalize('NFKC').toLowerCase().includes(part.normalize('NFKC').toLowerCase());

export function parseCostBudget(raw) {
  if (!raw) return null;
  let config;
  try { config=JSON.parse(raw); } catch { throw Error('RESEARCH_COST_BUDGET 格式无效'); }
  const names=['limit','Tavily','Exa','model'];
  if (!config || names.some(name=>!Number.isSafeInteger(config[name]) || config[name]<0)) {
    throw Error('RESEARCH_COST_BUDGET 必须提供 limit、Tavily、Exa 和 model，单位为整数微美元');
  }
  return Object.fromEntries(names.map(name=>[name,config[name]]));
}

export function cleanTopics(input = []) {
  if (!Array.isArray(input) || input.length > 4 ||
      input.some(value=>typeof value!=='string' || !value.trim() || Array.from(value.trim()).length > 40 || /[\x00-\x1f]/.test(value))) {
    throw Error('主题最多 4 个，每个 1 至 40 字，请使用可公开的关键词');
  }
  return [...new Set(input.map(item=>item.trim()))];
}

export function createResearch({keys, fetcher = fetch, read = readArticle, extract, clock = ()=>Date.now(), costBudget = null}) {
  const providers = ['Tavily','Exa'].filter(name=>keys[name]);
  const cache = new Map();
  async function run({role,company='',source='all',range='year',topics=[]}, {signal:clientSignal} = {}) {
    topics = cleanTopics(topics);
    const now = new Date(clock()), [base] = searchRequests(role,company,'',range,now,source);
    const today = now.toISOString().slice(0,10);
    const signature = JSON.stringify([role,company,source,range,topics,today,providers]);
    const cached = cache.get(signature);
    clientSignal?.throwIfAborted();
    if (cached && cached.expires > clock()) {
      return {...cached.result, cached:true, usage:{search:0,read:0,model:0,modelInputBytes:0,inputTokens:0,outputTokens:0,cost:null,
        reserved_cost_microusd:costBudget?0:null,duration_ms:0}, events:[]};
    }
    const signal = AbortSignal.any([AbortSignal.timeout(LIMITS.milliseconds), ...(clientSignal ? [clientSignal] : [])]);
    const [strategy, ...extractionSkills] = await skills();
    const instructions = extractionSkills.join('\n');
    const started = clock();
    const usage = {search:0,read:0,model:0,modelInputBytes:0,inputTokens:0,outputTokens:0,cost:null,reserved_cost_microusd:costBudget?0:null};
    let reservedOutput=0;
    const events = [], links = [], candidates = [], attempted = new Set(), readUrls = new Set(), covered = new Set();
    let stop = 'round_limit', rounds = 0;
    async function tool(kind, detail, action) {
      if (signal.aborted || usage[kind] >= LIMITS[kind]) return undefined;
      const reserve=costBudget ? (kind==='search'?costBudget[detail.provider]:kind==='model'?costBudget.model:0) : 0;
      if (costBudget && reserve > costBudget.limit-usage.reserved_cost_microusd) {
        stop='cost_budget'; return undefined;
      }
      if (costBudget) usage.reserved_cost_microusd+=reserve;
      usage[kind]++;
      const start = clock();
      try {
        const result = await action();
        events.push({tool:kind,...detail,status:'ok',ms:clock()-start});
        return result;
      } catch {
        if (kind==='model') {usage.inputTokens=null;usage.outputTokens=null;}
        events.push({tool:kind,...detail,status:signal.aborted?'cancelled':'failed',ms:clock()-start});
      }
    }
    const enough = () => topics.length ? topics.every(topic=>covered.has(topic)) : candidates.length > 0;
    async function model(instructions,payload,round) {
      const bytes=Buffer.byteLength(instructions)+Buffer.byteLength(payload);
      if (usage.modelInputBytes+bytes>LIMITS.modelInputBytes || reservedOutput+LIMITS.outputTokens>LIMITS.totalOutputTokens) {
        stop='model_budget'; return undefined;
      }
      return tool('model',{round},async()=>{
        usage.modelInputBytes+=bytes;
        reservedOutput+=LIMITS.outputTokens;
        const result=await extract({instructions,payload,signal,maxTokens:LIMITS.outputTokens});
        for (const [field,key] of [['inputTokens','prompt_tokens'],['outputTokens','completion_tokens']]) {
          const n=result.usage?.[key];
          usage[field]=usage[field]!==null && Number.isInteger(n) && n>=0 ? usage[field]+n : null;
        }
        return result.content;
      });
    }
    for (; rounds < LIMITS.rounds && !signal.aborted;) {
      rounds++;
      const missing = topics.filter(topic=>!covered.has(topic));
      const untried=missing.filter(topic=>!attempted.has(topic));
      let term = rounds === 1 ? (missing[0] || '') : (untried[0] || missing[0] || '');
      if (rounds>1 && untried.length>1 && extract && links.length && usage.read<LIMITS.read) {
        const content=await model(strategy+'\nChoose exactly one topic from remaining. Return JSON {"topic":"..."} only.',
          JSON.stringify({role,remaining:untried}),rounds);
        try {
          const chosen=JSON.parse(content)?.topic;
          if (untried.includes(chosen)) term=chosen;
        } catch {}
      }
      attempted.add(term);
      const phrase = rounds === 1 ? '面经' : '面试经历';
      const query = [role,company,term,phrase].filter(Boolean).join(' ');
      // Two providers share a normalized candidate contract. Run the other
      // provider only if evidence is still missing; every attempt consumes budget.
      for (const provider of providers) {
        if (signal.aborted || enough() || stop==='cost_budget' || stop==='model_budget') break;
        const plan = provider === 'Tavily' ? {...base,query} : {
          query,type:'auto',numResults:10,includeDomains:base.include_domains,contents:{highlights:true},
          ...(base.start_date ? {startPublishedDate:`${base.start_date}T00:00:00.000Z`,endPublishedDate:`${today}T23:59:59.999Z`} : {})
        };
        const rows = await tool('search',{provider,round:rounds},()=>fetchCandidates(fetcher,provider,keys[provider],plan,signal));
        if (!rows) continue;
        const scoped = normalizeCandidates(rows,provider).filter(item=>(source==='all' || item.site===source) &&
          (!base.start_date || (item.date && item.date>=base.start_date && item.date<=today)));
        const known = new Set(links.map(item=>articleUrl(item.url) || item.url));
        const ranked = filterSearchRelevance(role,dedupeSearchResults(scoped),{company});
        const findings = [...ranked.results,...ranked.unverified].filter(item=>!known.has(articleUrl(item.url) || item.url));
        for (const item of findings) {
          const key = articleUrl(item.url) || item.url;
          if (known.has(key)) continue;
          known.add(key);
          links.push({title:item.title,url:item.url,date:item.date,provider,status:articleUrl(item.url)?'not_read':'manual',role_match:item.role_match,company_match:item.company_match});
        }
        // Leave a read for the second round when the first readable post
        // doesn't provide sufficient coverage.
        for (const item of links) {
          const url = articleUrl(item.url);
          if (enough() || signal.aborted || usage.read >= rounds || !extract || stop==='cost_budget' || stop==='model_budget') break;
          if (!url || readUrls.has(url) || item.role_match !== 'title_keyword' || item.company_match==='unknown' ||
              searchContentHint(item) !== 'interview_clue') continue;
          readUrls.add(url);
          const body = await tool('read',{round:rounds},()=>read(url,signal,fetcher));
          if (!body) { item.status='read_failed'; continue; }
          if (base.start_date && (!body.date || body.date < base.start_date || body.date > today)) {
            item.status='date_unverified'; continue;
          }
          item.status='read';
          const content=await model(instructions,JSON.stringify({topics,article:body.text}),rounds);
          let result;
          try { result=parseSourceCandidates(content,body.text); }
          catch { item.status='extraction_failed'; continue; }
          for (const entry of result.items.slice(0,5)) {
            if (!isVerifiableEvidence(entry.evidence,body.text)) continue;
            const matching=topics.filter(value=>contains(entry.evidence,value));
            const topic = matching[0] || '';
            for (const value of matching) covered.add(value);
            candidates.push({question:entry.question,evidence:entry.evidence,topic,url:body.url,title:item.title,
              date:body.date,date_basis:body.date?'article_metadata':null,kind:'reported_question',evidence_basis:'article_body',
              provider:item.provider,company:null,role:null,relevance:'title_clue'});
          }
          item.status = result.items.length ? 'evidence' : 'no_questions';
        }
      }
      if (enough()) { stop='covered'; break; }
      if (stop==='model_budget' || stop==='cost_budget') break;
      if (usage.search >= LIMITS.search || usage.read >= LIMITS.read) { stop='tool_budget'; break; }
    }
    if (signal.aborted) stop=clientSignal?.aborted?'cancelled':'deadline';
    else if (stop!=='cost_budget' && !events.some(item=>item.tool==='search' && item.status==='ok')) stop='search_unavailable';
    else if (stop!=='cost_budget' && !extract) stop='model_unavailable';
    else if (stop==='round_limit' && links.length===0) stop='no_candidates';
    const result = {candidates:[...new Map(candidates.map(item=>[JSON.stringify([item.url,item.question]),item])).values()],
      links:dedupeSearchResults(links).slice(0,40), missing_topics:topics.filter(topic=>!covered.has(topic)),
      stop,rounds,usage:{...usage,duration_ms:clock()-started},events,cached:false};
    if (stop==='covered') {
      if (cache.size>=32) cache.delete(cache.keys().next().value);
      cache.set(signature,{result,expires:clock()+300000});
    }
    return result;
  }
  return {providers,run};
}
