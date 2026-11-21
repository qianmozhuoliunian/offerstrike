import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { renderAbilityEvaluation } from '../public/ui/ability-evaluation.js';

const source = await readFile(new URL('../public/ui/practice.js',import.meta.url),'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const nodes = new Map(), calls = [], drafts = [], notifications = [], storage = new Map();
  function node(key) {
    if (!nodes.has(key)) nodes.set(key,{
      value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,readOnly:false,dataset:{},events:new Map(),
      classList:{contains:()=>false},focus(){},scrollIntoView(){},setAttribute(){},append(){},replaceChildren(){},
      querySelector:()=>null,querySelectorAll:()=>[],
      addEventListener(type,handler) { const handlers=this.events.get(type) || []; handlers.push(handler); this.events.set(type,handlers); }
    });
    return nodes.get(key);
  }
  const document = {querySelector:node,querySelectorAll:()=>[],createElement:()=>node(Symbol()),createTextNode:text=>text};
  const context = vm.createContext({document,renderAbilityEvaluation,window:{confirm:()=>true,addEventListener(){}},AbortController,setTimeout,clearTimeout,
    TextEncoder,crypto:webcrypto,URL,sessionStorage:{getItem:key=>storage.get(key) || null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  vm.runInContext(source.slice(source.indexOf('export function')).replace('export function','function'),context);
  const api = (path,method,data,signal) => {
    if (path === '/api/draft') { drafts.push(data); return Promise.resolve({}); }
    return new Promise((resolve,reject)=>calls.push({path,method,data,signal,resolve,reject}));
  };
  const toast = message=>notifications.push(message);
  toast.error=toast; toast.success=toast;
  const controller = context.mountPractice({api,fetchLocal:async()=>({}),refresh:async()=>{},toast,escapeHtml:String,
    openSource:()=>{},openTab:()=>{},onAnswered:()=>notifications.push('answered'),onCompleted:()=>notifications.push('completed'),onAssessed:()=>notifications.push('assessed')});
  const sync = (role,question='',answer='') => controller.sync({role,practiceScope:role,sources:[],attempts:[],draft:{question,answer}});
  const fire = async (key,type,event={}) => { for (const handler of node(key).events.get(type) || []) await handler({preventDefault(){},currentTarget:node(key),...event}); };
  return {controller,sync,fire,node,calls,drafts,notifications};
}

test('mounted practice controller preserves edits on refresh and writes the correct linked draft', async () => {
  const harnessState = harness();
  harnessState.sync('产品','旧题','旧回答');
  harnessState.node('#answer').value='正在编辑';
  harnessState.sync('产品','服务端旧题','服务端旧回答');
  assert.equal(harnessState.node('#answer').value,'正在编辑');
  harnessState.controller.openQuestion({text:'新题',question_ref:{kind:'source',id:'q1'},sources:[{title:'合成原帖',url:'https://example.org'}]});
  harnessState.node('#answer').value='新回答';
  await harnessState.controller.flushDraft();
  assert.equal(harnessState.drafts.at(-1).question_ref.id,'q1');
  assert.equal(harnessState.drafts.at(-1).answer,'新回答');
  harnessState.sync('前端','前端题','前端草稿');
  await harnessState.controller.flushDraft();
  assert.equal(harnessState.drafts.at(-1).role,'前端');
  assert.equal(harnessState.drafts.at(-1).question_ref,null);
});

test('accepting a Career follow-up restores the saved turn and keeps a draft for that same follow-up',async()=>{
  const h=harness();
  h.sync('产品','旧题','旧回答');
  const selecting=h.controller.openFollowup({parent_attempt_id:'turn-1',question:'如何验证？'});
  assert.match(h.calls[0].path,/\/api\/practice\/dialogue\/turn-1\?role=/);
  h.calls[0].resolve({origin:'source',can_continue:true,summary:'',
    turns:[{id:'turn-1',question:'原题',answer:'原回答',feedback:'点评',follow_up:'如何验证？'}]});
  assert.equal(await selecting,true);
  assert.match(h.node('#dialogue-stream').innerHTML,/原回答/);
  assert.equal(h.node('#question').value,'如何验证？');
  h.node('#answer').value='尚未发出的补充';
  const repeat=h.controller.openFollowup({parent_attempt_id:'turn-1',question:'如何验证？'});
  h.calls[1].resolve({origin:'source',can_continue:true,summary:'',
    turns:[{id:'turn-1',question:'原题',answer:'原回答',feedback:'点评',follow_up:'如何验证？'}]});
  assert.equal(await repeat,true);
  await h.controller.flushDraft();
  assert.equal(h.drafts.at(-1).parent_attempt_id,'turn-1');
  assert.equal(h.drafts.at(-1).answer,'尚未发出的补充');
});

test('mounted controller cancels role-scoped requests and ignores old responses after switching away and back', async () => {
  const harnessState = harness();
  harnessState.sync('产品','问题','回答');
  const button={dataset:{practiceHelp:'hint'},disabled:false};
  const pending=harnessState.fire('#practice-help','click',{target:{closest:()=>button}});
  assert.equal(harnessState.calls.length,1);
  harnessState.sync('前端','别的题','别的回答');
  harnessState.sync('产品','问题','新草稿');
  assert.equal(harnessState.calls[0].signal.aborted,true);
  harnessState.calls[0].resolve({guidance:'失效的提示'});
  await pending;
  assert.equal(harnessState.node('#practice-help-result').hidden,true);
  assert.equal(harnessState.node('#answer').value,'新草稿');
});

test('mounted controller completes a turn and self-assessment through its real event wiring', async () => {
  const harnessState = harness();
  harnessState.sync('产品','问题','回答');
  const pending=harnessState.fire('#review-form','submit');
  for (let count=0;count<30 && !harnessState.calls.length;count++) await tick();
  assert.equal(harnessState.calls[0].path,'/api/practice/dialogue/turn');
  harnessState.calls[0].resolve({id:'turn-1',feedback:'模拟点评',follow_up:'',origin:'user'});
  await pending;
  assert.ok(harnessState.notifications.includes('answered'));
  assert.match(harnessState.node('#dialogue-stream').innerHTML,/模拟点评/);
  const rating={dataset:{dialogueRating:'revisit'},setAttribute(){}};
  const assessed=harnessState.fire('#dialogue-stream','click',{target:{closest:selector=>selector==='[data-dialogue-rating]'?rating:null}});
  assert.equal(harnessState.calls.at(-1).path,'/api/attempts/turn-1/assessment');
  harnessState.calls.at(-1).resolve({});
  await assessed;
  assert.ok(harnessState.notifications.includes('assessed'));
  assert.match(harnessState.node('#dialogue-stream .review-assessment-status').textContent,/已保存/);
});

test('an old local-save response cannot unlock a new save or discard its retry identity', async () => {
  const harnessState = harness();
  harnessState.sync('产品','问题一','回答一');
  const oldSave=harnessState.fire('#save-local-practice','click');
  harnessState.sync('前端','问题二','回答二');
  const newSave=harnessState.fire('#save-local-practice','click');
  const requestId=harnessState.calls[1].data.request_id;
  harnessState.calls[0].resolve({id:'old-attempt'});
  await oldSave;
  assert.equal(harnessState.node('#save-local-practice').disabled,true);
  assert.equal(harnessState.node('#answer').value,'回答二');
  harnessState.calls[1].reject(Error('临时失败'));
  await newSave;
  const retry=harnessState.fire('#save-local-practice','click');
  assert.equal(harnessState.calls[2].data.request_id,requestId);
  harnessState.calls[2].resolve({id:'new-attempt'});
  await retry;
  assert.equal(harnessState.node('#save-local-practice').disabled,false);
});
