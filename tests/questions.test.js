import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeQuestions, listSources, addQuestion, editQuestion, removeQuestion, removeSource } from '../src/questions.js';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sources (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, question TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL);
    INSERT INTO sources VALUES ('one', '旧来源', 'https://example.com', '', '来源未知', '旧摘要或题目', '产品', '2026-01-01');
    INSERT INTO sources VALUES ('two', '另一来源', 'https://example.org', '', '来源未知', '', '产品', '2026-01-02');`);
  initializeQuestions(db);
  return db;
}

test('legacy source text is preserved separately from confirmed questions', () => {
  const db = database();
  initializeQuestions(db); // Existing databases may be opened repeatedly.
  const source = listSources(db).find(item => item.id === 'one');
  assert.equal(source.legacy_question, '旧摘要或题目');
  assert.deepEqual(source.questions, []);
  assert.equal(db.prepare('SELECT question FROM sources WHERE id = ?').get('one').question, '旧摘要或题目');
  db.close();
});

test('questions are associated with their source and can be edited or removed', () => {
  const db = database();
  const first = addQuestion(db, 'one', '  如何评估产品效果？  ');
  const second = addQuestion(db, 'one', '如何确定指标？');
  assert.equal(first.text, '如何评估产品效果？');
  assert.equal(listSources(db).find(item => item.id === 'one').questions.length, 2);
  assert.throws(() => addQuestion(db, 'one', '   '), /题目/);
  assert.throws(() => addQuestion(db, 'missing', '问题'), /来源/);
  assert.throws(() => editQuestion(db, 'two', first.id, '不应修改'), /不存在/);
  assert.throws(() => removeQuestion(db, 'two', first.id), /不存在/);
  assert.equal(editQuestion(db, 'one', first.id, '如何评估上线效果？').text, '如何评估上线效果？');
  removeQuestion(db, 'one', second.id);
  assert.deepEqual(listSources(db).find(item => item.id === 'one').questions.map(item => item.text), ['如何评估上线效果？']);
  removeSource(db, 'one');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM questions').get().count, 0);
  assert.ok(listSources(db).some(item => item.id === 'two'));
  db.close();
});
