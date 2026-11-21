import { randomUUID } from 'node:crypto';
import { listSources } from './questions.js';
import { recommendFromHistory } from './recommendation.js';
import { validateQuestionRef } from './question-identity.js';
import { validateDate } from './core.js';
import { matchesFocus,matchesRag,topicKey as canonicalTopic } from './knowledge-names.js';

export { initializeWorkspace } from './database.js';

function bounded(value, max, name) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw Error(`${name}过长`);
  return text;
}
function validRole(value) {
  const role = bounded(value, 100, '岗位');
  if (!role) throw Error('请先设置目标岗位');
  return role;
}

export function saveProfile(db, role, jd, confirmed) {
  role = validRole(role); jd = bounded(jd, 30000, '岗位描述'); confirmed = bounded(confirmed, 10000, '岗位要求');
  db.prepare('INSERT OR REPLACE INTO job_profiles (role,jd,confirmed_requirements) VALUES (?,?,?)').run(role,jd,confirmed);
  return {jd, confirmed_requirements: confirmed};
}
export function getProfile(db, role) {
  return db.prepare('SELECT jd,confirmed_requirements FROM job_profiles WHERE role=?').get(role) || {jd:'',confirmed_requirements:''};
}
export function saveDraft(db, role, question, answer, parentId = '', questionRef = null) {
  role = validRole(role); question = String(question ?? ''); answer = String(answer ?? '');
  if (question.length > 10000 || answer.length > 30000) throw Error('草稿内容过长');
  parentId=String(parentId || '');
  const ref=validateQuestionRef(db,role,question,questionRef);
  if(parentId && ref) throw Error('追问不能关联为题库原题');
  if(parentId) {
    const parent=db.prepare('SELECT a.role,d.follow_up FROM attempts a JOIN attempt_details d ON d.attempt_id=a.id WHERE a.id=?').get(parentId);
    if(!parent || parent.role!==role || parent.follow_up!==question.trim()) throw Error('追问上下文已失效');
  }
  const updated = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR REPLACE INTO drafts (role,question,answer,updated) VALUES (?,?,?,?)').run(role,question,answer,updated);
    if(parentId) db.prepare('INSERT OR REPLACE INTO draft_contexts VALUES (?,?)').run(role,parentId);
    else db.prepare('DELETE FROM draft_contexts WHERE role=?').run(role);
    if(ref) db.prepare('INSERT OR REPLACE INTO draft_question_links VALUES (?,?,?)').run(role,ref.kind,ref.id);
    else db.prepare('DELETE FROM draft_question_links WHERE role=?').run(role);
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
  return {role,question,answer,updated,parent_attempt_id:parentId,question_ref:ref};
}
export function getDraft(db, role) {
  const draft=db.prepare('SELECT role,question,answer,updated FROM drafts WHERE role=?').get(role) || {role:role || '',question:'',answer:''};
  const context=db.prepare('SELECT c.parent_attempt_id FROM draft_contexts c JOIN attempt_details d ON d.attempt_id=c.parent_attempt_id JOIN attempts a ON a.id=c.parent_attempt_id WHERE c.role=? AND a.role=c.role AND d.follow_up=?').get(role,draft.question.trim());
  const link=db.prepare('SELECT kind,question_id FROM draft_question_links WHERE role=?').get(role);
  let ref=null;
  if(link) { try { ref=validateQuestionRef(db,role,draft.question,{kind:link.kind,id:link.question_id}); } catch {} }
  return {...draft,parent_attempt_id:context?.parent_attempt_id || '',question_ref:ref};
}
export function saveDebrief(db, input) {
  const item = {id:randomUUID(), role:bounded(input.role,100,'岗位'), company:bounded(input.company,200,'公司'), interview_date:validateDate(input.interview_date), question:bounded(input.question,10000,'问题'), answer:bounded(input.answer,30000,'回答'), notes:bounded(input.notes,30000,'复盘'), include_in_library:input.include_in_library === true ? 1 : 0, created:new Date().toISOString()};
  if (!item.question && !item.notes) throw Error('请填写面试问题或复盘');
  if (!item.question && item.include_in_library) throw Error('请填写面试问题后再加入题库');
  db.prepare('INSERT INTO debriefs (id,role,company,interview_date,question,answer,notes,include_in_library,created) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(item.id,item.role,item.company,item.interview_date,item.question,item.answer,item.notes,item.include_in_library,item.created);
  return item;
}
export function setDebriefLibrary(db, id, value) {
  const item=db.prepare('SELECT * FROM debriefs WHERE id=?').get(id);
  if (!item) throw Error('面试记录不存在');
  if (value === true && !item.question) throw Error('没有题目的记录不能加入题库');
  db.prepare('UPDATE debriefs SET include_in_library=? WHERE id=?').run(value === true ? 1 : 0,id);
  return db.prepare('SELECT * FROM debriefs WHERE id=?').get(id);
}
export function setQuestionNote(db, sourceId, questionId, value) {
  const note=bounded(value,30000,'笔记');
  const result=db.prepare('UPDATE questions SET note=? WHERE id=? AND source_id=?').run(note,questionId,sourceId);
  if (!result.changes) throw Error('题目不存在');
  return {note};
}
export function setInterviewDate(db, sourceId, value) {
  const date=validateDate(value);
  const result=db.prepare('UPDATE sources SET interview_date=? WHERE id=?').run(date,sourceId);
  if (!result.changes) throw Error('来源不存在');
  return {interview_date:date};
}
export function exportData(db) {
  const ability_evaluations=db.prepare('SELECT attempt_id,evaluation FROM attempt_ability_evaluations ORDER BY attempt_id').all()
    .map(({attempt_id,evaluation})=>({attempt_id,evaluation:JSON.parse(evaluation)}));
  return {version:1, exported_at:new Date().toISOString(), settings:db.prepare("SELECT key,value FROM settings WHERE key='role'").all(), profiles:db.prepare('SELECT role,jd,confirmed_requirements FROM job_profiles').all(), sources:listSources(db), attempts:db.prepare('SELECT * FROM attempts ORDER BY created DESC').all(), drafts:db.prepare('SELECT role,question,answer,updated FROM drafts').all(), debriefs:db.prepare("SELECT d.*,COALESCE(t.topic,'') AS topic FROM debriefs d LEFT JOIN question_topics t ON t.kind='debrief' AND t.question_id=d.id ORDER BY d.created DESC").all(), assessments:db.prepare('SELECT attempt_id,rating FROM attempt_assessments').all(), attempt_details:db.prepare('SELECT * FROM attempt_details').all(), draft_contexts:db.prepare('SELECT * FROM draft_contexts').all(), attempt_question_links:db.prepare('SELECT * FROM attempt_question_links').all(), draft_question_links:db.prepare('SELECT * FROM draft_question_links').all(), dialogue_origins:db.prepare('SELECT * FROM dialogue_origins').all(), dialogue_summaries:db.prepare('SELECT * FROM dialogue_summaries').all(), dialogue_coaching:db.prepare('SELECT * FROM dialogue_coaching').all(), dialogue_requests:db.prepare('SELECT * FROM dialogue_requests').all(), ability_evaluations};
}

export function setAssessment(db, id, rating) {
  if (!['revisit', 'comfortable', 'unassessed'].includes(rating)) throw Error('无效的自评');
  if (!db.prepare('SELECT id FROM attempts WHERE id=?').get(id)) throw Error('练习记录不存在');
  if (rating === 'unassessed') db.prepare('DELETE FROM attempt_assessments WHERE attempt_id=?').run(id);
  else db.prepare('INSERT OR REPLACE INTO attempt_assessments VALUES (?,?)').run(id,rating);
  return {rating};
}

export function recommendQuestion(db, role, excludeText = '', sourcePreference = '', {
  topic='',excludeIds=[],questionRef=null,deprioritizedIds=[],maxLength=Infinity,focus=''
} = {}) {
  role = validRole(role);
  if (!['','self_reported'].includes(sourcePreference)) throw Error('题目来源筛选无效');
  const sources=listSources(db).filter(s=>s.role===role && (sourcePreference !== 'self_reported' || s.type === '真实面经（自述）')).flatMap(s=>s.questions.map(q=>({role,text:q.text,question_ref:{kind:'source',id:q.id},questionCreated:q.created,topic:q.topic,sourceId:s.id,sourceTitle:s.title,sourceUrl:s.url,sourceDate:s.date,sourceType:s.type,interviewDate:s.interview_date})));
  const personal=sourcePreference === 'self_reported' ? [] : db.prepare("SELECT d.id,d.question,d.created,COALESCE(t.topic,'') AS topic FROM debriefs d LEFT JOIN question_topics t ON t.kind='debrief' AND t.question_id=d.id WHERE d.role=? AND d.include_in_library=1").all(role).map(d=>({role,text:d.question,question_ref:{kind:'debrief',id:d.id},questionCreated:d.created,topic:d.topic,sourceId:'debrief:'+d.id,sourceTitle:'个人面试记录',sourceType:'个人面试记录'}));
  const attempts=db.prepare('SELECT a.id,a.role,a.question,a.created,aa.rating,l.kind AS refKind,l.question_id AS refId FROM attempts a LEFT JOIN attempt_assessments aa ON aa.attempt_id=a.id LEFT JOIN attempt_question_links l ON l.attempt_id=a.id WHERE a.role=?').all(role);
  const canonical = text=>String(text || '').normalize('NFKC').trim().toLowerCase();
  const topicKey=canonicalTopic(topic);
  const topicWord=/^[a-z0-9]+$/u.test(topicKey) ? new RegExp(`(?<![a-z0-9])${topicKey}(?![a-z0-9])`,'u') : null;
  const pool = [...sources,...personal];
  const excludedText = new Set(pool.filter(item=>excludeIds.includes(item.question_ref.id)).map(item=>canonical(item.text)));
  const candidates = pool.filter(item=>item.text.trim().length<=maxLength && !excludedText.has(canonical(item.text)) &&
    (!questionRef || (item.question_ref.kind===questionRef.kind && item.question_ref.id===questionRef.id)) &&
    matchesFocus(focus,item.text) && (!topicKey || canonicalTopic(item.topic)===topicKey ||
      (topicKey==='rag' ? matchesRag(item.text) : topicWord ? topicWord.test(canonical(item.text)) : canonical(item.text).includes(topicKey))));
  return recommendFromHistory({role,candidates,attempts,excludeText,deprioritizedIds});
}
