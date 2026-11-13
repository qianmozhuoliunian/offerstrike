// Explicit opt-in: live mode makes billable requests for fixed public keywords.
import { createResearch, parseCostBudget } from '../src/research/index.js';
import { createInterviewResearch } from '../src/interview-research.js';
import { createResearchModel } from '../src/research/model.js';

const roles = [
  ['AI 应用开发实习生','字节跳动','阿里巴巴','RAG'],
  ['前端开发实习生','腾讯','美团','JavaScript'],
  ['产品经理实习生','小红书','字节跳动','需求分析'],
  ['用户运营实习生','哔哩哔哩','美团','用户增长'],
  ['销售管培生','宝洁','联合利华','客户沟通']
];
const args=process.argv.slice(2);
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
const selected=tasks.slice(skip,skip+limit);
if (!args.includes('--live')) {
  console.log(JSON.stringify({mode:'list_only',tasks:selected},null,2));
  process.exit(0);
}
const tavilyKey=process.env.TAVILY_API_KEY, exaKey=process.env.EXA_API_KEY;
if (!tavilyKey) throw Error('Tavily 基线需要 TAVILY_API_KEY');
const baseline=createInterviewResearch({tavilyKey});
const current=createInterviewResearch({tavilyKey,exaKey});
const extract=createResearchModel({key:process.env.AI_API_KEY,model:process.env.AI_MODEL,baseUrl:process.env.AI_BASE_URL});
const research=createResearch({keys:{Tavily:tavilyKey,Exa:exaKey},extract,costBudget:parseCostBudget(process.env.RESEARCH_COST_BUDGET)});
for (const task of selected) {
  const summarize = result => ({retrieval:result.retrieval,partial_failure:result.partial_failure,error:result.error,
    links:(result.results || []).slice(0,10).map(({url,date,title})=>({url,date,title}))});
  const [first,multi,deep]=await Promise.all([baseline.search(task),exaKey ? current.search(task) : null,research.run(task)]);
  console.log(JSON.stringify({task,baseline:summarize(first),multi:multi ? summarize(multi) : null,
    research:{...deep,candidates:deep.candidates.map(({url,topic,kind})=>({url,topic,kind}))},
    manual_review:{usable_sources:null,valid_evidence_questions:null,wrong_sources:null,actual_cost:null}}));
}
