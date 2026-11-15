import { randomUUID } from 'node:crypto';

// New questions are explicitly entered by the user. The old sources.question
// field may contain a search snippet, so it remains untouched and unverified.
export { initializeQuestions } from './database.js';

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

// Call inside a transaction. The request ID makes retries safe if a response
// is lost after the question was stored.
export function addExtractedQuestion(db, sourceId, value, evidence, requestId) {
  requireSource(db, sourceId);
  const text = normalizeQuestion(value);
  if (text.length > 2000) throw Error('题目不能超过 2000 字');
  if (typeof evidence !== 'string' || !evidence.trim() || evidence.length > 1000) throw Error('原文依据无效');
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw Error('候选题编号无效，请重新提取');
  const previous = db.prepare("SELECT q.id,q.source_id,q.text,q.created,q.note,COALESCE(t.topic,'') AS topic,e.evidence,e.confirmed_text FROM question_evidence e JOIN questions q ON q.id=e.question_id LEFT JOIN question_topics t ON t.kind='source' AND t.question_id=q.id WHERE e.request_id=?").get(requestId);
  if (previous) {
    if (previous.source_id !== sourceId || previous.confirmed_text !== text || previous.evidence !== evidence) throw Error('候选题已保存但内容已变化，请刷新后核对');
    return {...previous, reused:true};
  }
  if (db.prepare('SELECT 1 FROM questions WHERE source_id=? AND text=?').get(sourceId,text)) throw Error('该来源已有相同题目，请先在关联题目中核对');
  const question=addQuestion(db,sourceId,text);
  db.prepare('INSERT INTO question_evidence (question_id,evidence,confirmed_text,request_id) VALUES (?,?,?,?)').run(question.id,evidence,text,requestId);
  return {...question,note:'',topic:'',evidence,confirmed_text:text,reused:false};
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
    db.prepare('DELETE FROM question_evidence WHERE question_id=?').run(questionId);
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
  const questions = db.prepare("SELECT q.id,q.source_id,q.text,q.created,q.note,COALESCE(t.topic,'') AS topic,COALESCE(e.evidence,'') AS evidence,COALESCE(e.confirmed_text,'') AS evidence_question FROM questions q LEFT JOIN question_topics t ON t.kind='source' AND t.question_id=q.id LEFT JOIN question_evidence e ON e.question_id=q.id ORDER BY q.created,q.id").all();
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
    db.prepare('DELETE FROM question_evidence WHERE question_id IN (SELECT id FROM questions WHERE source_id=?)').run(sourceId);
    db.prepare('DELETE FROM questions WHERE source_id = ?').run(sourceId);
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
