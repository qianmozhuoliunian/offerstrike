import { randomUUID } from 'node:crypto';
import { searchFocus, topicKey } from './knowledge-names.js';
import { LIMITS } from './research/index.js';

const leaseMs=LIMITS.milliseconds+5000;

function recover(db,role,now) {
  db.prepare("UPDATE training_tasks SET status='failed',reason='timeout' WHERE role=? AND status='searching' AND started_at<=?")
    .run(role,now-leaseMs);
  db.prepare(`UPDATE training_tasks SET status='failed',reason='question_removed' WHERE role=? AND status='ready'
    AND NOT EXISTS(SELECT 1 FROM questions q JOIN sources s ON s.id=q.source_id
    JOIN question_evidence e ON e.question_id=q.id AND e.confirmed_text=q.text
    WHERE q.id=training_tasks.question_id AND s.role=training_tasks.role)`)
    .run(role);
}

export function readTrainingTasks(db,role,id,now=Date.now()) {
  recover(db,role,now);
  if (!id) return db.prepare(`SELECT id,topic,point,status,reason,created_at,question_id,attempt_id FROM training_tasks
    WHERE role=? ORDER BY CASE WHEN status IN ('proposed','searching','review','ready') THEN 0 ELSE 1 END,
    created_at DESC,rowid DESC LIMIT 12`).all(role);
  const row=db.prepare('SELECT * FROM training_tasks WHERE id=? AND role=?').get(id,role);
  if (!row) throw Error('本岗位的训练任务不存在');
  const {topics,result,...fields}=row;
  const question=row.question_id && db.prepare(`SELECT q.id,q.source_id,q.text,s.title,s.url FROM questions q
    JOIN sources s ON s.id=q.source_id WHERE q.id=? AND s.role=?`).get(row.question_id,role);
  return {...fields,research_request:{role,topics:JSON.parse(topics),focus:searchFocus(row.topic,row.point)},
    result:result?JSON.parse(result):null,question:question || null};
}

export function createTrainingTask(db,role,{topic='',request_id},suggest,now=Date.now()) {
  if (typeof topic!=='string' || topic.length>40 || typeof request_id!=='string' ||
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(request_id)) throw Error('训练任务主题或请求编号无效');
  recover(db,role,now);
  let id;
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=db.prepare('SELECT id,topic FROM training_tasks WHERE role=? AND request_id=?').get(role,request_id);
    if (existing && topicKey(existing.topic)!==topicKey(topic)) throw Error('请求编号已用于其他训练主题');
    id=existing?.id;
    if (!id) {
      const active=db.prepare(`SELECT id,topic FROM training_tasks WHERE role=? AND status IN ('proposed','searching','review','ready')`)
        .all(role).find(item=>topicKey(item.topic)===topicKey(topic));
      id=active?.id;
    }
    if (!id) {
      const suggestion=suggest(topic);
      if (!suggestion) throw Error('备战建议已更新，请重新选择补题目标');
      id=randomUUID();
      db.prepare(`INSERT INTO training_tasks (id,role,request_id,topic,point,topics,status,created_at)
        VALUES (?,?,?,?,?,?,'proposed',?)`).run(id,role,request_id,suggestion.topic,suggestion.point,
        JSON.stringify(suggestion.research_request.topics),now);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return readTrainingTasks(db,role,id,now);
}

export function startTrainingSearch(db,task,now) {
  return !!db.prepare("UPDATE training_tasks SET status='searching',started_at=? WHERE id=? AND role=? AND status='proposed'")
    .run(now,task.id,task.role).changes;
}

export function settleTrainingSearch(db,task,status,reason,result=null) {
  db.prepare("UPDATE training_tasks SET status=?,reason=?,result=? WHERE id=? AND role=? AND status='searching'")
    .run(status,reason,result?JSON.stringify(result):null,task.id,task.role);
}

export function cancelTrainingTask(db,role,id,now) {
  if (!id) throw Error('请指定训练任务');
  const task=readTrainingTasks(db,role,id,now);
  db.prepare(`UPDATE training_tasks SET status='cancelled',reason='cancelled',result=NULL
    WHERE id=? AND role=? AND status IN ('proposed','searching','review','ready')`).run(task.id,role);
  return readTrainingTasks(db,role,id,now);
}

export function finishTrainingFromAttempt(db,role,attemptId) {
  db.prepare(`WITH RECURSIVE lineage(id,depth) AS (
    SELECT ?,1 UNION ALL SELECT d.parent_attempt_id,lineage.depth+1 FROM lineage
    JOIN attempt_details d ON d.attempt_id=lineage.id JOIN attempts a ON a.id=d.parent_attempt_id AND a.role=?
    WHERE d.parent_attempt_id<>'' AND lineage.depth<8
  ) UPDATE training_tasks SET status='completed',attempt_id=? WHERE role=? AND status='ready' AND question_id=(
    SELECT l.question_id FROM lineage JOIN attempt_question_links l ON l.attempt_id=lineage.id WHERE l.kind='source'
    ORDER BY lineage.depth DESC LIMIT 1
  ) AND EXISTS(SELECT 1 FROM attempt_ability_evaluations WHERE attempt_id=?)
    AND EXISTS(SELECT 1 FROM questions q JOIN question_evidence e ON e.question_id=q.id AND e.confirmed_text=q.text
      WHERE q.id=training_tasks.question_id)`).run(attemptId,role,attemptId,role,attemptId);
}
