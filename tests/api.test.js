import { workbenchClient } from './fixtures/local-workbench.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

test('HTTP workflow validates JD output, isolates roles, imports safely and rejects foreign requests', async () => {
  const reviewCases=JSON.parse(await readFile(new URL('./fixtures/review-cases.json',import.meta.url),'utf8'));
  const temp=await mkdtemp(join(tmpdir(),'interview-test-'));
  const modelRequests=[];
  const mock=http.createServer(async (req,res) => {
    let body=''; for await (const chunk of req) body+=chunk;
    const request=JSON.parse(body), jd=request.messages.at(-1).content;
    modelRequests.push(request);
    let content='已记录点评和追问';
    if (request.messages[0].content.includes('判断输入能否表示求职者')) {
      content=JSON.stringify({status:'valid'});
    } else if (request.messages[0].content.includes('岗位要求提取工具')) {
      assert.equal(request.response_format.type,'json_object');
      const result=jd.includes('数据分析') ? {status:'ok',items:[{requirement:'负责数据分析',evidence:'负责数据分析'}]} : {status:'insufficient',items:[]};
      content=JSON.stringify(result);
    } else if (request.messages[0].content.includes('面试题学习助手')) {
      content=jd.includes('__bad_help__') ? '{invalid' : JSON.stringify({guidance:'先明确业务目标，再考虑衡量方式。'});
    } else {
      if (jd.includes('本轮问题：具体如何选指标？')) { assert.match(jd,/上轮问题：如何做数据分析？/); assert.match(jd,/上轮回答：先确定业务目标/); }
      const fixture=reviewCases.find(item => jd.includes(`本轮回答：${item.answer}`));
      content=jd.includes('本轮回答：__malformed_model_response__') ? '{not valid json' : JSON.stringify(fixture?.mock_response || {feedback:'已记录点评和追问',follow_up:'具体如何选指标？'});
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const allocate=http.createServer();await new Promise(resolve=>allocate.listen(0,'127.0.0.1',resolve));
  const port=allocate.address().port;await new Promise(resolve=>allocate.close(resolve));
  const env={...process.env,INTERVIEW_DATA_DIR:join(temp,'data'),PORT:String(port),AI_API_KEY:'fake-test-key',AI_MODEL:'test',AI_BASE_URL:`http://127.0.0.1:${mock.address().port}`};
  delete env.TAVILY_API_KEY;
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
  let stdout='', stderr=''; child.stdout.on('data',c=>stdout+=c); child.stderr.on('data',c=>stderr+=c);
  try {
    const deadline=Date.now()+10000;
    while(!stdout.includes('面试工作台已就绪')) {
      if(child.exitCode!==null) throw Error(`server exited: ${stderr}`);
      if(Date.now()>deadline) throw Error(`server did not start: ${stderr}`);
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    const fetchWorkbench=workbenchClient(stdout);
    const base=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/export',{headers:{'x-offerpilot-access':'invalid'}})).status,401);
    assert.equal((await fetch(base+'/api/draft',{method:'PUT',headers:{'content-type':'application/json'},body:'{}'})).status,401);
    for (const path of ['/.env','/data/interview.sqlite','/.git/config','/server.js']) assert.equal((await fetchWorkbench(base+path)).status,404);
    // The process runs from a temporary data directory; assets must still resolve
    // from the application directory, including modules imported by the page.
    for (const [path, contentType] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/ui/toast.js', 'text/javascript'], ['/ui/source-extraction.js', 'text/javascript'], ['/style.css', 'text/css']]) {
      const asset = await fetchWorkbench(base + path);
      assert.equal(asset.status, 200, path);
      assert.match(asset.headers.get('content-type'), new RegExp(contentType), path);
      assert.equal(asset.headers.get('cache-control'),'no-store');
      assert.equal(asset.headers.get('referrer-policy'),'no-referrer');
      assert.match(asset.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    }
    const post=(path,data,extra={})=>fetchWorkbench(base+path,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(data)});
    const denied=await post('/api/role',{role:'恶意修改'},{origin:'https://evil.example'});
    // A missing allowlisted ES module prevents the whole UI from starting.
    const modules = new Set(['/app.js']);
    for (const path of modules) {
      const response = await fetchWorkbench(base+path);
      assert.equal(response.status,200,`UI module must be served: ${path}`);
      assert.match(response.headers.get('content-type'),/text\/javascript/);
      for (const match of (await response.text()).matchAll(/\bimport\s+[^;]*?\s+from\s+['"]([^'"]+)['"]/g)) {
        const dependency = new URL(match[1],base+path);
        assert.equal(dependency.origin,base,'UI imports stay local');
        modules.add(dependency.pathname);
      }
    }
    assert.equal(denied.status,403);
    const wrongType=await fetchWorkbench(base+'/api/role',{method:'POST',headers:{'content-type':'text/plain'},body:'{"role":"恶意修改"}'});
    assert.equal(wrongType.status,403);
    assert.equal((await (await fetchWorkbench(base+'/api/state')).json()).role,'');
    assert.equal((await post('/api/role',{role:'产品经理'})).status,200);
    const valid=await post('/api/jd/parse',{jd:'岗位职责：负责数据分析'});
    assert.equal((await valid.json()).requirements,'• 负责数据分析');
    const invalid=await post('/api/jd/parse',{jd:'随便输入'});
    assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/未从内容/);
    const tooLongTitle=await post('/api/sources',{title:'长'.repeat(1001),url:'https://example.com',role:'产品经理'});
    assert.equal(tooLongTitle.status,400);
    assert.match((await tooLongTitle.json()).error,/标题不能超过 1000/);
    const source=await (await post('/api/sources',{title:'测试来源',url:'https://example.com',role:'产品经理',question:'如何做数据分析？'})).json();
    assert.ok(source.id);
    const sourceQuestion=(await (await fetchWorkbench(base+'/api/state')).json()).sources.find(s=>s.id===source.id).questions[0];
    const question_ref={kind:'source',id:sourceQuestion.id};
    const requirements='要求'.repeat(1600)+'要求末尾';
    assert.equal((await post('/api/jd',{role:'产品经理',jd:'岗位描述',confirmed_requirements:requirements})).status,200);
    const attemptsBeforeHelp=(await (await fetchWorkbench(base+'/api/state')).json()).attempts.length;
    for (const mode of ['hint','breakdown','approach']) {
      const help=await post('/api/practice/help',{role:'产品经理',question:'如何评估产品？',mode,answer:'不应发送的回答'});
      assert.equal(help.status,200);
      assert.equal((await help.json()).guidance,'先明确业务目标，再考虑衡量方式。');
      const request=modelRequests.at(-1);
      assert.match(request.messages.at(-1).content,/如何评估产品/);
      assert.ok(request.messages.at(-1).content.includes(requirements));
      assert.doesNotMatch(JSON.stringify(request),/不应发送的回答/);
    }
    assert.equal((await (await fetchWorkbench(base+'/api/state')).json()).attempts.length,attemptsBeforeHelp);
    const beforeInvalidHelp=modelRequests.length;
    assert.equal((await post('/api/practice/help',{role:'产品经理',question:'题目',mode:'invalid'})).status,400);
    assert.equal((await post('/api/practice/help',{role:'产品经理',question:'题'.repeat(2001),mode:'hint'})).status,400);
    assert.equal(modelRequests.length,beforeInvalidHelp);
    const malformedHelp=await post('/api/practice/help',{role:'产品经理',question:'__bad_help__',mode:'hint'});
    assert.equal(malformedHelp.status,400);
    assert.match((await malformedHelp.json()).error,/AI 帮助格式无效/);
    assert.equal((await (await fetchWorkbench(base+'/api/state')).json()).attempts.length,attemptsBeforeHelp);
    const maxQuestion='问'.repeat(1999)+'尾', maxAnswer='答'.repeat(9999)+'尾';
    const fullReview=await post('/api/review',{role:'产品经理',question:maxQuestion,answer:maxAnswer});
    assert.equal(fullReview.status,200);
    const prompt=modelRequests.at(-1).messages.at(-1).content;
    assert.ok(prompt.includes(`用户确认的岗位要求：${requirements}\n`));
    assert.ok(prompt.includes(`本轮问题：${maxQuestion}\n`));
    assert.ok(prompt.endsWith(`本轮回答：${maxAnswer}`));
    const beforeOversize=modelRequests.length;
    const longQuestion=await post('/api/review',{role:'产品经理',question:'问'.repeat(2001),answer:'回答'});
    assert.equal(longQuestion.status,400);
    assert.match((await longQuestion.json()).error,/问题不能超过 2000/);
    const longAnswer=await post('/api/review',{role:'产品经理',question:'问题',answer:'答'.repeat(10001)});
    assert.equal(longAnswer.status,400);
    assert.match((await longAnswer.json()).error,/回答不能超过 10000/);
    assert.equal(modelRequests.length,beforeOversize);
    const review=await (await post('/api/review',{role:'产品经理',question:'如何做数据分析？',answer:'先确定业务目标',question_ref})).json();
    assert.equal(review.feedback,'已记录点评和追问');
    assert.equal(review.follow_up,'具体如何选指标？');
    const linkedDraft=await fetchWorkbench(base+'/api/draft',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({role:'产品经理',question:'如何做数据分析？',answer:'草稿',question_ref})});
    assert.equal(linkedDraft.status,200);
    assert.deepEqual((await (await fetchWorkbench(base+'/api/state')).json()).draft.question_ref,question_ref);
    assert.equal((await post('/api/review',{role:'其他岗位',question:'如何做数据分析？',answer:'回答',question_ref})).status,400);
    assert.equal((await post('/api/review',{role:'产品经理',question:'手工修改',answer:'回答',question_ref})).status,400);
    const saveFollowupDraft=await fetchWorkbench(base+'/api/draft',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({role:'产品经理',question:review.follow_up,answer:'草稿',parent_attempt_id:review.id})});
    assert.equal(saveFollowupDraft.status,200);
    assert.equal((await (await fetchWorkbench(base+'/api/state')).json()).draft.parent_attempt_id,review.id);
    const followup=await post('/api/review',{role:'产品经理',question:review.follow_up,answer:'结合业务目标',parent_attempt_id:review.id});
    assert.equal(followup.status,200);
    assert.equal((await post('/api/review',{role:'其他岗位',question:review.follow_up,answer:'回答',parent_attempt_id:review.id})).status,400);
    assert.equal((await post('/api/review',{role:'产品经理',question:'错误的追问',answer:'回答',parent_attempt_id:review.id})).status,400);
    for (const fixture of reviewCases) {
      const response=await post('/api/review',{role:fixture.role,question:fixture.question,answer:fixture.answer});
      assert.equal(response.status,200,fixture.id);
      const actual=await response.json();
      assert.equal(actual.feedback,fixture.mock_response.feedback,fixture.id);
      assert.equal(actual.follow_up,fixture.mock_response.follow_up,fixture.id);
    }
    const beforeInvalid=(await (await fetchWorkbench(base+'/api/state')).json()).attempts.length;
    const badReview=await post('/api/review',{role:'产品经理',question:'测试问题',answer:'__malformed_model_response__'});
    assert.equal(badReview.status,400);
    assert.equal((await (await fetchWorkbench(base+'/api/state')).json()).attempts.length,beforeInvalid);
    const assessment=await fetchWorkbench(base+`/api/attempts/${review.id}/assessment`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({rating:'revisit'})});
    assert.equal(assessment.status,200);
    const recommendation=await (await post('/api/recommendation',{role:'产品经理'})).json();
    assert.equal(recommendation.question.reason,'你标记为需要再练');
    const backup=await (await fetchWorkbench(base+'/api/export')).json();
    assert.equal((await post('/api/import',{mode:'preview',data:backup})).status,200);
    backup.attempts.push({id:'legacy-long',question:'问'.repeat(2001),answer:'回答',feedback:'旧点评',role:'产品经理',created:'2026-01-01'});
    backup.attempt_details.push({attempt_id:'legacy-long',follow_up:'继续？',parent_attempt_id:''});
    backup.attempt_question_links.push({attempt_id:'legacy-long',kind:'none',question_id:''});
    assert.equal((await post('/api/import',{mode:'merge',data:backup})).status,200);
    const beforeLegacyFollowUp=modelRequests.length;
    const legacyFollowUp=await post('/api/review',{role:'产品经理',question:'继续？',answer:'回答',parent_attempt_id:'legacy-long'});
    assert.equal(legacyFollowUp.status,400);
    assert.match((await legacyFollowUp.json()).error,/上一轮问题或回答超过/);
    assert.equal(modelRequests.length,beforeLegacyFollowUp);
    assert.equal((await post('/api/import',{mode:'merge',data:{version:99}})).status,400);
    assert.equal((await (await fetchWorkbench(base+'/api/state')).json()).role,'产品经理');
  } finally {
    if(child.exitCode===null) { child.kill(); await once(child,'exit').catch(()=>{}); }
    await new Promise(resolve=>mock.close(resolve));
    await rm(temp,{recursive:true,force:true});
  }
});
