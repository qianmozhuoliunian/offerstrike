import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../src/database.js';
import { createPracticeApi, isPracticeRequest } from '../src/practice-api.js';

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
