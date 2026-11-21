import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateDatabase } from '../src/database.js';
import { createAgentWorkflow } from '../src/agent-workflow.js';
import { createPracticeApi } from '../src/practice-api.js';
import { saveValidatedRole } from '../src/role-validation.js';
import { addQuestion, setQuestionTopic } from '../src/questions.js';
import { saveProfile } from '../src/workspace.js';

const role='AI 应用开发', otherRole='前端开发';
const ragQuestion='RAG 中增加召回结果一定会提高答案准确率吗？';
const sqlQuestion='SQL 的事务隔离有哪些级别？';
const point='召回数量与答案准确率';
const incorrect='检索结果越多就一定越准确。';
const correct='更多检索结果可能引入噪声，准确率不一定提高。';

function practice(db,{targetFollowup=false}={}) {
  const requestAi=async ({messages})=>{
    const {answer,question}=JSON.parse(messages.at(-1).content);
    if (!answer) return Response.json({choices:[{message:{content:JSON.stringify({summary:'本题完成。'})}}]});
    const status=answer===correct?'correct':answer===incorrect?'incorrect':'unverified';
    const evaluation={topic:question.includes('RAG')?'RAG':'',strengths:status==='correct'?[{point,evidence:answer}]:[],
      weaknesses:status==='incorrect'?[{point,type:'incorrect',evidence:answer}]:[],
      unverified:status==='unverified'?[point]:[],followup_point:'',recommended_action:'review'};
    const response={feedback:'已保存本轮点评。',focus:point,evidence:answer,next_step:'继续核对检索准确率',follow_up:'',evaluation};
    if (targetFollowup && status==='incorrect') {
      response.follow_up='如何验证新增检索结果是否引入噪声？';
      evaluation.recommended_action='followup';
      evaluation.followup_point=point;
    }
    return Response.json({choices:[{message:{content:JSON.stringify(response)}}]});
  };
  return createPracticeApi({db,currentRole:()=>role,requestAi});
}

async function answerQuestion(api, question, answer) {
  return (await api('/api/practice/dialogue/turn',{method:'POST',input:{
    role,question:question.text,question_ref:{kind:'source',id:question.id},answer
  }})).body;
}

function open(name=':memory:') {
  const db=new DatabaseSync(name);
  migrateDatabase(db);
  return db;
}

function addToLibrary(db, role, text, topic) {
  const source=`source-${role}-${topic}`;
  db.prepare('INSERT OR IGNORE INTO sources (id,title,url,date,type,question,role,created) VALUES (?,?,?,?,?,?,?,?)')
    .run(source,'测试面经','https://example.com/interview','','真实面经（自述）','',role,new Date().toISOString());
  const question=addQuestion(db,source,text);
  setQuestionTopic(db,'source',question.id,topic,source);
  return question;
}

function connect(db, currentRole=()=>role) {
  const career=createAgentWorkflow({db,currentRole});
  const run=async(path,input)=>(await career(path,{role:currentRole(),...input},new AbortController().signal)).body;
  return {plan:input=>run('/api/career/plan',input),history:input=>run('/api/career/ability-history',input)};
}

test('first plan uses confirmed requirements and exposes a role-bound request for missing topics',async()=>{
  const db=open();
  try {
    saveValidatedRole(db,role,'confirmed');
    saveProfile(db,role,'公开岗位要求','RAG\nSQL');
    const rag=addToLibrary(db,role,ragQuestion,'RAG');
    addToLibrary(db,role,'NoSQL 的数据模型有哪些？','NoSQL');
    addToLibrary(db,role,'SQL 的背景'.repeat(340),'SQL');
    addToLibrary(db,otherRole,sqlQuestion,'SQL');
    const career=connect(db);
    const {tasks}=await career.plan();
    assert.equal(tasks[0].question.question_ref.id,rag.id);
    assert.equal(tasks[0].action,'practice');
    assert.match(tasks[0].reason,/岗位要求.*未练习/);
    assert.deepEqual(tasks[0].evidence,[]);
    assert.deepEqual(tasks[1].research_request,{role,topics:['SQL']});
    assert.equal(tasks[1].action,'research');
    assert.equal(tasks[1].question,undefined);
    await assert.rejects(career.plan({role:otherRole}),/岗位/);
  } finally { db.close(); }
});

test('two errors move a previously lower-ranked library question ahead of an unpracticed topic',async()=>{
  const db=open();
  try {
    saveValidatedRole(db,role,'confirmed');
    saveProfile(db,role,'公开岗位要求','SQL\nRAG');
    const rag=addToLibrary(db,role,ragQuestion,'RAG');
    const sql=addToLibrary(db,role,sqlQuestion,'SQL');
    const career=connect(db), api=practice(db);
    assert.equal((await career.plan()).tasks[0].question.question_ref.id,sql.id);
    const first=await answerQuestion(api,rag,incorrect);
    const second=await answerQuestion(api,rag,incorrect);
    const {profile}=await career.history();
    const [observation]=profile.points;
    assert.equal(observation.incorrect,2);
    assert.equal(observation.latest_assessed,'incorrect');
    assert.deepEqual(observation.evidence.map(item=>item.attempt_id),[second.id,first.id]);
    const [next]=(await career.plan()).tasks;
    assert.equal(next.action,'review');
    assert.equal(next.point,point);
    assert.equal(next.question.question_ref.id,rag.id);
    assert.match(next.reason,/连续 2 轮/);
    assert.deepEqual(next.evidence.map(item=>[item.attempt_id,item.evidence]),[[second.id,incorrect],[first.id,incorrect]]);
    const offTopic=await career.plan({topics:['SQL']});
    assert.equal(offTopic.tasks[0].question.question_ref.id,sql.id);
  } finally { db.close(); }
});

test('a weak point without a verified topic or linked question is not paired with an unrelated library question',async()=>{
  const db=open();
  try {
    saveValidatedRole(db,role,'confirmed');
    const sql=addToLibrary(db,role,sqlQuestion,'SQL');
    const turn=(await practice(db)('/api/practice/dialogue/turn',{method:'POST',input:{
      role,question:'检索结果的数量如何影响质量？',answer:incorrect
    }})).body;
    const {tasks}=await connect(db).plan();
    assert.equal(tasks[0].action,'practice');
    assert.equal(tasks[0].question.question_ref.id,sql.id);
    const request=tasks.find(item=>item.action==='research');
    assert.deepEqual(request.research_request,{role,topics:[]});
    assert.equal(request.evidence[0].attempt_id,turn.id);
    assert.equal(request.question,undefined);
  } finally { db.close(); }
});

test('repeated correct answers reduce repetition, and unknown observations do not erase improvement after reopen',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'offerstrike-career-')), file=join(directory,'workbench.sqlite');
  let db=open(file);
  try {
    saveValidatedRole(db,role,'confirmed');
    saveProfile(db,role,'公开岗位要求','SQL\nRAG');
    const rag=addToLibrary(db,role,ragQuestion,'RAG');
    const sql=addToLibrary(db,role,sqlQuestion,'SQL');
    const career=connect(db), api=practice(db);
    const miss=await answerQuestion(api,rag,incorrect);
    assert.equal((await career.plan()).tasks[0].action,'review');
    const first=await answerQuestion(api,rag,correct);
    assert.equal((await career.plan()).tasks[0].question.question_ref.id,sql.id);
    assert.equal((await career.history()).profile.points[0].change,'improving');
    const second=await answerQuestion(api,rag,correct);
    const unsure=await answerQuestion(api,rag,'这一轮没补充新的相关内容。');
    const history=await career.history();
    const [observation]=history.profile.points;
    assert.equal(observation.latest,'unverified');
    assert.equal(observation.latest_assessed,'correct');
    assert.equal(observation.supporting_sessions,2);
    assert.equal(observation.change,'improving');
    assert.equal(observation.last_attempt_id,unsure.id);
    assert.deepEqual(observation.evidence.map(item=>item.attempt_id),[second.id,first.id,miss.id]);
    const plan=await career.plan();
    assert.equal(plan.tasks[0].question.question_ref.id,sql.id);
    assert.match(plan.tasks.find(task=>task.topic==='RAG').reason,/降低重复优先级/);
    db.close();
    db=open(file);
    assert.deepEqual(await connect(db).history(),history);
    assert.deepEqual(await connect(db).plan(),plan);
    saveValidatedRole(db,otherRole,'confirmed');
    assert.deepEqual((await connect(db,()=>otherRole).history()).profile.points,[]);
  } finally { db.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('an active follow-up can be selected once and closing the dialogue leads to a review plan',async()=>{
  const db=open();
  try {
    saveValidatedRole(db,role,'confirmed');
    const rag=addToLibrary(db,role,ragQuestion,'RAG');
    const api=practice(db,{targetFollowup:true}), career=connect(db);
    const first=await answerQuestion(api,rag,incorrect);
    const [task]=(await career.plan()).tasks;
    assert.equal(task.action,'followup');
    assert.deepEqual(task.followup,{parent_attempt_id:first.id,question:first.follow_up});
    assert.equal(task.evidence[0].attempt_id,first.id);
    assert.equal((await career.plan({topics:['SQL']})).tasks[0].action,'research');
    const {body:history}=await api('/api/practice/dialogue/'+first.id,{method:'GET',query:new URLSearchParams({role})});
    assert.equal(history.can_continue,true);
    const input={role,parent_attempt_id:first.id,question:first.follow_up,answer:correct,request_id:'career-followup'};
    const {body:second}=await api('/api/practice/dialogue/turn',{method:'POST',input});
    assert.equal((await career.plan()).tasks.some(item=>item.action==='followup'),false);
    assert.equal((await api('/api/practice/dialogue/turn',{method:'POST',input})).body.id,second.id);
    await assert.rejects(api('/api/practice/dialogue/turn',{method:'POST',input:{...input,request_id:'old-followup'}}),/已回答/);
    const third=await answerQuestion(api,rag,incorrect);
    await api('/api/practice/dialogue/summary',{method:'POST',input:{role,attempt_id:third.id}});
    assert.equal((await career.plan()).tasks[0].action,'review');
    assert.equal((await api('/api/practice/dialogue/'+third.id,{method:'GET',query:new URLSearchParams({role})})).body.can_continue,false);
  } finally { db.close(); }
});
