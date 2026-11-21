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
import { createFastApiRetrieval } from '../src/fastapi-retrieval.js';
import { parsePilotUrls, verifyPilotCandidates } from '../src/research/pilot.js';
import { evidenceScopeCases, evidenceScopeInput } from './fixtures/research-evidence-scope.mjs';
import { pilotPost, pilotReplayCases, pilotReplayOptions } from './fixtures/research-pilot.mjs';

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
  assert.deepEqual(result,{url:post(1),date:'2026-08-01',text:'面试题 & 依据',headings:[],truncated:false});
  await assert.rejects(readArticle(post(1),controller.signal,async()=>new Response('登录后查看',{headers:{'content-type':'text/html'}})),/source_unavailable/);
  const clipped=await readArticle(post(1),controller.signal,async()=>new Response(
    '<div id="cnblogs_post_body"><p>'+'🙂'.repeat(6001)+'</p><h2>后续段落</h2></div>',{headers:{'content-type':'text/html'}}));
  assert.equal(Array.from(clipped.text).length,6000);
  assert.equal(clipped.truncated,true);
  assert.deepEqual(clipped.headings,[]);
});

test('NowCoder reader binds article ID and creation date and excludes response metadata',async()=>{
  const url='https://www.nowcoder.com/discuss/951967934602096640';
  assert.equal(articleUrl(url+'?source=search'),url);
  assert.equal(articleUrl(url.replace('www.','m.')),url);
  for (const invalid of [url.replace('www.nowcoder.com','evil.test'),
    'https://www.nowcoder.com/discuss/experience','https://www.nowcoder.com/feed/main/detail/abc']) {
    assert.equal(articleUrl(invalid),null);
  }
  const data={id:'951967934602096640',title:'后端开发一面',createTime:Date.parse('2026-11-15T12:00:00Z'),
    richText:'<h2>一面</h2><p>面试官问：Redis 怎么过期？</p><script>无关脚本</script>',
    quickReviews:[{text:'评论中的错误证据'}]};
  const fetcher=async endpoint=>{
    assert.equal(endpoint,'https://gw-c.nowcoder.com/api/sparta/detail/content-data/detail/951967934602096640');
    return Response.json({success:true,data});
  };
  const body=await readArticle(url,controller.signal,fetcher);
  assert.equal(body.title,'后端开发一面');
  assert.equal(body.date,'2026-11-15');
  assert.match(body.text,/Redis 怎么过期/);
  assert.doesNotMatch(body.text,/评论|脚本/);
  for (const patched of [{id:'other'},{richText:'',content:''},{title:null}]) {
    await assert.rejects(readArticle(url,controller.signal,async()=>Response.json({success:true,data:{...data,...patched}})),/source_unavailable/);
  }
});

test('NowCoder search goes through the existing evidence confirmation and reuses the saved question on retry',async()=>{
  const db=database(), id='951967934602096640', url='https://www.nowcoder.com/discuss/'+id;
  const text='面试官问：React 状态何时更新？';
  const research=createResearch({keys:{Tavily:'fake'},clock:now,
    fetcher:async endpoint=>endpoint.includes('tavily') ?
      Response.json({results:[{url,title:'示例前端开发一面面经',published_date:'2026-08-01'}]}) :
      Response.json({success:true,data:{id,title:'示例前端开发一面面经',createTime:Date.parse('2026-08-01'),richText:'<p>'+text+'</p>'}}),
    extract:async()=>({content:JSON.stringify({items:[{question:'React 状态何时更新？',evidence:text}]})})
  });
  try {
    saveValidatedRole(db,terms.role,'confirmed');
    const call=createAgentWorkflow({db,currentRole:()=>terms.role,research});
    const {body}=await call('/api/research',{...terms,source:'nowcoder',topics:['React'],confirm:true},controller.signal);
    assert.equal(body.usage.read,1);
    assert.equal(body.candidates.length,1);
    assert.equal(exportData(db).sources.length,0);
    const confirmation={role:terms.role,id:body.candidates[0].id,self_reported:true};
    const first=await call('/api/research/confirm',confirmation,controller.signal);
    assert.equal((await call('/api/research/confirm',confirmation,controller.signal)).body.id,first.body.id);
    assert.equal(exportData(db).sources[0].questions[0].evidence,text);
  } finally {db.close();}
});

test('extensionless numeric blog articles use the same body reader without accepting indexes or other hosts',async()=>{
  const url='https://www.cnblogs.com/autodriver/p/19922776';
  assert.equal(articleUrl(url+'?source=search'),url);
  for (const invalid of ['https://www.cnblogs.com/u/p/archive/2026/04/24',
    'https://www.cnblogs.com/u/tag/面经','https://www.cnblogs.com.evil.test/u/p/19922776',
    'https://www.cnblogs.com/u/p/abc']) assert.equal(articleUrl(invalid),null);
  const article=await readArticle(url,controller.signal,async target=>{
    assert.equal(target,url);
    return new Response('<span id="post-date">2026-08-01 12:00</span><div id="cnblogs_post_body"><p>面试官问：React 怎么更新？</p></div>',
      {headers:{'content-type':'text/html'}});
  });
  assert.equal(article.text,'面试官问：React 怎么更新？');
  assert.equal(article.date,'2026-08-01');
});

test('new URL layouts supplement the established article queue without displacing it',async()=>{
  const old=post(90), modern='https://www.cnblogs.com/example/p/19922776', reads=[];
  const runner=createResearch({keys:{Tavily:'fake'},clock:now,
    fetcher:async()=>Response.json({results:[modern,old].map(url=>({url,title:'示例前端开发一面面经'}))}),
    read:async url=>{reads.push(url);return {url,date:'2026-08-01',text:'面试官问：React 怎么更新？'};},
    extract:async()=>({content:JSON.stringify({items:[{question:'React 怎么更新？',evidence:'面试官问：React 怎么更新？'}]})})
  });
  assert.equal((await runner.run({...terms,range:'all',topics:['React']})).candidates.length,1);
  assert.deepEqual(reads,[old]);
});

test('a supported article with an absent search date is read once and its body date controls acceptance',async()=>{
  let reads=0;
  const runner=createResearch({keys:{Tavily:'fake'},clock:now,
    fetcher:async()=>Response.json({results:[{url:post(88),title:'示例前端开发一面面经'}]}),
    read:async()=>{reads++;return {url:post(88),date:'2026-08-01',text:'面试官问：React 怎么更新？'};},
    extract:async()=>({content:JSON.stringify({items:[{question:'React 怎么更新？',evidence:'面试官问：React 怎么更新？'}]})})
  });
  const result=await runner.run({...terms,topics:['React']});
  assert.equal(reads,1);
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].date,'2026-08-01');
  for (const date of ['', '2020-01-01', '2099-01-01']) {
    const rejected=createResearch({keys:{Tavily:'fake'},clock:now,
      fetcher:async()=>Response.json({results:[{url:post(89),title:'示例前端开发一面面经'}]}),
      read:async()=>({url:post(89),date,text:'面试官问：React 怎么更新？'}),
      extract:async()=>{throw Error('An unverified date must stop before extraction');}
    });
    const checked=await rejected.run({...terms,topics:['React']});
    assert.equal(checked.usage.read,1);
    assert.equal(checked.usage.model,0);
    assert.equal(checked.candidates.length,0);
  }
});

test('pilot replays the same results, locates every accepted quote and rejects cross-section company claims',async()=>{
  assert.throws(()=>parsePilotUrls('https://example.test/p/a.html'),/博客园/);
  for (const sample of pilotReplayCases) {
    const options=pilotReplayOptions(sample);
    const baseline=await createResearch(options).run(sample.task);
    const pilotUrls=parsePilotUrls(Object.keys(sample.pages).join(','));
    const trial=await createResearch({...options,pilotUrls}).run(sample.task);
    assert.equal(baseline.candidates.length,0,sample.name);
    assert.deepEqual(trial.candidates.map(item=>item.evidence),sample.accepted,sample.name);
    for (const item of trial.candidates) {
      const body=await readArticle(item.url,controller.signal,options.fetcher);
      const {start,end,paragraph}=item.evidence_location;
      assert.equal(body.text.slice(start,end),item.evidence);
      assert.equal(paragraph,2);
      assert.equal(item.company,'远帆科技');
      assert.equal(item.date,'2026-09-15');
      assert.equal(item.question,'React 状态何时更新？');
      assert.equal(trial.links.length,1);
      assert.equal(trial.links[0].model_source_chars,Array.from(body.text).length);
    }
    if (sample.name==='日期未核对') assert.equal(trial.links[0].status,'date_unverified');
    if (sample.name==='正文缺失或读取超时') assert.ok(trial.links.every(item=>item.status==='read_failed'));
    if (sample.name==='整理内容及未授权链接') {
      assert.equal(trial.usage.read,0);
      assert.equal(trial.links.find(item=>item.url===pilotPost(6)).status,'manual');
    }
  }
});

test('pilot links only explicitly scoped evidence across interview paragraphs and rounds',async()=>{
  const mistakes=[];
  for (const sample of evidenceScopeCases) {
    const {html,task,item}=evidenceScopeInput(sample);
    const body=await readArticle(post(1),controller.signal,
      async()=>new Response(html,{headers:{'content-type':'text/html'}}));
    const result=verifyPilotCandidates(JSON.stringify({items:[item]}),body,task);
    if (result.length!==Number(sample.expected)) mistakes.push(sample.name);
    if (result.length) assert.equal(body.text.slice(result[0].evidence_location.start,result[0].evidence_location.end),item.evidence);
    if (result.length && sample.title) assert.equal(result[0].role_evidence_basis,'article_title');
  }
  assert.deepEqual(mistakes,[]);
});

test('pilot requires affirmative firsthand company attribution in the article',async()=>{
  const {task}=pilotReplayCases[0];
  const url=pilotPost(10), question='面试官问：React 状态何时更新？';
  const cases=[
    ['explicit denial','',`我面试的是青帆科技的前端开发，不是远帆科技。 ${question}`,'不是远帆科技',false],
    ['denial cropped by the model','',`我没有在远帆科技参加前端开发面试。 ${question}`,'远帆科技',false],
    ['denial contradicts an affirmative heading','远帆科技 前端开发一面',question,'远帆科技',false,'更正：我面试的公司不是远帆科技。'],
    ['comparison heading','远帆科技与青帆科技的前端开发一面比较',question,'远帆科技',false],
    ['multiple companies share one heading','远帆科技 前端开发一面，青帆科技 前端开发二面',question,'远帆科技',false],
    ['name mentioned in a question','前端开发一面','面试官问：远帆科技的 React 应用和我们有什么区别？','远帆科技',false],
    ['uncertain attribution','疑似远帆科技 前端开发一面',question,'远帆科技',false],
    ['third-party interview','远帆科技 前端开发一面',question,'远帆科技',false,'本文转载自同学分享的面经。'],
    ['outside-body comment','前端开发一面',question,'远帆科技',false,'','远帆科技 前端开发一面'],
    ['affirmative heading','远帆科技 前端开发一面',question,'远帆科技',true],
    ['affirmative statement','',`我在远帆科技参加了前端开发一面。 ${question}`,'远帆科技',true]
  ];
  for (const [label,heading,paragraph,companyEvidence,expected,intro='',comment=''] of cases) {
    const evidence=label==='name mentioned in a question'?paragraph:question;
    const sample={rows:[{title:'前端开发面经',url,published_date:'2026-08-01'}],pages:{[url]:
      `<meta property="article:published_time" content="2026-08-01"><div id="cnblogs_post_body">`+
      `${intro?`<p>${intro}</p>`:''}${heading?`<h2>${heading}</h2>`:''}<p>${paragraph}</p></div><div id="comment_form">${comment}</div>`},
      items:[{evidence,report_evidence:evidence,company_evidence:companyEvidence,role_evidence:'前端开发'}]};
    const result=await createResearch({...pilotReplayOptions(sample),pilotUrls:new Set([url])}).run(task);
    assert.equal(result.usage.read,1,label);
    assert.equal(result.candidates.length,Number(expected),label);
    if (expected) assert.equal(result.candidates[0].company,task.company,label);
  }
  const sample=pilotReplayCases[0];
  const unscoped=await createResearch({...pilotReplayOptions(sample),pilotUrls:new Set(Object.keys(sample.pages))})
    .run({...task,company:''});
  assert.ok(unscoped.candidates.some(item=>item.evidence===sample.accepted[0] && item.company===null));
});

test('deep research passes only retrieval scope through FastAPI and does not resend failed queries directly',async()=>{
  const controller=new AbortController();
  const requests=[];
  const retrieve=createFastApiRetrieval('http://127.0.0.1:8091','a'.repeat(64),async (url,options)=>{
    assert.equal(url.href,'http://127.0.0.1:8091/v1/retrieve');
    requests.push(JSON.parse(options.body));
    assert.equal(options.signal.aborted,false);
    return new Response('',{status:502});
  });
  const runner=createResearch({keys:{Tavily:'present'},retrieve,clock:now,
    fetcher:async()=>assert.fail('failed Python searches must not fall back to direct requests')});
  const result=await runner.run({...terms,topics:['React']},{signal:controller.signal});
  assert.equal(result.engine,'fastapi');
  assert.equal(result.stop,'search_unavailable');
  assert.deepEqual(requests,['面经','面试经历'].map(phrase=>({
    provider:'Tavily',role:terms.role,company:terms.company,domains:['cnblogs.com'],
    phrase,topic:'React',from_date:'2025-11-13',through_date:'2026-11-13'
  })));
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

test('pilot cancellation writes nothing and confirmed evidence survives a backup restore',async()=>{
  const fixture=pilotReplayCases[0], {task}=fixture;
  const options={...pilotReplayOptions(fixture),pilotUrls:new Set(Object.keys(fixture.pages))};
  const db=database(), copy=database(), abort=new AbortController();
  const verified=createResearch(options);
  const workflow=research=>createAgentWorkflow({db,currentRole:()=>task.role,research});
  try {
    saveValidatedRole(db,task.role,'confirmed');
    const cancelled=workflow(createResearch({...options,extract:async payload=>{
      abort.abort();
      return options.extract(payload);
    }}));
    await assert.rejects(cancelled('/api/research',{...task,confirm:true},abort.signal),{name:'AbortError'});
    assert.equal(exportData(db).sources.length,0);
    const call=workflow(verified);
    const {body:{candidates:[candidate]}}=await call('/api/research',{...task,confirm:true},controller.signal);
    assert.equal(exportData(db).sources.length,0);
    const confirmation={role:task.role,id:candidate.id,self_reported:true};
    const saved=await call('/api/research/confirm',confirmation,controller.signal);
    assert.equal((await call('/api/research/confirm',confirmation,controller.signal)).body.id,saved.body.id);
    importData(copy,exportData(db),true);
    const [source]=exportData(copy).sources;
    assert.equal(source.questions.length,1);
    assert.equal(source.questions[0].evidence,candidate.evidence);
  } finally {db.close();copy.close();}
});

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
