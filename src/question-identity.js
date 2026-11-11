// Stable references never infer provenance from user-entered text.
export function validateQuestionRef(db, role, question, ref) {
  if (ref === undefined || ref === null) return null;
  if (typeof ref !== 'object' || Array.isArray(ref) || !['source','debrief'].includes(ref.kind) || typeof ref.id !== 'string' || !ref.id || ref.id.length > 200) throw Error('题目关联格式无效');
  const row=ref.kind==='source'
    ? db.prepare('SELECT q.text,s.role FROM questions q JOIN sources s ON s.id=q.source_id WHERE q.id=?').get(ref.id)
    : db.prepare('SELECT question AS text,role FROM debriefs WHERE id=? AND include_in_library=1').get(ref.id);
  if(!row || row.role!==role || row.text.trim()!==question.trim()) throw Error('题目已变更或不属于当前岗位，请重新选择题目');
  return {kind:ref.kind,id:ref.id};
}
