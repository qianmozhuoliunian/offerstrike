export const knowledgeKey = value => value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu,' ');

const rag = new Set(['rag','检索增强生成','retrieval-augmented generation','retrieval augmented generation']);
const retrievalEvaluation = ['检索评估','rag 检索评估','检索质量评估','检索效果评估','评估检索质量','评估检索效果',
  'retrieval evaluation','retrieval quality evaluation'];

export function topicKey(topic) {
  const key=knowledgeKey(topic);
  return rag.has(key) ? 'rag' : key;
}

export function pointKey(topic,point) {
  const key=knowledgeKey(point);
  return topicKey(topic)==='rag' && retrievalEvaluation.includes(key) ? '检索评估' : key;
}

export function searchFocus(topic,point) {
  return topicKey(topic)==='rag' && pointKey(topic,point)==='检索评估' ? '检索评估' : '';
}

export function matchesFocus(focus,text) {
  if (!focus) return true;
  const key=knowledgeKey(text);
  return retrievalEvaluation.some(alias=>key.includes(alias)) ||
    /评估\s*(?:(?:rag|检索增强生成)\s*的?\s*)?检索(?:的)?(?:质量|效果|表现)|检索(?:阶段|结果)?(?:的)?(?:质量|效果|表现)(?:应该|可以)?(?:怎么|如何)评估/u.test(key);
}

export function matchesRag(text) {
  const key=knowledgeKey(text);
  return /(?<![a-z0-9])rag(?![a-z0-9])/u.test(key) ||
    [...rag].some(alias=>alias!=='rag' && key.includes(alias));
}
