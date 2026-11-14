import { workbenchClient } from './fixtures/local-workbench.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('evidence-based coaching and opt-in AI practice survive backup without inventing source', async () => {
  const calls=[];
  const mock=http.createServer(async (req,res)=>{
    let raw=''; for await (const chunk of req) raw+=chunk;
    const request=JSON.parse(raw), system=request.messages[0].content, data=JSON.parse(request.messages.at(-1).content);
    calls.push({system,data});
    let value;
    if (system.includes('判断输入能否表示求职者')) value={status:'valid'};
    else if (system.includes('针对性补练出题助手')) value={question:'下面两个指标，哪个能验证需求改善？'};
    else if (system.includes('总结已有回答')) value={summary:'先核对目标，再验证指标。'};
    else value={focus:'用户目标与验证',evidence:data.answer.includes('伪造') ? '未出现的引用' : data.answer.slice(0,8),feedback:'先明确目标，再补充验证方式。',next_step:'区分目标与验证指标',follow_up:''};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const instances=[];
  async function start() {
    const temp=await mkdtemp(join(tmpdir(),'coaching-test-'));
    const allocator=http.createServer();await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
    const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{cwd:temp,env:{...process.env,INTERVIEW_DATA_DIR:join(temp,'data'),PORT:String(port),AI_API_KEY:'test',AI_MODEL:'test',AI_BASE_URL:`http://127.0.0.1:${mock.address().port}`},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    const deadline=Date.now()+10000;
    while(!stdout.includes('面试工作台已就绪')) {if(child.exitCode!==null || Date.now()>deadline) throw Error(stderr || 'startup failed');await new Promise(resolve=>setTimeout(resolve,25));}
    const fetchWorkbench=workbenchClient(stdout);
    const base=`http://127.0.0.1:${port}`;
    const post=(path,data)=>fetchWorkbench(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const instance={temp,child,base,post,fetchWorkbench};instances.push(instance);return instance;
  }
  try {
    const app=await start();
    const {base,post,fetchWorkbench}=app;
    assert.equal((await post('/api/role',{role:'产品经理'})).status,200);
    assert.equal((await post('/api/jd',{role:'产品经理',jd:'私人 JD 不应发送',confirmed_requirements:'分析业务指标'})).status,200);
    const source=await (await post('/api/sources',{title:'用户确认的来源',url:'https://example.com/post',role:'产品经理',type:'真实面经（自述）',question:'如何验证一个需求？'})).json();
    const state=await (await fetchWorkbench(base+'/api/state')).json();
    assert.equal(state.roleCoaching.name,'产品岗位');
    const ref={kind:'source',id:state.sources.find(s=>s.id===source.id).questions[0].id};
    const input={role:'产品经理',question:'如何验证一个需求？',answer:'先确定业务目标再看指标',question_ref:ref,request_id:'case-1'};
    const bad=await post('/api/practice/dialogue/turn',{...input,answer:'伪造回答',request_id:'bad'});
    assert.equal(bad.status,400);assert.match((await bad.json()).error,/无法核验/);
    const firstResponse=await post('/api/practice/dialogue/turn',input);assert.equal(firstResponse.status,200);
    const first=await firstResponse.json();assert.equal(first.origin,'source');assert.ok(input.answer.includes(first.coaching.evidence));
    assert.equal(calls.at(-1).data.role_focus.name,'产品岗位');
    assert.doesNotMatch(JSON.stringify(calls.at(-1).data),/私人 JD 不应发送/);
    const duplicate=await (await post('/api/practice/dialogue/turn',input)).json();
    assert.equal(duplicate.id,first.id);assert.deepEqual(duplicate.coaching,first.coaching);
    assert.equal((await post('/api/practice/dialogue/reinforce',{role:'产品经理',attempt_id:first.id})).status,400);
    assert.equal((await post('/api/practice/dialogue/summary',{role:'产品经理',attempt_id:first.id})).status,200);
    const drillResponse=await post('/api/practice/dialogue/reinforce',{role:'产品经理',attempt_id:first.id});assert.equal(drillResponse.status,200);
    const drill=await drillResponse.json();assert.ok(drill.generation_token);assert.notEqual(drill.question,input.question);
    const sent=calls.at(-1).data;assert.equal(sent.turns[0].answer,input.answer);assert.equal(sent.coaching.evidence,first.coaching.evidence);
    assert.doesNotMatch(JSON.stringify(sent),/私人 JD 不应发送/);
    assert.equal((await post('/api/practice/dialogue/turn',{role:'产品经理',question:drill.question+'篡改',answer:'回答',generation_token:drill.generation_token})).status,400);
    const answer=await post('/api/practice/dialogue/turn',{role:'产品经理',question:drill.question,answer:'选择更能反映目标的指标',generation_token:drill.generation_token});
    assert.equal(answer.status,200);assert.equal((await answer.json()).origin,'ai');
    const backup=await (await fetchWorkbench(base+'/api/export')).json();
    assert.ok(backup.dialogue_coaching.some(c=>c.attempt_id===first.id));
    const restored=await start();
    assert.equal((await restored.post('/api/import',{mode:'merge',data:backup})).status,200);
    const restoredDialogue=await (await restored.fetchWorkbench(restored.base+`/api/practice/dialogue/${first.id}?role=${encodeURIComponent('产品经理')}`)).json();
    assert.deepEqual(restoredDialogue.turns[0].coaching,first.coaching);
    const legacy=structuredClone(backup);delete legacy.dialogue_coaching;
    assert.equal((await restored.post('/api/import',{mode:'preview',data:legacy})).status,200);
    const conflict=structuredClone(backup);conflict.dialogue_coaching.find(c=>c.attempt_id===first.id).focus='不同的重点';
    assert.equal((await restored.post('/api/import',{mode:'merge',data:conflict})).status,200);
    const unchanged=await (await restored.fetchWorkbench(restored.base+`/api/practice/dialogue/${first.id}?role=${encodeURIComponent('产品经理')}`)).json();
    assert.equal(unchanged.turns[0].coaching.focus,first.coaching.focus);
    const forged=structuredClone(backup);forged.dialogue_coaching.find(c=>c.attempt_id===first.id).evidence='不属于回答';
    assert.equal((await restored.post('/api/import',{mode:'preview',data:forged})).status,400);
  } finally {
    for (const {child,temp} of instances) {
      child.kill();if(child.exitCode===null) await once(child,'exit');
      if (!/^coaching-test-[A-Za-z0-9]+$/.test(relative(resolve(tmpdir()),resolve(temp)))) throw Error('refusing to remove a path outside the test temp directory');
      await rm(temp,{recursive:true,force:true});
    }
    await new Promise(resolve=>mock.close(resolve));
  }
});
