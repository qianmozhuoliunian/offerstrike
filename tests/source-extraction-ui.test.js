import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSourceExtraction } from '../public/ui/source-extraction.js';

function harness(refresh=async()=>{}) {
  const listeners={},calls=[],source={id:'source-1',url:'https://example.org/post',role:'产品经理'};
  const container={addEventListener:(event,fn)=>{listeners[event]=fn;},querySelectorAll:()=>[]};
  const api=(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}));
  const extraction=createSourceExtraction({api,getSource:id=>id===source.id?source:null,refresh,escapeHtml:s=>String(s??''),toast:{}});
  extraction.attach(container);
  const panel={querySelector:()=>null,querySelectorAll:()=>[]};
  const input=value=>{const field={value,dataset:{extractText:source.id},closest:selector=>selector==='[data-extract-text]'?field:selector==='[data-extract-panel]'?panel:null};listeners.input({target:field});};
  const click=(selector,button)=>listeners.click({target:{closest:query=>query===selector?button:null}});
  return {source,calls,extraction,input,click};
}

test('extracting does not save until confirmation and preserves the source and evidence', async () => {
  const h=harness(), raw='面试官问：如何设计缓存？';
  h.input(raw);
  assert.match(h.extraction.render(h.source),/面试官问：如何设计缓存/);
  const pending=h.click('[data-extract-run]',{dataset:{extractRun:h.source.id}});
  assert.equal(h.calls.length,1);
  assert.deepEqual(h.calls[0].args.slice(0,3),['/api/sources/source-1/extract-questions','POST',{source_text:raw}]);
  h.calls[0].resolve({items:[{id:'candidate-id',question:'如何设计缓存？',evidence:raw}],omitted:0}); await pending;
  assert.equal(h.calls.length,1);
  assert.match(h.extraction.render(h.source),/原文依据/);
  const saving=h.click('[data-extract-save]',{dataset:{extractSave:h.source.id,candidate:'candidate-id'}});
  assert.equal(h.calls[1].args[0],'/api/sources/source-1/extracted-questions');
  assert.equal(h.calls[1].args[2].evidence,raw);
  assert.equal(h.calls[1].args[2].request_id,'candidate-id');
  assert.deepEqual(h.calls[1].args[2].expected_source,{url:'https://example.org/post',role:'产品经理'});
  h.calls[1].resolve({id:'question-1'}); await saving;
  assert.match(h.extraction.render(h.source),/已保存/);
});

test('oversized or changed source text cannot be sent or used to save stale candidates', async () => {
  const h=harness();
  h.input('😀'.repeat(12001));
  await h.click('[data-extract-run]',{dataset:{extractRun:h.source.id}});
  assert.equal(h.calls.length,0); assert.match(h.extraction.render(h.source),/本次未发送/);
  h.input('面试官问：如何设计缓存？');
  const pending=h.click('[data-extract-run]',{dataset:{extractRun:h.source.id}});
  h.calls[0].resolve({items:[{id:'candidate-id',question:'如何设计缓存？',evidence:'面试官问：如何设计缓存？'}],omitted:0}); await pending;
  h.input('已修改的原文');
  assert.match(h.extraction.render(h.source),/旧候选暂不能保存/);
  await h.click('[data-extract-save]',{dataset:{extractSave:h.source.id,candidate:'candidate-id'}});
  assert.equal(h.calls.length,1);
});

test('failed extraction keeps the original input for retry', async () => {
  const h=harness(); h.input('面试官问：如何设计缓存？');
  const pending=h.click('[data-extract-run]',{dataset:{extractRun:h.source.id}});
  h.calls[0].reject(Error('服务不可用')); await pending;
  const html=h.extraction.render(h.source);
  assert.match(html,/服务不可用/); assert.match(html,/面试官问：如何设计缓存/);
});

test('a saved candidate remains disabled if the following refresh fails', async () => {
  const h=harness(async()=>{throw Error('offline');}); h.input('面试官问：如何设计缓存？');
  const pending=h.click('[data-extract-run]',{dataset:{extractRun:h.source.id}});
  h.calls[0].resolve({items:[{id:'candidate-id',question:'如何设计缓存？',evidence:'面试官问：如何设计缓存？'}],omitted:0}); await pending;
  const saving=h.click('[data-extract-save]',{dataset:{extractSave:h.source.id,candidate:'candidate-id'}});
  h.calls[1].resolve({id:'question-1'}); await saving;
  assert.match(h.extraction.render(h.source),/已保存.*刷新失败/);
  await h.click('[data-extract-save]',{dataset:{extractSave:h.source.id,candidate:'candidate-id'}});
  assert.equal(h.calls.length,2);
});

test('an extraction response is discarded if its source changes', async () => {
  const h=harness(); h.input('面试官问：如何设计缓存？');
  const pending=h.click('[data-extract-run]',{dataset:{extractRun:h.source.id}});
  h.source.url='https://example.org/changed';
  h.calls[0].resolve({items:[{id:'candidate-id',question:'旧候选',evidence:'面试官问：如何设计缓存？'}],omitted:0}); await pending;
  assert.match(h.extraction.render(h.source),/来源已变化/);
  assert.doesNotMatch(h.extraction.render(h.source),/旧候选/);
});

test('a candidate cannot be saved if its source identity changes after extraction', async () => {
  const h=harness(); h.input('面试官问：如何设计缓存？');
  const pending=h.click('[data-extract-run]',{dataset:{extractRun:h.source.id}});
  h.calls[0].resolve({items:[{id:'candidate-id',question:'如何设计缓存？',evidence:'面试官问：如何设计缓存？'}],omitted:0}); await pending;
  h.source.role='运营';
  await h.click('[data-extract-save]',{dataset:{extractSave:h.source.id,candidate:'candidate-id'}});
  assert.equal(h.calls.length,1);
  assert.match(h.extraction.render(h.source),/来源已变化/);
  assert.match(h.extraction.render(h.source),/如何设计缓存/);
});
