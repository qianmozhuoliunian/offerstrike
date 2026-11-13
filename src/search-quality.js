// Only describe clues visible in the URL or title. Neither proves an author's
// identity or the type of the original article.
export function searchContentHint(result) {
  let url;
  try { url = new URL(result.url); } catch { return 'unknown'; }
  const title = String(result.title || '').normalize('NFKC');
  const host = url.hostname.toLowerCase();
  if ((host === 'nowcoder.com' || host.endsWith('.nowcoder.com')) &&
      (/^\/enterprise\/\d+\/interview\/?$/i.test(url.pathname) || /^\/experience\/\d+\/?$/i.test(url.pathname))) return 'listing';
  if (/合集|汇总|盘点|题库|高频题|面试题|面试八股|岗位介绍|面试指南|面试攻略|整理了|整理.*(?:面经|面试)|(?:面经|面试).{0,16}(?:总结|整理|全景|题解|笔记|趋势|风向|考点|常见.{0,8}题|\d+\s*个.{0,4}题)|我扒.{0,15}面经/i.test(title)) return 'compilation';
  if (/面经|挂经|凉经|面试经历|一面|二面|三面|终面/i.test(title)) return 'interview_clue';
  return 'unknown';
}

export function partitionSearchResults(matched, unverified) {
  const primary = [], supplementary = [];
  for (const item of matched) {
    const result = {...item, content_hint:searchContentHint(item)};
    (result.content_hint === 'interview_clue' ? primary : supplementary).push(result);
  }
  // Explicit clues first; stable sorting preserves provider order within a group.
  primary.sort((a,b) => (a.content_hint === 'interview_clue' ? 0 : 1) - (b.content_hint === 'interview_clue' ? 0 : 1));
  return {results:primary,supplementary_results:supplementary,unverified_results:unverified.map(item=>({...item,content_hint:searchContentHint(item)}))};
}
