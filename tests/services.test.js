import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchRequest, searchSource, searchPublishedDate, parseRequirements, parseReview, parsePracticeHelp } from '../src/services.js';
import { isAllowedRequest } from '../src/request-security.js';
import { filterSearchRelevance } from '../src/search-relevance.js';

test('frontend results omit clear backend titles without excluding mixed and uncertain titles', () => {
  const titles=['【面经分享】2026 Java 后端开发面试真题汇总','Java工程师精选面经合集','前端 JavaScript 面试','前端与 Java 后端面经','京东校招面经','JavaScript 面试'];
  const items=titles.map(title=>({title}));
  const result=filterSearchRelevance('前端开发工程师',items);
  assert.deepEqual(result.results.map(x=>x.title),titles.slice(2));
  assert.equal(result.filtered,2);
  assert.equal(result.results[2].role_match,'unknown');
  assert.deepEqual(filterSearchRelevance('Java 后端开发',items).results,items);
});

test('search normalizes provider dates while leaving unrecognizable dates unknown', () => {
  assert.equal(searchPublishedDate('Tue, 20 Jan 2026 12:00:00 GMT'),'2026-01-20');
  assert.equal(searchPublishedDate('2026-01-20T12:00:00Z'),'2026-01-20');
  assert.equal(searchPublishedDate('unknown'),'');
  assert.equal(searchPublishedDate(''),'');
});

test('search uses a real date range and requests estimated dates', () => {
  const now=new Date('2026-05-31T12:00:00Z');
  const q=searchRequest('产品经理','公司','会分析','3m',now);
  assert.equal(q.start_date,'2026-02-28');
  assert.equal(q.include_published_date,true);
  assert.ok(!('time_range' in q));
  assert.equal(searchRequest('产品','','','6m',now).start_date,'2025-11-30');
  assert.ok(!('start_date' in searchRequest('产品','','','all',now)));
  assert.throws(() => searchRequest('产品','','','unknown',now),/时间范围/);
});

test('search limits platforms to the selected trusted domains', () => {
  const now=new Date('2026-05-31T12:00:00Z');
  assert.deepEqual(searchRequest('产品','','','all',now).include_domains,['nowcoder.com','juejin.cn','zhihu.com']);
  assert.deepEqual(searchRequest('产品','','','all',now,'zhihu').include_domains,['zhihu.com']);
  assert.throws(()=>searchRequest('产品','','','all',now,'toString'),/搜索来源/);
  assert.equal(searchSource('https://www.nowcoder.com/discuss/1'),'nowcoder');
  assert.equal(searchSource('https://zhuanlan.zhihu.com/p/1'),'zhihu');
  for (const url of ['https://nowcoder.com.evil.test/a','https://evil.test/?q=zhihu.com','javascript:alert(1)','not a url']) assert.equal(searchSource(url),null);
});

test('JD extraction rejects invalid, unrelated, or untraceable model output', () => {
  const jd='岗位职责：负责数据分析。';
  const valid=JSON.stringify({status:'ok',items:[{requirement:'负责数据分析',evidence:'负责数据分析'}]});
  assert.equal(parseRequirements(valid,jd),'• 负责数据分析');
  assert.throws(() => parseRequirements('请问你想了解什么？',jd),/格式/);
  assert.throws(() => parseRequirements('{"status":"insufficient","items":[]}',jd),/未从内容/);
  assert.throws(() => parseRequirements('{"status":"ok","items":[{"requirement":"管理团队","evidence":"管理团队"}]}',jd),/原文/);
  assert.throws(() => parseRequirements('{"status":"ok","items":[]}',jd),/有效要求/);
});

test('review parser rejects malformed or unusable model responses while allowing no follow-up', () => {
  assert.deepEqual(parseReview('{"feedback":" 内容不足 ","follow_up":""}'),{feedback:'内容不足',follow_up:''});
  for (const content of ['', 'plain text', '{}', '{"feedback":"", "follow_up":"问题"}', '{"feedback":"点评", "follow_up":null}', '{"feedback":"点评"}']) {
    assert.throws(() => parseReview(content), /AI/);
  }
  assert.throws(() => parseReview(JSON.stringify({feedback:'a'.repeat(10001),follow_up:''})),/格式/);
  assert.throws(() => parseReview(JSON.stringify({feedback:'点评',follow_up:'a'.repeat(2001)})),/格式/);
});

test('practice help accepts only a nonempty bounded text response', () => {
  assert.equal(parsePracticeHelp('{"guidance":"  先想目标  "}'),'先想目标');
  for (const content of ['', 'plain text', '{}', '{"guidance":""}', '{"guidance":null}', JSON.stringify({guidance:'a'.repeat(6001)})]) assert.throws(()=>parsePracticeHelp(content),/AI 帮助/);
});

test('local requests reject foreign origins, hosts and simple content types', () => {
  const request=(headers,method='POST')=>({method,headers:{host:'127.0.0.1:8080','content-type':'application/json',...headers}});
  assert.equal(isAllowedRequest(request({origin:'http://127.0.0.1:8080','sec-fetch-site':'same-origin'}),8080),true);
  assert.equal(isAllowedRequest(request({origin:'https://evil.example'}),8080),false);
  assert.equal(isAllowedRequest(request({host:'evil.example:8080'}),8080),false);
  assert.equal(isAllowedRequest(request({'content-type':'text/plain'}),8080),false);
  assert.equal(isAllowedRequest(request({'sec-fetch-site':'cross-site'}),8080),false);
});
