export const pilotPost = n => `https://www.cnblogs.com/example/p/${n}.html`;
const task = {role:'前端开发',company:'远帆科技',source:'cnblogs',range:'year',topics:['React']};
const heading = '远帆科技 前端开发一面';
const evidence = '面试官问：React 状态何时更新？';
const wrongCompany = '面试官问：React 路由如何匹配？';
const valid = {evidence,report_evidence:evidence,role_evidence:heading,company_evidence:heading};
const dated = '<meta property="article:published_time" content="2026-09-15T12:00:00+08:00">';
const wrap = (body, date='') => date+'<div id="cnblogs_post_body">'+body+'</div>';
const relevant = {title:'远帆科技前端开发一面面经',published_date:'2026-09-15'};
const replayDate = Date.parse('2026-11-16T00:00:00Z');

export const pilotReplayCases = [
  {name:'正文补足标题及日期',task,rows:[{title:'我的九月记录',url:pilotPost(1)},{title:'我的九月记录',url:pilotPost(1)+'?utm_source=foo'}],
    pages:{[pilotPost(1)]:wrap('<h2>'+heading+'</h2><p>'+evidence+'</p><h2>另一家公司 前端开发一面</h2><p>'+wrongCompany+'</p>',dated)},
    items:[{...valid,evidence:wrongCompany,report_evidence:wrongCompany},{...valid,evidence:'我的摘录不存在'},
      {...valid,question:'与原文无关的改写'},valid],
    accepted:[evidence]},
  {name:'日期未核对',task,rows:[{...relevant,url:pilotPost(2)}],
    pages:{[pilotPost(2)]:wrap('<p>'+heading+' '+evidence+'</p>')},items:[valid],accepted:[]},
  {name:'正文缺失或读取超时',task,rows:[{...relevant,url:pilotPost(3)},{...relevant,url:pilotPost(4)}],
    pages:{[pilotPost(3)]:'<h1>仅有标题</h1>',[pilotPost(4)]:null},items:[valid],accepted:[]},
  {name:'整理内容及未授权链接',task,rows:[{...relevant,title:'前端面试题整理合集',url:pilotPost(5)},{...relevant,url:pilotPost(6)}],
    pages:{[pilotPost(5)]:wrap('<p>整理当天看到的题目</p>',dated)},items:[],accepted:[]}
];

export function pilotReplayOptions(sample) {
  const started = performance.now();
  return {
    keys:{Tavily:'fixture'},clock:()=>replayDate+Math.floor(performance.now()-started),
    fetcher:async url=>{
      if (url==='https://api.tavily.com/search') return Response.json({results:sample.rows});
      if (sample.pages[url] === null) throw new DOMException('读取超时','TimeoutError');
      if (!(url in sample.pages)) throw Error('fixture_not_available');
      return new Response(sample.pages[url],{headers:{'content-type':'text/html'}});
    },
    extract:async ({instructions})=>({
      content:JSON.stringify({items:instructions.includes('report_evidence') ? sample.items :
        sample.items.map(item=>({question:item.evidence,evidence:item.evidence}))}),
      usage:{prompt_tokens:25,completion_tokens:10}
    })
  };
}
