export const evaluationInstructions = [
  '在同一个输出 JSON 中必须同时返回外层已有字段与 evaluation 键。只有无法从回答定位任何观察、也无法确定待验证项时，evaluation 填 null。',
  'evaluation 对象须返回 {"topic":"一个原文主题词，如 RAG，未知填空字符串","strengths":[{"point":"正确点","evidence":"本轮回答连续原文"}],"weaknesses":[{"point":"本轮具体错误","type":"incorrect","evidence":"本轮回答连续原文"},{"point":"本轮明确遗漏","type":"missing","evidence":"回答相关原句","requirement":"本轮题目明确要求的连续原文"}],"unverified":["尚未验证的具体知识点"],"followup_point":"","recommended_action":"review"}。各列表无内容时填 []。',
  'type 只允许 incorrect 或 missing。missing 必须另有 requirement，逐字摘自本轮题目明确要求的内容，evidence 引用用户已说的相关部分。未被问及或回答无相关证据的内容写入 unverified，不作为错误或遗漏。',
  '每类最多四条，point 使用简短、中性的知识点名称，例如「召回数量与答案准确率」，不要写成「误认为更多召回更准」或「理解了召回影响」。评价方向已由所属列表和 type 表示。不要用追问、往轮内容或 AI 自己的话充当本轮证据。不要从单轮推断掌握水平。',
  'recommended_action 为 followup、review 或 complete。确有值得澄清的本轮薄弱点时才用 followup：将一条 weaknesses.point 原样复制到 evaluation.followup_point，并把一道相关的具体问题放在外层 follow_up，延续已知主题，避免重复。不要重复输出追问文本。review 或 complete 时 followup_point 与外层 follow_up 均为空字符串。'
].join(' ');

const canonical = text => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu,' ');
const questionKey = text => canonical(text).replace(/[\p{P}\s]/gu,'');
const mentionsTopic = (topic,question,answer) => [question,answer].some(part=>canonical(part).includes(canonical(topic)));

function bounded(value, max, optional=false) {
  if (typeof value !== 'string' || value.length>max || (!optional && !value.trim())) throw Error('invalid_evaluation');
  return value.trim();
}
function object(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('invalid_evaluation');
}
function list(value, convert) {
  if (!Array.isArray(value) || value.length>4) throw Error('invalid_evaluation');
  return value.map(convert);
}

export function validateAbilityEvaluation(value, question, answer) {
  object(value);
  const topic=bounded(value.topic,40,true);
  if (topic && !mentionsTopic(topic,question,answer)) throw Error('invalid_evaluation');
  const observed=item=>{
    object(item);
    const point=bounded(item.point,200), evidence=bounded(item.evidence,500);
    if (evidence!==item.evidence || !answer.includes(evidence)) throw Error('invalid_evaluation');
    return {point,evidence};
  };
  const strengths=list(value.strengths,observed);
  const weaknesses=list(value.weaknesses,item=>{
    const base=observed(item);
    if (item.type==='incorrect') return {...base,type:'incorrect'};
    if (item.type!=='missing') throw Error('invalid_evaluation');
    const requirement=bounded(item.requirement,300);
    if (requirement!==item.requirement || !question.includes(requirement)) throw Error('invalid_evaluation');
    return {...base,type:'missing',requirement};
  });
  const unverified=list(value.unverified,item=>bounded(item,200));
  const points=[...strengths.map(item=>item.point),...weaknesses.map(item=>item.point),...unverified];
  if (!points.length || new Set(points.map(canonical)).size!==points.length) throw Error('invalid_evaluation');
  const recommended_action=value.recommended_action;
  const followup_point=bounded(value.followup_point,200,true);
  const suggested_followup=bounded(value.suggested_followup,500,true);
  if (!['followup','review','complete'].includes(recommended_action)) throw Error('invalid_evaluation');
  if (recommended_action==='followup') {
    if (!questionKey(suggested_followup) || !weaknesses.some(item=>item.point===followup_point)) throw Error('invalid_evaluation');
  } else if (followup_point || suggested_followup) throw Error('invalid_evaluation');
  return {topic,strengths,weaknesses,unverified,followup_point,suggested_followup,recommended_action};
}

export function readModelEvaluation(content, question, answer) {
  const response=JSON.parse(content), value=response?.evaluation;
  if (value===undefined || value===null) return null;
  try {
    object(value);
    let topic=bounded(value.topic,40,true);
    if (topic && !mentionsTopic(topic,question,answer)) {
      // Models sometimes prefix a generated heading with the literal acronym.
      const token=/^([A-Z][A-Z0-9]{1,11})(?=\s|[:：])/u.exec(topic)?.[1];
      topic=token && [question,answer].some(part=>part.match(/[A-Za-z0-9]+/gu)?.includes(token)) ? token : '';
    }
    let {recommended_action,followup_point}=value;
    let suggested_followup=value.suggested_followup ?? '';
    if (recommended_action==='followup') {
      suggested_followup=suggested_followup || response.follow_up;
      const selected=Array.isArray(value.weaknesses) && value.weaknesses.some(item=>item?.point===followup_point);
      if (!selected || typeof followup_point!=='string' || !followup_point.trim() ||
          typeof suggested_followup!=='string' || !suggested_followup.trim() ||
          suggested_followup.length>500 || /[\r\n]/u.test(suggested_followup) || (suggested_followup.match(/[?？]/gu)?.length ?? 0)>1) {
        recommended_action='review';followup_point='';suggested_followup='';
        console.warn('[interview-evaluation] unusable follow-up; keeping grounded observations');
      }
    }
    return validateAbilityEvaluation({...value,topic,recommended_action,followup_point,suggested_followup},question,answer);
  } catch {
    console.warn('[interview-evaluation] invalid structured evaluation; keeping feedback');
    return null;
  }
}

export function applyEvaluation(review, evaluation, asked, canFollow=true) {
  if (!evaluation) return {...review,follow_up:canFollow?review.follow_up:'',evaluation:null};
  if (evaluation.recommended_action!=='followup') return {...review,follow_up:'',evaluation};
  const repeated=asked.some(question=>questionKey(question)===questionKey(evaluation.suggested_followup));
  if (canFollow && !repeated) return {...review,follow_up:evaluation.suggested_followup,evaluation};
  return {...review,follow_up:'',evaluation:{...evaluation,followup_point:'',suggested_followup:'',recommended_action:'review'}};
}

export function saveAbilityEvaluation(db, attemptId, evaluation) {
  if (evaluation) db.prepare('INSERT INTO attempt_ability_evaluations (attempt_id,evaluation) VALUES (?,?)')
    .run(attemptId,JSON.stringify(evaluation));
}

export function getAbilityEvaluation(db, attemptId) {
  const row=db.prepare('SELECT evaluation FROM attempt_ability_evaluations WHERE attempt_id=?').get(attemptId);
  return row ? JSON.parse(row.evaluation) : null;
}
