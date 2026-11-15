import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../src/database.js';
import { exportData, saveProfile, saveDraft, getDraft, setAssessment } from '../src/workspace.js';
import { addQuestion } from '../src/questions.js';
import { saveLocalPractice } from '../src/local-practice.js';
import { importData } from '../src/import-data.js';

test('migration adopts unversioned data without promoting snippets and survives repeat startup', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE sources (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, question TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL);
      INSERT INTO sources VALUES ('source','测试原帖','https://example.org/fixture','','来源未知','未核实摘要','产品','2026-01-01');`);
    migrateDatabase(db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('SELECT count(*) AS total FROM questions').get().total, 0);
    assert.equal(db.prepare('SELECT question FROM sources').get().question, '未核实摘要');
    const question = addQuestion(db,'source','用户确认的问题');
    saveProfile(db,'产品','虚构 JD','已确认要求');
    saveDraft(db,'产品',question.text,'保留草稿','',{kind:'source',id:question.id});
    const attempt = saveLocalPractice(db,'产品',{role:'产品',question:question.text,answer:'合成回答',question_ref:{kind:'source',id:question.id},request_id:'00000000-0000-4000-8000-000000000001'});
    setAssessment(db,attempt.id,'revisit');
    const before = exportData(db);
    migrateDatabase(db);
    const after = exportData(db);
    assert.deepEqual({...after,exported_at:before.exported_at},before);
    const restored = new DatabaseSync(':memory:');
    try {
      migrateDatabase(restored);
      importData(restored,before,true);
      assert.equal(getDraft(restored,'产品').answer,'保留草稿');
      assert.equal(restored.prepare('SELECT rating FROM attempt_assessments').get().rating,'revisit');
      assert.equal(restored.prepare('SELECT question_id FROM attempt_question_links').get().question_id,question.id);
    } finally { restored.close(); }
  } finally { db.close(); }
});

test('migration rolls back schema work on failure and refuses a future database version', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE VIEW questions AS SELECT 1 AS id');
    assert.throws(() => migrateDatabase(db));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);
    assert.equal(db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table'").get().total,0);
    db.exec('DROP VIEW questions; PRAGMA user_version = 99');
    assert.throws(() => migrateDatabase(db),/版本高于/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,99);
    assert.equal(db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table'").get().total,0);
  } finally { db.close(); }
});
