export function mountAgentWorkflow({api,context,openTab,startQuestion,continueQuestion,refresh}) {
  const $ = id => document.getElementById(id);
  if (!$('research-form') || !$('career-form')) return {roleChanged(){}, answered(){}, completed(){}, assessed(){},showPlan(){}};
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
  const linkText={manual:'需手动查看',not_read:'未读取正文',read:'已读取正文',read_failed:'原帖未能读取',
    date_unverified:'原帖日期未知或超出筛选范围',extraction_failed:'题目未能提取',
    no_questions:'未找到符合条件且有摘录的提问',evidence:'已提取候选题',supplementary:'标题显示为整理或列表，需手动核对'};
  let researchRun=null, researchTask=null, planRun=0, taskRun=0, resumeRun=null, mock=null, planTopics=null;
  const roleKey = () => context().revision;
  const role = () => context().role;
  function handoff(task) {
    if (researchRun) return;
    researchTask=task;
    $('research-topics').value=task.research_request.topics.join('，');
    $('research-topics').readOnly=true;
    $('research-task-clear').hidden=false;
    $('research-task-scope').textContent=task.research_request.focus ? '本次补题还会搜索「'+task.research_request.focus+'」。' : '';
    $('research-panel').open=true;
    openTab('search');
    $('research-topics').focus();
    $('research-results').replaceChildren();
    $('research-status').textContent=task.status==='proposed' ? '核对公开关键词和搜索范围后，确认执行。' : '';
    if (task.result) renderResearch(task.result,roleKey(),task.id);
  }

  function clearHandoff() {
    researchTask=null;
    $('research-topics').readOnly=false;
    $('research-task-clear').hidden=true;
    $('research-task-scope').textContent='';
  }
  $('research-task-clear').addEventListener('click',()=>{
    researchRun?.abort();
    clearHandoff();
    $('research-status').textContent='';
    $('research-results').replaceChildren();
  });
  $('research-cancel').addEventListener('click',async()=>{
    const id=researchTask?.id, revision=roleKey();
    researchRun?.abort();
    if (!id) return;
    try { await api('/api/training/tasks/cancel','POST',{role:role(),id}); }
    catch (error) { if (revision===roleKey()) $('research-status').textContent=error.message; }
    finally { if (revision===roleKey()) void refreshTasks(); }
  });
  $('research-form').addEventListener('submit',async e=>{
    e.preventDefault();
    if (researchRun) return;
    const revision=roleKey(), controller=new AbortController(), out=$('research-results'), status=$('research-status');
    const taskId=researchTask?.id;
    const button=e.currentTarget.querySelector('[type=submit]'), cancel=$('research-cancel');
    researchRun=controller; out.replaceChildren(); button.disabled=true; cancel.hidden=false;
    status.textContent='正在搜索、读取原帖和核对摘录，最多约 75 秒。';
    try {
      const result=await api('/api/research','POST',{role:role(),company:$('company').value,
        source:$('search-source').value,range:$('range').value,topics:parse('research-topics'),confirm:true,task_id:taskId},controller.signal);
      if (revision!==roleKey() || controller.signal.aborted || researchTask?.id!==taskId) return;
      renderResearch(result,revision,taskId);
    } catch (error) {
      if (revision===roleKey() && researchTask?.id===taskId) status.textContent=controller.signal.aborted ? '研究已取消。' : error.message;
    }
    finally {
      if (researchRun===controller) { researchRun=null; button.disabled=false; cancel.hidden=true; }
      if (taskId && revision===roleKey()) void refreshTasks();
    }
  });

  function renderResearch(result,revision,taskId) {
      const out=$('research-results'), status=$('research-status');
      const fastApiFailed=result.engine==='fastapi' && result.events.some(event=>event.tool==='search' && event.status==='failed');
      status.textContent=[failureText[result.task_reason] || stopText[result.stop],result.pilot?'博客园证据复核试点':'',`${result.candidates.length} 道待核对候选题`,
        fastApiFailed?'部分或全部 Python 检索失败，请检查服务是否运行、访问凭证和上游配置。':'',
        result.missing_topics.length ? '仍缺：'+result.missing_topics.join('、') : '',
        result.cached ? '已复用近期结果' : `搜索 ${result.usage.search} 次，读取 ${result.usage.read} 次，耗时 ${(result.usage.duration_ms/1000).toFixed(1)} 秒`].filter(Boolean).join(' · ');
      for (const item of result.candidates) {
        const card=el('article','',out); card.className='result-item';
        el('h3',item.question,card);
        el('p',`原帖记载的提问 · 待人工确认${item.topic?' · '+item.topic:''} · ${item.date?'原帖标注 '+item.date:'原帖日期未知'}`,card);
        if (item.evidence_location) {
          const roleEvidence=item.role_evidence_basis==='article_title' ? `原帖标题 · ${item.role_evidence}` : item.role_evidence;
          const scope=[roleEvidence,item.company_evidence].filter(Boolean);
          el('p',`正文第 ${item.evidence_location.paragraph} 段${scope.length?' · 岗位与公司线索：'+[...new Set(scope)].join('、'):''}`,card);
        } else el('p','公司和岗位请在原帖核对。标题中的线索不代表这道题由指定公司提问。',card);
        el('blockquote',item.evidence,card);
        link(item.url,item.title,card);
        const controls=el('div','',card); controls.className='agent-actions';
        const label=el('label','',controls), self=el('input','',label); self.type='checkbox';
        label.append(document.createTextNode(' 已核对为作者自述'));
        const save=action('核对无误，加入题库',controls,async()=>{
          if (revision!==roleKey()) return;
          save.disabled=true;
          try {
            const saved=await api('/api/research/confirm','POST',{role:role(),id:item.id,self_reported:self.checked,task_id:taskId});
            if (revision!==roleKey()) return;
            save.textContent='已加入题库'; self.disabled=true;
            if (taskId) {
              for (const other of out.querySelectorAll('[data-confirm-training-candidate]')) other.disabled=true;
              void refreshTasks();
            }
            if (planTopics && !mock) void plan();
            await refresh().catch(()=>{});
            if (revision===roleKey()) action('练习这道题',controls,()=>{
              if (revision!==roleKey()) return;
              if (taskId) planTopics ??= [];
              const started=startQuestion({text:saved.text,question_ref:{kind:'source',id:saved.id},
                sourceTitle:item.title,sourceUrl:item.url,topics:item.topic?[item.topic]:[],reason:'你核对后加入题库'});
              if (started) openTab('practice');
            });
          } catch (error) { if (revision===roleKey()) { save.disabled=false; status.textContent=error.message; } }
        });
        if (taskId) save.dataset.confirmTrainingCandidate='';
      }
      if (result.links.length) {
        const sources=el('details','',out); sources.open=!result.candidates.length || result.links.some(item=>item.source_truncated);
        el('summary','原帖线索与读取状态',sources);
        const list=el('ul','',sources);
        for (const item of result.links) {
          const row=el('li','',list); link(item.url,item.title,row);
          row.append(document.createTextNode(' · '+(linkText[item.status] || '待核实')));
          if (item.model_source_chars) row.append(document.createTextNode(result.cached
            ? ` · 上次尝试发送正文前 ${item.model_source_chars} 个字符给 AI${item.source_truncated?'，其余正文未发送':''}`
            : ` · 尝试发送正文前 ${item.model_source_chars} 个字符给 AI${item.source_truncated?'，其余正文未发送':''}`));
        }
        el('p','无法读取时，可以在资料库手动添加来源并粘贴原文。',sources);
      }
  }

  const taskText={proposed:'待确认搜索',searching:'搜索中',review:'待核对原帖',ready:'可开始练习',completed:'已保存能力评价',
    failed:'本次补题结束',cancelled:'已取消'};
  const failureText={no_results:'没有找到符合条件的结果',insufficient_evidence:'未找到原文证据足够的对应题目',
    model_failed:'提取题目的 AI 调用失败',timeout:'搜索超时或在重启前中断',search_unavailable:'搜索服务暂不可用',
    model_unavailable:'尚未配置 AI',research_failed:'研究未完成',question_removed:'关联题目已移除',
    cost_budget:stopText.cost_budget,model_budget:stopText.model_budget};

  function taskPath(id) {
    return '/api/training/tasks?'+new URLSearchParams({role:role(),...(id?{id}:{})});
  }
  async function refreshTasks() {
    if (!role()) return;
    const revision=roleKey(), run=++taskRun;
    const out=$('career-training-tasks'), status=$('career-training-status');
    try {
      const {tasks}=await api(taskPath());
      if (revision!==roleKey() || run!==taskRun) return;
      status.textContent='';
      out.replaceChildren();
      for (const item of tasks) {
        const box=el('article','',out);box.className='result-item';
        el('h3',item.point || item.topic || '当前岗位补题',box);
        el('p',[taskText[item.status],failureText[item.reason]].filter(Boolean).join(' · '),box);
        const controls=el('div','',box);controls.className='agent-actions';
        if (['proposed','review','ready','searching'].includes(item.status)) {
          if (item.status!=='searching') action(item.status==='ready'?'练习已确认题目':item.status==='review'?'核对原帖':'继续补题',
            controls,async()=>{
              if (revision!==roleKey() || run!==taskRun) return;
              try {
                const {task}=await api(taskPath(item.id));
                if (revision===roleKey() && run===taskRun) openTask(task);
              } catch (error) { if (revision===roleKey()) status.textContent=error.message; }
            });
          action('取消任务',controls,async()=>{
            if (revision!==roleKey() || run!==taskRun) return;
            try {
              await api('/api/training/tasks/cancel','POST',{role:role(),id:item.id});
              if (revision!==roleKey()) return;
              if (researchTask?.id===item.id) {
                researchRun?.abort();
                clearHandoff();
                $('research-results').replaceChildren();
              }
              void refreshTasks();
            } catch (error) { if (revision===roleKey()) status.textContent=error.message; }
          });
        }
      }
    } catch (error) { if (revision===roleKey() && run===taskRun) status.textContent=error.message; }
  }
  function openTask(task) {
    if (task.status==='ready' && task.question) {
      const {id,text,title,url}=task.question;
      planTopics ??= [];
      if (startQuestion({text,question_ref:{kind:'source',id},sourceTitle:title,sourceUrl:url,topics:task.topic?[task.topic]:[],reason:'补题任务中已核对的题目'},{restart:true})) {
        openTab('practice');
      }
    } else if (['proposed','review'].includes(task.status)) handoff(task);
    else void refreshTasks();
  }
  $('career-panel').addEventListener('toggle',()=>{if ($('career-panel').open) void refreshTasks();});
  $('career-training-refresh').addEventListener('click',()=>void refreshTasks());

  const observationText={correct:'有据正确',incorrect:'明确错误',missing:'本轮遗漏',unverified:'尚未验证',
    revisit:'自评需要再练',comfortable:'自评比较熟悉',unassessed:'练习后未自评'};
  const changeText={improving:'较之前有改善',needs_review_again:'近期再次出现错误或遗漏',consistent:'有多轮同方向证据',insufficient:'变化待观察'};
  function showEvidence(records,box) {
    if (!records?.length) return;
    const history=el('details','',box);
    el('summary',`查看依据（${records.length} 次作答）`,history);
    const list=el('ol','',history);
    for (const record of records) {
      const row=el('li','',list);
      const date=new Date(record.created);
      el('p',[observationText[record.kind],Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN',{dateStyle:'short',timeStyle:'short'})]
        .filter(Boolean).join(' · '),row);
      el('p',record.question,row);
      if (record.evidence) el('blockquote',record.evidence,row);
      if (record.requirement) el('p','题目要求：'+record.requirement,row);
    }
  }

  function showProfile(profile) {
    const panel=$('career-profile'), out=$('career-profile-points');
    panel.hidden=!profile;
    out.replaceChildren();
    if (!profile) return;
    if (!profile.points.length) {
      el('p','暂无能力观察，完成一次有证据的点评后可查看。',out);
      return;
    }
    const list=el('ul','',out);
    function renderMore(start) {
      for (const item of profile.points.slice(start,start+12)) {
        const row=el('li','',list);
        el('p',`${item.topic || '主题待确认'} · ${item.point}`,row);
        el('p',`正确 ${item.correct} · 错误 ${item.incorrect} · 遗漏 ${item.missing} · 待验证 ${item.unverified}`,row);
        const assessed=item.latest==='unverified' && item.latest_assessed ?
          ` · 上次有证据的结果为${observationText[item.latest_assessed]}` : '';
        el('p',`最近一轮${observationText[item.latest]}${assessed} · ${changeText[item.change]}`,row);
        showEvidence(item.evidence,row);
      }
      if (profile.points.length>start+12) {
        action('查看更多知识点',out,event=>{event.currentTarget.remove();renderMore(start+12);});
      }
    }
    renderMore(0);
  }

  async function plan() {
    const run=++planRun, revision=roleKey(), status=$('career-status'), tasks=$('career-tasks');
    tasks.replaceChildren();
    status.textContent='正在读取题库和近期作答…';
    try {
      const result=await api('/api/career/plan','POST',{role:role(),topics:mock?.topics ?? planTopics ?? [],
        mode:mock?'mock':'plan',completed:mock?.completed ?? []});
      if (revision!==roleKey() || run!==planRun) return;
      const practice=result.tasks.filter(task=>task.action==='practice');
      if (mock && (!practice.length || mock.completed.length>=3)) {
        status.textContent=`本场完成 ${mock.completed.length} 题。${mock.completed.length<3?'题库中暂时没有其他符合条件的题。':''}`;
        const list=el('ol','',tasks);
        for (const summary of mock.summaries) el('li',summary,list);
        mock=null;
        if (practice.length) return;
      } else status.textContent=mock ? `模拟面试：第 ${mock.completed.length+1} / 3 题，完成本题总结后可继续。` : '';
      $('career-requirements').textContent=result.has_requirements?'已参考已确认岗位要求。':'可在岗位设置确认 JD 要求，也可直接选题。';
      showProfile(result.profile);
      for (const task of result.tasks) {
        const box=el('article','',tasks); box.className='result-item';
        const labels={practice:'选题练习',review:'复习弱点',followup:'继续追问',research:'补充题库'};
        el('h3',`${labels[task.action]} · ${task.topic || '当前岗位'}`,box);
        if (task.point) el('strong',task.point,box);
        if (task.followup || task.question) el('p',task.followup?.question || task.question.text,box);
        el('p',task.reason,box);
        if (task.change && task.change!=='insufficient') el('p',changeText[task.change],box);
        showEvidence(task.evidence,box);
        const controls=el('div','',box); controls.className='agent-actions';
        const current=()=>run===planRun && revision===roleKey();
        if (task.action==='research') {
          let requestId;
          const button=action('去补搜',controls,async()=>{
            if (!current() || task.research_request?.role!==role()) return;
            requestId ??= globalThis.crypto.randomUUID();
            button.disabled=true;
            try {
              const {task:created}=await api('/api/training/tasks/create','POST',{role:role(),topic:task.topic,request_id:requestId});
              if (current()) openTask(created);
              if (revision===roleKey()) void refreshTasks();
            } catch (error) { if (current()) status.textContent=error.message; }
            finally { button.disabled=false; }
          });
        }
        else if (task.action==='followup') {
          const button=action('继续这道追问',controls,async()=>{
            if (!current()) return;
            button.disabled=true;
            try { await continueQuestion(task.followup); }
            catch (error) { if (current()) status.textContent=error.message; }
            finally { button.disabled=false; }
          });
        } else {
          action(task.action==='review'?'复习这题':'开始这题',controls,()=>{
            if (!current()) return;
            if (startQuestion(task.question,{restart:true}) && mock) {
              mock.active={...task.question.question_ref,attemptId:null};
              tasks.replaceChildren();
            }
          });
        }
      }
    } catch (error) { if (revision===roleKey() && run===planRun) status.textContent=error.message; }
  }
  $('career-form').addEventListener('submit',e=>{e.preventDefault();mock=null;planTopics=parse('career-topics');void plan();});
  $('career-mock').addEventListener('click',()=>{planTopics=null;showProfile(null);mock={topics:parse('career-topics'),completed:[],summaries:[],active:null};void plan();});
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
    showPlan() {
      mock=null;planTopics ??= parse('career-topics');
      const panel=$('career-panel');
      panel.open=true;
      panel.scrollIntoView({block:'start'});
      panel.querySelector('summary').focus({preventScroll:true});
      void plan();
    },
    assessed() { if (planTopics && !mock) void plan(); },
    answered(ref, attemptId) {
      if (ref && mock?.active?.id===ref.id && mock.active.kind===ref.kind) mock.active.attemptId=attemptId;
      if (planTopics && !mock) void plan();
      if ($('career-training-panel').open) void refreshTasks();
    },
    completed(attemptId, summary) {
      if (planTopics && !mock) {void plan();return;}
      if (!mock?.active || mock.active.attemptId!==attemptId) return;
      mock.completed.push(mock.active.id); mock.summaries.push(summary); mock.active=null;
      void plan();
    },
    roleChanged() {
      researchRun?.abort(); resumeRun?.abort(); planRun++; taskRun++; mock=null; planTopics=null;
      clearHandoff();
      showProfile(null);
      for (const id of ['research-results','research-status','career-tasks','career-status','career-requirements','career-resume-status','career-abilities']) $(id).replaceChildren();
      $('career-training-tasks').replaceChildren();
      $('career-training-status').textContent='';
      for (const id of ['research-topics','career-topics','career-resume']) $(id).value='';
    }
  };
}
