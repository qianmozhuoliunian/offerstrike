import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const handlers = app.slice(app.indexOf(' // Sources list item click actions'), app.indexOf(" $('#attempt-role-scope').addEventListener"));
const openEditor = app.slice(app.indexOf(' async function openSourceQuestionEditor'), app.indexOf('\n function practiceSourceQuestion'));

function harness() {
  const events={}, calls=[], messages=[], practiced=[];
  const source={id:'source-1',role:'岗位甲',title:'原帖',url:'https://example.org',questions:[]};
  const state={role:'岗位甲',sources:[source]};
  const questionDrafts=new Map(), questionSaveStates=new Map();
  const textarea={tagName:'TEXTAREA',name:'text',value:'原帖中的问题',disabled:false};
  const topic={tagName:'INPUT',name:'topic',value:'缓存',disabled:false};
  const save={tagName:'BUTTON',value:'save',disabled:false};
  const practice={tagName:'BUTTON',value:'practice',disabled:false};
  const controls=[textarea,topic,save,practice], status={textContent:''};
  const form={dataset:{questionForm:'source-1'},elements:{text:textarea,topic},querySelectorAll:()=>controls,querySelector:()=>status};
  const target={name:'text',closest:selector=>selector==='[data-question-form]' ? form : null};
  const container={addEventListener:(type,fn)=>{events[type]=fn;}};
  const api=(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}));
  const toast=message=>messages.push(message);
  toast.error=message=>messages.push(message); toast.success=message=>messages.push(message);
  const context=vm.createContext({state,questionDrafts,questionSaveStates,noteDrafts:new Map(),api,toast,renderSources:()=>{},
    $:selector=>selector==='#sources' ? container : null,
    refresh:async()=>{source.questions=[{id:'question-1',text:textarea.value.trim(),topic:topic.value}];},
    practiceSourceQuestion:(s,q)=>{practiced.push({source:s.id,question:q.id}); return true;}});
  vm.runInContext(`let roleRevision=0; ${handlers}`,context);
  return {events,calls,messages,practiced,context,state,questionDrafts,textarea,topic,save,practice,status,target};
}

test('saving a confirmed question opens practice with its actual source and question IDs', async () => {
  const h=harness();
  h.events.input({target:h.target});
  const pending=h.events.submit({target:h.target,submitter:h.practice,preventDefault(){}});
  await h.events.submit({target:h.target,submitter:h.practice,preventDefault(){}});
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].args[0],'/api/sources/source-1/questions');
  assert.equal(h.calls[0].args[2].text,'原帖中的问题');
  assert.equal(h.practice.disabled,true);
  h.calls[0].resolve({id:'question-1'}); await pending;
  assert.deepEqual(h.practiced,[{source:'source-1',question:'question-1'}]);
  assert.equal(h.questionDrafts.has('source-1'),false);
});

test('a failed save keeps the input and allows the user to retry', async () => {
  const h=harness();
  h.events.input({target:h.target});
  const pending=h.events.submit({target:h.target,submitter:h.save,preventDefault(){}});
  h.calls[0].reject(Error('网络异常')); await pending;
  assert.match(h.status.textContent,/保存失败.*网络异常/);
  assert.equal(h.questionDrafts.get('source-1').text,'原帖中的问题');
  assert.equal(h.textarea.disabled,false);
  assert.equal(h.save.disabled,false);
  assert.equal(h.practiced.length,0);
});

test('a successful save followed by a failed refresh cannot be submitted twice', async () => {
  const h=harness();
  h.context.refresh=async()=>{throw Error('刷新失败');};
  const pending=h.events.submit({target:h.target,submitter:h.practice,preventDefault(){}});
  h.calls[0].resolve({id:'question-1'}); await pending;
  assert.match(h.status.textContent,/题目已保存.*刷新失败/);
  assert.equal(h.save.disabled,true);
  assert.equal(h.practice.disabled,true);
  assert.equal(h.textarea.disabled,false);
  assert.equal(h.textarea.readOnly,true);
  assert.equal(h.practiced.length,0);
});

test('changing roles during a save leaves the question in its original source without opening practice', async () => {
  const h=harness();
  const pending=h.events.submit({target:h.target,submitter:h.practice,preventDefault(){}});
  vm.runInContext("state.role='岗位乙'; roleRevision++",h.context);
  h.calls[0].resolve({id:'question-1'}); await pending;
  assert.equal(h.practiced.length,0);
  assert.match(h.messages.at(-1),/岗位已变化/);
});

test('opening a source targets its editor, resets filtering and focuses it', async () => {
  const events=[], details={open:false}, scope={value:'all'};
  const input={isConnected:true,closest:()=>details,scrollIntoView:()=>events.push('scroll'),focus:()=>events.push('focus')};
  const state={role:'岗位甲',sources:[{id:'source-1',role:'岗位甲'}]};
  const window={location:{hash:'#search'}};
  const context=vm.createContext({state,window,document:{getElementById:id=>id==='question-source-1' ? input : null},
    $:selector=>selector==='#library-role-scope' ? scope : null,$$:()=>[],
    renderSources:()=>events.push('render'),switchTab:tab=>{window.location.hash='#'+tab;events.push(tab);},
    requestAnimationFrame:fn=>fn(),toast:{error:message=>events.push(message)}});
  vm.runInContext(`let roleRevision=0, searchBatch={}, activeFilter='filtered'; ${openEditor}`,context);
  await vm.runInContext("openSourceQuestionEditor('source-1','岗位甲')",context);
  assert.equal(scope.value,'current'); assert.equal(details.open,true);
  assert.deepEqual(events,['render','library','scroll','focus']);
});

test('an editor awaiting refresh does not navigate after a new search starts', async () => {
  const events=[], state={role:'岗位甲',sources:[]}; let finishRefresh;
  const refresh=()=>new Promise(resolve=>{finishRefresh=resolve;});
  const context=vm.createContext({state,refresh,toast:{error:message=>events.push(message)}});
  vm.runInContext(`let roleRevision=0, searchBatch={}, activeFilter='all'; ${openEditor}`,context);
  const pending=vm.runInContext("openSourceQuestionEditor('source-1','岗位甲')",context);
  vm.runInContext('searchBatch={}',context);
  state.sources.push({id:'source-1',role:'岗位甲'}); finishRefresh(); await pending;
  assert.match(events[0],/搜索结果或岗位已变化/);
});
