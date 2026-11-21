import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountAgentWorkflow } from '../public/ui/agent-workflow.js';

test('Career updates evidence and training choices on save without starting a question or searching',async()=>{
  function element(tag) {
    return {tag,hidden:false,value:'',children:[],events:{},textContent:'',
      append(child){this.children.push(child);},replaceChildren(){this.children=[];},focus(){},scrollIntoView(){},
      addEventListener(type,callback){this.events[type]=callback;}};
  }
  const nodes=new Map(), requests=[], selections=[], tabs=[];
  const byId=id=>{
    if (!nodes.has(id)) nodes.set(id,element(id));
    return nodes.get(id);
  };
  const descendants=root=>[root,...(root.children || []).flatMap(descendants)];
  const choose=text=>descendants(byId('career-tasks')).find(node=>node.tag==='button' && node.textContent===text);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const question={text:'SQL 原题',question_ref:{id:'sql',kind:'source'}};
  const followup={question:'如何验证 RAG 的准确率？',parent_attempt_id:'rag-attempt'};
  const evidence={question:'哪些因素影响 RAG 准确率？',evidence:'越多越准确',kind:'incorrect',created:'2026-11-16T00:00:00Z'};
  globalThis.document={getElementById:byId,createElement:element,createTextNode:value=>value};
  try {
    let reviewed=false;
    const workflow=mountAgentWorkflow({context:()=>({role:'AI 应用开发',revision:0}),
      openTab:tab=>tabs.push(tab),startQuestion:item=>{selections.push(item);return true;},
      continueQuestion:async item=>{selections.push(item);return true;},
      api:async(path,method,input)=>{
        requests.push({path,input});
        if (path==='/api/training/tasks/create') return {task:{id:'task-1',status:'proposed',
          research_request:{role:'AI 应用开发',topics:['数据清洗'],focus:''}}};
        if (path.startsWith('/api/training/tasks?')) return {tasks:[]};
        return {tasks:reviewed?[
          {action:'followup',topic:'RAG',reason:'出现错误',point:'召回质量',evidence:[evidence],followup},
          {action:'research',topic:'数据清洗',reason:'题库缺题',evidence:[],research_request:{role:'AI 应用开发',topics:['数据清洗']}}
        ]:[{action:'practice',topic:'SQL',reason:'尚未练习',question,evidence:[]}]};
      }});
    byId('career-form').events.submit({preventDefault(){}});
    await tick();
    assert.ok(choose('开始这题'));
    reviewed=true;
    workflow.answered({kind:'source',id:'rag'},'rag-attempt');
    await tick();
    const rendered=descendants(byId('career-tasks'));
    assert.ok(rendered.some(node=>node.textContent==='召回质量'));
    assert.ok(rendered.some(node=>node.textContent==='越多越准确'));
    assert.deepEqual(selections,[]);
    await choose('继续这道追问').events.click();
    assert.deepEqual(selections,[followup]);
    await choose('去补搜').events.click();
    assert.equal(byId('research-topics').value,'数据清洗');
    assert.equal(byId('research-topics').readOnly,true);
    assert.deepEqual(tabs,['search']);
    assert.deepEqual(requests.map(call=>call.path),['/api/career/plan','/api/career/plan',
      '/api/training/tasks/create','/api/training/tasks?role=AI+%E5%BA%94%E7%94%A8%E5%BC%80%E5%8F%91']);
  } finally { delete globalThis.document; }
});
