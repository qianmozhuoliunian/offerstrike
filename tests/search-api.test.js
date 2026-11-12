import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('search API separates unverified results and preserves source and date filters', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'interview-search-test-'));
  const fixture = new URL('./fixtures/mock-search-provider.mjs', import.meta.url).href;
  const server = fileURLToPath(new URL('../server.js', import.meta.url));
  const allocate = http.createServer();
  await new Promise(resolve => allocate.listen(0,'127.0.0.1',resolve));
  const port = allocate.address().port;
  await new Promise(resolve => allocate.close(resolve));
  const child = spawn(process.execPath, ['--import', fixture, server], {
    cwd:temp, env:{...process.env, PORT:String(port), TAVILY_API_KEY:'test-key', AI_API_KEY:'', AI_MODEL:''}, stdio:['ignore','pipe','pipe']
  });
  let stderr=''; child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    let info;
    const deadline = Date.now() + 10000;
    while (!info) {
      if (child.exitCode !== null) throw Error(`server exited: ${stderr}`);
      if (Date.now() > deadline) throw Error(`server did not start: ${stderr}`);
      try { info = JSON.parse(await readFile(join(temp,'data','server.json'),'utf8')); }
      catch { await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    const search = async payload => {
      const response = await fetch(info.url + '/api/search', {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload)
      });
      assert.equal(response.status,200);
      return response.json();
    };
    const pending=await (await fetch(info.url+'/api/role',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'产品经理'})})).json();
    assert.equal(pending.status,'needs_confirmation');
    const saved=await fetch(info.url+'/api/role',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'产品经理',confirmation_token:pending.confirmation_token})});
    assert.equal(saved.status,200);

    const current = await search({role:'产品经理',source:'all',range:'year'});
    assert.deepEqual(current.results.map(item=>item.title),['产品实习面经']);
    assert.deepEqual(current.unverified_results.map(item=>item.title),['产品经理职业发展建议']);
    assert.match(current.notice,/日期未知/);
    assert.match(current.notice,/初筛.*仍需核实/);

    const nowcoder = await search({role:'产品经理',source:'nowcoder',range:'all'});
    assert.equal(nowcoder.unverified_results.length,0);
    assert.equal(nowcoder.results.length,3);

    const requirements='范围验证'+'要'.repeat(795)+'😀'+'不应发送';
    const saveProfile=await fetch(info.url+'/api/jd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'产品经理',jd:'岗位描述',confirmed_requirements:requirements})});
    assert.equal(saveProfile.status,200);
    const captured=await search({role:'产品经理',company:'示例公司',source:'nowcoder',range:'all'});
    assert.equal(captured.results.length,0);
    assert.ok(captured.unverified_results.every(item=>item.company_match==='unknown'));
    const sent=(await readFile(join(temp,'search-provider-requests.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(item=>item.query.includes('示例公司'));
    assert.equal(sent.length,2);
    assert.ok(sent.every(item=>item.query.includes('产品经理') && item.include_domains.length===1 && item.include_domains[0]==='nowcoder.com'));
    assert.ok(sent.every(item=>!item.query.includes('范围验证') && !item.query.includes('不应发送')));
    const degraded=await search({role:'产品经理',company:'部分失败公司',source:'nowcoder',range:'all'});
    assert.equal(degraded.partial_failure,true);
    assert.match(degraded.notice,/部分检索失败/);
    const withoutAi=await search({role:'产品经理',source:'all',range:'year',ai_relevance:true});
    assert.equal(withoutAi.results.length,0);
    assert.ok(withoutAi.unverified_results.every(item=>item.ai_relevance==='uncertain'));
    assert.match(withoutAi.notice,/未配置/);
    const longCompany=await fetch(info.url+'/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'产品经理',company:'公'.repeat(101),range:'all'})});
    assert.equal(longCompany.status,400);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child,'exit').catch(()=>{}); }
    await rm(temp,{recursive:true,force:true});
  }
});

test('AI search sends only public snippets, validates evidence and degrades failures', async () => {
  const temp=await mkdtemp(join(tmpdir(),'interview-search-ai-test-'));
  const fixture=new URL('./fixtures/mock-search-provider.mjs',import.meta.url).href;
  const server=fileURLToPath(new URL('../server.js',import.meta.url));
  const allocate=http.createServer();
  await new Promise(resolve=>allocate.listen(0,'127.0.0.1',resolve));
  const port=allocate.address().port;
  await new Promise(resolve=>allocate.close(resolve));
  const child=spawn(process.execPath,['--import',fixture,server],{cwd:temp,env:{...process.env,PORT:String(port),TAVILY_API_KEY:'test-key',AI_API_KEY:'fake',AI_MODEL:'mock',AI_BASE_URL:'https://mock-search-ai.test/v1'},stdio:['ignore','pipe','pipe']});
  let stderr=''; child.stderr.on('data',chunk=>{stderr+=chunk;});
  try {
    let info; const deadline=Date.now()+10000;
    while(!info) {
      if(child.exitCode!==null || Date.now()>deadline) throw Error(stderr || 'server did not start');
      try { info=JSON.parse(await readFile(join(temp,'data','server.json'),'utf8')); }
      catch { await new Promise(resolve=>setTimeout(resolve,30)); }
    }
    const post=(path,data)=>fetch(info.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await post('/api/role',{role:'产品经理'})).status,200);
    assert.equal((await post('/api/jd',{role:'产品经理',jd:'私人岗位描述',confirmed_requirements:'私人岗位要求'})).status,200);
    const response=await post('/api/search',{role:'产品经理',source:'all',range:'year',ai_relevance:true});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.partial_failure,false);
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].ai_relevance,'related');
    assert.equal(result.results[0].ai_evidence.role_evidence,'产品');
    assert.ok(result.unverified_results.every(item=>item.ai_relevance==='uncertain'));
    const calls=(await readFile(join(temp,'search-ai-requests.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(calls.length>0);
    assert.doesNotMatch(JSON.stringify(calls),/私人岗位描述|私人岗位要求/);
    assert.ok(calls.every(call=>call.candidates.every(item=>Object.keys(item).sort().join(',')==='index,snippet,title')));
    const failed=await post('/api/search',{role:'产品经理',company:'AI失败',source:'all',range:'year',ai_relevance:true});
    const failedResult=await failed.json();
    assert.equal(failedResult.results.length,0);
    assert.ok(failedResult.unverified_results.every(item=>item.ai_relevance==='uncertain'));
    assert.match(failedResult.notice,/AI 判断暂不可用/);
  } finally {
    if(child.exitCode===null) {child.kill();await once(child,'exit').catch(()=>{});}
    await rm(temp,{recursive:true,force:true});
  }
});
