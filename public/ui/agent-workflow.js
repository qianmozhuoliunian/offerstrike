export function mountAgentWorkflow({api,context,openTab,startQuestion,refresh}) {
  const $ = id => document.getElementById(id);
  if (!$('research-form') || !$('career-form')) return {roleChanged(){}, answered(){}, completed(){}, assessed(){}};
  const parse = id => $(id).value.split(/[,，]/).map(item=>item.trim()).filter(Boolean);
  const el = (tag,text,parent) => { const item=document.createElement(tag); item.textContent=text; parent?.append(item); return item; };
  const action = (text,parent,fn) => {
    const button=el('button',text,parent); button.type='button'; button.className='apple-btn apple-btn-secondary';
    button.addEventListener('click',fn); return button;
  };
  function link(url,title,parent) {
    try {
      const parsed=new URL(url);
      if (!['http:','https:'].includes(parsed.protocol)) return;
      const a=el('a',title,parent); a.href=parsed.href; a.target='_blank'; a.rel='noopener noreferrer';
    } catch {}
  }
  const stopText={covered:'已找到有摘录的候选题',tool_budget:'本次检索或读取次数已用完',round_limit:'已完成两轮研究',
    no_candidates:'未发现符合当前条件的线索',search_unavailable:'搜索服务暂不可用',model_unavailable:'未配置 AI，只展示原帖线索',
    deadline:'本次研究已超时，保留已找到的结果',model_budget:'本次 AI 处理额度已用完',cost_budget:'已达到本次研究费用预算',cancelled:'研究已取消'};
  const linkText={manual:'需手动查看',not_read:'未读取正文',read_failed:'原帖未能读取',date_unverified:'原帖日期未核对',
    extraction_failed:'题目未能提取',no_questions:'未找到明确提问',evidence:'已提取候选题'};
  let researchRun=null, planRun=0, resumeRun=null, mock=null, planEnabled=false;
  const roleKey = () => context().revision;
  const role = () => context().role;
  function handoff(topic) {
    $('research-topics').value=topic;
    $('research-panel').open=true;
    openTab('search');
    $('research-topics').focus();
  }

  $('research-cancel').addEventListener('click',()=>researchRun?.abort());
  $('research-form').addEventListener('submit',async e=>{
    e.preventDefault();
    if (researchRun) return;
    const revision=roleKey(), controller=new AbortController(), out=$('research-results'), status=$('research-status');
    const button=e.currentTarget.querySelector('[type=submit]'), cancel=$('research-cancel');
    researchRun=controller; out.replaceChildren(); button.disabled=true; cancel.hidden=false;
    status.textContent='正在搜索、读取原帖和核对摘录，最多约 75 秒。';
    try {
      const result=await api('/api/research','POST',{role:role(),company:$('company').value,
        source:$('search-source').value,range:$('range').value,topics:parse('research-topics'),confirm:true},controller.signal);
      if (revision!==roleKey() || controller.signal.aborted) return;
      status.textContent=[stopText[result.stop],`${result.candidates.length} 道待核对候选题`,
        result.missing_topics.length ? '仍缺：'+result.missing_topics.join('、') : '',
        result.cached ? '已复用近期结果' : `搜索 ${result.usage.search} 次，读取 ${result.usage.read} 次，耗时 ${(result.usage.duration_ms/1000).toFixed(1)} 秒`].filter(Boolean).join(' · ');
      for (const item of result.candidates) {
        const card=el('article','',out); card.className='result-item';
        el('h3',item.question,card);
        el('p',`原帖记载的提问 · 待人工确认${item.topic?' · '+item.topic:''}${item.date?' · 原帖标注 '+item.date:''}`,card);
        el('p','公司和岗位请在原帖核对。标题中的线索不代表这道题由指定公司提问。',card);
        el('blockquote',item.evidence,card);
        link(item.url,item.title,card);
        const controls=el('div','',card); controls.className='agent-actions';
        const label=el('label','',controls), self=el('input','',label); self.type='checkbox';
        label.append(document.createTextNode(' 已核对为作者自述'));
        const save=action('核对无误，加入题库',controls,async()=>{
          if (revision!==roleKey()) return;
          save.disabled=true;
          try {
            const saved=await api('/api/research/confirm','POST',{role:role(),id:item.id,self_reported:self.checked});
            if (revision!==roleKey()) return;
            save.textContent='已加入题库'; self.disabled=true;
            await refresh().catch(()=>{});
            if (revision===roleKey()) action('练习这道题',controls,()=>{
              if (revision!==roleKey()) return;
              const started=startQuestion({text:saved.text,question_ref:{kind:'source',id:saved.id},
                sourceTitle:item.title,sourceUrl:item.url,topics:item.topic?[item.topic]:[],reason:'你核对后加入题库'});
              if (started) openTab('practice');
            });
          } catch (error) { if (revision===roleKey()) { save.disabled=false; status.textContent=error.message; } }
        });
      }
      if (result.links.length) {
        const sources=el('details','',out); sources.open=!result.candidates.length;
        el('summary','原帖线索与读取状态',sources);
        const list=el('ul','',sources);
        for (const item of result.links) {
          const row=el('li','',list); link(item.url,item.title,row);
          row.append(document.createTextNode(' · '+(linkText[item.status] || '待核实')));
        }
        el('p','无法读取时，可以在资料库手动添加来源并粘贴原文。',sources);
      }
    } catch (error) { if (revision===roleKey()) status.textContent=controller.signal.aborted ? '研究已取消。' : error.message; }
    finally { if (researchRun===controller) { researchRun=null; button.disabled=false; cancel.hidden=true; } }
  });

  async function plan() {
    const run=++planRun, revision=roleKey(), status=$('career-status'), tasks=$('career-tasks');
    tasks.replaceChildren();
    status.textContent='正在根据题库和最新自评安排…';
    try {
      const result=await api('/api/career/plan','POST',{role:role(),topics:mock?.topics ?? parse('career-topics'),
        mode:mock?'mock':'plan',completed:mock?.completed ?? []});
      if (revision!==roleKey() || run!==planRun) return;
      const practice=result.tasks.filter(task=>task.action==='practice');
      if (mock && (!practice.length || mock.completed.length>=3)) {
        status.textContent=`本场完成 ${mock.completed.length} 题。${mock.completed.length<3?'题库中暂时没有其他符合条件的题。':''}`;
        const list=el('ol','',tasks);
        for (const summary of mock.summaries) el('li',summary,list);
        mock=null;
        if (practice.length) return;
      } else status.textContent=mock ? `模拟面试：第 ${mock.completed.length+1} / 3 题，完成本题总结后可继续。` : '按自评和题库安排的下一步';
      $('career-requirements').textContent=result.has_requirements?'已参考已确认岗位要求。':'可在岗位设置确认 JD 要求，也可直接选题。';
      for (const task of result.tasks) {
        const box=el('div','',tasks); box.className='result-item';
        el('p',`${task.topic || '当前岗位'} · ${task.reason}`,box);
        if (task.action==='research') action('去补搜',box,()=>handoff(task.topic));
        else {
          el('p',task.question.text,box);
          action('开始这题',box,()=>{
            if (run!==planRun || revision!==roleKey()) return;
            if (startQuestion(task.question) && mock) {
              mock.active={...task.question.question_ref,attemptId:null};
              tasks.replaceChildren();
            }
          });
        }
      }
    } catch (error) { if (revision===roleKey() && run===planRun) status.textContent=error.message; }
  }
  $('career-form').addEventListener('submit',e=>{e.preventDefault();mock=null;planEnabled=true;void plan();});
  $('career-mock').addEventListener('click',()=>{planEnabled=false;mock={topics:parse('career-topics'),completed:[],summaries:[],active:null};void plan();});
  $('career-resume-form').addEventListener('submit',async e=>{
    e.preventDefault();
    if (resumeRun) return;
    const revision=roleKey(), controller=new AbortController(), button=e.currentTarget.querySelector('button');
    const status=$('career-resume-status'), out=$('career-abilities');
    resumeRun=controller; button.disabled=true; out.replaceChildren(); status.textContent='正在提取…';
    try {
      const result=await api('/api/career/resume','POST',{role:role(),resume:$('career-resume').value,confirm:true},controller.signal);
      if (revision!==roleKey()) return;
      status.textContent=result.abilities.length?'以下为简历中有摘录支持的能力线索，不能作为熟练度判断。':'未找到有依据的能力线索。';
      const list=el('ul','',out);
      for (const item of result.abilities) {
        const row=el('li',item.requirement,list);
        el('blockquote',item.evidence,row);
        if (Array.from(item.requirement).length<=40 && !/[,，\r\n]/.test(item.requirement)) action('用作训练主题',row,()=>{
          const values=parse('career-topics');
          if (!values.includes(item.requirement) && values.length<4) $('career-topics').value=[...values,item.requirement].join('，');
          else if (values.length>=4) status.textContent='最多 4 个训练主题，请先移除一个。';
        });
      }
      if (result.comparison.length) {
        el('p','与已确认岗位要求对照（按摘录中的原词匹配）：',out);
        const comparison=el('ul','',out);
        for (const item of result.comparison) el('li',`${item.topic}：${item.match==='literal_match'?'摘录中出现':'暂未核对到，不代表不会'}`,comparison);
      }
    } catch (error) { if (revision===roleKey()) status.textContent=error.message; }
    finally { if (resumeRun===controller) {resumeRun=null;button.disabled=false;} }
  });
  return {
    assessed() { if (planEnabled && !mock) void plan(); },
    answered(ref, attemptId) {
      if (ref && mock?.active?.id===ref.id && mock.active.kind===ref.kind) mock.active.attemptId=attemptId;
    },
    completed(attemptId, summary) {
      if (!mock?.active || mock.active.attemptId!==attemptId) return;
      mock.completed.push(mock.active.id); mock.summaries.push(summary); mock.active=null;
      void plan();
    },
    roleChanged() {
      researchRun?.abort(); resumeRun?.abort(); planRun++; mock=null; planEnabled=false;
      for (const id of ['research-results','research-status','career-tasks','career-status','career-requirements','career-resume-status','career-abilities']) $(id).replaceChildren();
      for (const id of ['research-topics','career-topics','career-resume']) $(id).value='';
    }
  };
}
