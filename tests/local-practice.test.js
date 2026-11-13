import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { initializeQuestions, addQuestion } from '../src/questions.js';
import { initializeWorkspace, exportData, setAssessment, recommendQuestion } from '../src/workspace.js';
import { importData } from '../src/import-data.js';
import { saveLocalPractice } from '../src/local-practice.js';

function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,question TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE attempts (id TEXT PRIMARY KEY,question TEXT NOT NULL,answer TEXT NOT NULL,feedback TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);`);
  initializeQuestions(db);initializeWorkspace(db);
  return db;
}

test('unreviewed local answers are retry-safe and survive backup with source and assessment',()=>{
  const db=database(), copy=database(), role='前端开发';
  try {
    db.prepare("INSERT INTO sources (id,title,url,date,type,question,role,created) VALUES ('s','标题','https://example.org','','来源未知','',?,'2026-11-13')").run(role);
    const question=addQuestion(db,'s','解释闭包');
    const input={request_id:randomUUID(),question:question.text,answer:'函数保留对外部变量的引用',question_ref:{kind:'source',id:question.id}};
    assert.equal(saveLocalPractice(db,role,input).reused,false);
    assert.equal(saveLocalPractice(db,role,input).reused,true);
    assert.throws(()=>saveLocalPractice(db,role,{...input,answer:'不同的回答'}),/内容已变化/);
    assert.throws(()=>saveLocalPractice(db,'后端开发',input),/不属于当前岗位/);
    setAssessment(db,input.request_id,'revisit');
    const backup=exportData(db);
    assert.equal(backup.attempts[0].feedback,'');
    assert.equal(backup.attempts.length,1);
    importData(copy,backup,true);
    assert.equal(exportData(copy).attempts[0].answer,input.answer);
    assert.equal(recommendQuestion(copy,role).selfAssessment,'revisit');
    assert.equal(recommendQuestion(copy,role).question_ref.id,question.id);
  } finally {db.close();copy.close();}
});
