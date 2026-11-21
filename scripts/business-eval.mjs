import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createAgentWorkflow } from '../src/agent-workflow.js';
import { createAiTransport } from '../src/ai-transport.js';
import { migrateDatabase } from '../src/database.js';
import { createPracticeApi } from '../src/practice-api.js';
import { addQuestion, setQuestionTopic } from '../src/questions.js';
import { createResearch } from '../src/research/index.js';
import { createResearchModel } from '../src/research/model.js';
import { readArticle } from '../src/research/read-source.js';
import { saveValidatedRole } from '../src/role-validation.js';
import { isVerifiableEvidence } from '../src/source-extraction.js';
import { saveProfile } from '../src/workspace.js';
import { scenarios } from '../tests/fixtures/business-golden.mjs';

const args=process.argv.slice(2);
const mode=args.find(arg=>arg.startsWith('--phase='))?.slice(8) || 'collect';
const emit=row=>console.log(JSON.stringify(row));
if (mode==='anchors') {
  const from=args.find(arg=>arg.startsWith('--input='))?.slice(8);
  if (!from) throw Error('Supply --input with a collected JSONL file');
  const rows=(await readFile(from,'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(JSON.parse);
  const candidates=rows.flatMap(row=>row.result?.candidates || []);
  const urls=[...new Set(candidates.map(candidate=>candidate.url))];
  const articles=new Map();
  for (const url of urls) {
    const article=await readArticle(url,AbortSignal.timeout(15000)).catch(error=>({error:error.message}));
    articles.set(url,article);
  }
  const records=candidates.map(({url,question,evidence})=>{
    const article=articles.get(url);
    return {url,question,anchor:!article.error && isVerifiableEvidence(evidence,article.text),date:article.date,error:article.error};
  });
  if (records.length) await new Promise(resolve=>process.stdout.write(records.map(row=>JSON.stringify(row)).join('\n')+'\n',resolve));
  process.exit(0);
}
if (!args.includes('--live')) {
  await new Promise(resolve=>process.stdout.write(JSON.stringify(scenarios,null,2)+'\n',resolve));
  process.exit(0);
}
const stateArg=args.find(arg=>arg.startsWith('--state='))?.slice(8);
if (!stateArg) throw Error('Specify an isolated --state directory');
const directory=resolve(stateArg);
await mkdir(directory,{recursive:true});
if (!['collect','confirm','research'].includes(mode)) throw Error('Use --phase=collect, research or confirm');
const rootArg=args.find(arg=>arg.startsWith('--baseline-root='))?.slice(16);
const researchFactory=rootArg ? (await import(pathToFileURL(resolve(rootArg,'src/research/index.js')))).createResearch : createResearch;
const samplesArg=args.find(arg=>arg.startsWith('--samples='))?.slice(10);
const samples=samplesArg ? JSON.parse(await readFile(samplesArg,'utf8')) : scenarios;
const sampleIds=args.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',') || scenarios.map(item=>item.id);
const model=process.env.AI_MODEL, baseUrl=process.env.AI_BASE_URL;
const keys={Tavily:process.env.TAVILY_API_KEY};
if (!keys.Tavily || !process.env.AI_API_KEY || model!=='deepseek-flash' || !baseUrl ||
    new URL(baseUrl).hostname!=='api.deepseek.com') throw Error('Configure Tavily and official deepseek-flash');
const reviewedPath=args.find(arg=>arg.startsWith('--reviewed='))?.slice(11);
const reviewed=mode==='confirm' ? JSON.parse(await readFile(reviewedPath,'utf8')) : [];
const now=()=>new Date().toISOString();
const elapsed=start=>Math.round(performance.now()-start);

function setup(sample) {
  const calls=[],decisions=[];
  async function fetcher(url,options) {
    const host=new URL(url).hostname;
    const kind=host==='api.deepseek.com'?'model':host==='api.tavily.com'?'search':'read';
    const entry={kind,at:now(),status:null};
    if (kind==='read') entry.url=url;
    const start=performance.now();
    calls.push(entry);
    try {
      const response=await fetch(url,options);
      entry.status=response.status;
      if (kind!=='read' && response.ok) {
        const data=await response.clone().json().catch(()=>null);
        if (kind==='search') {
          entry.query=JSON.parse(options.body).query;
          entry.hits=Array.isArray(data?.results)?data.results.length:null;
          entry.credits=data?.usage?.credits ?? null;
          entry.results=data?.results?.map(({title,url,published_date})=>({title,url,published_date}));
        } else {
          entry.usage=data?.usage ?? null;
          entry.model=data?.model ?? model;
        }
      }
      return response;
    } catch (error) {
      entry.error=error.cause?.code || error.name;
      throw error;
    } finally {entry.ms=elapsed(start);}
  }
  const {role,topic}=sample;
  const requestAi=createAiTransport({key:process.env.AI_API_KEY,baseUrl,model,fetcher});
  const research=researchFactory({keys,fetcher,extract:createResearchModel({request:requestAi}),
    trace:row=>decisions.push(row)});
  function connect(db) {
    const call=createAgentWorkflow({db,currentRole:()=>role,research});
    const practice=createPracticeApi({db,currentRole:()=>role,requestAi});
    const run=async (path,input={})=>(await call(path,{role,...input},new AbortController().signal)).body;
    return {run,plan:async()=> (await run('/api/career/plan',{topics:[topic]})).tasks,
      turn:async (question,answer,ref)=> (await practice('/api/practice/dialogue/turn',{method:'POST',
        input:{role,question,answer,question_ref:ref,request_id:randomUUID()}})).body};
  }
  return {connect,calls,decisions};
}

function init(db,{role,topic}) {
  migrateDatabase(db);
  saveValidatedRole(db,role,'confirmed');
  saveProfile(db,role,'',topic);
}

const compact=tasks=>tasks.map(({action,point,reason,question,followup,evidence})=>({
  action,point,reason,question:question?.text || followup?.question,attempts:evidence?.map(row=>row.attempt_id)
}));

async function runInterview(sample) {
  const db=new DatabaseSync(':memory:');
  const {connect,calls}=setup(sample);
  try {
    init(db,sample);
    const api=connect(db);
    const {role,topic,question,answer,improved}=sample;
    db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created) VALUES (?,?,?,?,?,?,?,?)')
      .run('eval','固定评价题','','','来源未知','',role,now());
    const item=addQuestion(db,'eval',question);
    setQuestionTopic(db,'source',item.id,topic,'eval');
    const ref={kind:'source',id:item.id};
    const start=performance.now();
    const first=await api.turn(question,answer,ref);
    const ms=elapsed(start);
    const plan=compact(await api.plan());
    let second;
    if (improved) {
      const retryStart=performance.now();
      const result=await api.turn(question,improved,ref);
      second={result,ms:elapsed(retryStart),plan:compact(await api.plan())};
    }
    emit({phase:'interview',id:sample.id,ms,first,plan,second,calls});
  } catch (error) {emit({phase:'interview',id:sample.id,error:error.message,calls});}
  finally {db.close();}
}

async function runResearch(sample) {
  const file=join(directory,sample.id+'.sqlite');
  const exists=await access(file).then(()=>true,()=>false);
  if (exists) throw Error('Research state already exists for '+sample.id);
  const db=new DatabaseSync(file);
  const {connect,calls,decisions}=setup(sample);
  try {
    init(db,sample);
    const api=connect(db);
    const {topic,company,source,range}=sample;
    const before=compact(await api.plan());
    const {task}=await api.run('/api/training/tasks/create',{topic,request_id:randomUUID()});
    const start=performance.now();
    const result=await api.run('/api/research',{task_id:task.id,company,source,range,confirm:true});
    emit({phase:'research',id:sample.id,ms:elapsed(start),before,task_id:task.id,result,calls,decisions});
  } catch (error) {emit({phase:'research',id:sample.id,error:error.message,calls});}
  finally {db.close();}
}

async function confirm(item) {
  const sample=scenarios.find(row=>row.id===item.id);
  const {connect,calls}=setup(sample);
  const file=join(directory,item.id+'.sqlite');
  await access(file);
  const db=new DatabaseSync(file);
  try {
    const api=connect(db);
    const {task}=await api.run('/api/training/tasks',{id:item.task_id});
    const candidate=task.result.candidates.find(candidate=>candidate.id===item.candidate_id);
    if (!candidate || candidate.url!==item.url || candidate.evidence!==item.evidence || item.author_confirmed!==true) {
      throw Error('Review record does not match a candidate from this run');
    }
    const start=performance.now();
    const saved=await api.run('/api/research/confirm',{task_id:task.id,id:candidate.id,self_reported:true});
    const confirmMs=elapsed(start);
    const reviewStart=performance.now();
    const turn=await api.turn(saved.text,item.answer,{kind:'source',id:saved.id});
    const interviewMs=elapsed(reviewStart);
    const plan=compact(await api.plan());
    const {task:finished}=await api.run('/api/training/tasks',{id:task.id});
    emit({phase:'e2e',id:item.id,confirm_ms:confirmMs,interview_ms:interviewMs,total_ms:elapsed(start),
      status:finished.status,attempt_matches:finished.attempt_id===turn.id,turn,plan,calls});
  } catch (error) {emit({phase:'e2e',id:item.id,error:error.message,calls});}
  finally {db.close();}
}

emit({phase:'metadata',mode,started_at:now(),model,search:'Tavily basic',node:process.version,
  baseline_root:rootArg || null,ids:args.some(arg=>arg.startsWith('--ids=')) ? sampleIds : samples.map(sample=>sample.id)});
if (mode==='confirm') {
  for (const item of reviewed) await confirm(item);
} else {
  const selected=samples.filter(sample=>!args.some(arg=>arg.startsWith('--ids=')) || sampleIds.includes(sample.id));
  const queue=selected.flatMap(sample=>mode==='research'?[()=>runResearch(sample)]:[()=>runResearch(sample),()=>runInterview(sample)]);
  await Promise.all(Array.from({length:4},async()=>{
    while (queue.length) await queue.shift()();
  }));
}
