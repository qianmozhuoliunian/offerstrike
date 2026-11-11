import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { initializeQuestions } from '../src/questions.js';
import { initializeWorkspace, getDraft, getProfile } from '../src/workspace.js';
import { importData } from '../src/import-data.js';
import { roleValidationStatus } from '../src/role-validation.js';

test('role validation protects saving, searching, old data and explicit confirmation', async () => {
  const temp = await mkdtemp(join(tmpdir(),'interview-role-test-'));
  const modelRequests = [];
  let releaseSlow, signalSlow, releaseSlow2, signalSlow2;
  const slowStarted=new Promise(resolve=>{signalSlow=resolve;});
  const slowRelease=new Promise(resolve=>{releaseSlow=resolve;});
  const slow2Started=new Promise(resolve=>{signalSlow2=resolve;});
  const slow2Release=new Promise(resolve=>{releaseSlow2=resolve;});
  const model = http.createServer(async (req,res) => {
    let input=''; for await (const chunk of req) input += chunk;
    const request=JSON.parse(input); modelRequests.push(request);
    const role=JSON.parse(request.messages[1].content).role;
    if (role==='慢速岗位') { signalSlow(); await slowRelease; }
    if (role==='另一个慢速岗位') { signalSlow2(); await slow2Release; }
    if (role==='服务故障岗位') { res.writeHead(503); return res.end(); }
    const status=role==='科比' ? 'invalid' : role==='AI' ? 'uncertain' : 'valid';
    const content=role==='格式错误岗位' ? 'not json' : JSON.stringify({status});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const allocate=http.createServer(); await new Promise(resolve=>allocate.listen(0,'127.0.0.1',resolve));
  const port=allocate.address().port; await new Promise(resolve=>allocate.close(resolve));
  const fixture=new URL('./fixtures/mock-search-provider.mjs',import.meta.url).href;
  const child=spawn(process.execPath,['--import',fixture,fileURLToPath(new URL('../server.js',import.meta.url))],{
    cwd:temp, env:{...process.env,PORT:String(port),AI_API_KEY:'mock-key',AI_MODEL:'mock-model',AI_BASE_URL:`http://127.0.0.1:${model.address().port}`,TAVILY_API_KEY:'mock-key'},stdio:['ignore','pipe','pipe']
  });
  let stderr=''; child.stderr.on('data',chunk=>stderr+=chunk);
  try {
    let info; const deadline=Date.now()+10000;
    while(!info) {
      if(child.exitCode!==null || Date.now()>deadline) throw Error(`server did not start: ${stderr}`);
      try { info=JSON.parse(await readFile(join(temp,'data','server.json'),'utf8')); }
      catch { await new Promise(resolve=>setTimeout(resolve,30)); }
    }
    const post=(path,data)=>fetch(info.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const state=async()=>await (await fetch(info.url+'/api/state')).json();
    const backup={version:1,settings:[{key:'role',value:'科比'}],profiles:[{role:'科比',jd:'旧岗位描述',confirmed_requirements:'旧岗位要求'}],sources:[],attempts:[],drafts:[{role:'科比',question:'旧问题',answer:'旧回答',updated:'2026-01-01'}],debriefs:[]};
    assert.equal((await post('/api/import',{mode:'merge',data:backup})).status,200);
    assert.equal((await state()).roleValidation,'unverified');
    assert.equal((await post('/api/search',{role:'科比',range:'all'})).status,400);

    const invalid=await post('/api/role',{role:'科比'});
    assert.equal(invalid.status,400);
    assert.match((await invalid.json()).error,/不是岗位/);
    const old=await state();
    assert.equal(old.role,'科比'); assert.equal(old.roleValidation,'unverified');
    assert.equal(old.draft.answer,'旧回答'); assert.equal(old.confirmed_requirements,'旧岗位要求');
    assert.deepEqual(JSON.parse(modelRequests.at(-1).messages[1].content),{role:'科比'});
    assert.doesNotMatch(JSON.stringify(modelRequests.at(-1)),/旧岗位描述|旧岗位要求|旧回答/);

    const beforeInvalid=modelRequests.length;
    for (const role of ['', '12345', '!!!', '岗'.repeat(101)]) assert.equal((await post('/api/role',{role})).status,400);
    assert.equal(modelRequests.length,beforeInvalid);

    for (const role of ['产品经理','AI Agent 应用工程师','篮球运动员']) {
      const response=await post('/api/role',{role});
      assert.equal(response.status,200); assert.equal((await response.json()).status,'saved');
      assert.equal((await state()).roleValidation,'valid');
    }
    assert.equal((await post('/api/search',{role:'科比',range:'all'})).status,400);
    assert.equal((await post('/api/search',{role:'篮球运动员',range:'all'})).status,200);

    let ambiguous=await (await post('/api/role',{role:'AI'})).json();
    assert.equal(ambiguous.status,'needs_confirmation');
    assert.equal((await state()).role,'篮球运动员');
    assert.equal((await post('/api/role',{role:'其他岗位',confirmation_token:ambiguous.confirmation_token})).status,400);
    ambiguous=await (await post('/api/role',{role:'AI'})).json();
    const confirmed=await post('/api/role',{role:'AI',confirmation_token:ambiguous.confirmation_token});
    assert.equal((await confirmed.json()).status,'saved');
    assert.equal((await state()).roleValidation,'confirmed');
    assert.equal((await post('/api/role',{role:'AI',confirmation_token:ambiguous.confirmation_token})).status,400);

    for (const role of ['服务故障岗位','格式错误岗位']) {
      const result=await (await post('/api/role',{role})).json();
      assert.equal(result.status,'needs_confirmation');
      assert.equal((await state()).role,'AI');
    }
    const slow=post('/api/role',{role:'慢速岗位'});
    await slowStarted;
    assert.equal((await post('/api/role',{role:'产品经理'})).status,200);
    releaseSlow();
    assert.equal((await slow).status,400);
    assert.equal((await state()).role,'产品经理');

    const slow2=post('/api/role',{role:'另一个慢速岗位'});
    await slow2Started;
    assert.equal((await post('/api/role',{role:'12345'})).status,400);
    releaseSlow2();
    assert.equal((await slow2).status,400);
    assert.equal((await state()).role,'产品经理');

    const oldToken=await (await post('/api/role',{role:'AI'})).json();
    assert.equal((await post('/api/role',{role:'篮球运动员'})).status,200);
    assert.equal((await post('/api/role',{role:'AI',confirmation_token:oldToken.confirmation_token})).status,400);
    assert.equal((await state()).role,'篮球运动员');
    const exported=await (await fetch(info.url+'/api/export')).json();
    assert.equal(exported.settings.length,1);
    assert.equal(exported.profiles.find(item=>item.role==='科比').jd,'旧岗位描述');
    assert.equal(exported.drafts.find(item=>item.role==='科比').answer,'旧回答');

    const restored=new DatabaseSync(':memory:');
    try {
      restored.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE sources (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, question TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL); CREATE TABLE attempts (id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, feedback TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL)");
      initializeQuestions(restored); initializeWorkspace(restored);
      importData(restored,exported,true);
      assert.equal(roleValidationStatus(restored,'篮球运动员'),'unverified');
      assert.equal(getProfile(restored,'科比').jd,'旧岗位描述');
      assert.equal(getDraft(restored,'科比').answer,'旧回答');
    } finally { restored.close(); }
  } finally {
    releaseSlow();
    releaseSlow2();
    if(child.exitCode===null) {child.kill(); await once(child,'exit').catch(()=>{});}
    await new Promise(resolve=>model.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
});
