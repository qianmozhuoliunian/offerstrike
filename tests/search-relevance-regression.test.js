import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSearchRelevance } from '../src/search-relevance.js';

test('does not present unrelated search results for the requested role', () => {
  const items = [
    {title:'长鑫科技 AI面试，求经验分享_牛客网', snippet:'大疆面经 硬件芯片岗位面试，SPI读取传感器。'},
    {title:'如何评价库里签约李宁？', snippet:'库里与李宁达成十年长约。'}
  ];
  const result = filterSearchRelevance('科比', items);
  assert.deepEqual(result.results, []);
  assert.equal(result.unverified.length, 2);
});

test('a name mentioned incidentally in a search snippet does not make the post relevant to that role', () => {
  const items = [
    {title:'面经分享｜6轮面试上岸产品实习', snippet:'聊了科比的故事和十几年的篮球爱好。'},
    {title:'证券公司投行部分析师校招面经', snippet:'其他人的评论提到了科比。'}
  ];
  const result = filterSearchRelevance('科比', items);
  assert.deepEqual(result.results, []);
  assert.equal(result.unverified.length, 2);
});

test('visible results contain role and interview clues, without implying verified relevance', () => {
  const items = [
    {title:'产品实习一面面经', snippet:'记录一次面试。'},
    {title:'产品经理如何学习数据分析', snippet:'职业发展与学习建议。'},
    {title:'运营实习面经', snippet:'聊了产品。'}
  ];
  const result = filterSearchRelevance('产品经理', items);
  assert.deepEqual(result.results.map(item=>item.title), ['产品实习一面面经']);
  assert.equal(result.results[0].role_match, 'title_keyword');
  assert.deepEqual(result.unverified.map(item=>item.title), items.slice(1).map(item=>item.title));
});

test('role keyword extraction works for mixed Chinese and Latin titles without matching JavaScript as Java', () => {
  const titles = ['算法工程师面试记录', 'JavaScript 前端面试', 'Java 后端面经'];
  const items = titles.map(title=>({title, snippet:''}));
  assert.deepEqual(filterSearchRelevance('AI算法工程师', items).results.map(item=>item.title), [titles[0]]);
  assert.deepEqual(filterSearchRelevance('Java开发工程师', items).results.map(item=>item.title), [titles[2]]);
});

test('specified company must have a title clue before a result is presented as potentially matching', () => {
  const items = [
    {title:'字节跳动产品经理一面面经', snippet:'记录面试经过。'},
    {title:'腾讯产品经理一面面经', snippet:'评论区有人提到了字节跳动。'},
    {title:'产品经理一面面经', snippet:'准备了字节跳动的资料。'},
    {title:'字节跳动产品经理职业发展', snippet:'学习建议。'}
  ];
  const filtered=filterSearchRelevance('产品经理', items, {company:'字节跳动'});
  assert.deepEqual(filtered.results.map(item=>item.title), [items[0].title]);
  assert.equal(filtered.results[0].company_match,'title_keyword');
  assert.deepEqual(filtered.unverified.map(item=>item.title), items.slice(1).map(item=>item.title));
  assert.equal(filtered.unverified[0].company_match,'unknown');
  assert.equal(filtered.unverified[1].company_match,'unknown');
  assert.equal(filtered.unverified[2].company_match,'title_keyword');
  assert.equal(filterSearchRelevance('产品经理',[items[1]]).results[0].company_match,'not_requested');
});
