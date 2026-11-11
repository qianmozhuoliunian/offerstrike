export function validateDate(value) {
  const date = String(value || '').trim();
  if (!date) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('日期格式不正确');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw Error('日期无效');
  return date;
}

export function validateSource(input) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('请填写标题');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('请输入有效链接'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('链接只支持 HTTP 或 HTTPS');
  return {title, url: url.href, date: validateDate(input.date), interview_date: validateDate(input.interview_date), type: ['真实面经（自述）','博主整理','来源未知'].includes(input.type) ? input.type : '来源未知', question: String(input.question || '').trim(), role: String(input.role || '').trim()};
}
export function filterByDate(items, from) { return from ? items.filter(x => x.date && x.date >= from) : items; }
export function normalizeAnswer(answer) { const text = String(answer || '').trim(); if (!text) throw new Error('请填写回答'); return text; }
