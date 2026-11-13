import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('extraction sends only supplied text, requires evidence and saves only on confirmation', async () => {
  const temp=await mkdtemp(join(tmpdir(),'interview-extract-test-'));
  const modelRequests=[];
  let slowStarted, releaseSlow;
  const started=new Promise(resolve=>{slowStarted=resolve;});
  const release=new Promise(resolve=>{releaseSlow=resolve;});
  const model=http.createServer(async(req,res)=>{
    let body=''; for await(const chunk of req) body+=chunk;
    const request=JSON.parse(body); modelRequests.push(request);
    const input=request.messages.at(-1).content;
    if(input.includes('__slow__')) {slowStarted(); await release;}
    const content=input.includes('__bad_json__') ? 'invalid' : JSON.stringify({items:input.includes('__empty__') ? [] : [
      {question:'如何设计缓存？',evidence:'面试官问：如何设计缓存？'},
      {question:'虚构的问题',evidence:'原文里没有这句话'}
    ]});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const allocator=http.createServer(); await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));
  const port=allocator.address().port; await new Promise(resolve=>allocator.close(resolve));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{
    cwd:temp,env:{...process.env,PORT:String(port),AI_API_KEY:'fake',AI_MODEL:'test',AI_BASE_URL:`http://127.0.0.1:${model.address().port}`},stdio:['ignore','pipe','pipe']
  });
  let stderr=''; child.stderr.on('data',chunk=>stderr+=chunk);
  try {
    let info; const deadline=Date.now()+10000;
    while(!info) {
      if(child.exitCode!==null || Date.now()>deadline) throw Error(`server did not start: ${stderr}`);
      try {info=JSON.parse(await readFile(join(temp,'data','server.json'),'utf8'));}
      catch {await new Promise(resolve=>setTimeout(resolve,30));}
    }
    const send=(path,method,data)=>fetch(info.url+path,{method,headers:{'content-type':'application/json'},body:data===undefined ? undefined : JSON.stringify(data)});
    const state=async()=>(await (await fetch(info.url+'/api/state')).json());
    const source=await (await send('/api/sources','POST',{title:'未发送的标题',url:'https://example.org/post',role:'未发送的岗位',type:'来源未知'})).json();
    const path=`/api/sources/${source.id}/extract-questions`;
    const savePath=`/api/sources/${source.id}/extracted-questions`;
    const raw='面试官问：如何设计缓存？\n用户粘贴的其他内容不应存入备份。';
    assert.equal((await send('/api/sources/missing/extract-questions','POST',{source_text:raw})).status,400);
    assert.equal((await send(path,'POST',{source_text:'😀'.repeat(12001)})).status,400);
    assert.equal(modelRequests.length,0);
    assert.equal((await send(path,'POST',{source_text:'__bad_json__'})).status,400);
    const empty=await (await send(path,'POST',{source_text:'__empty__'})).json();
    assert.deepEqual(empty.items,[]);
    const extracted=await (await send(path,'POST',{source_text:raw})).json();
    assert.equal(extracted.items.length,1); assert.equal(extracted.omitted,1);
    assert.equal(extracted.items[0].evidence,'面试官问：如何设计缓存？');
    assert.equal(modelRequests.at(-1).messages.at(-1).content,raw);
    assert.doesNotMatch(JSON.stringify(modelRequests.at(-1)),/未发送的标题|未发送的岗位/);
    assert.equal((await state()).sources[0].questions.length,0);

    const candidate=extracted.items[0];
    const confirmed={text:'用户确认后的缓存问题',evidence:candidate.evidence,source_text:raw,request_id:candidate.id,expected_source:{role:'未发送的岗位',url:'https://example.org/post'}};
    assert.equal((await send(savePath,'POST',{...confirmed,evidence:'伪造的原文依据'})).status,400);
    assert.equal((await send(savePath,'POST',{...confirmed,expected_source:{role:'其他岗位',url:'https://example.org/post'}})).status,400);
    assert.equal((await state()).sources[0].questions.length,0);
    const saved=await send(savePath,'POST',confirmed);
    assert.equal(saved.status,201); const question=await saved.json();
    assert.equal((await send(`/api/sources/${source.id}/questions/${question.id}/note`,'PUT',{note:'用户笔记'})).status,200);
    assert.equal((await send(`/api/sources/${source.id}/questions/${question.id}/topic`,'PUT',{topic:'缓存'})).status,200);
    const retried=await send(savePath,'POST',confirmed);
    assert.equal(retried.status,200); const retriedQuestion=await retried.json();
    assert.equal(retriedQuestion.id,question.id); assert.equal(retriedQuestion.note,'用户笔记'); assert.equal(retriedQuestion.topic,'缓存');
    assert.equal((await send(savePath,'POST',{...confirmed,text:'不一样的题目'})).status,400);
    let stored=(await state()).sources[0].questions;
    assert.equal(stored.length,1); assert.equal(stored[0].evidence,candidate.evidence);
    assert.equal(stored[0].evidence_question,confirmed.text);
    assert.equal((await send(`/api/sources/${source.id}/questions/${question.id}`,'PUT',{text:'后来编辑的问题'})).status,200);
    stored=(await state()).sources[0].questions;
    assert.equal(stored[0].text,'后来编辑的问题'); assert.equal(stored[0].evidence_question,confirmed.text);
    const exported=await (await fetch(info.url+'/api/export')).json();
    assert.doesNotMatch(JSON.stringify(exported),/用户粘贴的其他内容不应存入备份/);
    assert.match(JSON.stringify(exported),/面试官问：如何设计缓存/);

    const other=await (await send('/api/sources','POST',{title:'临时来源',url:'https://example.org/other',role:'岗位'})).json();
    const pending=send(`/api/sources/${other.id}/extract-questions`,'POST',{source_text:'__slow__ 面试官问：如何设计缓存？'});
    await started;
    assert.equal((await send(`/api/sources/${other.id}`,'DELETE')).status,200);
    releaseSlow();
    assert.equal((await pending).status,400);
  } finally {
    releaseSlow();
    if(child.exitCode===null) {child.kill(); await once(child,'exit').catch(()=>{});}
    await new Promise(resolve=>model.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
});
