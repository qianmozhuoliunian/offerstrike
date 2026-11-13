import { validateQuestionRef } from './question-identity.js';
import { normalizeAnswer } from './core.js';

export function saveLocalPractice(db, role, input) {
  if (typeof input.question!=='string' || typeof input.answer!=='string') throw Error('请填写题目和回答');
  const id=input.request_id, question=input.question.trim(), answer=normalizeAnswer(input.answer);
  if (typeof id!=='string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw Error('作答编号无效');
  if (!question || question.length>2000 || answer.length>10000) throw Error('请填写题目和回答，题目最多 2000 字、回答最多 10000 字');
  const ref=validateQuestionRef(db,role,question,input.question_ref);
  const previous=db.prepare(`SELECT a.role,a.question,a.answer,l.kind,l.question_id FROM attempts a
    LEFT JOIN attempt_question_links l ON l.attempt_id=a.id WHERE a.id=?`).get(id);
  const kind=ref?.kind || 'none', refId=ref?.id || '';
  if (previous) {
    if (previous.role!==role || previous.question!==question || previous.answer!==answer ||
        previous.kind!==kind || previous.question_id!==refId) throw Error('作答内容已变化，请重新保存');
    return {id,reused:true};
  }
  db.exec('BEGIN');
  try {
    db.prepare("INSERT INTO attempts VALUES (?,?,?,'',?,?)").run(id,question,answer,role,new Date().toISOString());
    db.prepare('INSERT INTO attempt_question_links VALUES (?,?,?)').run(id,kind,refId);
    db.exec('COMMIT');
  } catch (error) {db.exec('ROLLBACK');throw error;}
  return {id,reused:false};
}
