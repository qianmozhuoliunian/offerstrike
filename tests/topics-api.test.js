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

test('topic endpoints validate ownership and create question and topic atomically', async () => {
  const dir=await mkdtemp(join(tmpdir(),'interview-topic-'));
  const allocator=http.createServer(); await new Promise(resolve=>allocator.listen(0,'127.0.0.1',resolve));
  const port=allocator.address().port; await new Promise(resolve=>allocator.close(resolve));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{cwd:dir,env:{...process.env,INTERVIEW_DATA_DIR:join(dir,'data'),PORT:String(port),AI_API_KEY:'',AI_MODEL:''},stdio:['ignore','pipe','pipe']});
  let output='', errors=''; child.stdout.on('data',c=>output+=c); child.stderr.on('data',c=>errors+=c);
  try {
    const deadline=Date.now()+10000;
    while(!output.includes('面试工作台已就绪')) {
      if(child.exitCode!==null || Date.now()>deadline) throw Error(`服务未启动: ${errors}`);
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    const url=`http://127.0.0.1:${port}`;
    const fetchWorkbench=workbenchClient(output);
    const send=(path,method,data)=>fetchWorkbench(url+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const uncertain=await (await send('/api/role','POST',{role:'产品'})).json();
    assert.equal(uncertain.status,'needs_confirmation');
    assert.equal((await send('/api/role','POST',{role:'产品',confirmation_token:uncertain.confirmation_token})).status,200);
    const source=await (await send('/api/sources','POST',{title:'面经',url:'https://example.com',role:'产品'})).json();
    const path=`/api/sources/${source.id}/questions`;
    const invalid=await send(path,'POST',{text:'测试题',topic:'x'.repeat(101)});
    assert.equal(invalid.status,400);
    assert.equal((await (await fetchWorkbench(url+'/api/state')).json()).sources[0].questions.length,0);
    const created=await (await send(path,'POST',{text:'测试题',topic:'产品指标'})).json();
    assert.equal(created.topic,'产品指标');
    assert.equal((await send(`/api/sources/wrong/questions/${created.id}/topic`,'PUT',{topic:'不能保存'})).status,400);
    assert.equal((await send(`/api/sources/${source.id}/questions/${created.id}/topic`,'PUT',{topic:'用户研究'})).status,200);
    const debrief=await (await send('/api/debriefs','POST',{role:'产品',question:'如何增长？',include_in_library:true})).json();
    assert.equal((await send(`/api/debriefs/${debrief.id}/topic`,'PUT',{topic:'增长'})).status,200);
    const state=await (await fetchWorkbench(url+'/api/state')).json();
    assert.equal(state.sources[0].questions[0].topic,'用户研究');
    assert.equal(state.debriefs[0].topic,'增长');
  } finally {
    if(child.exitCode===null) { child.kill(); await once(child,'exit').catch(()=>{}); }
    await rm(dir,{recursive:true,force:true});
  }
});
