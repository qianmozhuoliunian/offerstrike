export const MAX_SOURCE_CHARACTERS = 12000;

export function validateSourceText(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('请先粘贴面经原文');
  if (Array.from(value).length > MAX_SOURCE_CHARACTERS) throw Error('原文超过 12000 个字符，请分段后再提取；本次未发送');
  return value;
}

export function isVerifiableEvidence(value, sourceText) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) return false;
  const length=Array.from(value).length;
  return length >= 4 && length <= 500 && value.length <= 1000 && sourceText.includes(value);
}

// Exact text matching verifies only the quote's presence in the user's input;
// the user still decides whether the candidate accurately reflects the source.
export function parseSourceCandidates(content, sourceText) {
  let parsed;
  try { parsed=JSON.parse(content); } catch { throw Error('AI 返回格式无效，请重试'); }
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length > 20) throw Error('AI 返回格式无效，请重试或分段提取');
  const items=[], seen=new Set();
  let omitted=0;
  for (const item of parsed.items) {
    const question=typeof item?.question === 'string' ? item.question.trim() : '';
    const evidence=typeof item?.evidence === 'string' ? item.evidence.trim() : '';
    if (!question || question.length > 2000 || !isVerifiableEvidence(evidence,sourceText) || seen.has(question)) { omitted++; continue; }
    seen.add(question); items.push({question,evidence});
  }
  return {items,omitted};
}
