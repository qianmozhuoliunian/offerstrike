import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../src/database.js';
import { createPracticeApi, isPracticeRequest } from '../src/practice-api.js';
import { exportData } from '../src/workspace.js';
import { importData } from '../src/import-data.js';
import { createAgentWorkflow } from '../src/agent-workflow.js';
import { saveValidatedRole } from '../src/role-validation.js';

const ragExample={
  role:'AI 应用开发',question:'RAG 如何使用检索结果？请说明如何评估检索质量。',
  answer:'先检索相关文档，把文档放进上下文。检索结果越多就一定越准确。'
};
const ragEvaluation={topic:'RAG',strengths:[{point:'理解检索结果进入上下文',evidence:'把文档放进上下文'}],
  weaknesses:[{point:'检索数量不保证准确',type:'incorrect',evidence:'检索结果越多就一定越准确'},
    {point:'未说明检索质量指标',type:'missing',evidence:'先检索相关文档',requirement:'如何评估检索质量'}],
  unverified:['向量检索与关键词检索的区别'],followup_point:'未说明检索质量指标',
  suggested_followup:'你会用哪个指标评估检索结果的相关性？',recommended_action:'followup'};

test('dialogue saves a grounded evaluation and follows one relevant gap', async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrateDatabase(db);
    const requestAi=async payload=>{
      const data=JSON.parse(payload.messages.at(-1).content);
      const result=data.answer===ragExample.answer
        ? {focus:'检索',evidence:'先检索相关文档',next_step:'练习检索评估',feedback:'已解释上下文流程。',follow_up:'错误的旧追问',evaluation:ragEvaluation}
        : {focus:'检索',evidence:data.answer,next_step:'继续练习',feedback:'已记录补充回答。',follow_up:''};
      return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
    };
    const api=createPracticeApi({db,currentRole:()=>ragExample.role,requestAi});
    const input={...ragExample,request_id:'grounded-1'};
    const first=(await api('/api/practice/dialogue/turn',{method:'POST',input})).body;
    assert.equal(first.feedback,'已解释上下文流程。');
    assert.deepEqual(first.evaluation,ragEvaluation);
    assert.equal(first.follow_up,ragEvaluation.suggested_followup);
    const retry=(await api('/api/practice/dialogue/turn',{method:'POST',input})).body;
    assert.deepEqual(retry.evaluation,first.evaluation);
    const history=(await api('/api/practice/dialogue/'+first.id,{method:'GET',query:new URLSearchParams({role:input.role})})).body;
    assert.deepEqual(history.turns[0].evaluation,first.evaluation);
  } finally {db.close();}
});

test('practice entry preserves offline retry, assessment, draft and optional AI contracts', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrateDatabase(db);
    let role='产品';
    const handle=createPracticeApi({db,currentRole:()=>role});
    const input={role,question:'合成问题',answer:'合成回答',request_id:'00000000-0000-4000-8000-000000000002'};
    const first=await handle('/api/practice/local',{method:'POST',input});
    assert.equal(first.status,201);
    const retry=await handle('/api/practice/local',{method:'POST',input});
    assert.equal(retry.status,200);
    assert.equal(retry.body.id,first.body.id);
    await handle(`/api/attempts/${first.body.id}/assessment`,{method:'PUT',input:{rating:'revisit'}});
    assert.equal(db.prepare('SELECT rating FROM attempt_assessments').get().rating,'revisit');
    await handle('/api/draft',{method:'PUT',input});
    assert.equal(db.prepare('SELECT answer FROM drafts WHERE role=?').get(role).answer,input.answer);
    const feedback=await handle(`/api/practice/local/${first.body.id}/feedback`,{method:'POST',input:{role}});
    assert.equal(feedback.status,503);
    assert.equal(db.prepare('SELECT answer FROM attempts').get().answer,input.answer);
    role='前端';
    await assert.rejects(handle('/api/practice/local',{method:'POST',input}),/当前岗位/);
    assert.equal(isPracticeRequest('/api/practice/local','DELETE'),false);
    assert.equal(isPracticeRequest('/api/search','POST'),false);
    assert.equal(isPracticeRequest('/api/practice/local','POST'),true);
  } finally { db.close(); }
});

test('local AI feedback retains its grounded evaluation through backup and rejects forged evidence', async()=>{
  const db=new DatabaseSync(':memory:'), restored=new DatabaseSync(':memory:');
  try {
    migrateDatabase(db);migrateDatabase(restored);
    const api=createPracticeApi({db,currentRole:()=>ragExample.role,agentExtract:async()=>({content:JSON.stringify({
      feedback:'检索流程清晰。',follow_up:'',evaluation:ragEvaluation
    })})});
    const {body:attempt}=await api('/api/practice/local',{method:'POST',input:{...ragExample,request_id:'00000000-0000-4000-8000-000000000003'}});
    const {body:review}=await api(`/api/practice/local/${attempt.id}/feedback`,{method:'POST',input:{role:ragExample.role}});
    assert.equal(review.feedback,'检索流程清晰。');
    assert.equal(review.evaluation.recommended_action,'review');
    assert.equal(review.evaluation.suggested_followup,'');
    const backup=exportData(db);
    importData(restored,backup,true);
    assert.deepEqual(exportData(restored).ability_evaluations,backup.ability_evaluations);
    const forged=structuredClone(backup);
    forged.ability_evaluations[0].evaluation.weaknesses[0].evidence='答卷中没有的原句';
    assert.throws(()=>importData(restored,forged,true),/能力评价/);
  } finally {db.close();restored.close();}
});

test('dialogue falls back to text for fabricated evidence or an unasked omission',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrateDatabase(db);
    for (const [i,patch] of [{evidence:'不存在的回答原文'},{requirement:'问卷中没有的要求'}].entries()) {
      const evaluation=structuredClone(ragEvaluation);
      Object.assign(evaluation.weaknesses[1],patch);
      const value={feedback:'仍然保留自然语言点评。',focus:'检索',evidence:'先检索相关文档',next_step:'继续练习',follow_up:'',evaluation};
      const api=createPracticeApi({db,currentRole:()=>ragExample.role,requestAi:async()=>Response.json({
        choices:[{message:{content:JSON.stringify(value)}}]
      })});
      const first=(await api('/api/practice/dialogue/turn',{method:'POST',input:{...ragExample,request_id:'invalid-evaluation-'+i}})).body;
      assert.equal(first.feedback,value.feedback);
      assert.equal(first.evaluation,null);
    }
  } finally {db.close();}
});

test('Career reads repeated observations for the current role and offers a review topic',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrateDatabase(db);
    const role=ragExample.role;
    saveValidatedRole(db,role,'confirmed');
    const ai=async()=>({content:JSON.stringify({feedback:'结构清楚。',follow_up:'',evaluation:ragEvaluation})});
    const api=createPracticeApi({db,currentRole:()=>role,agentExtract:ai});
    for (const suffix of ['4','5']) {
      const {body:attempt}=await api('/api/practice/local',{method:'POST',input:{...ragExample,request_id:'00000000-0000-4000-8000-00000000000'+suffix}});
      await api(`/api/practice/local/${attempt.id}/feedback`,{method:'POST',input:{role}});
    }
    const career=createAgentWorkflow({db,currentRole:()=>role});
    const signal=new AbortController().signal;
    const {body}=await career('/api/career/ability-history',{role},signal);
    assert.equal(body.history.length,2);
    assert.equal(body.history[0].question,ragExample.question);
    assert.equal(body.history[0].evaluation.topic,'RAG');
    assert.equal(body.recurring_issues.find(item=>item.point==='未说明检索质量指标').missing,2);
    assert.equal(body.repeated_strengths[0].correct,2);
    assert.equal(body.unverified[0].point,'向量检索与关键词检索的区别');
    assert.equal(body.next_steps[0].topic,'RAG');
    const {body:plan}=await career('/api/career/plan',{role,topics:[]},signal);
    assert.equal(plan.tasks[0].topic,'RAG');
    await assert.rejects(career('/api/career/ability-history',{role:'其他岗位'},signal),/岗位/);
  } finally {db.close();}
});

test('a partial model action does not erase grounded observations or launch an unanchored follow-up',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrateDatabase(db);
    const evaluation={...ragEvaluation,topic:'RAG 检索质量与使用检索片段',followup_point:'',suggested_followup:''};
    const reply={feedback:'保留文字点评。',focus:'检索',evidence:'先检索相关文档',next_step:'继续练习',follow_up:'用什么指标？',evaluation};
    const api=createPracticeApi({db,currentRole:()=>ragExample.role,requestAi:async()=>Response.json({choices:[{message:{content:JSON.stringify(reply)}}]})});
    const {body}=await api('/api/practice/dialogue/turn',{method:'POST',input:ragExample});
    assert.equal(body.evaluation.topic,'RAG');
    assert.deepEqual(body.evaluation.weaknesses,ragEvaluation.weaknesses);
    assert.equal(body.evaluation.recommended_action,'review');
    assert.equal(body.follow_up,'');
  } finally {db.close();}
});

test('a structured follow-up cannot repeat the current question with only a punctuation change',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    migrateDatabase(db);
    const evaluation={...ragEvaluation,suggested_followup:ragExample.question+'？'};
    const reply={feedback:'点评已保存。',focus:'检索',evidence:'先检索相关文档',next_step:'继续练习',follow_up:'',evaluation};
    const api=createPracticeApi({db,currentRole:()=>ragExample.role,requestAi:async()=>Response.json({choices:[{message:{content:JSON.stringify(reply)}}]})});
    const {body}=await api('/api/practice/dialogue/turn',{method:'POST',input:ragExample});
    assert.equal(body.follow_up,'');
    assert.equal(body.evaluation.recommended_action,'review');
  } finally {db.close();}
});
