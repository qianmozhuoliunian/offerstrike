export function filterSearchRelevance(role, results) {
  const frontend = /前端|front[ -]?end/i;
  if (!frontend.test(role) || /全栈|full[ -]?stack/i.test(role)) return {results, filtered:0};
  let filtered = 0;
  const kept = [];
  for (const result of results) {
    const title = String(result.title || '');
    const mentionsFrontend = frontend.test(title);
    const mentionsBackend = /后端|后臺|后台|back[ -]?end|(?<![a-z])java(?![a-z])/i.test(title);
    if (!mentionsFrontend && mentionsBackend) { filtered++; continue; }
    kept.push({...result, role_match:mentionsFrontend ? 'title_match' : 'unknown'});
  }
  return {results:kept, filtered};
}
