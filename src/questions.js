import { randomUUID } from 'node:crypto';

// New questions are explicitly entered by the user. The old sources.question
// field may contain a search snippet, so it remains untouched and unverified.
export function initializeQuestions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created TEXT NOT NULL
  );`);
  if (!db.prepare('PRAGMA table_info(questions)').all().some(column => column.name === 'note')) {
    db.exec("ALTER TABLE questions ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS question_topics (
    kind TEXT NOT NULL, question_id TEXT NOT NULL, topic TEXT NOT NULL,
    PRIMARY KEY (kind, question_id)
  );`);
}

function normalizeQuestion(value) {
  const text = String(value || '').trim();
  if (!text) throw Error('请填写题目');
  if (text.length > 10000) throw Error('题目过长');
  return text;
}

function requireSource(db, sourceId) {
  if (!db.prepare('SELECT id FROM sources WHERE id = ?').get(sourceId)) throw Error('来源不存在');
}

export function addQuestion(db, sourceId, value) {
  requireSource(db, sourceId);
  const text = normalizeQuestion(value);
  const question = { id: randomUUID(), source_id: sourceId, text, created: new Date().toISOString() };
  db.prepare('INSERT INTO questions (id, source_id, text, created) VALUES (?, ?, ?, ?)')
    .run(question.id, question.source_id, question.text, question.created);
  return question;
}

export function editQuestion(db, sourceId, questionId, value) {
  const text = normalizeQuestion(value);
  const result = db.prepare('UPDATE questions SET text = ? WHERE id = ? AND source_id = ?').run(text, questionId, sourceId);
  if (!result.changes) throw Error('题目不存在');
  return db.prepare('SELECT id, source_id, text, created FROM questions WHERE id = ?').get(questionId);
}

export function removeQuestion(db, sourceId, questionId) {
  db.exec('BEGIN');
  try {
    const result = db.prepare('DELETE FROM questions WHERE id = ? AND source_id = ?').run(questionId, sourceId);
    if (!result.changes) throw Error('题目不存在');
    db.prepare("DELETE FROM question_topics WHERE kind='source' AND question_id=?").run(questionId);
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

// Topics are explicitly user-entered and never inferred from model output.
export function setQuestionTopic(db, kind, id, value, sourceId = '') {
  if (!['source','debrief'].includes(kind)) throw Error('题目类型无效');
  if (typeof value !== 'string') throw Error('主题格式无效');
  const topic=value.trim();
  if (topic.length > 100) throw Error('主题不能超过 100 字');
  const exists=kind === 'source'
    ? db.prepare('SELECT 1 FROM questions WHERE id=? AND source_id=?').get(id,sourceId)
    : db.prepare("SELECT 1 FROM debriefs WHERE id=? AND question<>''").get(id);
  if(!exists) throw Error('题目不存在');
  if(topic) db.prepare('INSERT OR REPLACE INTO question_topics (kind,question_id,topic) VALUES (?,?,?)').run(kind,id,topic);
  else db.prepare('DELETE FROM question_topics WHERE kind=? AND question_id=?').run(kind,id);
  return {topic};
}

export function listSources(db) {
  const sources = db.prepare('SELECT * FROM sources ORDER BY created DESC').all();
  const questions = db.prepare("SELECT q.id,q.source_id,q.text,q.created,q.note,COALESCE(t.topic,'') AS topic FROM questions q LEFT JOIN question_topics t ON t.kind='source' AND t.question_id=q.id ORDER BY q.created,q.id").all();
  const bySource = new Map();
  for (const question of questions) {
    if (!bySource.has(question.source_id)) bySource.set(question.source_id, []);
    bySource.get(question.source_id).push(question);
  }
  return sources.map(source => ({ ...source, legacy_question: source.question, questions: bySource.get(source.id) || [] }));
}

export function removeSource(db, sourceId) {
  // Explicitly delete dependent questions even in existing databases where
  // foreign-key enforcement was disabled by the previous version.
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM question_topics WHERE kind='source' AND question_id IN (SELECT id FROM questions WHERE source_id=?)").run(sourceId);
    db.prepare('DELETE FROM questions WHERE source_id = ?').run(sourceId);
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
