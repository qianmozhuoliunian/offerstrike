import { parse } from 'parse5';
import { searchPublishedDate } from '../services.js';

const MAX_BYTES = 512 * 1024;
export const MAX_ARTICLE_CHARS = 6000;
const ignored = new Set(['script','style','template','iframe','noscript','nav','footer','aside']);
const blocks = new Set(['p','li','pre','br','div','h1','h2','h3','h4','blockquote','tr']);
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;

// Only this public article layout has an enabled reader. No arbitrary URL
// reads, redirects, page scripts, credentials, or resources embedded in HTML.
export function articleUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.cnblogs.com' || url.username || url.password ||
        !/^\/[\w-]+\/p\/[\w-]+\.html$/.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
}

function* walk(node) {
  if (ignored.has(node.tagName)) return;
  yield node;
  for (const child of node.childNodes ?? []) yield* walk(child);
}

export async function readArticle(url, signal, fetcher = fetch) {
  const safe = articleUrl(url);
  if (!safe) throw Error('unsupported_source');
  const res = await fetcher(safe, {redirect:'error', signal:AbortSignal.any([signal, AbortSignal.timeout(9000)]),
    headers:{accept:'text/html', 'user-agent':'OfferStrikeResearch/1.0'}});
  if (!res.ok || !/^text\/html\b/i.test(res.headers.get('content-type') ?? '') ||
      Number(res.headers.get('content-length')) > MAX_BYTES || !res.body) {
    await res.body?.cancel();
    throw Error('source_unavailable');
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw Error('source_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  const doc = [...walk(parse(Buffer.concat(chunks).toString('utf8')))];
  const article = doc.find(node => attr(node,'id') === 'cnblogs_post_body');
  if (!article) throw Error('source_unavailable');
  let text = '';
  function append(node) {
    if (ignored.has(node.tagName)) return;
    if (node.nodeName === '#text') text += node.value;
    if (blocks.has(node.tagName)) text += '\n';
    for (const child of node.childNodes ?? []) append(child);
    if (blocks.has(node.tagName)) text += '\n';
  }
  append(article);
  text = text.replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if (!text) throw Error('source_unavailable');
  const meta = doc.find(node => node.tagName === 'meta' && attr(node,'property') === 'article:published_time');
  const posted = doc.find(node => attr(node,'id') === 'post-date');
  const rawDate = attr(meta ?? {},'content') || posted?.childNodes?.find(node=>node.nodeName==='#text')?.value?.trim().replace(' ','T');
  return {url:safe, text:Array.from(text).slice(0,MAX_ARTICLE_CHARS).join(''), date:searchPublishedDate(rawDate)};
}
