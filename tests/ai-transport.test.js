import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAiTransport, validateAiBase} from '../src/ai-transport.js';

test('AI transport accepts HTTPS and loopback, and never follows a provider redirect', async () => {
  for (const address of ['http://example.com/v1','https://user:password@example.com','https://example.com/v1?token=ignored','https://example.com/v1#fragment','file:///example']) {
    assert.throws(()=>validateAiBase(address),/AI 服务地址/);
  }
  assert.equal(validateAiBase('http://127.0.0.1:9000/v1/'),'http://127.0.0.1:9000/v1');
  const request=createAiTransport({key:'sample-key',model:'sample',baseUrl:'https://api.deepseek.com/v1/',fetcher:async (url,options)=>{
    assert.equal(url,'https://api.deepseek.com/v1/chat/completions');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.authorization,'Bearer sample-key');
    assert.deepEqual(JSON.parse(options.body),{messages:[],thinking:{type:'disabled'},model:'sample'});
    return new Response(null,{status:307,headers:{Location:'https://example.com'}});
  }});
  assert.equal((await request({messages:[]})).ok,false);
});
