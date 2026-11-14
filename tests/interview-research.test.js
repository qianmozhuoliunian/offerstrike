import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInterviewResearch } from '../src/interview-research.js';
import { createFastApiRetrieval } from '../src/fastapi-retrieval.js';

const now = new Date('2026-11-13T12:00:00Z');
const target = {role:'产品经理', company:'示例公司', source:'nowcoder', range:'3m', now};
const post = (id, date = '2026-11-01', site = 'www.nowcoder.com', suffix = '') => ({
  title:'示例公司产品经理一面面经', url:`https://${site}/discuss/${id}${suffix}`,
  content:'Tavily 摘要', published_date:date, highlights:['Exa 摘要'], publishedDate:date
});

function setup({tavily = [], exa = [], tavilyKey = 't', exaKey = 'e'} = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const backup = url === 'https://api.exa.ai/search';
    if (!backup) assert.equal(url, 'https://api.tavily.com/search');
    const request = JSON.parse(options.body);
    calls.push({url, request, headers:options.headers});
    const data = backup ? exa : tavily;
    return typeof data === 'number' ? new Response('', {status:data}) : Response.json({results:data});
  };
  return {calls, research:createInterviewResearch({tavilyKey, exaKey, fetcher})};
}

test('stops before Exa when enough distinct, in-scope interview clues are found', async () => {
  const {research,calls} = setup({tavily:[post(1), post(2), post(3)]});
  const result = await research.search(target);
  assert.equal(result.results.length,3);
  assert.deepEqual(result.retrieval.providers,['Tavily']);
  assert.equal(result.retrieval.fallback_reason,null);
  assert.equal(calls.length,2);
});

test('retries thin results once, keeping filters and merging duplicates across providers', async () => {
  const {research,calls} = setup({
    tavily:[post(1), post(2,'2026-01-01'), {...post(8),title:'示例公司产品经理面经汇总'}],
    exa:[post(1,'2026-11-01','www.nowcoder.com','?utm_source=exa'), post(3),
      post(4,''), post(5,'2027-01-01'), post(6,'2026-11-01','www.zhihu.com')]
  });
  const result = await research.search({...target, jd:'不应发送的 JD', resume:'不应发送的简历'});
  assert.deepEqual(result.results.map(item => item.url.split('/').at(-1)),['1','3']);
  assert.equal(result.results[1].provider,'Exa');
  assert.equal(result.results[1].snippet,'Exa 摘要');
  assert.equal(result.supplementary_results.length,1);
  assert.equal(result.retrieval.fallback_reason,'insufficient_clues');
  assert.equal(result.retrieval.requests,3);
  assert.match(result.notice,/已用 Exa 补搜/);
  assert.equal(calls[2].headers['x-api-key'],'e');
  assert.deepEqual(calls[2].request.includeDomains,['nowcoder.com']);
  assert.equal(calls[2].request.startPublishedDate,'2026-08-13T00:00:00.000Z');
  assert.equal(calls[2].request.endPublishedDate,'2026-11-13T23:59:59.999Z');
  assert.match(calls[2].request.query,/产品经理 示例公司/);
  assert.doesNotMatch(JSON.stringify(calls),/不应发送/);
});

test('handles failed providers, Exa alone, and the unlimited date range', async () => {
  const recovered = await setup({tavily:429,exa:[post(1)]}).research.search(target);
  assert.equal(recovered.retrieval.fallback_reason,'unavailable');
  assert.equal(recovered.partial_failure,true);
  assert.equal(recovered.results.length,1);
  const partial = await setup({tavily:[post(1)],exa:503}).research.search(target);
  assert.equal(partial.partial_failure,true);
  assert.equal(partial.results.length,1);
  const failed = await setup({tavily:429,exa:503}).research.search(target);
  assert.equal(failed.unavailable,true);
  assert.match(failed.error,/Tavily 和 Exa 检索失败/);
  const {research,calls} = setup({tavilyKey:'',exa:[post(1,'')]});
  const exaOnly = await research.search({...target,range:'all'});
  assert.equal(exaOnly.results[0].date,'');
  assert.deepEqual(exaOnly.retrieval.providers,['Exa']);
  assert.equal(calls.length,1);
  assert.equal('startPublishedDate' in calls[0].request,false);
  await assert.rejects(research.search({...target,range:'invalid'}),/时间范围/);
  await assert.rejects(research.search({...target,range:'constructor'}),/时间范围/);
  assert.equal(calls.length,1);
});

test('the FastAPI path sends only search scope, preserves fallback and does not call providers directly', async () => {
  const calls = [];
  let serviceDown = false;
  const token = 'a'.repeat(64);
  const retrieve = createFastApiRetrieval('http://127.0.0.1:8091', token, async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:8091/v1/retrieve');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-offerpilot-retrieval'],token);
    const query = JSON.parse(options.body);
    calls.push(query);
    if (serviceDown || query.provider === 'Tavily') return Response.json({detail:'unavailable'}, {status:502});
    return Response.json({results:[
      {title:post(1).title, url:post(1).url, published_date:'2026-11-01', snippet:'公开摘要'},
      {title:post(1).title, url:'https://example.com/not-allowed', published_date:'2026-11-01'},
      null
    ]});
  });
  let direct = 0;
  const research = createInterviewResearch({tavilyKey:'private-key', exaKey:'another-key', retrieve,
    fetcher:async () => { direct++; throw Error('unexpected direct fetch'); }});
  const result = await research.search({...target, jd:'private-jd'});
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].provider, 'Exa');
  assert.equal(result.retrieval.engine, 'fastapi');
  assert.equal(result.retrieval.fallback_reason, 'unavailable');
  assert.deepEqual(calls, ['面经','面试经验','面试经历'].map((phrase, index) => ({
    provider:index === 2 ? 'Exa' : 'Tavily', role:'产品经理', company:'示例公司',
    domains:['nowcoder.com'], phrase, from_date:'2026-08-13', through_date:'2026-11-13'
  })));
  serviceDown = true;
  const failure = await research.search(target);
  assert.equal(failure.unavailable, true);
  assert.match(failure.error, /FastAPI 已启动/);
  assert.equal(direct, 0);
  assert.throws(() => createFastApiRetrieval('http://example.com:8091'), /本机地址/);
});
