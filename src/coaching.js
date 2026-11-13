import { parseReview } from './services.js';

// These are broad prompts, not claims about the job or the user's ability.
export function roleCoaching(role) {
  const value=String(role || '');
  if (/产品经理|产品专员|product\s*manager/i.test(value)) return {name:'产品岗位',focus:'关注用户问题、目标与指标、方案取舍和验证方法。'};
  if (/前端|front[ -]?end/i.test(value)) return {name:'前端岗位',focus:'关注浏览器与交互原理、实现边界、性能及具体取舍。'};
  if (/(?:AI|agent|大模型|人工智能|机器学习|LLM)/i.test(value) && /应用|开发|工程|研发|算法/i.test(value)) return {name:'AI 应用岗位',focus:'关注实际问题、模型与检索或工具的选择、评测、失败处理和取舍。'};
  return {name:'通用岗位',focus:'关注对问题的理解、具体做法、依据与取舍；以确认的岗位要求为准。'};
}

function text(value, max) {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : '';
}

// Existing historical feedback remains readable; new feedback requires a quote.
export function parseCoachingReview(content, answer) {
  const review = parseReview(content);
  let object;
  try { object=JSON.parse(content); } catch { throw Error('AI 点评格式无效，请重试'); }
  const focus=text(object.focus,300), evidence=text(object.evidence,500), next_step=text(object.next_step,1000);
  if (!focus || !evidence || !next_step || !answer.includes(evidence)) throw Error('AI 点评的回答引用无法核验，请重试；原回答仍保留');
  return {...review,coaching:{focus,evidence,next_step}};
}

export function validateStoredCoaching(value, answer) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('备份中的点评依据无效');
  const focus=text(value.focus,300), evidence=text(value.evidence,500), next_step=text(value.next_step,1000);
  if (!focus || !evidence || !next_step || !answer.includes(evidence)) throw Error('备份中的点评依据与回答不匹配');
  return {focus,evidence,next_step};
}
