import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual event handlers with controlled network responses.
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const handlers = app.slice(app.indexOf(' // AI Review submission'), app.indexOf(' // Initial Startup'));

function harness({draft} = {}) {
  const events = {}, calls = [], storage = new Map();
  const make = (value='') => ({value, textContent:'', innerHTML:'', hidden:false, disabled:false, readOnly:false,
    addEventListener(type, fn) { events[this.id + ':' + type] = fn; }, focus() {}});
  const elements = Object.fromEntries(['#question','#answer','#answer-char-count','#review-status','#dialogue-stream','#review-btn','#dialogue-finish','#pick-from-lib-btn','#review-form'].map(id=>[id,Object.assign(make(),{id})]));
  elements['#question'].value = '如何做需求分析？'; elements['#answer'].value = '先了解用户问题';
  const api = (path,method,data) => new Promise((resolve,reject)=>calls.push({path,method,data,resolve,reject}));
  let count=0;
  const ctx=vm.createContext({
    state:{role:'产品经理'}, questionContext:{text:'如何做需求分析？',questionRef:{kind:'source',id:'q1'}}, roleRevision:0,
    dialogue:{role:'',turns:[],summary:'',origin:'',generation:null}, dialogueRevision:0, dialogueBusy:false, dialogueRequest:null, practiceAutopickRole:null,
    $:s=>elements[s], api, escapeHtml:s=>String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    crypto:{randomUUID:()=>`request-${++count}`}, sessionStorage:{getItem:k=>storage.get(k) || null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    writeDraft:draft || (async()=>{}), refresh:async()=>{}, setQuestionContext:c=>{ctx.questionContext=c;}, window:{confirm:()=>true},
  });
  vm.runInContext(handlers,ctx);
  return {events,calls,ctx,elements,storage};
}

const submit = h => h.events['#review-form:submit']({preventDefault(){}});
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('a sourced question stays in one conversation through a follow-up and summary', async () => {
  const h=harness(); const first=submit(h); await tick();
  assert.equal(h.calls[0].path,'/api/practice/dialogue/turn');
  assert.equal(h.calls[0].data.question_ref.id,'q1');
  h.calls[0].resolve({id:'turn-1',feedback:'先确认目标',follow_up:'如何验证？',origin:'source'}); await first;
  assert.match(h.elements['#dialogue-stream'].innerHTML,/已确认的来源题/);
  assert.match(h.elements['#dialogue-stream'].innerHTML,/你的回答/);
  assert.equal(h.elements['#question'].value,'如何验证？');
  h.elements['#answer'].value='做用户访谈'; const second=submit(h); await tick();
  assert.equal(h.calls[1].data.parent_attempt_id,'turn-1');
  h.calls[1].resolve({id:'turn-2',feedback:'可以补充样本',follow_up:'',origin:'source'}); await second;
  assert.equal(h.elements['#review-btn'].disabled,true);
  const finish=h.events['#dialogue-finish:click'](); await tick();
  assert.equal(h.calls[2].path,'/api/practice/dialogue/summary');
  h.calls[2].resolve({summary:'总结：下次补充验证方法'}); await finish;
  assert.match(h.elements['#dialogue-stream'].innerHTML,/总结：下次补充验证方法/);
});

test('failed sends preserve the answer and retry with the same idempotency key', async () => {
  const h=harness(); const first=submit(h); await tick();
  const requestId=h.calls[0].data.request_id;
  h.calls[0].reject(Error('服务暂不可用')); await first;
  assert.equal(h.elements['#answer'].value,'先了解用户问题');
  assert.match(h.elements['#review-status'].textContent,/回答仍保留/);
  const retry=submit(h); await tick();
  assert.equal(h.calls[1].data.request_id,requestId);
  h.calls[1].resolve({id:'turn-1',feedback:'点评',follow_up:'',origin:'source'}); await retry;
});

test('a role change while saving the draft prevents sending the old answer to AI', async () => {
  let finishDraft; const h=harness({draft:()=>new Promise(resolve=>{finishDraft=resolve;})});
  const pending=submit(h);
  h.ctx.state.role='其他岗位'; h.ctx.roleRevision++;
  finishDraft(); await pending;
  assert.equal(h.calls.length,0);
});

test('restoring a saved conversation keeps the pending answer and displays unavailable source', async () => {
  const h=harness(); h.elements['#question'].value='如何验证？'; h.elements['#answer'].value='尚未发送';
  const pending=vm.runInContext("restoreDialogue('产品经理',{parent_attempt_id:'turn-1'})",h.ctx);
  h.calls[0].resolve({origin:'source',source_available:false,summary:'',turns:[{id:'turn-1',question:'原问题',answer:'原回答',feedback:'点评',follow_up:'如何验证？'}]});
  await pending;
  assert.equal(h.elements['#answer'].value,'尚未发送');
  assert.match(h.elements['#dialogue-stream'].innerHTML,/来源已不可用/);
});
