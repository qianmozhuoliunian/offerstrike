import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const help=app.slice(app.indexOf(' // Optional AI help'),app.indexOf(' // Recommend a different eligible question'));
const clearHelp=app.slice(app.indexOf(' function clearPracticeHelp()'),app.indexOf('\n function clearRecommendationChoice()'));
const clearChoice=app.slice(app.indexOf(' function clearRecommendationChoice()'),app.indexOf('\n function loadPracticeQuestion('));
const loadQuestion=app.slice(app.indexOf(' function loadPracticeQuestion('),app.indexOf('\n async function openSourceQuestionEditor'));
const recommendations=app.slice(app.indexOf(' // Recommend a different eligible question'),app.indexOf(' // Answer character counter'));

function helpHarness() {
  const events={}, calls=[], buttons=['hint','breakdown','approach'].map(mode=>({dataset:{practiceHelp:mode},disabled:false}));
  const question={value:'怎么评估产品？',focus(){}};
  const status={hidden:true,textContent:''}, result={hidden:true}, label={textContent:''}, content={textContent:''};
  const elements={'#practice-help':{addEventListener:(type,fn)=>{events[type]=fn;}},'#question':question,'#practice-help-status':status,'#practice-help-result':result,'#practice-help-label':label,'#practice-help-content':content};
  const api=(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}));
  const context=vm.createContext({AbortController,api,state:{role:'产品'},$:selector=>elements[selector],$$:()=>buttons});
  vm.runInContext(`let helpRequestId=0, helpController=null, roleRevision=0; ${clearHelp}\n${help}`,context);
  const click=button=>events.click({target:{closest:()=>button}});
  return {context,calls,buttons,question,status,result,label,content,click};
}

test('help is requested explicitly for the question, not the answer, and is labelled as AI-generated', async () => {
  const h=helpHarness();
  const pending=h.click(h.buttons[0]);
  assert.equal(h.calls[0].args[0],'/api/practice/help');
  assert.equal(h.calls[0].args[2].mode,'hint');
  assert.equal(h.calls[0].args[2].question,'怎么评估产品？');
  assert.equal(Object.hasOwn(h.calls[0].args[2],'answer'),false);
  assert.equal(h.buttons[0].disabled,true);
  h.calls[0].resolve({guidance:'先想业务目标。'}); await pending;
  assert.equal(h.result.hidden,false);
  assert.match(h.label.textContent,/AI 提示.*仅供参考/);
  assert.equal(h.content.textContent,'先想业务目标。');
  assert.equal(h.buttons[0].disabled,false);
});

test('changing the question invalidates an in-flight help result even if cancellation is ignored', async () => {
  const h=helpHarness();
  const pending=h.click(h.buttons[1]);
  h.question.value='新的问题'; vm.runInContext('clearPracticeHelp()',h.context);
  assert.equal(h.calls[0].args[3].aborted,true);
  h.calls[0].resolve({guidance:'旧问题的帮助'}); await pending;
  assert.equal(h.result.hidden,true);
  assert.equal(h.content.textContent,'');
});

test('switching roles while help is in flight prevents displaying the old response', async () => {
  const h=helpHarness(); const pending=h.click(h.buttons[0]);
  vm.runInContext("state.role='运营'; roleRevision++; state.role='产品'; roleRevision++",h.context);
  h.calls[0].resolve({guidance:'旧岗位的帮助'}); await pending;
  assert.equal(h.result.hidden,true); assert.equal(h.content.textContent,'');
});

test('help failures leave a retryable message and an empty question sends no request', async () => {
  const h=helpHarness();
  h.question.value=''; await h.click(h.buttons[2]);
  assert.equal(h.calls.length,0); assert.match(h.status.textContent,/先填写/);
  h.question.value='问题'; const pending=h.click(h.buttons[2]);
  h.calls[0].reject(Error('服务不可用')); await pending;
  assert.match(h.status.textContent,/服务不可用/); assert.equal(h.buttons[2].disabled,false);
});

function recommendationHarness(confirm=true) {
  const events={},calls=[],messages=[],state={role:'产品'};
  const question={value:'当前题'},answer={value:'已有回答',focus(){}};
  const pick={disabled:false,addEventListener:(type,fn)=>{events.pick=fn;}};
  const action={hidden:true,textContent:'',addEventListener:(type,fn)=>{events.action=fn;}};
  const notice={hidden:true},message={textContent:''};
  const elements={'#question':question,'#answer':answer,'#answer-char-count':{textContent:''},'#pick-from-lib-btn':pick,'#practice-suggested-anyway':action,'#recommendation-choice':notice,'#recommendation-message':message};
  const api=(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}));
  const toast=value=>messages.push(value); toast.error=value=>messages.push(value);
  const context=vm.createContext({state,api,toast,$:selector=>elements[selector],window:{confirm:()=>confirm},clearPracticeHelp(){},setQuestionContext(){},scheduleDraft(){}});
  vm.runInContext(`let recommendationRequestId=0, pendingRecommendation=null, roleRevision=0; ${clearChoice}\n${loadQuestion}\n${recommendations}`,context);
  return {events,calls,state,question,answer,pick,action,notice,message,context};
}

test('an early repeat is explained before any change and continuing keeps the existing answer', async () => {
  const h=recommendationHarness();
  const pending=h.events.pick();
  assert.equal(h.calls[0].args[2].exclude_question,'当前题');
  h.calls[0].resolve({question:{text:'当前题',sameAsCurrent:true,availability:'early',reasonDetails:'建议间隔 1 天。'}}); await pending;
  assert.equal(h.notice.hidden,false); assert.match(h.message.textContent,/还没到建议复习时间/);
  assert.equal(h.answer.value,'已有回答');
  h.events.action();
  assert.equal(h.answer.value,'已有回答'); assert.equal(h.notice.hidden,true);
});

test('a different available question does not overwrite an answer when the user cancels', async () => {
  const h=recommendationHarness(false);
  const pending=h.events.pick();
  h.calls[0].resolve({question:{text:'另一题',sameAsCurrent:false,availability:'new'}}); await pending;
  assert.equal(h.question.value,'当前题'); assert.equal(h.answer.value,'已有回答');
});

test('an empty library shows a next step without offering a nonexistent question', async () => {
  const h=recommendationHarness(); const pending=h.events.pick();
  h.calls[0].resolve({question:null}); await pending;
  assert.equal(h.notice.hidden,false); assert.equal(h.action.hidden,true);
  assert.match(h.message.textContent,/题库还没有题目/);
});

test('an unknown practice date is explained instead of claiming a question is due', async () => {
  const h=recommendationHarness(); const pending=h.events.pick();
  h.calls[0].resolve({question:{text:'当前题',sameAsCurrent:true,availability:'unknown',reasonDetails:'最近练习时间未知。'}}); await pending;
  assert.equal(h.notice.hidden,false); assert.match(h.message.textContent,/无法判断/);
  assert.doesNotMatch(h.message.textContent,/已到建议复习时间/);
});

test('a recommendation arriving after the question changes is discarded', async () => {
  const h=recommendationHarness(); const pending=h.events.pick();
  h.question.value='用户正在编辑的新问题'; vm.runInContext('clearRecommendationChoice()',h.context);
  h.calls[0].resolve({question:{text:'旧推荐',sameAsCurrent:false,availability:'new'}}); await pending;
  assert.equal(h.question.value,'用户正在编辑的新问题'); assert.equal(h.notice.hidden,true);
});
