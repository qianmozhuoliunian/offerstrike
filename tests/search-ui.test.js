import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the browser's actual search handlers using a small fake DOM and
// controlled requests, without contacting a search service or saving data.
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const invalidation = app.slice(app.indexOf(' function invalidateSearchForRoleChange()'), app.indexOf('\n function writeDraft()'));
const searchHandlers = app.slice(app.indexOf(' // Search form submission'), app.indexOf(' // AI Review submission'));

function harness() {
  const handlers = {}, calls = [], messages = [], opened = [];
  const button = {disabled:false,innerHTML:'搜索'};
  const results = {innerHTML:'',replaceChildren(){this.innerHTML='';},addEventListener(type,fn){handlers['results:'+type]=fn;}};
  const form = {addEventListener(type,fn){handlers['form:'+type]=fn;}};
  const status = {className:'',textContent:'',innerHTML:''};
  const elements = {'#search-form':form,'#search-btn':button,'#search-status':status,'#results':results,'#company':{value:''},'#range':{value:'year'},'#search-ai-relevance':{checked:false}};
  const api = (path,method,data,signal) => new Promise((resolve,reject) => calls.push({path,method,data,signal,resolve,reject}));
  const toast = {success:message=>messages.push(message),error:message=>messages.push(message)};
  const openSourceQuestionEditor=async (id,role)=>opened.push({id,role});
  const context=vm.createContext({AbortController,api,toast,openSourceQuestionEditor,escapeHtml:s=>String(s ?? ''),$:s=>elements[s],refresh:async()=>{},window:{}});
  vm.runInContext(`let state={role:'岗位甲'}; let searchBatch=null; let searchRequestId=0; let searchController=null; let searchButtonMarkup=''; let searchNeedsRoleCheck=false; ${invalidation}\n${searchHandlers}`,context);
  return {context,handlers,calls,messages,button,status,results,opened,elements};
}

const targetFor=(selector,button)=>({closest:query=>query===selector ? button : null});

test('search displays AI evidence, uncertain company and partial failure without claiming completion', async () => {
  const h=harness();
  h.elements['#search-ai-relevance'].checked=true;
  const pending=h.handlers['form:submit']({preventDefault(){}});
  assert.equal(h.calls[0].data.ai_relevance,true);
  h.calls[0].resolve({partial_failure:true,notice:'部分检索失败，结果不完整，可重试。',results:[],unverified_results:[{title:'产品经理面经',url:'https://example.org',role_match:'title_keyword',company_match:'unknown',ai_relevance:'uncertain',ai_evidence:null}]});
  await pending;
  assert.match(h.status.textContent,/部分检索失败/);
  assert.match(h.results.innerHTML,/部分检索失败/);
  assert.match(h.results.innerHTML,/公司待核实/);
  assert.match(h.results.innerHTML,/AI 无法判断/);
  const again=h.handlers['form:submit']({preventDefault(){}});
  h.calls[1].resolve({results:[{title:'产品经理面经',url:'https://example.org',ai_relevance:'related',ai_evidence:{role_evidence:'产品经理',interview_evidence:'面经'}}]});
  await again;
  assert.match(h.results.innerHTML,/AI 初筛可能相关/);
  assert.match(h.results.innerHTML,/产品经理；面经/);
  assert.match(h.results.innerHTML,/不代表原帖真实性/);
  h.elements['#search-ai-relevance'].checked=false;
  vm.runInContext('updateSearchConditionsNotice()',h.context);
  assert.match(h.status.textContent,/搜索条件已更改/);
});

test('an old unverified role is directed to role settings before any search request', async () => {
  const h=harness();
  vm.runInContext("state.roleValidation='unverified'",h.context);
  await h.handlers['form:submit']({preventDefault(){}});
  assert.equal(h.calls.length,0);
  assert.match(h.status.innerHTML,/尚未核对/);
  assert.match(h.status.innerHTML,/data-tab="role"/);
  vm.runInContext("state.role='岗位乙'; state.roleValidation='valid'; invalidateSearchForRoleChange()",h.context);
  assert.match(h.status.textContent,/目标岗位已更新/);
});

test('search results and saved sources remain bound to their original role', async () => {
  const h=harness();
  const pending=h.handlers['form:submit']({preventDefault(){}});
  assert.equal(h.calls[0].data.role,'岗位甲');
  h.calls[0].resolve({notice:'需核实',results:[{title:'来源',url:'https://example.org',date:''}]});
  await pending;
  assert.match(h.status.textContent,/岗位甲/);
  assert.match(h.status.textContent,/找到 1 条面经线索/);
  assert.match(h.results.innerHTML,/来源/);
  assert.match(h.results.innerHTML,/收藏来源/);
  const saveButton={dataset:{save:'0'},disabled:false};
  const saving=h.handlers['results:click']({target:targetFor('[data-save]',saveButton)});
  assert.equal(h.calls[1].data.role,'岗位甲');
  // A role switch after clicking Save cannot change the payload already sent.
  vm.runInContext("state.role='岗位乙'; invalidateSearchForRoleChange()",h.context);
  h.calls[1].resolve({id:'source'}); await saving;
  assert.match(h.messages.at(-1),/岗位甲/);
  assert.match(h.status.textContent,/岗位已更新/);
  assert.equal(h.results.innerHTML,'');
});

test('search errors and empty results are shown in the page', async () => {
  const h=harness();
  const failed=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].reject(Error('请配置 Tavily'));
  await failed;
  assert.match(h.status.innerHTML,/请配置 Tavily/);
  assert.equal(h.button.disabled,false);
  const empty=h.handlers['form:submit']({preventDefault(){}});
  h.calls[1].resolve({notice:'请核实',results:[]});
  await empty;
  assert.match(h.status.textContent,/找到 0 条面经线索/);
  assert.match(h.results.innerHTML,/暂时没有找到面经线索/);
});

test('unverified results are folded separately and their save action uses the right item', async () => {
  const h=harness();
  const pending=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].resolve({
    results:[{title:'岗位甲面经',url:'https://example.org/match',date:'2026-01-01',role_match:'title_keyword'}],
    unverified_results:[{title:'无关新闻',url:'https://example.org/unknown',role_match:'unknown'}]
  });
  await pending;
  assert.match(h.results.innerHTML,/<details class="search-unverified">/);
  assert.match(h.results.innerHTML,/1 条相关性未确认（可能无关）/);
  assert.match(h.results.innerHTML,/标题含岗位关键词/);
  assert.match(h.results.innerHTML,/日期参考 2026-01-01/);
  assert.doesNotMatch(h.results.innerHTML,/岗位匹配|发布于/);
  const saveButton={dataset:{save:'1'},disabled:false,textContent:'',closest:()=>null};
  const saving=h.handlers['results:click']({target:targetFor('[data-save]',saveButton)});
  assert.equal(h.calls[1].data.url,'https://example.org/unknown');
  h.calls[1].resolve({id:'saved'}); await saving;
});

test('supplemental results stay separate and saving unverified uses the right item', async () => {
  const h=harness();const pending=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].resolve({results:[{title:'岗位甲面经',url:'https://example.org/post',content_hint:'interview_clue'}],supplementary_results:[{title:'岗位甲题目汇总',url:'https://example.org/collection',content_hint:'compilation'}],unverified_results:[{title:'待核对',url:'https://example.org/uncertain'}]});await pending;
  assert.match(h.results.innerHTML,/1 条补充内容/);
  assert.match(h.results.innerHTML,/面经线索，待核实/);
  const saving=h.handlers['results:click']({target:targetFor('[data-save]',{dataset:{save:'2'},disabled:false,textContent:'',closest:()=>null})});
  assert.equal(h.calls[1].data.url,'https://example.org/uncertain');h.calls[1].resolve({id:'saved'});await saving;
});

test('when only unverified items exist, the empty state stays visible and the items stay folded', async () => {
  const h=harness(); const pending=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].resolve({results:[],unverified_results:[{title:'其他话题',url:'https://example.org',role_match:'unknown'}]});
  await pending;
  assert.match(h.status.textContent,/找到 0 条面经线索/);
  assert.match(h.results.innerHTML,/暂时没有找到明确的面经线索/);
  assert.match(h.results.innerHTML,/<details class="search-unverified">/);
  assert.match(h.results.innerHTML,/可能无关/);
});

test('long results are readable, saved sources are marked, and changed filters are explained', async () => {
  const h=harness();
  vm.runInContext("state.sources=[{id:'existing',role:'岗位甲',url:'https://example.org'}]",h.context);
  const pending=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].resolve({results:[{title:'来源',url:'https://example.org',snippet:'# 标题 ' + '内容'.repeat(150)}]});
  await pending;
  assert.match(h.results.innerHTML,/查看完整摘要/);
  assert.match(h.results.innerHTML,/已收藏/);
  assert.match(h.results.innerHTML,/data-organize="0"\s*>整理题目/);
  assert.match(h.results.innerHTML,/disabled/);
  assert.match(h.status.textContent,/不限公司 · 近一年/);
  vm.runInContext("$('#company').value='某公司'",h.context);
  h.handlers['form:input']();
  assert.match(h.status.textContent,/条件已更改/);
});

test('successful save stays saved even if refreshing the page state fails', async () => {
  const h=harness();
  h.context.refresh=async()=>{throw Error('offline')};
  const pending=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].resolve({results:[{title:'来源',url:'https://example.org'}]});
  await pending;
  const saveButton={dataset:{save:'0'},disabled:false,textContent:''};
  const saving=h.handlers['results:click']({target:targetFor('[data-save]',saveButton)});
  h.calls[1].resolve({id:'saved'});
  await saving;
  assert.equal(saveButton.disabled,true);
  assert.equal(saveButton.textContent,'已收藏');
  assert.match(h.messages.at(-1),/已收藏.*刷新失败/);
});

test('switching roles invalidates completed results and cannot save stale results', async () => {
  const h=harness();
  const pending=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].resolve({notice:'',results:[{title:'来源',url:'https://example.org'}]}); await pending;
  vm.runInContext("state.role='岗位乙'; invalidateSearchForRoleChange()",h.context);
  await h.handlers['results:click']({target:targetFor('[data-save]',{dataset:{save:'0'},disabled:false})});
  assert.equal(h.calls.length,1);
  assert.match(h.status.textContent,/重新搜索/);
});

test('a saved search result opens the matching source editor without creating a question', async () => {
  const h=harness();
  const pending=h.handlers['form:submit']({preventDefault(){}});
  h.calls[0].resolve({results:[{title:'来源',url:'https://example.org'}]}); await pending;
  const organize={hidden:true, dataset:{organize:'0'}};
  const saveButton={dataset:{save:'0'},disabled:false,textContent:'',closest:()=>({querySelector:()=>organize})};
  const saving=h.handlers['results:click']({target:targetFor('[data-save]',saveButton)});
  h.calls[1].resolve({id:'saved-source'}); await saving;
  assert.equal(organize.hidden,false);
  await h.handlers['results:click']({target:targetFor('[data-organize]',organize)});
  assert.deepEqual(h.opened,[{id:'saved-source',role:'岗位甲'}]);
  assert.equal(h.calls.length,2);
});

test('late search results remain invalid after switching away and back', async () => {
  const h=harness();
  const pending=h.handlers['form:submit']({preventDefault(){}});
  vm.runInContext("state.role='岗位乙'; invalidateSearchForRoleChange(); state.role='岗位甲'",h.context);
  assert.equal(h.calls[0].signal.aborted,true);
  assert.equal(h.button.disabled,false);
  // Even if a transport ignores cancellation, the old response is discarded.
  h.calls[0].resolve({notice:'旧结果',results:[{title:'旧来源',url:'https://example.org'}]}); await pending;
  assert.doesNotMatch(h.results.innerHTML,/旧来源/);
  assert.match(h.status.textContent,/重新搜索/);
});
