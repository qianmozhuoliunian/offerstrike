import { validateSource, validateDate } from './core.js';
import { randomUUID } from 'node:crypto';
import { validateStoredCoaching } from './coaching.js';

// Existing records win on conflicts; validation happens before any writes.
export function importData(db, data, commit = false) {
  if (!data || data.version !== 1) throw Error('备份版本不受支持');
  const names=['settings','profiles','sources','attempts','drafts','debriefs'];
  for (const name of names) if (!Array.isArray(data[name]) || data[name].length > 20000) throw Error(`备份中的 ${name} 无效`);
  if (data.assessments !== undefined && (!Array.isArray(data.assessments) || data.assessments.length > 20000)) throw Error('备份中的自评无效');
  if (data.attempt_details !== undefined && (!Array.isArray(data.attempt_details) || data.attempt_details.length > 20000)) throw Error('备份中的追问信息无效');
  if (data.draft_contexts !== undefined && (!Array.isArray(data.draft_contexts) || data.draft_contexts.length > 20000)) throw Error('备份中的追问草稿无效');
  if (data.attempt_question_links !== undefined && (!Array.isArray(data.attempt_question_links) || data.attempt_question_links.length > 20000)) throw Error('备份中的题目关联无效');
  if (data.draft_question_links !== undefined && (!Array.isArray(data.draft_question_links) || data.draft_question_links.length > 20000)) throw Error('备份中的草稿关联无效');
  for (const name of ['dialogue_origins','dialogue_summaries','dialogue_coaching','dialogue_requests']) if (data[name] !== undefined && (!Array.isArray(data[name]) || data[name].length > 20000)) throw Error(`备份中的 ${name} 无效`);
  const text=(v,max,field,required=false) => {
    if (typeof v !== 'string' || v.length>max || (required && !v.trim())) throw Error(`备份中的${field}无效`);
    return v;
  };
  const id=v=>text(v,200,'编号',true);
  const record=(x)=>{if(!x || typeof x!=='object' || Array.isArray(x)) throw Error('备份记录格式无效');return x;};
  const seen=new Set();
  const unique=(kind,key)=>{const keyValue=`${kind}:${key}`;if(seen.has(keyValue)) throw Error('备份包含重复记录');seen.add(keyValue);};
  const operations=[]; const counts={新增:0,保留现有:0};
  const add=(exists,sql,args)=>{if(exists) counts.保留现有++; else {counts.新增++;operations.push([sql,args]);}};
  for(const item of data.settings) {
    record(item); if(item.key!=='role') throw Error('备份中包含不支持的设置');
    const value=text(item.value,100,'岗位'); unique('setting',item.key);
    add(!!db.prepare('SELECT 1 FROM settings WHERE key=?').get('role'),'INSERT INTO settings VALUES (?,?)',['role',value]);
  }
  for(const item of data.profiles) {
    record(item);const role=text(item.role,100,'岗位',true);unique('profile',role);
    const args=[role,text(item.jd,30000,'岗位描述'),text(item.confirmed_requirements,10000,'岗位要求')];
    add(!!db.prepare('SELECT 1 FROM job_profiles WHERE role=?').get(role),'INSERT INTO job_profiles VALUES (?,?,?)',args);
  }
  const acceptedSources=new Set(), compatibleQuestionRefs=new Map(), backupQuestionRefs=new Set();
  for(const item of data.sources) {
    record(item); const sourceId=id(item.id);unique('source',sourceId);
    // Older versions allowed longer source fields; keep their backups restorable.
    const source=validateSource(item); text(source.title,100000,'标题',true);text(source.role,100000,'岗位');text(item.question,100000,'旧题目');text(item.created,100,'时间',true);
    const existing=db.prepare('SELECT url,role FROM sources WHERE id=?').get(sourceId);
    let sameUrl=false;
    if (existing) { try { sameUrl=new URL(existing.url).href===source.url; } catch {} }
    if (!existing || (sameUrl && existing.role===source.role)) acceptedSources.add(sourceId);
    add(!!existing,'INSERT INTO sources (id,title,url,date,type,question,role,created,interview_date) VALUES (?,?,?,?,?,?,?,?,?)',[sourceId,source.title,source.url,source.date,source.type,item.question,source.role,item.created,source.interview_date]);
    if(!Array.isArray(item.questions) || item.questions.length>20000) throw Error('备份中的题目无效');
    for(const q of item.questions) {
      record(q);const qid=id(q.id);unique('question',qid);
      backupQuestionRefs.add('source:'+qid);
      if(q.source_id!==sourceId) throw Error('题目与来源不匹配');
      const args=[qid,sourceId,text(q.text,10000,'题目',true),text(q.created,100,'时间',true),text(q.note ?? '',30000,'笔记')];
      const existingQuestion=db.prepare('SELECT source_id,text FROM questions WHERE id=?').get(qid);
      const compatible=acceptedSources.has(sourceId) && (!existingQuestion || (existingQuestion.source_id===sourceId && existingQuestion.text===q.text));
      if(compatible) compatibleQuestionRefs.set('source:'+qid,{role:source.role,text:q.text});
      add(!compatible || !!existingQuestion,'INSERT INTO questions (id,source_id,text,created,note) VALUES (?,?,?,?,?)',args);
      const evidence=text(q.evidence ?? '',1000,'原文依据');
      const evidenceQuestion=text(q.evidence_question ?? '',10000,'依据对应题目');
      if (!!evidence !== !!evidenceQuestion || (evidence && (!evidence.trim() || !evidenceQuestion.trim()))) throw Error('备份中的原文依据无效');
      if(evidence) add(!compatible || !!db.prepare('SELECT 1 FROM question_evidence WHERE question_id=?').get(qid),'INSERT INTO question_evidence (question_id,evidence,confirmed_text,request_id) VALUES (?,?,?,?)',[qid,evidence,evidenceQuestion,randomUUID()]);
      const topic=text(q.topic ?? '',100,'主题').trim();
      if(topic) add(!compatible || !!db.prepare("SELECT 1 FROM question_topics WHERE kind='source' AND question_id=?").get(qid),'INSERT INTO question_topics (kind,question_id,topic) VALUES (?,?,?)',['source',qid,topic]);
    }
  }
  const acceptedAttempts=new Set(), linkCompatibleAttempts=new Set();
  for(const item of data.attempts) {
    record(item);const itemId=id(item.id);unique('attempt',itemId);
    const args=[itemId,text(item.question,100000,'问题',true),text(item.answer,100000,'回答'),text(item.feedback,30000,'点评'),text(item.role,100000,'岗位'),text(item.created,100,'时间',true)];
    const existing=db.prepare('SELECT question,answer,feedback,role,created FROM attempts WHERE id=?').get(itemId);
    if(!existing || ['question','answer','feedback','role','created'].every(key=>existing[key]===item[key])) { acceptedAttempts.add(itemId); linkCompatibleAttempts.add(itemId); }
    add(!!existing,'INSERT INTO attempts VALUES (?,?,?,?,?,?)',args);
  }
  for(const item of data.drafts) {
    record(item);const role=text(item.role,100,'岗位',true);unique('draft',role);
    add(!!db.prepare('SELECT 1 FROM drafts WHERE role=?').get(role),'INSERT INTO drafts VALUES (?,?,?,?)',[role,text(item.question,10000,'问题'),text(item.answer,30000,'回答'),text(item.updated,100,'时间',true)]);
  }
  for(const item of data.debriefs) {
    record(item);const itemId=id(item.id);unique('debrief',itemId);
    backupQuestionRefs.add('debrief:'+itemId);
    if(![0,1].includes(item.include_in_library)) throw Error('面试复盘状态无效');
    const args=[itemId,text(item.role,100,'岗位'),text(item.company,200,'公司'),validateDate(item.interview_date),text(item.question,10000,'问题'),text(item.answer,30000,'回答'),text(item.notes,30000,'复盘'),item.include_in_library,text(item.created,100,'时间',true)];
    if ((!item.question && !item.notes) || (!item.question && item.include_in_library)) throw Error('面试复盘内容无效');
    const existingDebrief=db.prepare('SELECT role,question FROM debriefs WHERE id=?').get(itemId);
    add(!!existingDebrief,'INSERT INTO debriefs VALUES (?,?,?,?,?,?,?,?,?)',args);
    const topic=text(item.topic ?? '',100,'主题').trim();
    if(topic && !item.question) throw Error('没有题目的复盘不能标注主题');
    const compatible=!existingDebrief || (existingDebrief.role===item.role && existingDebrief.question===item.question);
    if(compatible) compatibleQuestionRefs.set('debrief:'+itemId,{role:item.role,text:item.question});
    if(topic) add(!compatible || !!db.prepare("SELECT 1 FROM question_topics WHERE kind='debrief' AND question_id=?").get(itemId),'INSERT INTO question_topics (kind,question_id,topic) VALUES (?,?,?)',['debrief',itemId,topic]);
  }
  const attemptsById=new Map(data.attempts.map(item=>[item.id,item]));
  const draftsByRole=new Map(data.drafts.map(item=>[item.role,item]));
  const detailsByAttempt=new Map((data.attempt_details || []).map(item=>[item?.attempt_id,item]));
  for(const item of (data.assessments || [])) {
    record(item);const attemptId=id(item.attempt_id);unique('assessment',attemptId);
    if(!['revisit','comfortable'].includes(item.rating) || !attemptsById.has(attemptId)) throw Error('备份中的自评无效');
    add(!acceptedAttempts.has(attemptId) || !!db.prepare('SELECT 1 FROM attempt_assessments WHERE attempt_id=?').get(attemptId),'INSERT INTO attempt_assessments VALUES (?,?)',[attemptId,item.rating]);
  }
  for(const item of (data.attempt_details || [])) {
    record(item);const attemptId=id(item.attempt_id);unique('attempt_details',attemptId);
    const followUp=text(item.follow_up,2000,'追问'), parent=text(item.parent_attempt_id,200,'上轮练习编号');
    if(!attemptsById.has(attemptId) || (parent && !attemptsById.has(parent))) throw Error('追问信息与练习记录不匹配');
    add(!acceptedAttempts.has(attemptId) || (parent && !acceptedAttempts.has(parent)) || !!db.prepare('SELECT 1 FROM attempt_details WHERE attempt_id=?').get(attemptId),'INSERT INTO attempt_details VALUES (?,?,?)',[attemptId,followUp,parent]);
  }
  for(const item of (data.draft_contexts || [])) {
    record(item); const role=text(item.role,100,'岗位',true), parent=id(item.parent_attempt_id);unique('draft_context',role);
    const draft=draftsByRole.get(role), detail=detailsByAttempt.get(parent), attempt=attemptsById.get(parent);
    if(!draft || !detail || !attempt || attempt.role!==role || detail.follow_up!==draft.question.trim()) throw Error('备份中的追问草稿不匹配');
    const existingDraft=db.prepare('SELECT question FROM drafts WHERE role=?').get(role);
    const existingDetail=db.prepare('SELECT follow_up FROM attempt_details WHERE attempt_id=?').get(parent);
    const collision=!acceptedAttempts.has(parent) || (existingDraft && existingDraft.question!==draft.question) || (existingDetail && existingDetail.follow_up!==detail.follow_up);
    add(!!collision || !!db.prepare('SELECT 1 FROM draft_contexts WHERE role=?').get(role),'INSERT INTO draft_contexts VALUES (?,?)',[role,parent]);
  }
  for(const item of (data.attempt_question_links || [])) {
    record(item);const attemptId=id(item.attempt_id);unique('attempt_question_link',attemptId);
    if(!['source','debrief','none','missing_source','missing_debrief'].includes(item.kind) || typeof item.question_id!=='string' || item.question_id.length>200 || (item.kind==='none' ? !!item.question_id : !item.question_id)) throw Error('备份中的题目关联无效');
    const attempt=attemptsById.get(attemptId);
    if(!attempt) throw Error('题目关联缺少练习记录');
    const reference=compatibleQuestionRefs.get(item.kind+':'+item.question_id);
    // On conflicts, keep an explicit unlinked marker, so imported new records
    // cannot silently fall back to legacy text-based matching.
    const isMissing=item.kind.startsWith('missing_');
    const existedInBackup=backupQuestionRefs.has(item.kind+':'+item.question_id);
    const safe=item.kind==='none' || isMissing || (!!reference && reference.role===attempt.role);
    const missing=!safe && !existedInBackup && ['source','debrief'].includes(item.kind);
    const kind=safe ? item.kind : missing ? 'missing_'+item.kind : 'none', questionId=(safe || missing) ? item.question_id : '';
    add(!linkCompatibleAttempts.has(attemptId) || !!db.prepare('SELECT 1 FROM attempt_question_links WHERE attempt_id=?').get(attemptId),'INSERT INTO attempt_question_links VALUES (?,?,?)',[attemptId,kind,questionId]);
  }
  for(const item of (data.draft_question_links || [])) {
    record(item);const role=text(item.role,100,'岗位',true), questionId=id(item.question_id);unique('draft_question_link',role);
    if(!['source','debrief'].includes(item.kind)) throw Error('备份中的草稿关联无效');
    const draft=draftsByRole.get(role), reference=compatibleQuestionRefs.get(item.kind+':'+questionId);
    if(!draft) throw Error('题目关联缺少草稿');
    const existingDraft=db.prepare('SELECT question,answer,updated FROM drafts WHERE role=?').get(role);
    const compatibleDraft=!existingDraft || ['question','answer','updated'].every(key=>existingDraft[key]===draft[key]);
    const safe=compatibleDraft && reference && reference.role===role && reference.text.trim()===draft.question.trim();
    add(!safe || !!db.prepare('SELECT 1 FROM draft_question_links WHERE role=?').get(role),'INSERT INTO draft_question_links VALUES (?,?,?)',[role,item.kind,questionId]);
  }
  const backupLinks = new Map((data.attempt_question_links || []).map(item => [item?.attempt_id,item]));
  for (const item of (data.dialogue_origins || [])) {
    record(item); const attemptId=id(item.attempt_id); unique('dialogue_origin',attemptId);
    if (!['source','debrief','ai','user'].includes(item.origin) || !attemptsById.has(attemptId)) throw Error('备份中的对话来源无效');
    const detail=detailsByAttempt.get(attemptId), link=backupLinks.get(attemptId);
    if (!detail || detail.parent_attempt_id || !link) throw Error('对话来源与题目不匹配');
    if (['source','debrief'].includes(item.origin) && link.kind!==item.origin) throw Error('对话来源与题目关联不匹配');
    if (['ai','user'].includes(item.origin) && link.kind!=='none') throw Error('对话来源与题目关联不匹配');
    const existingLink=db.prepare('SELECT kind,question_id FROM attempt_question_links WHERE attempt_id=?').get(attemptId);
    const ref=compatibleQuestionRefs.get(link.kind+':'+link.question_id);
    const sourceSafe=!['source','debrief'].includes(item.origin) || (!!ref && ref.role===attemptsById.get(attemptId).role);
    const linkSafe=!existingLink || (existingLink.kind===link.kind && existingLink.question_id===link.question_id);
    add(!acceptedAttempts.has(attemptId) || !sourceSafe || !linkSafe || !!db.prepare('SELECT 1 FROM dialogue_origins WHERE attempt_id=?').get(attemptId),'INSERT INTO dialogue_origins VALUES (?,?)',[attemptId,item.origin]);
  }
  for (const item of (data.dialogue_summaries || [])) {
    record(item); const attemptId=id(item.attempt_id); unique('dialogue_summary',attemptId);
    const summary=text(item.summary,10000,'对话总结',true);
    if (!attemptsById.has(attemptId) || !detailsByAttempt.has(attemptId)) throw Error('对话总结缺少练习记录');
    add(!acceptedAttempts.has(attemptId) || !!db.prepare('SELECT 1 FROM dialogue_summaries WHERE attempt_id=?').get(attemptId),'INSERT INTO dialogue_summaries VALUES (?,?)',[attemptId,summary]);
  }
  for (const item of (data.dialogue_coaching || [])) {
    record(item); const attemptId=id(item.attempt_id); unique('dialogue_coaching',attemptId);
    const attempt=attemptsById.get(attemptId);
    if (!attempt || !detailsByAttempt.has(attemptId)) throw Error('点评依据缺少练习记录');
    const coaching=validateStoredCoaching(item,attempt.answer);
    add(!acceptedAttempts.has(attemptId) || !!db.prepare('SELECT 1 FROM dialogue_coaching WHERE attempt_id=?').get(attemptId),'INSERT INTO dialogue_coaching VALUES (?,?,?,?)',[attemptId,coaching.focus,coaching.evidence,coaching.next_step]);
  }
  for (const item of (data.dialogue_requests || [])) {
    record(item); const requestId=id(item.request_id), attemptId=id(item.attempt_id); unique('dialogue_request',requestId);
    if (!attemptsById.has(attemptId) || !detailsByAttempt.has(attemptId)) throw Error('对话请求缺少练习记录');
    add(!acceptedAttempts.has(attemptId) || !!db.prepare('SELECT 1 FROM dialogue_requests WHERE request_id=?').get(requestId),'INSERT INTO dialogue_requests VALUES (?,?)',[requestId,attemptId]);
  }
  if(commit) {
    db.exec('BEGIN');
    try { for(const [sql,args] of operations) db.prepare(sql).run(...args); db.exec('COMMIT'); }
    catch(error) { db.exec('ROLLBACK'); throw error; }
  }
  return counts;
}
