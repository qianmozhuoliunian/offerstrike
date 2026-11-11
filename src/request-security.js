// Restrict the local server to trusted same-origin requests.
export function isAllowedRequest(req, port) {
  const host = req.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return false;
  return true;
}
