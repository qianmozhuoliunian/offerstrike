const fragment = new URLSearchParams(location.hash.slice(1));
const suppliedAccess = fragment.get('access') || '';
let access = /^[a-f0-9]{64}$/.test(suppliedAccess) ? suppliedAccess : '';
try {
  if (access) sessionStorage.setItem('offerstrike-vue-access', access);
  else access = sessionStorage.getItem('offerstrike-vue-access') || '';
} catch { /* Access still works for this page when session storage is disabled. */ }
if (fragment.has('access')) history.replaceState(null, '', location.pathname + location.search);

export async function request(path, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers: { 'x-offerpilot-access': access, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作失败，请稍后重试');
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('服务响应超时，请检查保存结果后重试');
    if (error instanceof TypeError) throw new Error('无法连接本机服务，请检查启动窗口');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function sourceLink(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return url.href;
  } catch { /* Old data may contain a link that needs correction. */ }
  return null;
}
