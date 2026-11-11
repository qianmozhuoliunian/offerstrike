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
    cwd:temp, env:{...process.env, PORT:String(port), TAVILY_API_KEY:'test-key'}, stdio:['ignore','pipe','pipe']
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
    const irrelevant = await search({role:'科比',source:'all',range:'all'});
    assert.equal(irrelevant.results.length,0);
    assert.equal(irrelevant.unverified_results.length,3);
    assert.match(irrelevant.notice,/初筛.*仍需核实/);

    const current = await search({role:'产品经理',source:'all',range:'year'});
    assert.deepEqual(current.results.map(item=>item.title),['产品实习面经']);
    assert.deepEqual(current.unverified_results.map(item=>item.title),['产品经理职业发展建议']);
    assert.match(current.notice,/日期未知/);

    const nowcoder = await search({role:'产品经理',source:'nowcoder',range:'all'});
    assert.equal(nowcoder.unverified_results.length,0);
    assert.equal(nowcoder.results.length,3);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child,'exit').catch(()=>{}); }
    await rm(temp,{recursive:true,force:true});
  }
});
