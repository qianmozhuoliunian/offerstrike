import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scenarios } from '../tests/fixtures/business-golden.mjs';

const directory=process.argv[2] || 'docs/evaluations/business-quality-2026-11-17';
const read=async file=>(await readFile(join(directory,file),'utf8')).replace(/^\uFEFF/,'');
const json=async file=>JSON.parse(await read(file));
const jsonl=async file=>(await read(file)).trim().split(/\r?\n/).map(JSON.parse);
const [collect,e2e,anchors,labels]=await Promise.all([
  jsonl('live-collect.jsonl'),jsonl('live-e2e.jsonl'),jsonl('live-anchors.jsonl'),json('adjudication.json')
]);
const research=collect.filter(row=>row.phase==='research');
const interview=collect.filter(row=>row.phase==='interview');
const flows=e2e.filter(row=>row.phase==='e2e');
assert.deepEqual(research.map(row=>row.id).sort(),scenarios.map(row=>row.id));
assert.deepEqual(interview.map(row=>row.id).sort(),scenarios.map(row=>row.id));
const count=(rows,condition)=>rows.filter(condition).length;
const sum=(rows,select)=>rows.reduce((total,row)=>total+select(row),0);
const group=rows=>rows.reduce((total,key)=>({...total,[key]:(total[key] || 0)+1}),{});
function latency(rows) {
  const times=rows.filter(Number.isFinite).sort((a,b)=>a-b);
  const at=p=>times[Math.ceil(times.length*p)-1] ?? null;
  return {n:times.length,p50:at(.5),p90:at(.9),max:times.at(-1) ?? null};
}
function usage(rows) {
  const calls=rows.flatMap(row=>row.calls || []);
  const search=calls.filter(call=>call.kind==='search');
  const model=calls.filter(call=>call.kind==='model');
  const known=model.filter(call=>call.status===200 && Number.isInteger(call.usage?.prompt_cache_hit_tokens) &&
    Number.isInteger(call.usage.prompt_cache_miss_tokens) && Number.isInteger(call.usage.completion_tokens));
  const cacheHit=sum(known,call=>call.usage.prompt_cache_hit_tokens);
  const cacheMiss=sum(known,call=>call.usage.prompt_cache_miss_tokens);
  const output=sum(known,call=>call.usage.completion_tokens);
  const observedSearch=count(search,call=>call.status===200);
  const estimatedCredits=sum(search.filter(call=>call.status===200),call=>call.credits ?? 1);
  // Snapshot of 2026-11-17 public Tavily pay-as-you-go and DeepSeek Flash peak rates.
  return {search_attempts:search.length,search_http_200:observedSearch,
    search_credits_estimated:estimatedCredits,
    search_credit_fields_observed:count(search,call=>call.credits!==null && call.credits!==undefined),
    search_usd_list_price:estimatedCredits*.008,
    model_attempts:model.length,model_usage_available:known.length,cacheHit,cacheMiss,output,
    model_usd_peak:(cacheHit*.006+cacheMiss*.30+output*1.20)/1e6,billed_usd:null};
}
function exactAnswers(first,answer) {
  const quotes=[...first.evaluation?.strengths || [],...first.evaluation?.weaknesses || []].map(item=>item.evidence);
  if (first.coaching?.evidence) quotes.push(first.coaching.evidence);
  return {matches:count(quotes,quote=>answer.includes(quote)),total:quotes.length};
}
const cases=scenarios.map(sample=>{
  const r=research.find(row=>row.id===sample.id), i=interview.find(row=>row.id===sample.id);
  const flow=flows.find(row=>row.id===sample.id), c=labels.research[sample.id];
  const grade=labels.interview[sample.id];
  const candidates=r.result?.candidates || [];
  assert.equal(c?.count || 0,candidates.length,'Candidate review count must agree with live output');
  return {id:sample.id,label:sample.label,searchHit:r.calls.some(call=>call.hits>0),
    links:r.result?.links.length ?? 0,read:r.result?.usage.read ?? 0,
    readOk:count(r.result?.events || [],event=>event.tool==='read' && event.status==='ok'),
    stop:r.result?.stop || r.error,reason:r.result?.task_reason || '',
    researchMs:r.ms,interviewMs:i.ms,candidates:candidates.length,company:sample.company,
    explicitCompany:count(candidates,candidate=>Boolean(candidate.company)),
    relevance:c?.topic_match || 0,companyCorrect:c?.target_company_match ?? null,eligible:!!c?.strict_eligible,
    anchored:i.first ? exactAnswers(i.first,sample.answer) : {matches:0,total:0},
    structured:!!i.first?.evaluation,feedbackPass:grade.feedback,structPass:grade.structure,
    followupSent:!!i.first?.follow_up.trim(),followupPass:grade.followup,
    careerMissing: r.before?.[0]?.action==='research' && !!r.task_id,
    e2ePassed: flow?.status==='completed' && flow.attempt_matches &&
      flow.plan.some(item=>item.attempts.includes(flow.turn.id)),
    e2eMs:flow && r.ms+flow.total_ms,sourceEvidence:anchors.filter(anchor=>candidates.some(candidate=>
      candidate.url===anchor.url && candidate.question===anchor.question && anchor.anchor)).length};
});
const price=usage([...collect,...e2e]);
const classification=Object.fromEntries(['correct','wrong','incomplete'].map(label=>{
  const selected=cases.filter(row=>row.label===label);
  return [label,{pass:count(selected,row=>row.structPass),total:selected.length}];
}));
console.log(JSON.stringify({
  metrics:{cases:cases.length,
    searchCoverage:count(cases,row=>row.searchHit),productLinkCoverage:count(cases,row=>row.links>0),links:sum(cases,row=>row.links),
    readCases:count(cases,row=>row.read>0),readAttempt:sum(cases,row=>row.read),readOk:sum(cases,row=>row.readOk),
    candidateCases:count(cases,row=>row.candidates>0),candidateCount:sum(cases,row=>row.candidates),
    sourceEvidence:sum(cases,row=>row.sourceEvidence),topicRelated:sum(cases,row=>row.relevance),
    namedCompanyCandidates:sum(cases.filter(row=>row.company),row=>row.candidates),
    namedCompanyVerified:sum(cases,row=>row.companyCorrect || 0),explicitCompany:sum(cases,row=>row.explicitCompany),
    eligible:count(cases,row=>row.eligible),eligibleCandidates:sum(cases.filter(row=>row.eligible),row=>row.candidates),
    researchStops:group(cases.map(row=>row.stop)),feedbackPass:count(cases,row=>row.feedbackPass),
    evaluationValid:count(cases,row=>row.structured),classification,
    verbatim:sum(cases,row=>row.anchored.matches),quotes:sum(cases,row=>row.anchored.total),
    followupSent:count(cases,row=>row.followupSent),followupPass:count(cases,row=>row.followupPass),
    gapsWithoutFollowup:count(cases,row=>row.label!=='correct' && !row.followupSent),
    missingTriggered:count(cases,row=>row.careerMissing),
    improvementPass:count(Object.values(labels.career_improvement),row=>row.pass),
    improvementTotal:Object.keys(labels.career_improvement).length,
    e2ePassed:count(cases,row=>row.e2ePassed),
    researchMs:latency(cases.map(row=>row.researchMs)),interviewMs:latency(cases.map(row=>row.interviewMs)),
    e2eMachineMs:latency(cases.map(row=>row.e2eMs)),price,phaseUsage:{research:usage(research),interview:usage(interview),e2e:usage(flows)}},
  cases
},null,2));
