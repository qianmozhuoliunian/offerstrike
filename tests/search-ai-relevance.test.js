import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSearchAiRelevance } from '../src/search-ai-relevance.js';

const candidate = {title:'字节跳动产品经理面经', snippet:'分享产品经理一面经历。', role_match:'title_keyword', company_match:'title_keyword'};
const answer = (item) => JSON.stringify({items:[{index:0,...item}]});
const related = {status:'related',role_evidence:'产品经理',interview_evidence:'面经',company_evidence:'字节跳动'};
const base = {enabled:true,role:'产品经理',company:'字节跳动',results:[candidate]};

test('explicit opt-in is required and sends only bounded public candidate data', async () => {
  let sent;
  const request=async payload=>{sent=payload;return answer(related);};
  await assert.rejects(assessSearchAiRelevance({...base,enabled:false,request}),/选择/);
  assert.equal(sent,undefined);
  const result=await assessSearchAiRelevance({...base,results:[{...candidate,url:'https://private.example/link',personal_note:'不应发送的笔记'}],requirements:'不应发送的岗位要求',request});
  assert.equal(result.items[0].status,'related');
  assert.equal(result.items[0].role_evidence,'产品经理');
  assert.doesNotMatch(JSON.stringify(sent.messages),/不应发送的岗位要求/);
  assert.doesNotMatch(JSON.stringify(sent.messages),/private\.example|不应发送的笔记/);
  assert.match(JSON.stringify(sent.messages),/字节跳动产品经理面经/);
  assert.deepEqual(sent.response_format,{type:'json_object'});
});

test('a nonconflicting unrelated judgment requires a literal public excerpt', async () => {
  const result=await assessSearchAiRelevance({enabled:true,role:'产品经理',company:'',results:[{title:'Java后端面经',snippet:'后端一面记录',role_match:'unknown'}],request:async()=>answer({status:'unrelated',evidence:'Java后端'})});
  assert.deepEqual(result.items,[{index:0,status:'unrelated',evidence:'Java后端'}]);
  assert.equal(result.warning,'');
});

test('relevance requires literal evidence for role, interview and requested company', async () => {
  for (const item of [
    {...related,role_evidence:'不存在的岗位'},
    {...related,interview_evidence:'产品经理'},
    {...related,company_evidence:'其他公司'},
    {...related,company_evidence:''},
    {...related,role_evidence:'字节'.repeat(200)}
  ]) {
    const result=await assessSearchAiRelevance({...base,request:async()=>answer(item)});
    assert.equal(result.items[0].status,'uncertain');
    assert.match(result.warning,/待核实/);
  }
  const incidental = await assessSearchAiRelevance({...base,results:[{title:'产品经理一面面经',snippet:'评论提到字节跳动。'}],request:async()=>answer({...related,interview_evidence:'面经'})});
  assert.equal(incidental.items[0].status,'uncertain');
});

test('invalid JSON, out-of-range and duplicate indices do not become confirmed matches', async () => {
  for (const content of ['not json','{}',JSON.stringify({items:[{index:9,...related}]}),JSON.stringify({items:[{index:0,...related},{index:0,...related}]})]) {
    const result=await assessSearchAiRelevance({...base,request:async()=>content});
    assert.equal(result.items[0].status,'uncertain');
    assert.match(result.warning,/待核实/);
  }
});

test('missing model results and conflicts with existing clear clues stay uncertain', async () => {
  const missing=await assessSearchAiRelevance({...base,request:async()=>JSON.stringify({items:[]})});
  assert.equal(missing.items[0].status,'uncertain');
  const conflict=await assessSearchAiRelevance({...base,request:async()=>answer({status:'unrelated',evidence:'产品经理面经'})});
  assert.equal(conflict.items[0].status,'uncertain');
  const titleConflict=await assessSearchAiRelevance({...base,results:[{...candidate,role_match:'conflict'}],request:async()=>answer(related)});
  assert.equal(titleConflict.items[0].status,'uncertain');
});

test('failures and timeouts return uncertain results without inventing evidence', async () => {
  const failed=await assessSearchAiRelevance({...base,request:async()=>{throw Error('network failure');}});
  assert.deepEqual(failed.items,[{index:0,status:'uncertain'}]);
  assert.match(failed.warning,/待核实/);
  let signal;
  const timeout=await assessSearchAiRelevance({...base,timeoutMs:10,request:({signal:s})=>{signal=s; return new Promise(()=>{});}});
  assert.deepEqual(timeout.items,[{index:0,status:'uncertain'}]);
  assert.equal(signal.aborted,true);
  assert.match(timeout.warning,/超时/);
});

test('processes all 30 normal candidates in bounded batches and preserves original indices', async () => {
  const sent=[];
  const request=async ({messages})=>{
    const input=JSON.parse(messages[1].content); sent.push(input.candidates);
    return JSON.stringify({items:input.candidates.map(({index})=>({index,...related}))});
  };
  const output=await assessSearchAiRelevance({...base,results:Array(30).fill(candidate),request});
  assert.deepEqual(sent.map(batch=>batch.length),[20,10]);
  assert.equal(output.items.length,30);
  assert.ok(output.items.every((item,index)=>item.index===index && item.status==='related'));
  assert.equal(output.warning,'');
});

test('long input is split by total length; oversized single candidates are not sent or truncated', async () => {
  const sent=[];
  const request=async ({messages})=>{
    const input=JSON.parse(messages[1].content); sent.push(input.candidates);
    return JSON.stringify({items:input.candidates.map(({index})=>({index,...related}))});
  };
  const results=[{...candidate,title:'字'.repeat(501)},...Array(9).fill({...candidate,snippet:'字'.repeat(1900)}),{...candidate,snippet:'字'.repeat(2001)}];
  const output=await assessSearchAiRelevance({...base,results,request});
  assert.deepEqual(sent.map(batch=>batch.length),[8,1]);
  assert.deepEqual(sent.flat().map(item=>item.index),[1,2,3,4,5,6,7,8,9]);
  assert.equal(sent[0][0].snippet.length,1900);
  assert.equal(output.items[0].status,'uncertain');
  assert.equal(output.items[10].status,'uncertain');
  assert.ok(output.items.slice(1,10).every(item=>item.status==='related'));
  assert.match(output.warning,/2 条.*未发送.*待核实/);
});

test('a failed batch is marked uncertain while later batches are still evaluated', async () => {
  let calls=0;
  const request=async ({messages})=>{
    calls++;
    if (calls===1) throw Error('network');
    const {candidates}=JSON.parse(messages[1].content);
    return JSON.stringify({items:candidates.map(({index})=>({index,...related}))});
  };
  const output=await assessSearchAiRelevance({...base,results:Array(30).fill(candidate),request});
  assert.equal(calls,2);
  assert.ok(output.items.slice(0,20).every(item=>item.status==='uncertain'));
  assert.ok(output.items.slice(20).every(item=>item.status==='related'));
  assert.match(output.warning,/第 1 批.*待核实/);
});

test('results beyond the request limit remain unsent, uncertain and disclosed', async () => {
  const sent=[];
  const request=async ({messages})=>{
    const {candidates}=JSON.parse(messages[1].content); sent.push(...candidates);
    return JSON.stringify({items:candidates.map(({index})=>({index,...related}))});
  };
  const output=await assessSearchAiRelevance({...base,results:Array(101).fill(candidate),request});
  assert.equal(sent.length,100);
  assert.equal(output.items[100].status,'uncertain');
  assert.match(output.warning,/1 条.*未发送.*待核实/);
});
