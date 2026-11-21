import { workbenchClient } from './fixtures/local-workbench.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('dialogue keeps full context, validates origins, retries safely and restores backups', async () => {
  const requests=[];
  const mock=http.createServer(async (req,res)=>{
    let body=''; for await (const chunk of req) body+=chunk;
    const input=JSON.parse(body), system=input.messages[0].content, content=input.messages.at(-1).content;
    requests.push({system,content});
    if (content.includes('__fail__')) { res.writeHead(503); return res.end(); }
    let value;
    if (system.includes('判断输入能否表示求职者')) value={status:'valid'};
    else if (system.includes('复习出题助手')) value={question:'如何判断需求优先级？'};
    else if (system.includes('总结已有回答')) value={summary:'先明确目标，再比较优先级；继续补充验证方式。'};
    else {
      const data=JSON.parse(content);
      value={focus:'判断依据',evidence:data.answer.slice(0,100),next_step:'练习验证方法',feedback:'你的回答提出了判断依据。',follow_up:data.answer.startsWith('__round') || data.answer.startsWith('__large') ? '继续说明？' : data.previous_turns.length ? '' : '你会如何验证？'};
      if (data.answer==='先确定业务目标') value.evaluation={topic:'指标',
        strengths:[{point:'先明确业务目标',evidence:'先确定业务目标'}],
        weaknesses:[{point:'补充指标分析的验证方式',evidence:'先确定业务目标',type:'missing',requirement:'分析指标'}],
        unverified:['如何识别异常值'],followup_point:'补充指标分析的验证方式',suggested_followup:'你会如何验证？',recommended_action:'followup'};
      if (data.answer==='对照业务数据') value.evaluation={topic:'',strengths:[{point:'对照已有数据',evidence:'对照业务数据'}],
        weaknesses:[],unverified:[],followup_point:'',recommended_action:'complete'};
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const instances=[];
  async function start() {
    const temp=await mkdtemp(join(tmpdir(),'dialogue-test-'));
    const allocate=http.createServer();await new Promise(resolve=>allocate.listen(0,'127.0.0.1',resolve));const port=allocate.address().port;await new Promise(resolve=>allocate.close(resolve));
    const env={...process.env,INTERVIEW_DATA_DIR:join(temp,'data'),PORT:String(port),AI_API_KEY:'fake-key',AI_MODEL:'test',AI_BASE_URL:`http://127.0.0.1:${mock.address().port}`};delete env.TAVILY_API_KEY;
    const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    const deadline=Date.now()+10000;
    while(!stdout.includes('面试工作台已就绪')) { if(child.exitCode!==null || Date.now()>deadline) throw Error(stderr || 'server start failed'); await new Promise(resolve=>setTimeout(resolve,25)); }
    const fetchWorkbench=workbenchClient(stdout);
    const base=`http://127.0.0.1:${port}`;
    const post=(path,data)=>fetchWorkbench(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const instance={temp,child,base,post,fetchWorkbench};instances.push(instance);return instance;
  }
  try {
    const app=await start(), {post,base,fetchWorkbench}=app;
    assert.equal((await post('/api/role',{role:'产品经理'})).status,200);
    assert.equal((await post('/api/jd',{role:'产品经理',jd:'不应传给对话的描述',confirmed_requirements:'分析指标'})).status,200);
    const source=await (await post('/api/sources',{title:'自述面经',url:'https://example.com/interview',role:'产品经理',type:'真实面经（自述）',question:'如何分析指标？'})).json();
    const state=await (await fetchWorkbench(base+'/api/state')).json();
    const ref={kind:'source',id:state.sources.find(s=>s.id===source.id).questions[0].id};
    const recommend=await (await post('/api/recommendation',{role:'产品经理',source_preference:'self_reported'})).json();
    assert.equal(recommend.question.text,'如何分析指标？');
    const generated=await (await post('/api/practice/dialogue/generate',{role:'产品经理'})).json();
    assert.equal(generated.question,'如何判断需求优先级？'); assert.ok(generated.generation_token);
    assert.equal((await post('/api/practice/dialogue/turn',{role:'产品经理',question:'如何分析指标？',answer:'回答',question_ref:ref,generation_token:generated.generation_token})).status,400);
    assert.equal((await post('/api/practice/dialogue/turn',{role:'产品经理',question:'篡改的题目',answer:'回答',question_ref:ref})).status,400);
    const input={role:'产品经理',question:'如何分析指标？',answer:'先确定业务目标',question_ref:ref,request_id:'request-1'};
    const [a,b]=await Promise.all([post('/api/practice/dialogue/turn',input),post('/api/practice/dialogue/turn',input)]);
    assert.equal(a.status,200);assert.equal(b.status,200);
    const first=await a.json(), duplicate=await b.json(); assert.equal(first.id,duplicate.id);assert.equal(first.origin,'source');
    assert.deepEqual(first.evaluation,duplicate.evaluation);
    assert.equal(first.evaluation.strengths[0].evidence,input.answer);
    assert.equal(requests.filter(r=>r.system.includes('围绕同一道题逐轮对话')).length,1);
    assert.equal((await post('/api/practice/dialogue/turn',{...input,answer:'不同回答'})).status,400);
    assert.equal((await post('/api/practice/dialogue/turn',{...input,question_ref:null})).status,400);
    const before=requests.length;
    assert.equal((await post('/api/practice/dialogue/turn',{role:'产品经理',question:first.follow_up,answer:'答'.repeat(10001),parent_attempt_id:first.id})).status,400);
    assert.equal(requests.length,before);
    const fail=await post('/api/practice/dialogue/turn',{role:'产品经理',question:first.follow_up,answer:'__fail__',parent_attempt_id:first.id,request_id:'fail-1'});
    assert.equal(fail.status,400);
    const secondRes=await post('/api/practice/dialogue/turn',{role:'产品经理',question:first.follow_up,answer:'对照业务数据',parent_attempt_id:first.id,request_id:'request-2'});
    assert.equal(secondRes.status,200); const second=await secondRes.json();
    const turnInput=JSON.parse(requests.at(-1).content);
    assert.equal(turnInput.previous_turns[0].answer,'先确定业务目标');
    assert.equal(Object.hasOwn(turnInput.previous_turns[0],'evaluation'),false);
    assert.equal(turnInput.requirements,'分析指标');
    assert.doesNotMatch(requests.at(-1).content,/不应传给对话的描述/);
    const summary=await post('/api/practice/dialogue/summary',{role:'产品经理',attempt_id:second.id});assert.equal(summary.status,200);
    const summaryText=(await summary.json()).summary; assert.match(summaryText,/验证方式/);
    const lastRequestCount=requests.length;
    assert.equal((await post('/api/practice/dialogue/summary',{role:'产品经理',attempt_id:second.id})).status,200);assert.equal(requests.length,lastRequestCount);
    const history=await (await fetchWorkbench(base+`/api/practice/dialogue/${second.id}?role=${encodeURIComponent('产品经理')}`)).json();
    assert.equal(history.turns.length,2);assert.equal(history.origin,'source');assert.equal(history.summary,summaryText);
    assert.deepEqual(history.turns[0].evaluation,first.evaluation);
    const abilityResponse=await fetchWorkbench(base+'/api/career/ability-history?role='+encodeURIComponent('产品经理'));
    assert.equal(abilityResponse.status,200);
    const ability=await abilityResponse.json();
    assert.deepEqual(ability.history[0].question_ref,ref);
    assert.equal(ability.history[0].topic,'指标');
    assert.deepEqual(ability.topics.map(({topic,rounds})=>({topic,rounds})),[{topic:'指标',rounds:2}]);
    assert.equal(ability.next_steps[0].topic,'指标');
    const ai=await post('/api/practice/dialogue/turn',{role:'产品经理',question:generated.question,answer:'先看影响',generation_token:generated.generation_token,request_id:'generated-1'});
    assert.equal(ai.status,200);const aiTurn=await ai.json();assert.equal(aiTurn.origin,'ai');
    const aiRetry=await post('/api/practice/dialogue/turn',{role:'产品经理',question:generated.question,answer:'先看影响',generation_token:generated.generation_token,request_id:'generated-1'});
    assert.equal((await aiRetry.json()).id,aiTurn.id);
    assert.equal((await post('/api/practice/dialogue/summary',{role:'产品经理',attempt_id:aiTurn.id})).status,200);
    assert.equal((await post('/api/practice/dialogue/turn',{role:'产品经理',question:aiTurn.follow_up,answer:'补充',parent_attempt_id:aiTurn.id})).status,400);
    let lastId='', nextQuestion='轮数检查';
    for (let i=0;i<8;i++) {
      const response=await post('/api/practice/dialogue/turn',{role:'产品经理',question:nextQuestion,answer:`__round${i}`,parent_attempt_id:lastId});
      assert.equal(response.status,200); const result=await response.json(); lastId=result.id;nextQuestion=result.follow_up;
    }
    const countBeforeNinth=requests.length;
    assert.equal((await post('/api/practice/dialogue/turn',{role:'产品经理',question:nextQuestion,answer:'__round9',parent_attempt_id:lastId})).status,400);
    assert.equal(requests.length,countBeforeNinth);
    lastId='';nextQuestion='长度检查';
    for (let i=0;i<3;i++) {
      const response=await post('/api/practice/dialogue/turn',{role:'产品经理',question:nextQuestion,answer:'__large'+'答'.repeat(9000),parent_attempt_id:lastId});
      assert.equal(response.status,200); const result=await response.json(); lastId=result.id;nextQuestion=result.follow_up;
    }
    const beforeLong=requests.length;
    assert.equal((await post('/api/practice/dialogue/turn',{role:'产品经理',question:nextQuestion,answer:'__large'+'答'.repeat(9900),parent_attempt_id:lastId})).status,400);
    assert.equal(requests.length,beforeLong);
    const backup=await (await fetchWorkbench(base+'/api/export')).json();
    const restored=await start();
    assert.equal((await restored.post('/api/import',{mode:'merge',data:backup})).status,200);
    const restoredHistory=await (await restored.fetchWorkbench(restored.base+`/api/practice/dialogue/${second.id}?role=${encodeURIComponent('产品经理')}`)).json();
    assert.equal(restoredHistory.summary,summaryText);assert.equal(restoredHistory.origin,'source');assert.equal(restoredHistory.source_available,true);assert.equal(restoredHistory.turns.length,2);
    assert.deepEqual(restoredHistory.turns[0].evaluation,first.evaluation);
    const restoredAi=await (await restored.fetchWorkbench(restored.base+`/api/practice/dialogue/${aiTurn.id}?role=${encodeURIComponent('产品经理')}`)).json();
    assert.equal(restoredAi.origin,'ai');
    const forged=structuredClone(backup);forged.dialogue_origins.find(item=>item.attempt_id===aiTurn.id).origin='source';
    assert.equal((await restored.post('/api/import',{mode:'preview',data:forged})).status,400);
    const legacy={...backup};delete legacy.dialogue_origins;delete legacy.dialogue_summaries;delete legacy.dialogue_requests;
    delete legacy.ability_evaluations;
    assert.equal((await restored.post('/api/import',{mode:'preview',data:legacy})).status,200);
    assert.equal((await restored.fetchWorkbench(restored.base+`/api/sources/${source.id}`,{method:'DELETE'})).status,200);
    const missing=await (await restored.fetchWorkbench(restored.base+`/api/practice/dialogue/${second.id}?role=${encodeURIComponent('产品经理')}`)).json();
    assert.equal(missing.source_available,false);
  } finally {
    for(const {child,temp} of instances) { child.kill(); if(child.exitCode===null) await once(child,'exit'); await rm(temp,{recursive:true,force:true}); }
    await new Promise(resolve=>mock.close(resolve));
  }
});
