// Explicit opt-in: live mode makes billable requests for fixed public keywords.
import { createResearch, parseCostBudget } from '../src/research/index.js';
import { createInterviewResearch } from '../src/interview-research.js';
import { createResearchModel } from '../src/research/model.js';
import { createFastApiRetrieval } from '../src/fastapi-retrieval.js';
import { articleUrl, readArticle } from '../src/research/read-source.js';
import { parsePilotUrls } from '../src/research/pilot.js';

function summarizeResearch(result, accepted) {
  const reads=result.events.filter(event=>event.tool==='read');
  const valid=accepted && result.candidates.filter(item=>accepted.includes(item.evidence)).length;
  return {
    engine:result.engine, stop:result.stop, usage:result.usage,
    read_success_rate:reads.length ? reads.filter(event=>event.status==='ok').length / reads.length : null,
    failure_rate:result.events.length ? result.events.filter(event=>event.status==='failed').length / result.events.length : null,
    valid_questions:valid ?? null, wrong_questions:valid===undefined ? null : result.candidates.length-valid,
    actual_cost:null,
    links:result.links.map(({url,status})=>({url,status})),
    candidates:result.candidates.map(({url,question,evidence,evidence_location,company})=>({url,question,evidence,evidence_location,company}))
  };
}

const roles = [
  ['AI 应用开发实习生','字节跳动','阿里巴巴','RAG'],
  ['前端开发实习生','腾讯','美团','JavaScript'],
  ['产品经理实习生','小红书','字节跳动','需求分析'],
  ['用户运营实习生','哔哩哔哩','美团','用户增长'],
  ['销售管培生','宝洁','联合利华','客户沟通']
];
const args=process.argv.slice(2);
if (args.includes('--replay')) {
  if (args.includes('--live')) throw Error('--replay 与 --live 不能同时使用');
  const {pilotReplayCases,pilotReplayOptions}=await import('../tests/fixtures/research-pilot.mjs');
  for (const sample of pilotReplayCases) {
    const options=pilotReplayOptions(sample);
    const old=await createResearch(options).run(sample.task);
    const pilotUrls=new Set(Object.keys(sample.pages));
    const trial=await createResearch({...options,pilotUrls}).run(sample.task);
    console.log(JSON.stringify({mode:'synthetic_replay',case:sample.name,
      baseline:summarizeResearch(old,sample.accepted),pilot:summarizeResearch(trial,sample.accepted)}));
  }
  process.exit(0);
}

const pilot=args.includes('--pilot');
const flag=args.find(value=>value.startsWith('--limit='));
const skipFlag=args.find(value=>value.startsWith('--skip='));
const limit=flag ? Number(flag.slice(8)) : 20;
const skip=skipFlag ? Number(skipFlag.slice(7)) : 0;
if (!Number.isInteger(limit) || limit<1 || limit>20) throw Error('limit 必须在 1 到 20 之间');
if (!Number.isInteger(skip) || skip<0 || skip>=20) throw Error('skip 必须在 0 到 19 之间');
const tasks=roles.flatMap(([role,companyA,companyB,topic])=>[
  {role,company:companyA,source:'all',range:'year',topics:[topic]},
  {role,company:companyB,source:'all',range:'6m',topics:[topic]},
  {role,company:'',source:'nowcoder',range:'3m',topics:[topic]},
  {role,company:'',source:'juejin',range:'all',topics:[topic]}
]);
const selected=tasks.slice(skip,skip+limit).map(task=>pilot?{...task,source:'cnblogs'}:task);
if (!args.includes('--live')) {
  console.log(JSON.stringify({mode:'list_only',tasks:selected},null,2));
  process.exit(0);
}
const tavilyKey=process.env.TAVILY_API_KEY, exaKey=process.env.EXA_API_KEY;
if (!tavilyKey) throw Error('Tavily 基线需要 TAVILY_API_KEY');
const baseline=createInterviewResearch({tavilyKey});
const current=createInterviewResearch({tavilyKey,exaKey});
const extract=createResearchModel({key:process.env.AI_API_KEY,model:process.env.AI_MODEL,baseUrl:process.env.AI_BASE_URL});
const retrieve=process.env.RESEARCH_SERVICE_URL
  ? createFastApiRetrieval(process.env.RESEARCH_SERVICE_URL,process.env.RESEARCH_SERVICE_TOKEN) : undefined;
const options={keys:{Tavily:tavilyKey,Exa:exaKey},extract,retrieve,costBudget:parseCostBudget(process.env.RESEARCH_COST_BUDGET)};
const pilotUrls=parsePilotUrls(pilot?process.env.RESEARCH_PILOT_URLS:undefined);
if (pilot) {
  if (!extract || !pilotUrls.size) throw Error('试点实测需要 AI 服务和 RESEARCH_PILOT_URLS 中已核对使用范围的链接');
  options.read=(url,signal,fetcher)=>{
    if (!pilotUrls.has(articleUrl(url))) throw Error('not_in_pilot');
    return readArticle(url,signal,fetcher);
  };
}
const research=createResearch(options), trial=pilot?createResearch({...options,pilotUrls}):null;
for (const task of selected) {
  if (trial) {
    const old=await research.run(task), next=await trial.run(task);
    console.log(JSON.stringify({mode:'live_pilot',task,baseline:summarizeResearch(old),pilot:summarizeResearch(next)}));
    continue;
  }
  const summarize = result => ({retrieval:result.retrieval,partial_failure:result.partial_failure,error:result.error,
    links:(result.results || []).slice(0,10).map(({url,date,title})=>({url,date,title}))});
  const [first,multi,deep]=await Promise.all([baseline.search(task),exaKey ? current.search(task) : null,research.run(task)]);
  console.log(JSON.stringify({task,baseline:summarize(first),multi:multi ? summarize(multi) : null,
    research:{...deep,candidates:deep.candidates.map(({url,topic,kind})=>({url,topic,kind}))},
    manual_review:{usable_sources:null,valid_evidence_questions:null,wrong_sources:null,actual_cost:null}}));
}
