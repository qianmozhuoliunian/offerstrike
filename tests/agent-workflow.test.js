import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createResearch, parseCostBudget } from '../src/research/index.js';
import { articleUrl,readArticle } from '../src/research/read-source.js';
import { createAgentWorkflow } from '../src/agent-workflow.js';
import { initializeQuestions,setQuestionTopic } from '../src/questions.js';
import { initializeWorkspace,saveProfile,exportData,setAssessment } from '../src/workspace.js';
import { saveValidatedRole } from '../src/role-validation.js';
import { importData } from '../src/import-data.js';
import { resumeAbilities } from '../src/career.js';

const now=()=>Date.parse('2026-11-13');
const post=n=>`https://www.cnblogs.com/example/p/${n}.html`;
const terms={role:'前端开发',company:'示例',source:'cnblogs',range:'year',topics:['React','TypeScript']};
const controller=new AbortController();
function fixture() {
  const queries=[],reads=[];
  const search=createResearch({keys:{Tavily:'fake',Exa:'fake'},clock:now,
    fetcher:async (url,opts)=>{
      const {query}=JSON.parse(opts.body);
      queries.push({url,query});
      if (url.includes('tavily') && query.includes('React')) return new Response('',{status:503});
      const second=query.includes('TypeScript');
      return Response.json({results:[
        {title:'示例前端开发一面面经',url:post(second?2:1),published_date:'2026-08-01',publishedDate:'2026-08-01'},
        {title:'别家前端开发一面面经',url:post(3),published_date:'2026-08-01',publishedDate:'2026-08-01'}
      ]});
    },
    read:async url=>{
      reads.push(url);
      return {url,date:'2026-08-01',text:url===post(1)?'面试官问：React 的状态何时更新？':'面试官问：TypeScript 的类型如何收窄？'};
    },
    extract:async ({instructions,payload,maxTokens})=>{
      assert.match(instructions,/source-verification/);
      assert.equal(maxTokens,800);
      const {article}=JSON.parse(payload);
      return {content:JSON.stringify({items:[
        {question:article.split('：')[1],evidence:article},{question:'没有依据的题',evidence:'搜索摘要不可作为证据'}
      ]}),usage:{prompt_tokens:10,completion_tokens:5}};
    }
  });
  return {search,queries,reads};
}

test('research fails over, targets the missing topic, checks quotes and caches completed coverage',async()=>{
  const {search,queries,reads}=fixture();
  const run=await search.run(terms);
  assert.deepEqual(queries.map(item=>item.query),['前端开发 示例 React 面经','前端开发 示例 React 面经','前端开发 示例 TypeScript 面试经历']);
  assert.deepEqual(reads,[post(1),post(2)]);
  assert.deepEqual(run.candidates.map(item=>item.topic),['React','TypeScript']);
  assert.equal(run.stop,'covered');
  assert.equal(run.events[0].status,'failed');
  assert.equal(run.usage.outputTokens,10);
  assert.equal(run.usage.cost,null);
  const repeated=await search.run(terms);
  assert.equal(repeated.cached,true);
  assert.equal(repeated.usage.search,0);
  assert.equal(queries.length,3);
});

test('planning chooses only an approved uncovered topic, and invalid choices fall back to the rule', async()=>{
  for (const [choice,expected] of [['CSS','CSS'],['私人词','Vue']]) {
    const queries=[];
    const runner=createResearch({keys:{Tavily:'fake'},clock:now,
      fetcher:async (_,options)=>{
        const {query}=JSON.parse(options.body);
        queries.push(query);
        return Response.json({results:[{title:'示例前端开发一面面经',url:post(queries.length),published_date:'2026-08-01'}]});
      },
      read:async url=>({url,date:'2026-08-01',text:'面试官问：React 怎么更新？'}),
      extract:async ({instructions,payload})=>{
        if (instructions.includes('search-strategy')) {
          assert.deepEqual(JSON.parse(payload).remaining,['Vue','CSS']);
          return {content:JSON.stringify({topic:choice})};
        }
        return {content:JSON.stringify({items:[{question:'React 怎么更新？',evidence:'面试官问：React 怎么更新？'}]})};
      }
    });
    const result=await runner.run({...terms,topics:['React','Vue','CSS']});
    assert.match(queries[1],new RegExp(expected));
    assert.equal(result.usage.model,3);
    assert.deepEqual(result.missing_topics,['Vue','CSS']);
    assert.equal(result.usage.inputTokens,null);
  }
});

test('reader stays on supported public article URLs and extracts only the post body',async()=>{
  assert.equal(articleUrl('https://www.cnblogs.com@localhost/u/p/x.html'),null);
  assert.equal(articleUrl('https://www.cnblogs.com/u/p/x.html?track=1'),post(5).replace('/example/p/5','/u/p/x'));
  const result=await readArticle(post(1),controller.signal,async (url,opts)=>{
    assert.equal(url,post(1));assert.equal(opts.redirect,'error');
    return new Response('<span id="post-date">2026-08-01 12:00</span><nav>其他帖子</nav><div id="cnblogs_post_body"><p>面试题 &amp; 依据</p><script>无关内容</script></div>',
      {headers:{'content-type':'text/html'}});
  });
  assert.deepEqual(result,{url:post(1),date:'2026-08-01',text:'面试题 & 依据'});
  await assert.rejects(readArticle(post(1),controller.signal,async()=>new Response('登录后查看',{headers:{'content-type':'text/html'}})),/source_unavailable/);
});

test('research cost cap stops before starting a request that cannot be covered',async()=>{
  let calls=0;
  const runner=createResearch({keys:{Tavily:'fake',Exa:'fake'},clock:now,
    fetcher:async()=>{calls++;return new Response('',{status:503});},
    costBudget:parseCostBudget('{"limit":50,"Tavily":40,"Exa":40,"model":10}')});
  const result=await runner.run(terms);
  assert.equal(result.stop,'cost_budget');
  assert.equal(result.usage.reserved_cost_microusd,40);
  assert.equal(calls,1);
});

function database() {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,question TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE attempts (id TEXT PRIMARY KEY,question TEXT NOT NULL,answer TEXT NOT NULL,feedback TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);`);
  initializeQuestions(db);initializeWorkspace(db);
  return db;
}

test('candidate confirmation is explicit, role-bound and repeatable; backup and self-assessment retain their meaning',async()=>{
  const db=database(), copy=database(), {search}=fixture();
  const role=terms.role, call=createAgentWorkflow({db,currentRole:()=>role,research:search});
  const submit=(path,data)=>call(path,{...data,role},controller.signal);
  try {
    saveValidatedRole(db,role,'confirmed');
    await assert.rejects(submit('/api/research',{...terms,confirm:false}),/确认/);
    const {body:{candidates}}=await submit('/api/research',{...terms,confirm:true});
    assert.equal(exportData(db).sources.length,0);
    await assert.rejects(call('/api/research/confirm',{role:'产品经理',id:candidates[0].id},controller.signal),/岗位/);
    const first=await submit('/api/research/confirm',{id:candidates[0].id,self_reported:true});
    const second=await submit('/api/research/confirm',{id:candidates[1].id});
    assert.equal((await submit('/api/research/confirm',{id:candidates[0].id})).status,200);
    assert.equal(exportData(db).sources[0].questions.length,1);
    importData(copy,exportData(db),true);
    assert.equal(exportData(copy).sources.find(s=>s.url===post(1)).questions[0].evidence,candidates[0].evidence);

    saveProfile(db,role,'公开 JD','React\nTypeScript');
    setQuestionTopic(db,'source',first.body.id,'React',first.body.source_id);
    db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run('try',candidates[0].question,'回答','点评',role,'2026-01-01T00:00:00Z');
    db.prepare('INSERT INTO attempt_question_links VALUES (?,?,?)').run('try','source',first.body.id);
    setAssessment(db,'try','revisit');
    const plan=()=>submit('/api/career/plan',{topics:[]});
    assert.equal((await plan()).body.tasks[0].topic,'React');
    setAssessment(db,'try','comfortable');
    assert.equal((await plan()).body.tasks[0].topic,'TypeScript');
    assert.equal((await submit('/api/career/plan',{mode:'mock',completed:[first.body.id]})).body.tasks[0].question.question_ref.id,second.body.id);
  } finally {db.close();copy.close();}
});

test('resume compares literal evidence with confirmed requirements without treating missing evidence as a skill gap',async()=>{
  const source='用 React 构建了个人项目';
  const result=await resumeAbilities(source,async ({payload})=>{
    assert.equal(payload,source);
    return {content:JSON.stringify({status:'ok',items:[
      {requirement:'React',evidence:source},{requirement:'SQL',evidence:'虚构的 SQL 工作经历'}
    ]})};
  },controller.signal,'React\nSQL');
  assert.equal(result.abilities.length,1);
  assert.deepEqual(result.comparison,[{topic:'React',match:'literal_match'},{topic:'SQL',match:'unconfirmed'}]);
});
