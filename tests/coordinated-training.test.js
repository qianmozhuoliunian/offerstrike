import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../src/database.js';
import { saveValidatedRole } from '../src/role-validation.js';
import { createAgentWorkflow } from '../src/agent-workflow.js';
import { createPracticeApi } from '../src/practice-api.js';
import { createResearch } from '../src/research/index.js';
import { addQuestion, setQuestionTopic } from '../src/questions.js';

const role='AI Agent 开发实习生', url='https://www.cnblogs.com/example/p/123.html';
const question='RAG 怎么评估检索质量？', quote='面试官问：'+question;
const wrong='RAG 只要有返回值，检索质量就一定合格。';
const correct='用有标注的相关文档计算 Recall@k，结合排序质量评估。';

function fixture({mode='ok',clock=Date.now}={}) {
  const calls={search:0,reviews:0};
  const research=createResearch({keys:{Tavily:'mock'},clock,
    fetcher:async (endpoint,options)=>{
      calls.search++;
      const {query}=JSON.parse(options.body);
      assert.doesNotMatch(query,/只要有返回值|Recall/);
      if (mode==='wait') {
        await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
      }
      return Response.json({results:mode==='empty'?[]:[{url,title:role+'一面面经'}]});
    },
    read:async()=>({url,date:'',title:role+'一面面经',text:'我参加了一面。\n\n'+quote}),
    extract:async()=>{
      if (mode==='model') throw Error('model unavailable');
      const items=mode==='forged'?[{question,evidence:'网页中没有这句 RAG 检索评估题'}]:[{question,evidence:quote}];
      return {content:JSON.stringify({items})};
    }});
  const requestAi=async payload=>{
    calls.reviews++;
    const {answer,question}=JSON.parse(payload.messages.at(-1).content);
    if (answer==='模型失败时的作答') return new Response('',{status:502});
    const ok=answer===correct;
    const http=question==='说说HTTP缓存';
    const point=http?'缓存指令':ok?'检索质量评估':'检索评估';
    return Response.json({choices:[{message:{content:JSON.stringify({feedback:'已点评',focus:point,evidence:answer,next_step:'再做一次评估',
      follow_up:'',evaluation:{topic:http?'HTTP 缓存':ok?'RAG':'检索增强生成',strengths:ok?[{point,evidence:answer}]:[],
        weaknesses:ok?[]:[{point,evidence:answer,type:'incorrect'}],unverified:['生成质量评估','召回率'],
        followup_point:'',recommended_action:'review'}})}}]});
  };
  function connect(db) {
    const workflow=createAgentWorkflow({db,currentRole:()=>role,research,clock});
    const practice=createPracticeApi({db,currentRole:()=>role,requestAi});
    const call=(path,input={})=>workflow(path,{role,...input},new AbortController().signal);
    const task=async id=>(await call('/api/training/tasks',{id})).body.task;
    const answer=async input=>(await practice('/api/practice/dialogue/turn',{method:'POST',input:{role,...input}})).body;
    const create=async (request_id=randomUUID())=>(await call('/api/training/tasks/create',{topic:'RAG',request_id})).body.task;
    return {call,task,answer,create};
  }
  return {connect,calls};
}

function open(file=':memory:') {
  const db=new DatabaseSync(file);
  migrateDatabase(db);
  saveValidatedRole(db,role,'confirmed');
  return db;
}
const search=(api,id,options={})=>api.call('/api/research',{task_id:id,confirm:true,source:'cnblogs',range:'all',...options});

test('Career, Research and Interview maintain one verified task through restart and update the next plan',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'offerstrike-training-')), file=join(directory,'db.sqlite');
  const {connect,calls}=fixture();
  let db=open(file), api=connect(db);
  try {
    db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created) VALUES (?,?,?,?,?,?,?,?)')
      .run('existing','已有题库','','','来源未知','',role,new Date().toISOString());
    const intro=addQuestion(db,'existing','RAG 的基本架构是什么？');
    setQuestionTopic(db,'source',intro.id,'RAG','existing');
    const first=await api.answer({question:'检索增强生成如何保证检索质量？',answer:wrong});
    const before=(await api.call('/api/career/plan',{topics:['RAG']})).body;
    assert.equal(before.tasks[0].action,'research');
    assert.equal(before.tasks[0].evidence[0].attempt_id,first.id);
    const requestId=randomUUID(), proposed=await api.create(requestId);
    assert.deepEqual(proposed.research_request,{role,topics:['RAG'],focus:'检索评估'});
    assert.equal((await api.create()).id,proposed.id);
    assert.equal((await api.create(requestId)).id,proposed.id);
    assert.equal(calls.search,0);
    await assert.rejects(search(api,proposed.id,{confirm:false}),/确认/);
    const {body:found}=await search(api,proposed.id,{topics:['不得替换主题']});
    assert.equal(found.task_status,'review');
    assert.equal(found.candidates[0].evidence,quote);
    assert.equal(db.prepare('SELECT count(*) AS n FROM questions').get().n,1);
    const candidate=found.candidates[0];
    db.close();db=open(file);api=connect(db);
    assert.equal((await api.task(proposed.id)).result.candidates[0].id,candidate.id);
    const searchCount=calls.search;
    assert.equal((await search(api,proposed.id)).body.candidates[0].id,candidate.id);
    assert.equal(calls.search,searchCount);
    await assert.rejects(api.call('/api/research/confirm',{task_id:proposed.id,id:candidate.id}),/自述/);
    const confirm={task_id:proposed.id,id:candidate.id,self_reported:true};
    const {body:saved}=await api.call('/api/research/confirm',confirm);
    assert.equal((await api.call('/api/research/confirm',confirm)).body.id,saved.id);
    assert.equal((await api.task(proposed.id)).status,'ready');
    const input={question:saved.text,question_ref:{kind:'source',id:saved.id},request_id:'interview-task'};
    await assert.rejects(api.answer({...input,answer:'模型失败时的作答'}),/AI/);
    assert.equal((await api.task(proposed.id)).status,'ready');
    const scored=await api.answer({...input,answer:correct});
    assert.equal((await api.answer({...input,answer:correct})).id,scored.id);
    const completed=await api.task(proposed.id);
    assert.equal(completed.status,'completed');
    assert.equal(completed.attempt_id,scored.id);
    const {profile}= (await api.call('/api/career/ability-history')).body;
    const point=profile.points.find(item=>item.point==='检索质量评估');
    assert.equal(point.change,'improving');
    assert.deepEqual(point.evidence.map(item=>item.raw_point),['检索质量评估','检索评估']);
    assert.ok(profile.points.some(item=>item.point==='生成质量评估' && item.unverified===2));
    assert.ok(profile.points.some(item=>item.point==='召回率' && item.unverified===2));
    assert.equal((await api.call('/api/career/plan',{topics:['RAG']})).body.tasks[0].action,'practice');
    await assert.rejects(api.call('/api/training/tasks',{id:proposed.id,role:'其他岗位'}),/岗位/);
  } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('a narrower model topic can inform the library topic recommendation without merging both names',async()=>{
  const db=open(), api=fixture().connect(db);
  try {
    db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created) VALUES (?,?,?,?,?,?,?,?)')
      .run('http','已有题库','','','来源未知','',role,new Date().toISOString());
    const http=addQuestion(db,'http','说说HTTP缓存');
    setQuestionTopic(db,'source',http.id,'HTTP','http');
    const turn=await api.answer({question:http.text,question_ref:{kind:'source',id:http.id},answer:'HTTP 缓存的 no-cache 等于不存储。'});
    const {body}=await api.call('/api/career/plan',{topics:['HTTP']});
    assert.equal(body.tasks[0].action,'review');
    assert.equal(body.tasks[0].evidence[0].attempt_id,turn.id);
    assert.equal(body.profile.points[0].topic,'HTTP 缓存');
  } finally {db.close();}
});

for (const [mode,reason] of [['empty','no_results'],['forged','insufficient_evidence'],['model','model_failed']]) {
  test(`Research stores the ${reason} outcome and leaves the question bank empty`,async()=>{
    const db=open(), {connect}=fixture({mode}), api=connect(db);
    try {
      const task=await api.create();
      assert.equal((await search(api,task.id)).body.task_reason,reason);
      assert.equal((await api.task(task.id)).status,'failed');
      assert.equal(db.prepare('SELECT count(*) AS n FROM questions').get().n,0);
      assert.notEqual((await api.create()).id,task.id);
    } finally {db.close();}
  });
}

test('cancellation aborts in-flight search and a lost worker expires without automatically searching again',async()=>{
  const db=open();
  let now=Date.now();
  const {connect,calls}=fixture({mode:'wait',clock:()=>now}), api=connect(db);
  try {
    const task=await api.create();
    const pending=assert.rejects(search(api,task.id),{name:'AbortError'});
    while (!calls.search) await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await search(api,task.id)).status,409);
    await api.call('/api/training/tasks/cancel',{id:task.id});
    await pending;
    assert.equal((await api.task(task.id)).status,'cancelled');
    const orphan=await api.create();
    db.prepare("UPDATE training_tasks SET status='searching',started_at=? WHERE id=?").run(now,orphan.id);
    now+=81000;
    const recovered=await connect(db).task(orphan.id);
    assert.equal(recovered.reason,'timeout');
    assert.equal(recovered.status,'failed');
    assert.equal(calls.search,1);
  } finally {db.close();}
});
