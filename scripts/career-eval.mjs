import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../src/database.js';
import { addQuestion, setQuestionTopic } from '../src/questions.js';
import { saveValidatedRole } from '../src/role-validation.js';
import { saveProfile } from '../src/workspace.js';
import { randomUUID } from 'node:crypto';
import { saveAbilityEvaluation } from '../src/ability-evaluation.js';

if (!process.argv.includes('--live')) {
  console.log('Use --live for one fixed sample answer, or --live --coordinated to first run the public-source Research handoff.');
  process.exit(0);
}
const model=process.env.AI_MODEL;
assert.ok(process.env.AI_API_KEY && /^deepseek-/i.test(model) &&
  process.env.AI_BASE_URL && new URL(process.env.AI_BASE_URL).hostname==='api.deepseek.com',
  'Configure the official DeepSeek endpoint and model in the existing environment before testing');
const coordinated=process.argv.includes('--coordinated');
const role=coordinated?'后端开发':'AI 应用开发';
if (coordinated) assert.ok(process.env.TAVILY_API_KEY,'Configure Tavily for the coordinated live test');
const directory=await mkdtemp(join(tmpdir(),'offerstrike-career-live-'));
const file=join(directory,'interview.sqlite');
const serverFile=fileURLToPath(new URL('../server.js',import.meta.url));
let child;

async function start() {
  const env={...process.env,INTERVIEW_DATA_DIR:directory,PORT:'0'};
  delete env.INTERVIEW_DESKTOP_TOKEN;
  if (coordinated) {
    delete env.RESEARCH_SERVICE_URL;
    delete env.RESEARCH_PILOT_URLS;
  }
  child=spawn(process.execPath,[serverFile],{cwd:directory,env,stdio:['ignore','pipe','ignore']});
  const [base,access]=await new Promise((resolve,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(Error('The isolated service did not start')),10000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('The isolated service exited'));});
    child.stdout.on('data',chunk=>{
      output+=chunk;
      const match=output.match(/(http:\/\/127\.0\.0\.1:\d+)\/#access=([a-f0-9]{64})/u);
      if (match) {clearTimeout(timer);resolve(match.slice(1));}
    });
  });
  return async (path,input)=>{
    const headers={'x-offerpilot-access':access,'content-type':'application/json'};
    const response=await fetch(base+path,{headers,method:input?'POST':'GET',body:input?JSON.stringify({role,...input}):undefined,
      signal:AbortSignal.timeout(path==='/api/research'?85000:50000)});
    const result=await response.json();
    assert.ok(response.ok,`${path} returned ${response.status}: ${result.error || 'request failed'}`);
    return result;
  };
}

async function stop() {
  if (child && child.exitCode===null && child.signalCode===null && child.pid) {
    const exited=once(child,'exit');
    child.kill();
    await exited;
  }
}

async function validateCoordinatedFlow() {
  const request=await start(), plan='/api/career/plan';
  const selection={topics:['HTTP']};
  const initial=await request(plan,selection);
  assert.equal(initial.tasks[0].action,'research');
  assert.equal(initial.tasks[0].evidence[0].attempt_id,'prior-http-attempt');
  const {task}=await request('/api/training/tasks/create',{topic:'HTTP',request_id:randomUUID()});
  assert.equal(task.status,'proposed');
  const scope={task_id:task.id,company:'今日头条',source:'cnblogs',range:'all',confirm:true};
  const result=await request('/api/research',scope);
  assert.equal(result.task_status,'review',JSON.stringify({stop:result.stop,reason:result.task_reason,usage:result.usage}));
  // Each approved excerpt belongs to the author's first-round account in the public post.
  const examples=[
    {excerpt:'说说HTTP缓存',answer:'HTTP 缓存里，Cache-Control: no-cache 的意思是任何响应都不能存到缓存；max-age 过期后也不需要向服务器验证。'},
    {excerpt:'HTTP2了解吗',answer:'HTTP/2 的多路复用给每个请求单独开一个 TCP 连接；同一 TCP 连接无法并发承载多个流。'},
    {excerpt:'说说HTTP',answer:'HTTP 是应用层协议，不过 HTTP 本身会在每个请求之间保存客户端登录会话，服务端无需 Cookie、令牌或其他机制。'}
  ];
  const candidates=result.candidates.filter(item=>item.url==='https://www.cnblogs.com/jianrenfang/p/8697397.html');
  const example=examples.find(item=>candidates.some(candidate=>candidate.evidence.includes(item.excerpt)));
  assert.ok(example,JSON.stringify({message:'Expected a previously verified question',candidates:result.candidates.map(({url,question})=>({url,question}))}));
  const candidate=candidates.find(item=>item.evidence.includes(example.excerpt));
  assert.equal((await request('/api/state')).sources.length,0);
  await stop();
  const resumed=await start();
  const taskPath='/api/training/tasks?'+new URLSearchParams({role,id:task.id});
  assert.equal((await resumed(taskPath)).task.result.candidates.find(item=>item.id===candidate.id).evidence,candidate.evidence);
  const confirm={task_id:task.id,id:candidate.id,self_reported:true};
  const saved=await resumed('/api/research/confirm',confirm);
  assert.equal((await resumed('/api/research/confirm',confirm)).id,saved.id);
  const started=performance.now();
  const {answer}=example;
  const turn=await resumed('/api/practice/dialogue/turn',{question:saved.text,answer,request_id:'live-http-cache',
    question_ref:{kind:'source',id:saved.id}});
  const turnMs=Math.round(performance.now()-started);
  assert.ok(turn.evaluation?.weaknesses.some(item=>item.type==='incorrect' && answer.includes(item.evidence)));
  const {task:completed}=await resumed(taskPath);
  assert.equal(completed.status,'completed');
  assert.equal(completed.attempt_id,turn.id);
  const after=await resumed(plan,selection);
  assert.ok(['review','followup'].includes(after.tasks[0].action),JSON.stringify({topic:turn.evaluation.topic,actions:after.tasks.map(item=>item.action)}));
  assert.ok(after.tasks[0].evidence.some(item=>item.attempt_id===turn.id));
  console.log(JSON.stringify({provider:candidate.provider,model,research_stop:result.stop,research_usage:result.usage,
    source:candidate.url,original_evidence:candidate.evidence,turn_ms:turnMs,task_status:completed.status,
    before:initial.tasks[0].action,after:after.tasks[0].action,next:after.tasks[0].followup?.question || after.tasks[0].question.text,
    answer_evidence:after.tasks[0].evidence[0].evidence,candidates_reopened:true}));
}

async function validateCareerPlan(question,rag) {
  const request=await start();
  const plan='/api/career/plan', history='/api/career/ability-history?'+new URLSearchParams({role});
  const before=await request(plan,{});
  assert.equal(before.tasks[0].topic,'SQL');
  const answer='先根据用户查询检索相关文档，把检索到的片段作为上下文交给生成模型。检索返回越多，答案就一定越准确。';
  const started=performance.now();
  const turn=await request('/api/practice/dialogue/turn',{question,answer,question_ref:{kind:'source',id:rag.id},request_id:'career-live-rag'});
  const turn_ms=Math.round(performance.now()-started);
  assert.ok(turn.feedback && turn.evaluation?.weaknesses.some(item=>item.type==='incorrect'),'DeepSeek must return a grounded error');
  const after=await request(plan,{});
  const [next]=after.tasks;
  assert.ok(['followup','review'].includes(next.action));
  assert.equal(next.topic,'RAG');
  assert.equal(next.action==='review'?next.question.question_ref.id:next.followup.parent_attempt_id,next.action==='review'?rag.id:turn.id);
  assert.ok(next.evidence.some(item=>item.attempt_id===turn.id && item.evidence && answer.includes(item.evidence)));
  const observations=await request(history);
  assert.ok(observations.profile.points.some(item=>item.evidence.some(item=>item.attempt_id===turn.id)));
  await stop();
  const reopened=await start();
  assert.deepEqual(await reopened(plan,{}),after);
  assert.deepEqual(await reopened(history),observations);
  console.log(JSON.stringify({model,turn_ms,before:{action:before.tasks[0].action,topic:before.tasks[0].topic},
    after:{action:next.action,topic:next.topic,point:next.point,question:next.followup?.question || next.question?.text,
      evidence:next.evidence[0].evidence},reopened:true}));
}

try {
  const db=new DatabaseSync(file);
  const question='请用 RAG 解释如何使用检索结果，并说明如何评估检索质量。';
  let rag;
  try {
    migrateDatabase(db);
    saveValidatedRole(db,role,'confirmed');
    if (coordinated) {
      saveProfile(db,role,'合成岗位说明','HTTP');
      const priorAnswer='HTTP 缓存总是永久有效。', attempt='prior-http-attempt';
      db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run(attempt,'什么决定 HTTP 缓存的有效期？',priorAnswer,
        '缓存有效期取决于存储和响应指令。',role,'2025-01-01T00:00:00.000Z');
      saveAbilityEvaluation(db,attempt,{topic:'HTTP',strengths:[],weaknesses:[{point:'缓存有效期',type:'incorrect',evidence:priorAnswer}],
        unverified:[],followup_point:'',suggested_followup:'',recommended_action:'review'});
    } else {
      saveProfile(db,role,'合成岗位说明','SQL\nRAG');
      db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created) VALUES (?,?,?,?,?,?,?,?)')
        .run('live-eval','隔离验收示例','https://example.com/offerstrike-eval','','来源未知','',role,new Date().toISOString());
      const sql=addQuestion(db,'live-eval','SQL 的事务隔离有哪些级别？');
      rag=addQuestion(db,'live-eval',question);
      setQuestionTopic(db,'source',sql.id,'SQL','live-eval');
      setQuestionTopic(db,'source',rag.id,'RAG','live-eval');
    }
  } finally {db.close();}
  if (coordinated) await validateCoordinatedFlow();
  else await validateCareerPlan(question,rag);
} finally {
  await stop();
  await rm(directory,{recursive:true,force:true});
}
