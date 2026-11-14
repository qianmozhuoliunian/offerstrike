import {recommendFromHistory} from './recommendation.js';

const role='前端开发', now=new Date('2026-11-14T08:00:00Z');
const candidates=[
  {role,text:'你了解 Webpack 的 loader 吗？',question_ref:{kind:'source',id:'webpack'},topic:'Webpack'},
  {role,text:'你的项目是怎样部署的？',question_ref:{kind:'source',id:'deploy'},topic:'项目经历'}
];
const panel=document.querySelector('#demo-panel');
const progress=[...document.querySelectorAll('.steps li')];
const initial=panel.innerHTML;
const assessment='<h2>为这次练习做个自评</h2><blockquote><strong>预置示例点评：</strong>可以先说明 loader 用于转换模块，再举出处理 CSS 或 TypeScript 的例子。这里没有分析你的输入。</blockquote><p>演示场景：一天后打开工作台。</p><div class="actions"><button data-rating="revisit" type="button">需要再练</button><button class="secondary" data-rating="comfortable" type="button">比较熟悉</button></div>';
function step(index,markup){
  panel.innerHTML=markup;
  progress.forEach((item,i)=>i===index?item.setAttribute('aria-current','step'):item.removeAttribute('aria-current'));
  panel.querySelector('h2').setAttribute('tabindex','-1');
  panel.querySelector('h2').focus();
}
document.querySelector('#desktop-download').hidden=!document.documentElement.hasAttribute('data-desktop-download');
panel.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button) return;
  if(button.id==='demo-start'){
    step(1,'<h2>用自己的话回答</h2><p>你了解 Webpack 的 loader 吗？</p><label for="demo-answer">你的练习回答（可选）</label><textarea id="demo-answer" maxlength="1000" autocomplete="off" spellcheck="false" placeholder="例如：先解释它的作用，再举一个场景。"></textarea><button id="demo-review" type="button">查看示例点评 →</button>');
  } else if(button.id==='demo-review'){
    step(1,assessment);
  } else if(button.dataset.rating){
    const rating=button.dataset.rating;
    const recommended=recommendFromHistory({role,candidates,now,attempts:[{id:'sample',role,refKind:'source',refId:'webpack',created:'2026-11-13T08:00:00Z',rating}]});
    step(2,'<h2>这是下次建议练的题</h2><h3 id="demo-next"></h3><p id="demo-reason"></p><div class="actions"><button class="secondary" id="demo-change" type="button">换个自评看看</button><button class="secondary" id="demo-reset" type="button">从头体验</button></div>');
    panel.querySelector('#demo-next').textContent=recommended.text;
    panel.querySelector('#demo-reason').textContent=recommended.reason+'。'+recommended.reasonDetails;
  } else if(button.id==='demo-change'){
    step(1,assessment);
  } else if(button.id==='demo-reset') step(0,initial);
});
window.addEventListener('pagehide',()=>{
  const answer=document.querySelector('#demo-answer');
  if (answer) answer.value='';
});
