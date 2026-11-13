import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchContentHint, partitionSearchResults } from '../src/search-quality.js';
import { filterSearchRelevance } from '../src/search-relevance.js';
import { assessSearchAiRelevance } from '../src/search-ai-relevance.js';
import { roleCoaching, parseCoachingReview } from '../src/coaching.js';

test('separates known listings and compilation clues without claiming source truth', () => {
  const list={title:'快手校招面经',url:'https://www.nowcoder.com/enterprise/898/interview'};
  const collection={title:'AI Agent 面试题汇总',url:'https://www.nowcoder.com/discuss/1'};
  const post={title:'前端一面面经',url:'https://juejin.cn/post/1'};
  const unknown={title:'产品岗位信息',url:'https://example.com/page'};
  assert.equal(searchContentHint(list),'listing');
  assert.equal(searchContentHint(collection),'compilation');
  assert.equal(searchContentHint(post),'interview_clue');
  assert.equal(searchContentHint(unknown),'unknown');
  const separated=partitionSearchResults([list,collection,unknown,post],[unknown]);
  assert.deepEqual(separated.results.map(x=>x.title),[post.title]);
  assert.deepEqual(separated.supplementary_results.map(x=>x.content_hint),['listing','compilation','unknown']);
  assert.equal(searchContentHint({title:'Agent 开发面经总结【04/24】',url:'https://www.nowcoder.com/discuss/1'}),'compilation');
  assert.equal(searchContentHint({title:'我扒了最近的前端面经——面试考这5样',url:'https://segmentfault.com/a/1'}),'compilation');
  assert.equal(separated.unverified_results.length,1);
});

test('role and interview evidence from an unrelated snippet cannot promote a result', async () => {
  const polluted={title:'小红书 PE 全栈一面',snippet:'推荐：小红书产品经理面试经验',role_match:'unknown',company_match:'not_requested'};
  const ai=await assessSearchAiRelevance({enabled:true,role:'产品经理',results:[polluted],request:async()=>JSON.stringify({items:[{index:0,status:'related',role_evidence:'产品经理',interview_evidence:'面试'}]})});
  assert.equal(ai.items[0].status,'uncertain');
  assert.match(ai.warning,/待核实/);
  const ordinary=filterSearchRelevance('产品经理',[{title:'产品经理岗位介绍',snippet:'推荐：产品经理面试经验'}]);
  assert.equal(ordinary.results.length,0);
  assert.equal(ordinary.unverified.length,1);
});

test('role templates are conservative and feedback quotes must be literal', () => {
  assert.equal(roleCoaching('AI 产品经理').name,'产品岗位');
  assert.equal(roleCoaching('前端开发工程师').name,'前端岗位');
  assert.equal(roleCoaching('AI 应用开发工程师').name,'AI 应用岗位');
  assert.equal(roleCoaching('增长黑客').name,'通用岗位');
  const answer='我觉得温度为零就不会有幻觉。';
  const response={focus:'可靠性',evidence:'温度为零',feedback:'低温不能保证事实正确。',next_step:'判断结论是否有依据',follow_up:'怎么验证？'};
  assert.equal(parseCoachingReview(JSON.stringify(response),answer).coaching.evidence,'温度为零');
  assert.throws(()=>parseCoachingReview(JSON.stringify({...response,evidence:'不在回答中'}),answer),/无法核验/);
  assert.throws(()=>parseCoachingReview(JSON.stringify({...response,next_step:''}),answer),/无法核验/);
  assert.throws(()=>parseCoachingReview(JSON.stringify({feedback:'无引用点评',follow_up:''}),answer),/无法核验/);
});
