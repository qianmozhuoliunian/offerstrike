import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeQuestions, addQuestion, listSources, setQuestionTopic, removeSource } from '../src/questions.js';
import { initializeWorkspace, saveDebrief, exportData } from '../src/workspace.js';
import { importData } from '../src/import-data.js';

function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,question TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE attempts (id TEXT PRIMARY KEY,question TEXT NOT NULL,answer TEXT NOT NULL,feedback TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    INSERT INTO sources VALUES ('source','面经','https://example.com','','来源未知','','产品','2026-01-01');`);
  initializeQuestions(db); initializeWorkspace(db);
  return db;
}

test('topics apply only to the specified source question or real interview question', () => {
  const db=database();
  const q=addQuestion(db,'source','如何分析指标？');
  const d=saveDebrief(db,{role:'产品',question:'如何做增长？'});
  initializeQuestions(db);
  assert.equal(listSources(db)[0].questions[0].topic,'');
  assert.equal(setQuestionTopic(db,'source',q.id,'  数据分析  ','source').topic,'数据分析');
  assert.equal(setQuestionTopic(db,'debrief',d.id,'增长策略').topic,'增长策略');
  assert.throws(()=>setQuestionTopic(db,'source',q.id,'错误','other'),/不存在/);
  assert.throws(()=>setQuestionTopic(db,'debrief','missing','错误'),/不存在/);
  assert.throws(()=>setQuestionTopic(db,'source',q.id,'x'.repeat(101),'source'),/100/);
  assert.equal(listSources(db)[0].questions[0].topic,'数据分析');
  assert.equal(exportData(db).debriefs[0].topic,'增长策略');
  setQuestionTopic(db,'source',q.id,'','source');
  assert.equal(listSources(db)[0].questions[0].topic,'');
  setQuestionTopic(db,'source',q.id,'数据分析','source');
  removeSource(db,'source');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM question_topics WHERE kind='source'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM question_topics WHERE kind='debrief'").get().n,1);
  db.close();
});

test('topic backup can merge without replacing existing labels and older backups still import', () => {
  const from=database();
  const q=addQuestion(from,'source','如何分析指标？');
  const d=saveDebrief(from,{role:'产品',question:'如何做增长？'});
  setQuestionTopic(from,'source',q.id,'数据分析','source');
  setQuestionTopic(from,'debrief',d.id,'增长策略');
  const data=exportData(from);
  const target=database();
  importData(target,data,true);
  assert.equal(listSources(target)[0].questions[0].topic,'数据分析');
  assert.equal(exportData(target).debriefs[0].topic,'增长策略');
  setQuestionTopic(target,'source',q.id,'自己修改','source');
  importData(target,data,true);
  assert.equal(listSources(target)[0].questions[0].topic,'自己修改');
  const legacy=structuredClone(data); delete legacy.sources[0].questions[0].topic; delete legacy.debriefs[0].topic;
  const fresh=database();
  assert.doesNotThrow(()=>importData(fresh,legacy,true));
  assert.equal(listSources(fresh)[0].questions[0].topic,'');
  from.close(); target.close(); fresh.close();
});
