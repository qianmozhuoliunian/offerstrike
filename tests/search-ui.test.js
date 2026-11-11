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
  const elements = {'#search-form':form,'#search-btn':button,'#search-status':status,'#results':results,'#company':{value:''},'#range':{value:'year'}};
  const api = (path,method,data,signal) => new Promise((resolve,reject) => calls.push({path,method,data,signal,resolve,reject}));
  const toast = {success:message=>messages.push(message),error:message=>messages.push(message)};
  const openSourceQuestionEditor=async (id,role)=>opened.push({id,role});
  const context=vm.createContext({AbortController,api,toast,openSourceQuestionEditor,escapeHtml:s=>String(s ?? ''),$:s=>elements[s],refresh:async()=>{},window:{}});
  vm.runInContext(`let state={role:'岗位甲'}; let searchBatch=null; let searchRequestId=0; let searchController=null; let searchButtonMarkup=''; ${invalidation}\n${searchHandlers}`,context);
  return {context,handlers,calls,messages,button,status,results,opened};
}

const targetFor=(selector,button)=>({closest:query=>query===selector ? button : null});

test('search results and saved sources remain bound to their original role', async () => {
  const h=harness();
  const pending=h.handlers['form:submit']({preventDefault(){}});
  assert.equal(h.calls[0].data.role,'岗位甲');
  h.calls[0].resolve({notice:'需核实',results:[{title:'来源',url:'https://example.org',date:''}]});
  await pending;
  assert.match(h.status.textContent,/岗位甲/);
  assert.match(h.status.textContent,/找到 1 条结果/);
  assert.match(h.results.innerHTML,/来源/);
  assert.match(h.results.innerHTML,/收藏来源/);
  const saveButton={dataset:{save:'0'},disabled:false};
  const saving=h.handlers['results:click']({target:targetFor('[data-save]',saveButton)});
  assert.equal(h.calls[1].data.role,'岗位甲');
  // A role switch after clicking Save cannot change the payload already sent.
  vm.runInContext("state.role='岗位乙'; invalidateSearchForRoleChange()",h.context);
  h.calls[1].resolve({id:'source'}); await saving;
  assert.match(h.messages.at(-1),/岗位甲/);
  assert.match(h.status.textContent,/岗位已切换/);
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
  assert.match(h.status.textContent,/找到 0 条结果/);
  assert.match(h.results.innerHTML,/未找到符合条件/);
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
