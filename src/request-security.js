import {createHash, timingSafeEqual} from 'node:crypto';

export function secretMatches(secret) {
  const digest = value => createHash('sha256').update(value).digest();
  const expected = digest(secret);
  return candidate => typeof candidate === 'string' && timingSafeEqual(digest(candidate), expected);
}

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

export function privateResponseHeaders({demo = false} = {}) {
  const style = demo ? "'self'" : "'self' 'unsafe-inline'";
  const connect = demo ? "'none'" : "'self'";
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src ${style}; img-src 'self'; connect-src ${connect}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}

export function setPrivateResponseHeaders(res, options) {
  for (const [name,value] of Object.entries(privateResponseHeaders(options))) res.setHeader(name,value);
}
