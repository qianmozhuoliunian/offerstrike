import { filterByDate } from './core.js';
import { searchRequests, dedupeSearchResults, searchSource, searchPublishedDate } from './services.js';
import { filterSearchRelevance } from './search-relevance.js';
import { partitionSearchResults, searchContentHint } from './search-quality.js';
import { assessSearchAiRelevance } from './search-ai-relevance.js';

const MIN_CLUES = 3;
const TIMEOUT_MS = 12_000;
const platforms = {nowcoder:'牛客',juejin:'掘金',zhihu:'知乎',csdn:'CSDN',cnblogs:'博客园','51cto':'51CTO',segmentfault:'SegmentFault'};

async function fetchCandidates(fetcher, provider, key, request) {
  const exa = provider === 'Exa';
  const response = await fetcher(exa ? 'https://api.exa.ai/search' : 'https://api.tavily.com/search', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {'content-type':'application/json', ...(exa ? {'x-api-key':key} : {authorization:`Bearer ${key}`})},
    body: JSON.stringify(request)
  });
  if (!response.ok) throw Error(`${provider} 检索失败`);
  const data = await response.json();
  if (!Array.isArray(data?.results)) throw Error(`${provider} 返回格式无效`);
  return data.results.map(item => ({
    title:item?.title, url:item?.url,
    snippet:exa ? (Array.isArray(item?.highlights) ? item.highlights.filter(h => typeof h === 'string').join(' … ') : '') : item?.content,
    published_date:exa ? item?.publishedDate : item?.published_date
  }));
}

function normalizeCandidates(rows, provider) {
  return rows.flatMap(item => {
    const url = item?.url;
    const site = typeof url === 'string' && searchSource(url);
    if (!site || typeof item.title !== 'string' || !item.title.trim()) return [];
    const snippet = item.snippet;
    return [{title:item.title, url, snippet:typeof snippet === 'string' ? snippet : '',
      date:searchPublishedDate(item.published_date), site, platform:platforms[site], provider}];
  });
}

// The caller supplies public search terms only. This module neither reads the
// workspace nor saves research results as verified sources or questions.
export function createInterviewResearch({tavilyKey, exaKey, fetcher = fetch, requestAi, retrieve}) {
  const providers = [...(tavilyKey ? ['Tavily'] : []), ...(exaKey ? ['Exa'] : [])];
  return {
    providers,
    async search({role, company = '', source = 'all', range = 'year', useAi = false, now = new Date()}) {
      if (!providers.length) throw Error('尚未配置搜索服务');
      const queries = searchRequests(role, company, '', range, now, source);
      const [{start_date:from, include_domains:domains}] = queries;
      const today = now.toISOString().slice(0, 10);
      const started = performance.now(), used = [];
      let requests = 0, failures = 0, fallbackReason = null;
      const candidates = [];
      const run = async (provider, key, plans, phrases) => {
        used.push(provider);
        requests += plans.length;
        const outcomes = await Promise.allSettled(plans.map((plan, index) => retrieve
          ? retrieve({provider, role, company, domains, phrase:phrases[index], from, today})
          : fetchCandidates(fetcher, provider, key, plan)));
        for (const result of outcomes) {
          if (result.status === 'fulfilled') candidates.push(...normalizeCandidates(result.value, provider));
          else failures++;
        }
      };
      const shortlist = () => {
        const scoped = candidates.filter(item => source === 'all' || item.site === source);
        const dated = from ? filterByDate(scoped, from).filter(item => item.date <= today) : scoped;
        return filterSearchRelevance(role, dedupeSearchResults(dated), {company});
      };

      if (tavilyKey) await run('Tavily', tavilyKey, queries, ['面经', '面试经验']);
      const clues = shortlist().results.filter(item => searchContentHint(item) === 'interview_clue').length;
      if (exaKey && (!tavilyKey || clues < MIN_CLUES)) {
        if (tavilyKey) fallbackReason = failures === requests ? 'unavailable' : 'insufficient_clues';
        await run('Exa', exaKey, [{
          query:[role, company, '面试经历'].filter(Boolean).join(' '),
          type:'auto', numResults:10, includeDomains:domains, contents:{highlights:true},
          ...(from ? {startPublishedDate:`${from}T00:00:00.000Z`, endPublishedDate:`${today}T23:59:59.999Z`} : {})
        }], ['面试经历']);
      }
      const retrieval = {providers:used, fallback_reason:fallbackReason, requests, duration_ms:Math.round(performance.now()-started),
        ...(retrieve ? {engine:'fastapi'} : {})};
      if (failures === requests) return {unavailable:true, retrieval,
        error:retrieve
          ? 'Python 研究服务未能完成检索，请确认 FastAPI 已启动，并检查搜索密钥、网络和服务额度。也可以手动添加来源。'
          : `${used.join(' 和 ')} 检索失败，请检查网络、密钥和服务额度后重试，也可以手动添加来源。`};

      const relevant = shortlist();
      let {results:matched, unverified} = relevant, aiWarning = '';
      if (useAi) {
        const all = [...matched, ...unverified];
        matched = [];
        if (!requestAi) {
          unverified = all.map(item => ({...item, ai_relevance:'uncertain', ai_evidence:null}));
          aiWarning = 'AI 相关性判断未配置，所有结果均待核实。';
        } else {
          unverified = [];
          const assessment = await assessSearchAiRelevance({enabled:true, role, company, results:all, request:requestAi});
          for (const {index, status, ...evidence} of assessment.items) {
            const result = {...all[index], ai_relevance:status, ai_evidence:status === 'uncertain' ? null : evidence};
            (status === 'related' ? matched : unverified).push(result);
          }
          aiWarning = assessment.warning;
        }
      }
      const notice = [
        retrieve ? '本次由 Python 研究服务执行检索。' : '',
        fallbackReason === 'unavailable' ? 'Tavily 检索失败，已改用 Exa。' : '',
        fallbackReason === 'insufficient_clues' ? 'Tavily 初筛线索较少，已用 Exa 补搜。' : '',
        `本次使用 ${used.join('、')}，共 ${requests} 次检索请求。`,
        failures ? '部分检索失败，结果不完整，可重试。' : '',
        from ? '已隐藏日期未知或不在范围内的结果；可尝试不限时间。' : '',
        '日期由搜索服务提供，需核实原帖。',
        useAi ? 'AI 判断仅供参考，仍需核实原帖。' : '已按标题中的岗位关键词和面试线索初筛，相关性仍需核实。',
        relevant.filtered ? `已隐藏 ${relevant.filtered} 条标题明显偏向 Java 或后端的结果。` : '',
        aiWarning
      ].filter(Boolean).join(' ');
      return {...partitionSearchResults(matched, unverified), notice, partial_failure:failures > 0, retrieval};
    }
  };
}
