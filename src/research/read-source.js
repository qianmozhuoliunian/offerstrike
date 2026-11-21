import { parse } from 'parse5';
import { searchPublishedDate } from '../services.js';

const MAX_BYTES = 512 * 1024;
export const MAX_ARTICLE_CHARS = 6000;
const ignored = new Set(['script','style','template','iframe','noscript','nav','footer','aside']);
const blocks = new Set(['p','li','pre','br','div','h1','h2','h3','h4','h5','h6','blockquote','tr']);
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const tidy = text => text.replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();

// Public article URLs map to fixed providers. Page scripts, credentials and
// redirects are never followed.
export function articleUrl(value) {
  try {
    const url = new URL(value);
    if (!url.username && !url.password && ['https://www.nowcoder.com','https://m.nowcoder.com'].includes(url.origin) &&
        /^\/discuss\/\d{10,20}$/.test(url.pathname)) return 'https://www.nowcoder.com'+url.pathname;
    if (url.origin !== 'https://www.cnblogs.com' || url.username || url.password ||
        !/^\/[\w-]+\/p\/(?:[\w-]+\.html|\d+)$/.test(url.pathname)) return null;
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
  const nowcoder=safe.startsWith('https://www.nowcoder.com/');
  const endpoint=nowcoder ? 'https://gw-c.nowcoder.com/api/sparta/detail/content-data/detail/'+safe.split('/').at(-1) : safe;
  const res = await fetcher(endpoint, {redirect:'error', signal:AbortSignal.any([signal, AbortSignal.timeout(9000)]),
    headers:{accept:nowcoder?'application/json':'text/html', 'user-agent':'OfferStrikeResearch/1.0'}});
  const mime=nowcoder ? /^application\/json\b/i : /^text\/html\b/i;
  if (!res.ok || !mime.test(res.headers.get('content-type') ?? '') ||
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
  let html=Buffer.concat(chunks).toString('utf8'), detail;
  if (nowcoder) {
    const response=JSON.parse(html);
    detail=response.data;
    if (response.success!==true || !detail || detail.id!==safe.split('/').at(-1) ||
        typeof detail.title!=='string' || !detail.title.trim()) throw Error('source_unavailable');
    html=detail.richText || detail.content;
    if (typeof html!=='string' || !html.trim()) throw Error('source_unavailable');
  }
  const doc = [...walk(parse(html))];
  const article = nowcoder ? doc.find(node=>node.tagName==='body') :
    doc.find(node => attr(node,'id') === 'cnblogs_post_body');
  if (!article) throw Error('source_unavailable');
  const titleNode = doc.slice(0,doc.indexOf(article)).find(node=>node.tagName==='a' && attr(node,'id')==='cb_post_title_url');
  const title = nowcoder ? tidy(detail.title) : titleNode && tidy([...walk(titleNode)].filter(node=>node.nodeName==='#text').map(node=>node.value).join(''));
  const sections = [{heading:'',text:''}];
  function append(node, inHeading = false) {
    if (ignored.has(node.tagName)) return;
    const heading = /^h([1-6])$/.exec(node.tagName ?? '');
    if (heading) sections.push({heading:'',text:'',level:Number(heading[1])});
    const section = sections.at(-1);
    if (node.nodeName === '#text') {
      section.text += node.value;
      if (inHeading) section.heading += node.value;
    }
    if (blocks.has(node.tagName)) section.text += '\n';
    for (const child of node.childNodes ?? []) append(child, inHeading || heading);
    if (blocks.has(node.tagName)) section.text += '\n';
  }
  append(article);
  const headings = [];
  let text = '';
  for (const section of sections) {
    const content = tidy(section.text);
    if (!content) continue;
    if (text) text += '\n\n';
    const heading = tidy(section.heading);
    if (heading) headings.push({start:text.length,text:heading,level:section.level});
    text += content;
  }
  if (!text) throw Error('source_unavailable');
  const meta = doc.find(node => node.tagName === 'meta' && attr(node,'property') === 'article:published_time');
  const posted = doc.find(node => attr(node,'id') === 'post-date');
  let rawDate = attr(meta ?? {},'content') || posted?.childNodes?.find(node=>node.nodeName==='#text')?.value?.trim().replace(' ','T');
  // Date conversion follows InterviewRadar's MIT NowCoder connector. See THIRD_PARTY_NOTICES.md.
  if (nowcoder) {
    const stamp=detail.createTime;
    const milliseconds=typeof stamp==='number' && Number.isFinite(stamp) && stamp>0 ? (stamp<10000000000 ? stamp*1000 : stamp) : NaN;
    rawDate=Number.isFinite(new Date(milliseconds).getTime()) ? new Date(milliseconds).toISOString() : '';
  }
  const clipped = Array.from(text).slice(0,MAX_ARTICLE_CHARS).join('');
  return {url:safe, text:clipped, date:searchPublishedDate(rawDate), truncated:clipped.length < text.length,
    ...(title && title.length<=300 ? {title} : {}),
    headings:headings.filter(heading=>heading.start+heading.text.length<=clipped.length)};
}
