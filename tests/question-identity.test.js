import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeQuestions, addQuestion, editQuestion, removeQuestion } from '../src/questions.js';
import { initializeWorkspace, recommendQuestion, saveDraft, getDraft, exportData } from '../src/workspace.js';
import { importData } from '../src/import-data.js';

function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,question TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE attempts (id TEXT PRIMARY KEY,question TEXT NOT NULL,answer TEXT NOT NULL,feedback TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    INSERT INTO sources VALUES ('s1','来源一','https://example.com/1','','来源未知','','产品','2020-01-01');
    INSERT INTO sources VALUES ('s2','来源二','https://example.com/2','','来源未知','','产品','2020-01-01');`);
  initializeQuestions(db); initializeWorkspace(db); return db;
}
function attempt(db,id,question,kind,questionId) {
  db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run(id,question,'回答','点评','产品','2026-01-01');
  if(kind!==null) db.prepare('INSERT INTO attempt_question_links VALUES (?,?,?)').run(id,kind,questionId || '');
  db.prepare('INSERT INTO attempt_assessments VALUES (?,?)').run(id,'revisit');
}

test('duplicate text aggregates sources once, and edits follow stable IDs', () => {
  const db=database(), first=addQuestion(db,'s1','同一个问题'), second=addQuestion(db,'s2','同一个问题');
  attempt(db,'a','同一个问题','source',first.id);
  const merged=recommendQuestion(db,'产品');
  assert.equal(merged.sources.length,2);assert.equal(merged.practiceCount,1);
  assert.deepEqual(merged.question_ref,{kind:'source',id:first.id});
  editQuestion(db,'s1',first.id,'修改后的问题');
  const renamed=recommendQuestion(db,'产品');
  assert.equal(renamed.text,'修改后的问题');assert.equal(renamed.practiceCount,1);
  assert.equal(db.prepare('SELECT question FROM attempts WHERE id=?').get('a').question,'同一个问题');
  removeQuestion(db,'s1',first.id);
  const replacement=addQuestion(db,'s1','修改后的问题');
  assert.notEqual(replacement.id,first.id);
  const result=recommendQuestion(db,'产品');
  assert.equal(result.reason,'尚未练习'); assert.equal(result.practiceCount,0);
  assert.equal(db.prepare('SELECT question_id FROM attempt_question_links WHERE attempt_id=?').get('a').question_id,first.id);
  assert.ok(second.id);db.close();
});

test('manual entries cannot inherit source identity; ambiguous or later legacy matches are not attributed', () => {
  const db=database(), q=addQuestion(db,'s1','同文题');
  attempt(db,'manual','同文题','none','');
  assert.equal(recommendQuestion(db,'产品').practiceCount,0);
  attempt(db,'legacy','同文题',null,'');
  // A source added later than the historical answer cannot be its origin.
  assert.equal(recommendQuestion(db,'产品').practiceCount,0);
  db.prepare('UPDATE questions SET created=? WHERE id=?').run('2020-01-01',q.id);
  const legacy=recommendQuestion(db,'产品');assert.equal(legacy.practiceCount,1);assert.match(legacy.reasonDetails,/旧记录按文字匹配/);
  const duplicate=addQuestion(db,'s2','同文题');db.prepare('UPDATE questions SET created=? WHERE id=?').run('2020-01-01',duplicate.id);
  assert.equal(recommendQuestion(db,'产品').practiceCount,0);
  db.close();
});

test('draft identity validates role and text and is discarded on edit', () => {
  const db=database(), q=addQuestion(db,'s1','一道题'); const ref={kind:'source',id:q.id};
  saveDraft(db,'产品','一道题','草稿','',ref);
  assert.deepEqual(getDraft(db,'产品').question_ref,ref);
  assert.throws(()=>saveDraft(db,'运营','一道题','草稿','',ref),/岗位/);
  assert.throws(()=>saveDraft(db,'产品','错误题','草稿','',ref),/题目/);
  saveDraft(db,'产品','手工修改','草稿');assert.equal(getDraft(db,'产品').question_ref,null);
  db.close();
});

test('backup links survive a clean merge; conflicting identities never bind', () => {
  const origin=database(), q=addQuestion(origin,'s1','一道题');
  attempt(origin,'a','一道题','source',q.id);saveDraft(origin,'产品','一道题','草稿','',{kind:'source',id:q.id});
  const backup=exportData(origin), destination=database();
  importData(destination,backup,true);
  assert.equal(destination.prepare('SELECT question_id FROM attempt_question_links WHERE attempt_id=?').get('a').question_id,q.id);
  assert.deepEqual(getDraft(destination,'产品').question_ref,{kind:'source',id:q.id});
  const conflict=database();
  conflict.prepare('INSERT INTO questions (id,source_id,text,created,note) VALUES (?,?,?,?,?)').run(q.id,'s1','另一题',q.created,'');
  importData(conflict,backup,true);
  assert.equal(conflict.prepare('SELECT kind FROM attempt_question_links WHERE attempt_id=?').get('a').kind,'none');
  assert.equal(getDraft(conflict,'产品').question_ref,null);
  const attemptConflict=database();
  attemptConflict.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run('a','一道题','不同的回答','点评','产品','2026-01-01');
  importData(attemptConflict,backup,true);
  assert.equal(attemptConflict.prepare('SELECT * FROM attempt_question_links WHERE attempt_id=?').get('a'),undefined);
  assert.equal(attemptConflict.prepare('SELECT * FROM attempt_assessments WHERE attempt_id=?').get('a'),undefined);
  removeQuestion(origin,'s1',q.id);
  const orphan=exportData(origin), restored=database();
  importData(restored,orphan,true);
  assert.equal(restored.prepare('SELECT kind FROM attempt_question_links WHERE attempt_id=?').get('a').kind,'missing_source');
  assert.equal(restored.prepare('SELECT question FROM attempts WHERE id=?').get('a').question,'一道题');
  origin.close(); destination.close(); conflict.close(); attemptConflict.close(); restored.close();
});
