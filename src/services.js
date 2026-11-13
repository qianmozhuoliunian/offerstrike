// External-service request construction and response validation.
export const SEARCH_SOURCES = Object.freeze({
  nowcoder: 'nowcoder.com',
  juejin: 'juejin.cn',
  zhihu: 'zhihu.com',
  csdn: 'csdn.net',
  cnblogs: 'cnblogs.com',
  '51cto': '51cto.com',
  segmentfault: 'segmentfault.com'
});

export function searchSource(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const entry = Object.entries(SEARCH_SOURCES).find(([, domain]) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
    return entry?.[0] || null;
  } catch { return null; }
}

export function searchPublishedDate(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (iso) {
    const date = new Date(iso[1] + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso[1] ? iso[1] : '';
  }
  if (!/^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

export function searchRequests(role, company, requirements, range, now = new Date(), source = 'all') {
  const months = { '3m': 3, '6m': 6, year: 12 };
  if (range !== 'all' && !Object.hasOwn(months, range)) throw Error('不支持的时间范围');
  if (source !== 'all' && !Object.hasOwn(SEARCH_SOURCES, source)) throw Error('不支持的搜索来源');
  const roleText = String(role || '').trim();
  if (!roleText) throw Error('请先填写目标岗位');
  const companyText = String(company || '').trim();
  if (companyText.length > 100) throw Error('公司关键词不能超过 100 字');
  // Search for the role and company, not the user's potentially long and private JD.
  // Keep requirements in the signature for callers using the previous interface.
  const request = { search_depth: 'basic', max_results: 15, include_answer: false, include_raw_content: false, include_published_date: true };
  request.include_domains = source === 'all' ? Object.values(SEARCH_SOURCES) : [SEARCH_SOURCES[source]];
  if (months[range]) {
    // Clamp the day when subtracting months (e.g. May 31 -> February 28).
    const year = now.getUTCFullYear(), month = now.getUTCMonth() - months[range], day = now.getUTCDate();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    request.start_date = new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
  }
  return ['面经', '面试经验'].map(phrase => ({
    ...request,
    include_domains: [...request.include_domains],
    query: [roleText, companyText, phrase].filter(Boolean).join(' ')
  }));
}

export function searchRequest(role, company, requirements, range, now = new Date(), source = 'all') {
  return searchRequests(role, company, requirements, range, now, source)[0];
}

// Collapse common tracking variants without dropping potentially meaningful query parameters.
function canonicalResultUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ['spm', 'share_source', 'share_medium'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
    return `${url.host.toLowerCase()}${pathname}${url.search}`;
  } catch { return ''; }
}

export function dedupeSearchResults(results) {
  const seen = new Set();
  return results.filter(result => {
    const key = canonicalResultUrl(result?.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseRequirements(content, jd) {
  let result;
  try { result = JSON.parse(content); } catch { throw Error('AI 返回格式无效，请重试或手动填写要求'); }
  if (!result || !['ok', 'insufficient'].includes(result.status) || !Array.isArray(result.items)) throw Error('AI 返回格式无效，请重试或手动填写要求');
  if (result.status === 'insufficient') throw Error('未从内容中识别到明确的岗位要求，请补充岗位描述或手动填写');
  if (!result.items.length || result.items.length > 30) throw Error('AI 未提取到有效要求，请检查岗位描述或手动填写');
  const items = result.items.map(item => {
    if (!item || typeof item.requirement !== 'string' || typeof item.evidence !== 'string') throw Error('AI 返回格式无效，请重试或手动填写要求');
    const requirement = item.requirement.trim(), evidence = item.evidence.trim();
    if (!requirement || requirement.length > 500 || !evidence || evidence.length > 1000 || !jd.includes(evidence)) throw Error('AI 提取结果无法对应原文，请重试或手动填写要求');
    return `• ${requirement}`;
  });
  return items.join('\n');
}

export function parseReview(content) {
  if (typeof content !== 'string' || !content.trim()) throw Error('AI 返回内容不可用');
  let result;
  try { result=JSON.parse(content); } catch { throw Error('AI 点评格式无效，请重试'); }
  if (!result || typeof result.feedback !== 'string' || !result.feedback.trim() || result.feedback.length > 10000 || typeof result.follow_up !== 'string' || result.follow_up.length > 2000) throw Error('AI 点评格式无效，请重试');
  return {feedback:result.feedback.trim(), follow_up:result.follow_up.trim()};
}

export function parsePracticeHelp(content) {
  let result;
  try { result = JSON.parse(content); } catch { throw Error('AI 帮助格式无效，请重试'); }
  if (!result || typeof result.guidance !== 'string' || !result.guidance.trim() || result.guidance.length > 6000) throw Error('AI 帮助内容不可用，请重试');
  return result.guidance.trim();
}
