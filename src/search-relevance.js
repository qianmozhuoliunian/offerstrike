// Search-provider snippets can include comments or unrelated recommendations.
// Only use the title as evidence of a role; neither keywords nor snippets prove
// that a result is a genuine interview experience.
const frontend = /前端|front[ -]?end/i;
const backend = /后端|后臺|后台|back[ -]?end|(?<![a-z])java(?![a-z])/i;
const interviewClue = /面经|面试|笔经|笔试|一面|二面|三面|终面|interview/i;
const broadTerms = new Set(['ai', '应用', '技术', '开发', '研发', '工程']);

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/<[^>]*>/g, '').replace(/\s+/g, '');
}

function roleKeywords(role) {
  const pieces = normalize(role).match(/[a-z][a-z0-9+#.]*(?:-?[a-z0-9]+)*|[\p{Script=Han}]+/gu) || [];
  const terms = pieces.map(piece => {
    if (!/[\p{Script=Han}]/u.test(piece)) return piece;
    let term = piece.replace(/^(?:资深|高级|中级|初级|应届|校招|社招|暑期|实习)+/u, '');
    if (term.endsWith('分析师')) term = term.slice(0, -1);
    else term = term.replace(/(?:工程师|设计师|架构师|程序员|实习生|经理|专员|代表|助理|顾问|主管|总监|岗位|实习)$/u, '');
    return term.replace(/(?:开发|研发)$/u, '');
  }).filter(term => term.length >= 2);
  const specific = terms.filter(term => !broadTerms.has(term));
  return [...new Set(specific.length ? specific : terms)];
}

function containsKeyword(title, keyword) {
  if (/^[a-z0-9+#.\-]+$/i.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(title);
  }
  return title.includes(keyword);
}

export function searchRoleMatcher(role) {
  const roleText = normalize(role);
  const keywords = roleKeywords(role);
  return text => {
    const normalized = normalize(text);
    return Boolean((roleText && containsKeyword(normalized, roleText)) ||
      keywords.some(keyword => containsKeyword(normalized, keyword)));
  };
}

export function filterSearchRelevance(role, results, {company = ''} = {}) {
  const matchesRole = searchRoleMatcher(role);
  const companyText = normalize(company);
  const isFrontend = frontend.test(role) && !/全栈|full[ -]?stack/i.test(role);
  const kept = [], unverified = [];
  let filtered = 0;
  for (const result of results) {
    const originalTitle = String(result.title || '');
    if (isFrontend && !frontend.test(originalTitle) && backend.test(originalTitle)) { filtered++; continue; }
    const title = normalize(originalTitle);
    const roleInTitle = matchesRole(originalTitle);
    // Provider snippets can include comments or recommendations. Company names
    // there alone do not establish that the author interviewed at that company.
    const companyInTitle = !companyText || containsKeyword(title, companyText);
    const hasInterviewClue = interviewClue.test(originalTitle);
    const annotated = {
      ...result,
      role_match: roleInTitle && hasInterviewClue ? 'title_keyword' : 'unknown',
      company_match: !companyText ? 'not_requested' : companyInTitle ? 'title_keyword' : 'unknown'
    };
    if (roleInTitle && hasInterviewClue && companyInTitle) kept.push(annotated);
    else unverified.push(annotated);
  }
  return {results:kept, unverified, filtered};
}
