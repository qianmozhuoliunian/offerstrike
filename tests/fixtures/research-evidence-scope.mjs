const question = '<p>面试官问：如何实现 HTTP 缓存？</p>';
const evidence = '面试官问：如何实现 HTTP 缓存？';
const fullScope = '远帆科技 后端开发面经';
const parent = `<h2>${fullScope}</h2>`;
const role = '后端开发', company = '远帆科技';

export const evidenceScopeCases = [
  {name:'本节题头', html:parent+question, expected:true},
  {name:'公司章节下的技术轮次', html:parent+'<h3>技术一面 (60min)</h3>'+question, expected:true},
  {name:'独立自述开头与题目分段', html:'<p>我在远帆科技参加了后端开发一面。</p>'+question,
    companyEvidence:'我在远帆科技参加了后端开发一面。', expected:true},
  {name:'网页题头补足岗位，正文核对公司', title:fullScope, html:'<h2>远帆科技</h2><h3>一面</h3>'+question,
    companyEvidence:company, expected:true},
  {name:'只用网页标题推测公司', title:fullScope, html:'<h2>一面</h2>'+question, expected:false},
  {name:'不可从另一公司章节继承', html:parent+'<h2>青帆科技 后端开发面经</h2><h3>一面</h3>'+question, expected:false},
  {name:'子标题明确命名其他公司', html:parent+'<h3>青帆科技 后端开发一面</h3>'+question, expected:false},
  {name:'轮次正文明确否定归属', html:parent+'<h3>一面</h3><p>更正，不是远帆科技。</p>'+question, expected:false},
  {name:'轮次另行声明公司', html:parent+'<h3>一面</h3><p>我面试的公司是青帆科技。</p>'+question, expected:false},
  {name:'公司章节内的纯文本分隔', html:parent+'<h3>一面</h3><p>青帆科技后端开发一面</p>'+question, expected:false},
  {name:'纯文本新章节阻断开头继承', html:'<p>我在远帆科技参加了后端开发一面。</p><p>青帆科技后端开发一面</p>'+question,
    companyEvidence:'我在远帆科技参加了后端开发一面。', expected:false},
  {name:'转载标记在上级章节', html:parent+'<p>本文转载自同学的面经。</p><h3>一面</h3>'+question, expected:false},
  {name:'题头明确列出多家公司', title:'远帆科技与青帆科技 后端开发面经', html:'<h2>远帆科技</h2><h3>一面</h3>'+question,
    companyEvidence:company, expected:false},
  {name:'在别轮报告的题目', html:parent+'<h3>一面</h3>'+question+'<h3>二面</h3><p>面试官问：如何解决跨域？</p>',
    reportEvidence:'面试官问：如何解决跨域？', expected:false}
];

export function evidenceScopeInput(sample) {
  return {
    html:`${sample.title?`<a id="cb_post_title_url">${sample.title}</a>`:''}<div id="cnblogs_post_body">${sample.html}</div>`,
    task:{role,company},
    item:{evidence, report_evidence:sample.reportEvidence ?? evidence, role_evidence:role,
      company_evidence:sample.companyEvidence ?? fullScope}
  };
}
