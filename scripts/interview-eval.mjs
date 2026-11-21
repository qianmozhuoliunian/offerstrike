import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAiTransport } from '../src/ai-transport.js';
import { migrateDatabase } from '../src/database.js';
import { createPracticeApi } from '../src/practice-api.js';
import { careerAbilityHistory } from '../src/career.js';

if (!process.argv.slice(2).includes('--live')) {
  console.log('Add --live to send the fixed RAG example to the configured AI provider.');
  process.exit(0);
}
const requestAi=createAiTransport({key:process.env.AI_API_KEY,model:process.env.AI_MODEL,baseUrl:process.env.AI_BASE_URL});
assert.ok(requestAi,'Configure AI_API_KEY and AI_MODEL before running the live evaluation');
const prefix=join(await realpath(tmpdir()),'offerstrike-interview-eval-');
const directory=await mkdtemp(prefix), database=join(directory,'interview.sqlite');
const role='AI 应用开发';
const question='请用 RAG 解释如何使用检索结果，并说明如何评估检索质量。';
const answer='先根据用户查询检索相关文档，把检索到的片段作为上下文交给生成模型。检索返回越多，答案就一定越准确。';
const query=new URLSearchParams({role});
let db=new DatabaseSync(database);
try {
  migrateDatabase(db);
  const practice=()=>createPracticeApi({db,currentRole:()=>role,requestAi});
  const api=practice();
  async function submit(input) {
    const start=performance.now();
    const {body}=await api('/api/practice/dialogue/turn',{method:'POST',input:{role,...input}});
    console.log(JSON.stringify({step:'turn',ms:Math.round(performance.now()-start),feedback:body.feedback,
      follow_up:body.follow_up,evaluation:body.evaluation}));
    return body;
  }
  const first=await submit({question,answer,request_id:'rag-first'});
  assert.ok(first.feedback && first.evaluation,'The first answer must yield text feedback and grounded observations');
  assert.ok(first.evaluation.strengths.length,'Expected a supported strength');
  assert.ok(first.evaluation.weaknesses.some(item=>item.type==='incorrect'),'Expected a supported error');
  assert.ok(first.evaluation.weaknesses.some(item=>item.type==='missing'),'Expected a supported omission');
  assert.ok(first.follow_up,'Expected one targeted follow-up');
  const second=await submit({question:first.follow_up,parent_attempt_id:first.id,request_id:'rag-second',
    answer:'我会先用标注数据算 Recall@k 和 Precision@k，再在固定评测集上比较生成答案正确率。增加 k 可能引入噪声，需要同时观察召回率和生成结果。'});
  const {body:{summary}}=await api('/api/practice/dialogue/summary',{method:'POST',input:{role,attempt_id:second.id}});
  assert.ok(summary);
  const path='/api/practice/dialogue/'+second.id;
  const before=(await api(path,{method:'GET',query})).body;
  db.close();db=null;
  db=new DatabaseSync(database);migrateDatabase(db);
  const {body:after}=await practice()(path,{method:'GET',query});
  assert.deepEqual(after,before);
  const history=careerAbilityHistory(db,role);
  assert.ok(history.history.some(item=>item.attempt_id===first.id && item.topic==='RAG'));
  console.log(JSON.stringify({step:'reopen',turns:after.turns.length,summary,topics:history.topics,nextSteps:history.next_steps}));
} finally {
  db?.close();
  if (directory.startsWith(prefix)) await rm(directory,{recursive:true,force:true});
}
