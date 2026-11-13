import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initializeQuestions, addExtractedQuestion, editQuestion, listSources, removeQuestion, removeSource } from '../src/questions.js';
import { initializeWorkspace, exportData } from '../src/workspace.js';
import { importData } from '../src/import-data.js';
import { validateSourceText, parseSourceCandidates } from '../src/source-extraction.js';

function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,question TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE attempts (id TEXT PRIMARY KEY,question TEXT NOT NULL,answer TEXT NOT NULL,feedback TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);`);
  initializeQuestions(db); initializeWorkspace(db);
  return db;
}
function addSource(db) {
  db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created,interview_date) VALUES (?,?,?,?,?,?,?,?,?)').run('s1','来源','https://example.org/post','','来源未知','','产品','2020-01-01','');
}

test('candidate quotes must occur exactly in the complete supplied text', () => {
  const source='面试官问：如何设计缓存？\n后面还有其他说明。';
  const result=parseSourceCandidates(JSON.stringify({items:[
    {question:'如何设计缓存？',evidence:'面试官问：如何设计缓存？'},
    {question:'无依据题目',evidence:'并不存在的原文'},
    {question:'如何设计缓存？',evidence:'面试官问：如何设计缓存？'},
    {question:'问题',evidence:'短'}
  ]}),source);
  assert.deepEqual(result.items,[{question:'如何设计缓存？',evidence:'面试官问：如何设计缓存？'}]);
  assert.equal(result.omitted,3);
  assert.deepEqual(parseSourceCandidates('{"items":[]}',source),{items:[],omitted:0});
  assert.throws(()=>parseSourceCandidates('not json',source),/格式/);
  assert.throws(()=>validateSourceText(' '),/原文/);
  assert.equal(validateSourceText('😀'.repeat(12000)).length,24000);
  assert.throws(()=>validateSourceText('😀'.repeat(12001)),/超过 12000/);
});

test('confirmed evidence is retry-safe, survives backup and never overwrites conflicts', () => {
  const from=database(); addSource(from);
  const requestId=randomUUID();
  const question=addExtractedQuestion(from,'s1','如何设计缓存？','面试官问：如何设计缓存？',requestId);
  assert.equal(addExtractedQuestion(from,'s1','如何设计缓存？','面试官问：如何设计缓存？',requestId).id,question.id);
  assert.throws(()=>addExtractedQuestion(from,'s1','另一题','面试官问：如何设计缓存？',requestId),/已保存/);
  editQuestion(from,'s1',question.id,'修改后的问题');
  const original=listSources(from)[0].questions[0];
  assert.equal(original.evidence,'面试官问：如何设计缓存？');
  assert.equal(original.evidence_question,'如何设计缓存？');

  const backup=exportData(from), restored=database();
  importData(restored,backup,true);
  const restoredQuestion=listSources(restored)[0].questions[0];
  assert.equal(restoredQuestion.text,'修改后的问题');
  assert.equal(restoredQuestion.evidence,original.evidence);
  assert.equal(restoredQuestion.evidence_question,original.evidence_question);
  assert.equal(importData(restored,backup,true).新增,0);

  const legacy=structuredClone(backup);
  delete legacy.sources[0].questions[0].evidence;
  delete legacy.sources[0].questions[0].evidence_question;
  const older=database(); importData(older,legacy,true);
  assert.equal(listSources(older)[0].questions[0].evidence,'');

  const conflict=database(); addSource(conflict);
  conflict.prepare('INSERT INTO questions (id,source_id,text,created,note) VALUES (?,?,?,?,?)').run(question.id,'s1','已有另一题',question.created,'');
  importData(conflict,backup,true);
  assert.equal(listSources(conflict)[0].questions[0].text,'已有另一题');
  assert.equal(listSources(conflict)[0].questions[0].evidence,'');

  const invalid=structuredClone(backup); invalid.sources[0].questions[0].evidence_question='';
  const empty=database();
  assert.throws(()=>importData(empty,invalid,true),/原文依据/);
  assert.equal(listSources(empty).length,0);

  removeQuestion(from,'s1',question.id);
  assert.equal(from.prepare('SELECT COUNT(*) AS n FROM question_evidence').get().n,0);
  const another=addExtractedQuestion(from,'s1','另一题','另一段有效原文',randomUUID());
  assert.ok(another.id); removeSource(from,'s1');
  assert.equal(from.prepare('SELECT COUNT(*) AS n FROM question_evidence').get().n,0);
  from.close(); restored.close(); older.close(); conflict.close(); empty.close();
});
