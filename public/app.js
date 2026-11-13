import { createToast } from './ui/toast.js';
import { createSourceExtraction } from './ui/source-extraction.js';

 /**
  * 见面 · 面试准备助手 (Apple HIG Design System Implementation)
  * Client Application Logic
  */

 const $ = s => document.querySelector(s);
 const $$ = s => document.querySelectorAll(s);

 let state = {
   role: '',
   sources: [],
   attempts: [],
   searchConfigured: false,
   aiConfigured: false
 };

 let activeFilter = 'all';
 let jdLoadedRole = null;
 let draftLoadedRole = null;
 let draftTimer;
 let draftWrite = Promise.resolve();
 let jdSaved = {jd:'', requirements:''};
 let jdBusy = false;
 let questionContext = null;
 let searchBatch = null;
 let searchRequestId = 0;
 let roleRevision = 0;
 let searchController = null;
 let searchButtonMarkup = '';
 let searchNeedsRoleCheck = false;
 let helpRequestId = 0;
 let helpController = null;
 let recommendationRequestId = 0;
 let pendingRecommendation = null;
 let dialogue = {role:'', turns:[], summary:'', origin:'', generation:null};
 let dialogueRevision = 0;
 let dialogueBusy = false;
 let dialogueRequest = null;
 let practiceAutopickRole = null;
 const noteDrafts = new Map();
 const topicDrafts = new Map();
 const questionDrafts = new Map();
 const questionSaveStates = new Map();

 const tabTitles = {
   dashboard: '备考工作台',
   role: '岗位设置',
   debrief: '真实面试复盘',
   search: '发现面经',
   practice: 'AI 复习追问',
   library: '资料库',
   settings: '偏好与状态'
 };

 const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({
   '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
 }[c]));

 async function api(path, method = 'GET', data, signal) {
   const r = await fetch(path, {
     method,
      signal,
     headers: { 'content-type': 'application/json' },
     body: data ? JSON.stringify(data) : undefined
   });
   const x = await r.json();
   if (!r.ok) throw Error(x.error || '操作失败');
   return x;
 }

const toast = createToast(escapeHtml);
const sourceExtraction = createSourceExtraction({api, getSource:id=>state.sources.find(source=>source.id===id), refresh, escapeHtml, toast});

 /* ==========================================================================
   Tab Navigation Architecture (Emil's Blur Crossfade Masking)
    ========================================================================== */

 function switchTab(tabId) {
   if (!tabTitles[tabId]) tabId = 'dashboard';

  $$('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `pane-${tabId}`);
    pane.classList.remove('transitioning');
  });

   // Update nav links
   $$('.nav-link').forEach(btn => {
     const matches = btn.dataset.tab === tabId;
     btn.classList.toggle('active', matches);
     if (matches) btn.setAttribute('aria-current', 'page');
     else btn.removeAttribute('aria-current');
   });

   // Update breadcrumbs
   const currentCrumb = $('#crumb-current');
   if (currentCrumb) {
     currentCrumb.textContent = tabTitles[tabId];
   }

   // Sync location hash
   if (window.location.hash.slice(1) !== tabId) {
     window.location.hash = tabId;
   }

   window.scrollTo({ top: 0, behavior: 'instant' });
   if (tabId === 'practice') setTimeout(maybeAutoSelectPractice, 0);
 }

 window.addEventListener('hashchange', () => {
   const hash = window.location.hash.slice(1);
   if (hash && tabTitles[hash] && !$('#pane-' + hash)?.classList.contains('active')) {
     switchTab(hash);
   }
 });

 document.addEventListener('click', e => {
   const tabTarget = e.target.closest('[data-tab]');
   if (tabTarget) {
     e.preventDefault();
     switchTab(tabTarget.dataset.tab);
   }
 });

 /* ==========================================================================
    macOS Sheet Modal Management
    ========================================================================== */

 let modalOpener = null;
 let modalOpenFrame = null;
 function openModal() {
   const modal = $('#modal-backdrop');
   if (!modal) return;
  clearTimeout(window.modalCloseTimer);
  if (modal.hidden) modalOpener = document.activeElement;
   modal.hidden = false;
  cancelAnimationFrame(modalOpenFrame);
  modalOpenFrame = requestAnimationFrame(() => {
    if (modal.hidden) return;
    modal.classList.add('open');
    const titleInput = $('#source-title');
    if (titleInput) titleInput.focus();
  });
 }

 function closeModal() {
   const modal = $('#modal-backdrop');
   if (!modal) return;
  cancelAnimationFrame(modalOpenFrame);
  modal.classList.remove('open');
  clearTimeout(window.modalCloseTimer);
  window.modalCloseTimer = setTimeout(() => {
    modal.hidden = true;
    const form = $('#source-form');
    if (form) form.reset();
    if (modalOpener && modalOpener.isConnected) modalOpener.focus();
  }, 220);
 }

 const globalAddBtn = $('#global-add-btn');
 if (globalAddBtn) globalAddBtn.addEventListener('click', openModal);

 const toggleAddBtn = $('#toggle-add');
 if (toggleAddBtn) toggleAddBtn.addEventListener('click', openModal);

 const modalCloseBtn = $('#modal-close-btn');
 if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);

 const cancelAddBtn = $('#cancel-add-btn');
 if (cancelAddBtn) cancelAddBtn.addEventListener('click', closeModal);

 const modalBackdrop = $('#modal-backdrop');
 if (modalBackdrop) {
   modalBackdrop.addEventListener('click', e => {
     if (e.target === modalBackdrop) closeModal();
   });
 }

 window.addEventListener('keydown', e => {
   if (e.key === 'Escape' && modalBackdrop && !modalBackdrop.hidden) {
     closeModal();
   }
 });

 /* ==========================================================================
    State Rendering
    ========================================================================== */

 function render() {
   // Form inputs & Topbar badges
   const roleInput = $('#role');
   if (roleInput) roleInput.value = state.role || '';
   if (jdLoadedRole !== state.role) {
     $('#jd-text').value = state.jd || '';
     $('#jd-requirements').value = state.confirmed_requirements || '';
     jdSaved = {jd:state.jd || '', requirements:state.confirmed_requirements || ''};
     $('#jd-status').textContent = state.role ? '' : '请先设置目标岗位';
     jdLoadedRole = state.role;
   }
   if (draftLoadedRole !== state.role) {
     $('#question').value = state.draft?.question || '';
     $('#answer').value = state.draft?.answer || '';
     $('#answer-char-count').textContent = `${$('#answer').value.length} 字`;
     $('#draft-status').textContent = state.role ? '已恢复本岗位草稿' : '设置岗位后可保存草稿';
     draftLoadedRole = state.role;
      try { questionContext = JSON.parse(sessionStorage.getItem('practice-context:' + state.role) || 'null'); } catch { questionContext = null; }
      if (questionContext?.text !== $('#question').value) questionContext = null;
      if (state.draft?.parent_attempt_id) questionContext={text:$('#question').value,parentId:state.draft.parent_attempt_id};
      else if (questionContext?.parentId) questionContext=null;
      if (state.draft?.question_ref) {
        const ref=state.draft.question_ref;
        if (!questionContext && ref.kind==='source') {
          const source=state.sources.find(s=>(s.questions || []).some(q=>q.id===ref.id));
          const q=source?.questions.find(item=>item.id===ref.id);
          if(source) questionContext={topics:q?.topic ? [q.topic] : [],sources:[{title:source.title,url:source.url,date:source.date,type:source.type}]};
        }
        if (!questionContext && ref.kind==='debrief') questionContext={sources:[{title:'个人面试记录',type:'个人面试记录'}]};
        questionContext={...questionContext,text:$('#question').value,questionRef:ref};
      }
      else if (questionContext?.questionRef) { delete questionContext.questionRef; }
      renderQuestionContext();
   }

   const displayRole = state.role ? state.role + (state.roleValidation === 'unverified' ? '（待核对）' : '') : '未设定';
   const validationStatus = $('#role-validation-status');
   if (validationStatus) {
     validationStatus.hidden = state.roleValidation !== 'unverified';
     validationStatus.textContent = validationStatus.hidden ? '' : '当前岗位尚未核对，请确认或修改后重新保存，再搜索面经。';
   }
   const topbarRole = $('#topbar-role');
   if (topbarRole) topbarRole.textContent = displayRole;
  const searchRole = $('#search-role-text');
   if (searchRole) searchRole.textContent = displayRole;
   const roleFocus = $('#role-coaching-focus');
   if (roleFocus) {
     roleFocus.hidden = !!dialogue.turns.length || !state.role || !state.roleCoaching?.focus;
     roleFocus.textContent = state.role && state.roleCoaching?.focus ? `本岗位练习参考 · ${state.roleCoaching.name}：${state.roleCoaching.focus}` : '';
   }

   // Dashboard metric widgets
   const widgetRole = $('#widget-role-display');
   if (widgetRole) widgetRole.textContent = displayRole;

   const widgetCount = $('#widget-count-display');
   if (widgetCount) widgetCount.textContent = state.sources.length;

   const widgetAttempts = $('#widget-attempts-display');
   if (widgetAttempts) widgetAttempts.textContent = state.attempts.length;

   // Library counts
   const count = state.sources.length;
   if ($('#count')) $('#count').textContent = count;
   if ($('#nav-count')) $('#nav-count').textContent = count;

   // Render Library sources
   renderSources();

   // Render Practice history
   renderAttempts();
   renderDebriefs();

   // Render Settings badges
   renderSettings();
 }

 function renderSources() {
   const sourcesEl = $('#sources');
   if (!sourcesEl) return;
   const allRoles = $('#library-role-scope')?.value === 'all';
   const inScope = item => allRoles || (!!state.role && item.role === state.role);
   const scopedSources = state.sources.filter(inScope);
   if ($('#count')) $('#count').textContent = scopedSources.length;
   const personalEl = $('#personal-interview-questions');
   if (personalEl) {
     const personalQuestions = (state.debriefs || []).filter(item => item.include_in_library && inScope(item));
     if ($('#personal-count')) $('#personal-count').textContent = personalQuestions.length;
     personalEl.innerHTML = personalQuestions.length ? personalQuestions.map(item => `
       <article class="source-item-card">
         <div class="source-card-main">
           <div class="source-tags-row">
             <span class="apple-pill blue">个人面试记录</span>
             <span class="apple-pill gray">${escapeHtml(item.role || '岗位未知')}</span>
             <span class="apple-pill gray">${item.company ? escapeHtml(item.company) : '公司未填'}</span>
             <span class="apple-pill gray">${item.interview_date ? `面试 ${escapeHtml(item.interview_date)}` : '面试时间未知'}</span>
           </div>
           <p class="debrief-question">${escapeHtml(item.question)}</p>
            ${topicEditor('debrief',item.id,'',item.topic)}
         </div>
          <div class="source-card-actions"><button type="button" class="action-pill-btn primary" data-library-debrief-practice="${escapeHtml(item.id)}">练习这题</button></div>
       </article>`).join('') : `<div class="library-empty library-empty-personal"><span class="library-empty-icon library-empty-icon-personal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><div class="library-empty-copy"><strong>暂无个人面试题</strong><p>${!allRoles && !state.role ? '请先设置目标岗位，或选择查看全部岗位。' : '在面试复盘中记录问题，并选择将其加入个人题库。'}</p></div><button type="button" class="apple-btn apple-btn-secondary compact" data-tab="${!allRoles && !state.role ? 'role' : 'debrief'}">${!allRoles && !state.role ? '设置岗位' : '进入面试复盘'} <span aria-hidden="true">→</span></button></div>`;
   }
   const filtered = activeFilter === 'all'
     ? scopedSources
     : scopedSources.filter(s => s.type === activeFilter);

   if (!filtered.length) {
     sourcesEl.innerHTML = `
       <div class="library-empty library-empty-sources">
         <span class="library-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
         <div class="library-empty-copy"><strong>${activeFilter === 'all' ? '所选范围暂无面经来源' : '这个分类下暂无面经来源'}</strong><p>${!allRoles && !state.role ? '请先设置目标岗位，或选择查看全部岗位。' : activeFilter === 'all' ? '搜索公开面经或手动录入链接，保存后可在这里整理题目。' : '可以切换内容类型或岗位范围，查看其他来源。'}</p></div>
         <div class="library-empty-actions">${!allRoles && !state.role ? '<button type="button" class="apple-btn apple-btn-secondary compact" data-tab="role">设置岗位 <span aria-hidden="true">→</span></button>' : activeFilter === 'all' ? '<button type="button" class="apple-btn apple-btn-secondary compact" data-tab="search">搜索面经 <span aria-hidden="true">→</span></button><button type="button" class="library-subtle-link" data-action="open-add-modal">录入已有链接</button>' : ''}</div>
       </div>
     `;
     return;
   }

   sourcesEl.innerHTML = filtered.map(s => {
     const typeClass = s.type === '真实面经（自述）' ? 'green' : (s.type === '博主整理' ? 'orange' : 'gray');
     const dateLabel = s.date ? `发布 ${escapeHtml(s.date)} · 待核实` : '发布时间未知';
     const interviewDateLabel = s.interview_date ? `面试 ${escapeHtml(s.interview_date)} · 用户填报` : '面试时间未知';
     const questions = Array.isArray(s.questions) ? s.questions : [];
     const legacy = s.legacy_question ?? s.question ?? '';
     const draft = questionDrafts.get(s.id) || {text:'', topic:''};
     const saveState = questionSaveStates.get(s.id);
     return `
       <article class="source-item-card">
         <div class="source-card-main">
           <h3 class="source-card-title">
             <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">
               <span>${escapeHtml(s.title)}</span>
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
             </a>
           </h3>
           <div class="source-tags-row">
             <span class="apple-pill ${typeClass}">${escapeHtml(s.type)}</span>
             <span class="apple-pill gray">${dateLabel}</span>
             <span class="apple-pill gray">${interviewDateLabel}</span>
             <span class="apple-pill blue">${escapeHtml(s.role || '岗位未知')}</span>
           </div>
           <details class="source-date-editor"><summary>修改面试发生时间</summary>
             <form class="source-date-form" data-source-date-form="${escapeHtml(s.id)}"><label for="interview-date-${escapeHtml(s.id)}">面试发生时间（留空表示未知）</label><input id="interview-date-${escapeHtml(s.id)}" name="interview_date" type="date" value="${escapeHtml(s.interview_date || '')}"><button type="submit" class="apple-btn apple-btn-secondary compact">保存时间</button></form>
           </details>
           <div class="source-questions">
             <h4 class="source-questions-heading">关联题目 <span>${questions.length}</span></h4>
             ${questions.length ? questions.map(q => `
               <div class="source-question-row">
                  <div class="source-question-content"><div class="source-question-text">${escapeHtml(q.text)}</div>
                    ${q.evidence ? `<details class="question-evidence"><summary>AI 整理 · 查看原文依据${q.evidence_question !== q.text ? '（题目已修改，请重新核对）' : ''}</summary><blockquote>${escapeHtml(q.evidence)}</blockquote><p>摘录来自用户粘贴的内容，请核对原帖与题意。</p></details>` : ''}
                    ${topicEditor('source',q.id,s.id,q.topic)}
                   <details class="question-note"><summary>个人笔记${q.note ? ' · 已保存' : ''}</summary>
                     <form class="note-form" data-note-form="${escapeHtml(q.id)}" data-source-id="${escapeHtml(s.id)}">
                       <label for="note-${escapeHtml(q.id)}">你的理解、项目例子或待补充内容</label>
                       <textarea id="note-${escapeHtml(q.id)}" name="note" rows="2" maxlength="10000">${escapeHtml(noteDrafts.has(q.id) ? noteDrafts.get(q.id) : (q.note || ''))}</textarea>
                       <button type="submit" class="apple-btn apple-btn-secondary compact">保存笔记</button>
                     </form>
                   </details></div>
                 <button type="button" class="action-pill-btn primary" data-practice="${escapeHtml(q.id)}">练习这题</button>
               </div>`).join('') : '<p class="source-question-empty">暂无确认题目，可以从原文摘录后添加。</p>'}
             ${legacy ? `<div class="legacy-question"><strong>旧内容 · 待核实</strong><p>${escapeHtml(legacy)}</p><p>旧内容可能是搜索摘要，请核对原文后再作为题目保存。</p><button type="button" class="text-link-action" data-copy-legacy="${escapeHtml(s.id)}">复制到题目输入框</button></div>` : ''}
             <h4 class="source-add-heading">添加题目</h4>
             ${sourceExtraction.render(s)}
             <details class="add-question-panel">
               <summary>手动添加关联题目</summary>
               <form class="add-question-form" data-question-form="${escapeHtml(s.id)}">
                 <label for="question-${escapeHtml(s.id)}">从原帖摘录或输入问题</label>
                 <textarea id="question-${escapeHtml(s.id)}" name="text" rows="2" required maxlength="2000" ${saveState === 'saving' ? 'disabled' : saveState === 'saved' ? 'readonly' : ''} placeholder="核对原帖后输入题目">${escapeHtml(draft.text)}</textarea>
                 <span class="question-source-hint">请核对原帖；搜索摘要不会自动作为题目保存。</span>
                  <label for="new-topic-${escapeHtml(s.id)}">题目主题（选填）</label>
                  <input id="new-topic-${escapeHtml(s.id)}" name="topic" maxlength="100" ${saveState === 'saving' ? 'disabled' : saveState === 'saved' ? 'readonly' : ''} value="${escapeHtml(draft.topic)}" placeholder="例如：缓存、项目管理">
                 <div class="question-form-actions">
                   <button type="submit" class="apple-btn apple-btn-secondary" name="action" value="save" ${saveState ? 'disabled' : ''}>保存题目</button>
                   <button type="submit" class="apple-btn apple-btn-primary" name="action" value="practice" ${saveState ? 'disabled' : ''}>保存并练习</button>
                 </div>
                 <span class="question-form-status" role="status" aria-live="polite">${saveState === 'saving' ? '正在保存题目…' : saveState === 'saved' ? '题目已保存，但页面刷新失败；请刷新后查看，避免重复保存。' : ''}</span>
               </form>
             </details>
           </div>
         </div>
         <div class="source-card-actions">
           <button class="action-pill-btn delete" data-delete="${escapeHtml(s.id)}">移除</button>
         </div>
       </article>
     `;
   }).join('');
 }

  function topicEditor(kind, id, sourceId, topic) {
    const key=kind+':'+id;
    const value=topicDrafts.has(key) ? topicDrafts.get(key) : (topic || '');
    return `<details class="question-topic-editor"><summary>主题：${escapeHtml(topic || '未标注')}</summary><form class="topic-form" data-topic-form="${escapeHtml(id)}" data-topic-kind="${kind}" data-source-id="${escapeHtml(sourceId)}"><label for="topic-${escapeHtml(kind)}-${escapeHtml(id)}">题目主题（选填）</label><div class="topic-form-controls"><input id="topic-${escapeHtml(kind)}-${escapeHtml(id)}" name="topic" maxlength="100" value="${escapeHtml(value)}" placeholder="例如：缓存、项目管理"><button type="submit" class="apple-btn apple-btn-secondary compact">保存主题</button></div></form></details>`;
  }

  $('#pane-library').addEventListener('input', e => {
    const form=e.target.closest('[data-topic-form]');
    if(form && e.target.name==='topic') topicDrafts.set(form.dataset.topicKind+':'+form.dataset.topicForm,e.target.value);
  });
  $('#pane-library').addEventListener('submit', async e => {
    const form=e.target.closest('[data-topic-form]'); if(!form) return;
    e.preventDefault();
    const id=form.dataset.topicForm, kind=form.dataset.topicKind, key=kind+':'+id, value=form.elements.topic.value;
    const path=kind==='source' ? '/api/sources/'+encodeURIComponent(form.dataset.sourceId)+'/questions/'+encodeURIComponent(id)+'/topic' : '/api/debriefs/'+encodeURIComponent(id)+'/topic';
    const button=form.querySelector('button[type="submit"]'); button.disabled=true;
    try {
      const result=await api(path,'PUT',{topic:value});
      const item=kind==='source' ? state.sources.find(s=>s.id===form.dataset.sourceId)?.questions?.find(q=>q.id===id) : (state.debriefs || []).find(d=>d.id===id);
      if(item) item.topic=result.topic;
      if(topicDrafts.get(key)===value) topicDrafts.delete(key);
      const summary=form.closest('details')?.querySelector('summary'); if(summary) summary.textContent='主题：'+(result.topic || '未标注');
      toast.success('主题已保存');
    } catch(err) { toast.error(err.message); }
    finally { button.disabled=false; }
  });

 function renderDebriefs() {
   const list = $('#debrief-list');
   if (!list) return;
   const records = state.debriefs || [];
   if (!records.length) {
     list.innerHTML = '<p class="source-question-empty">还没有真实面试复盘记录。</p>';
     return;
   }
   list.innerHTML = records.map(item => `
     <article class="debrief-card">
       <div class="debrief-meta"><span class="apple-pill blue">个人面试记录</span><span>${escapeHtml(item.role || '岗位未设置')}</span><span>${item.company ? escapeHtml(item.company) : '公司未填'}</span><span>${item.interview_date ? `面试 ${escapeHtml(item.interview_date)}` : '面试时间未知'}</span></div>
       <p class="debrief-question">${escapeHtml(item.question)}</p>
       ${item.answer ? `<p class="debrief-detail"><strong>当时的回答：</strong>${escapeHtml(item.answer)}</p>` : ''}
       ${item.notes ? `<p class="debrief-detail"><strong>复盘：</strong>${escapeHtml(item.notes)}</p>` : ''}
       <div class="debrief-actions"><label class="checkbox-label"><input type="checkbox" data-debrief-library="${escapeHtml(item.id)}" ${item.include_in_library ? 'checked' : ''}>将此面试问题加入个人题库，供日后练习</label>${item.include_in_library ? `<button type="button" class="action-pill-btn primary" data-practice-debrief="${escapeHtml(item.id)}">练习这题</button>` : ''}</div>
     </article>`).join('');
 }

 function renderAttempts() {
   const listEl = $('#attempts-list');
   if (!listEl) return;

   const allRoles = $('#attempt-role-scope')?.value === 'all';
   const attempts = (state.attempts || []).filter(a => allRoles || (!!state.role && a.role === state.role));
   if (!attempts.length) {
     listEl.innerHTML = `
       <div class="apple-empty-state" style="padding: 32px 20px;">
         <div class="empty-state-desc">最近 30 条练习中，所选岗位范围暂无记录。可切换为全部岗位查看。</div>
       </div>
     `;
     return;
   }

   listEl.innerHTML = attempts.map(a => {
     const timeStr = a.created ? new Date(a.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
     return `
       <article class="attempt-card">
         <div class="attempt-header">
           <div style="display:flex; align-items:center; gap:8px;">
             <span class="apple-pill purple">AI 复习</span>
             ${a.role ? `<span class="apple-pill blue">${escapeHtml(a.role)}</span>` : ''}
              ${a.question_link_available === 0 ? '<span class="apple-pill gray">关联题目已不可用</span>' : ''}
           </div>
           <span style="font-size:11.5px; color:var(--apple-text-tertiary);">${escapeHtml(timeStr)}</span>
         </div>
         <div class="attempt-question">Q: ${escapeHtml(a.question)}</div>
         <div class="attempt-answer"><strong>你的作答：</strong>${escapeHtml(a.answer)}</div>
         <div class="attempt-feedback">${escapeHtml(a.feedback)}</div>
          <label>本次自评 <select class="apple-select" data-attempt-assessment="${escapeHtml(a.id)}" aria-label="本次练习自评">
            <option value="unassessed" ${!a.rating ? 'selected' : ''}>尚未自评</option>
            <option value="revisit" ${a.rating === 'revisit' ? 'selected' : ''}>需要再练</option>
            <option value="comfortable" ${a.rating === 'comfortable' ? 'selected' : ''}>比较熟悉</option>
          </select></label>
       </article>
     `;
   }).join('');
 }

  $('#attempts-list').addEventListener('change', async e => {
    const select=e.target.closest('[data-attempt-assessment]');
    if (!select) return;
    select.disabled=true;
    try { await api('/api/attempts/' + encodeURIComponent(select.dataset.attemptAssessment) + '/assessment', 'PUT', {rating:select.value}); await refresh(); toast.success('自评已保存'); }
    catch (err) { toast.error(err.message); await refresh().catch(() => {}); }
    finally { select.disabled=false; }
  });

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async e => {
    const file=e.target.files[0]; if(!file) return;
    const status=$('#import-status');
    try {
      if(file.size>8000000) throw Error('备份文件过大（上限 8 MB）');
      const data=JSON.parse(await file.text());
      const preview=await api('/api/import','POST',{mode:'preview',data});
      status.textContent=`备份预览：新增 ${preview.新增} 项，保留现有 ${preview.保留现有} 项。`;
      if (!window.confirm(`${status.textContent}\n确认合并导入？现有冲突记录不会被覆盖。`)) return;
      const result=await api('/api/import','POST',{mode:'merge',data});
      await refresh();
      status.textContent=`导入完成：新增 ${result.新增} 项，保留现有 ${result.保留现有} 项。`;
      toast.success('备份已导入');
    } catch(err) { status.textContent='导入失败：'+(err instanceof SyntaxError ? '文件不是有效的 JSON' : err.message); }
    finally { e.target.value=''; }
  });

 function renderSettings() {
   const searchBadge = $('#settings-search-badge');
   if (searchBadge) {
     if (state.searchConfigured) {
       searchBadge.className = 'apple-pill green';
       searchBadge.textContent = '已就绪 (Tavily Search API)';
     } else {
       searchBadge.className = 'apple-pill gray';
       searchBadge.textContent = '待配置 ($env:TAVILY_API_KEY)';
     }
   }

   const aiBadge = $('#settings-ai-badge');
   if (aiBadge) {
     if (state.aiConfigured) {
       aiBadge.className = 'apple-pill green';
        aiBadge.textContent = '已配置（尚未验证连接）';
     } else {
       aiBadge.className = 'apple-pill gray';
       aiBadge.textContent = '待配置 ($env:AI_API_KEY)';
     }
   }
 }

 async function refresh() {
    const nextState = await api('/api/state');
    const changedRole = state.role !== nextState.role;
    if (changedRole) { roleRevision++; invalidateSearchForRoleChange(); clearPracticeHelp(); clearRecommendationChoice(); resetDialogue(false); }
    else if (state.roleValidation !== nextState.roleValidation) invalidateSearchForRoleChange();
    state = nextState;
   render();
   if (changedRole) restoreDialogue(nextState.role, nextState.draft).then(maybeAutoSelectPractice).catch(() => {});
 }

 function invalidateSearchForRoleChange() {
   if (!searchBatch && !searchController && !searchNeedsRoleCheck) return;
   searchNeedsRoleCheck = false;
   searchRequestId++;
   searchBatch = null;
   searchController?.abort();
   searchController = null;
   const results = $('#results'), status = $('#search-status'), button = $('#search-btn');
   if (results) results.replaceChildren();
   if (status) { status.className = 'status-banner neutral'; status.textContent = '目标岗位已更新，请重新搜索面经。'; }
   if (button) { button.disabled = false; button.innerHTML = searchButtonMarkup; }
 }

 function writeDraft() {
   clearTimeout(draftTimer);
   const role = state.role;
   if (!role) return draftWrite;
    const payload = {role, question: $('#question').value, answer: $('#answer').value, parent_attempt_id:questionContext?.parentId || '', question_ref:questionContext?.questionRef || null};
   $('#draft-status').textContent = '正在保存草稿…';
   draftWrite = draftWrite.catch(() => {}).then(() => api('/api/draft', 'PUT', payload)).then(() => {
     if (state.role === role) $('#draft-status').textContent = '草稿已保存在本机';
   }).catch(() => {
     if (state.role === role) $('#draft-status').textContent = '草稿保存失败，请检查服务';
     throw Error('草稿保存失败');
   });
   return draftWrite;
 }

 function scheduleDraft() {
   clearTimeout(draftTimer);
   if (!state.role) { $('#draft-status').textContent = '设置岗位后可保存草稿'; return; }
   $('#draft-status').textContent = '草稿待保存…';
   draftTimer = setTimeout(() => { writeDraft().catch(() => {}); }, 400);
 }

 function setQuestionContext(context) {
   questionContext=context;
   if (state.role) {
     try { if(context) sessionStorage.setItem('practice-context:' + state.role, JSON.stringify(context)); else sessionStorage.removeItem('practice-context:' + state.role); } catch {}
   }
   renderQuestionContext();
 }

 function renderQuestionContext() {
   const el=$('#question-context'); if(!el) return;
   el.replaceChildren(); el.hidden=!questionContext;
   if(!questionContext) return;
   if(questionContext.origin === 'ai') { el.textContent='AI 生成题 · 非真实面经，仅供练习。'; return; }
   if(questionContext.parentId) { el.textContent='正在回答 AI 追问；点评会发送本题之前的完整对话。'; return; }
   if(questionContext.reason) { const reason=document.createElement('div'); reason.textContent=`推荐原因：${questionContext.reason}${questionContext.reasonDetails ? ' · '+questionContext.reasonDetails : ''}`; el.append(reason); }
   if(questionContext.topics?.length) { const topics=document.createElement('div'); topics.textContent='主题：'+questionContext.topics.join('、'); el.append(topics); }
   const sources=questionContext.sources?.length ? questionContext.sources : [{title:questionContext.sourceTitle || '来源未知',url:questionContext.sourceUrl}];
   for(const source of sources) {
     const line=document.createElement('div'); line.append(document.createTextNode('来源：'));
     try { const url=new URL(source.url); if(!['http:','https:'].includes(url.protocol)) throw Error('invalid'); const link=document.createElement('a'); link.href=url.href; link.target='_blank'; link.rel='noopener noreferrer'; link.textContent=source.title || '查看原帖'; line.append(link); }
     catch { line.append(document.createTextNode(source.title || '来源未知')); }
     if(source.type && source.type!=='个人面试记录') line.append(document.createTextNode(' · '+source.type));
     if(source.date) line.append(document.createTextNode(' · 日期 '+source.date+'（待核实）'));
     el.append(line);
   }
 }

 function clearPracticeHelp() {
   helpRequestId++;
   helpController?.abort();
   helpController = null;
   $$('#practice-help [data-practice-help]').forEach(button => { button.disabled = false; });
   const status = $('#practice-help-status'), result = $('#practice-help-result');
   if (status) { status.hidden = true; status.textContent = ''; }
   if (result) result.hidden = true;
 }

 function clearRecommendationChoice() {
   recommendationRequestId++;
   pendingRecommendation = null;
   const notice = $('#recommendation-choice');
   if (notice) notice.hidden = true;
   const button = $('#pick-from-lib-btn');
   if (button) button.disabled = false;
 }

 function loadPracticeQuestion(text) {
   const question = $('#question');
   const answer = $('#answer');
   if (question.value !== text && answer.value.trim() && !window.confirm('切换题目会替换当前回答，确定继续吗？')) return false;
   if (question.value !== text && typeof resetDialogue === 'function') resetDialogue();
   if (question.value !== text) { clearPracticeHelp(); clearRecommendationChoice(); }
   if (question.value !== text) { answer.value = ''; $('#answer-char-count').textContent = '0 字'; }
    question.value = text;
    setQuestionContext(null);
   scheduleDraft();
   return true;
 }

 async function openSourceQuestionEditor(sourceId, role) {
   const revision = roleRevision;
   const batch = searchBatch;
   if (!sourceId || state.role !== role) { toast.error('岗位已切换，请重新搜索'); return; }
   if (!state.sources.some(source => source.id === sourceId && source.role === role)) {
     try { await refresh(); } catch { toast.error('来源已收藏，但读取失败，请刷新后重试'); return; }
   }
   if (roleRevision !== revision || state.role !== role || searchBatch !== batch) { toast.error('搜索结果或岗位已变化，请重新选择来源'); return; }
   const source = state.sources.find(item => item.id === sourceId && item.role === role);
   if (!source) { toast.error('找不到已收藏的来源，请刷新后重试'); return; }
   const scope = $('#library-role-scope');
   if (scope) scope.value = 'current';
   activeFilter = 'all';
   $$('.filter-pill').forEach(pill => {
     const selected = pill.dataset.filter === 'all';
     pill.classList.toggle('active', selected);
     pill.setAttribute('aria-pressed', String(selected));
   });
   renderSources();
   switchTab('library');
   const input = document.getElementById('question-' + sourceId);
   if (!input) { toast.error('无法打开题目编辑区，请刷新后重试'); return; }
   const details = input.closest('details');
   if (details) details.open = true;
   requestAnimationFrame(() => {
     if (state.role !== role || window.location.hash !== '#library' || !input.isConnected) return;
     input.scrollIntoView({behavior:'instant', block:'center'});
     input.focus();
   });
 }

 function practiceSourceQuestion(source, target) {
   if ((!state.role || source.role !== state.role) && !window.confirm(`此题来自「${source.role || '岗位未知'}」，将按当前岗位「${state.role || '未设置'}」进行练习。是否继续？`)) return false;
   if (!loadPracticeQuestion(target.text)) return false;
   const matches = state.sources.filter(item => item.role === source.role && (item.questions || []).some(question => question.text.trim() === target.text.trim()));
   const sources = (matches.length ? matches : [source]).map(item => ({title:item.title,url:item.url,date:item.date,type:item.type}));
   setQuestionContext({text:target.text,questionRef:source.role===state.role ? {kind:'source',id:target.id} : null,topics:target.topic ? [target.topic] : [],sources});
   switchTab('practice');
   $('#answer')?.focus();
   toast('考题已载入复习面板');
   return true;
 }

 function canSwitchRole(role) {
   if (role === state.role) return true;
   if (jdBusy) { toast.error('请等待岗位描述处理完成'); return false; }
   const changed = $('#jd-text').value !== jdSaved.jd || $('#jd-requirements').value !== jdSaved.requirements;
   return !changed || window.confirm('当前岗位描述有未保存的修改，切换岗位后这些修改将丢失。确定切换吗？');
 }

 $('#question').addEventListener('input', () => { clearPracticeHelp(); clearRecommendationChoice(); if(questionContext && $('#question').value !== questionContext.text) setQuestionContext(null); scheduleDraft(); });
 $('#answer').addEventListener('input', scheduleDraft);
 $('#clear-draft').addEventListener('click', () => {
   if (!$('#question').value && !$('#answer').value) return;
   if (!window.confirm('确定清空当前岗位的题目和回答草稿吗？')) return;
   resetDialogue();
   $('#question').value = '';
   clearPracticeHelp(); clearRecommendationChoice();
    setQuestionContext(null);
   $('#answer').value = '';
   $('#answer-char-count').textContent = '0 字';
   writeDraft().catch(() => {});
 });
 window.addEventListener('pagehide', () => {
   if (!state.role) return;
   clearTimeout(draftTimer);
    fetch('/api/draft', {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({role:state.role,question:$('#question').value,answer:$('#answer').value,parent_attempt_id:questionContext?.parentId || '',question_ref:questionContext?.questionRef || null}), keepalive:true}).catch(() => {});
 });

 $('#jd-form').addEventListener('submit', async e => {
   e.preventDefault();
   if (!state.role) { toast.error('请先设置目标岗位'); return; }
   const button = e.target.querySelector('button[type="submit"]');
   const role = state.role;
   const jd = $('#jd-text').value;
   const confirmed_requirements = $('#jd-requirements').value;
   button.disabled = true;
   jdBusy = true;
   try {
     await api('/api/jd', 'POST', {role, jd, confirmed_requirements});
     if (state.role === role) { jdSaved = {jd, requirements:confirmed_requirements}; $('#jd-status').textContent = '已保存当前岗位的描述和要求'; }
     toast.success('岗位描述已保存');
   } catch (err) { toast.error(err.message); }
   finally { button.disabled = false; jdBusy = false; }
 });

 $('#jd-extract').addEventListener('click', async e => {
   if (!state.role) { toast.error('请先设置目标岗位'); return; }
   const jd = $('#jd-text').value.trim();
   if (!jd) { toast.error('请先填写岗位描述'); return; }
   const role = state.role;
   const requirementsBefore = $('#jd-requirements').value;
   const button = e.currentTarget;
   button.disabled = true;
   jdBusy = true;
   $('#jd-status').textContent = '正在提取，结果需确认后保存…';
   try {
     const result = await api('/api/jd/parse', 'POST', {jd});
     if (state.role !== role || $('#jd-text').value.trim() !== jd || $('#jd-requirements').value !== requirementsBefore) {
       $('#jd-status').textContent = '内容已变化，请重新提取，或直接手动填写';
       return;
     }
     $('#jd-requirements').value = result.requirements || '';
     $('#jd-status').textContent = '请检查并修改提取结果，然后点击保存';
   } catch (err) { $('#jd-status').textContent = err.message.includes('手动填写') ? err.message : err.message + '；也可以手动填写要求。'; }
   finally { button.disabled = false; jdBusy = false; }
 });

 /* ==========================================================================
    Action Handlers
    ========================================================================== */

 // Offer the next step only after the role has been saved and refreshed.
 const roleNextDialog = $('#role-next-dialog');
 let roleSaveBusy = false;
 let roleNextOpener = null;
 function showRoleNext() {
   if (!$('#pane-role').classList.contains('active') || roleNextDialog.open) return;
   roleNextOpener = document.activeElement;
   roleNextDialog.showModal();
   $('#role-next-close').focus();
 }
 roleNextDialog.addEventListener('close', () => {
   if (roleNextOpener?.isConnected) roleNextOpener.focus();
 });
 $('#role-next-close').addEventListener('click', () => roleNextDialog.close());
 $('#role-next-later').addEventListener('click', () => roleNextDialog.close());
 roleNextDialog.addEventListener('click', e => {
   const choice = e.target.closest('[data-next]');
   if (!choice) return;
   const next = choice.dataset.next;
   roleNextOpener = null;
   roleNextDialog.close();
   if (next === 'jd') {
     $('#jd-text').focus();
     $('#jd-text').scrollIntoView({behavior:'smooth', block:'center'});
   } else {
     switchTab(next);
   }
 });
 async function saveRole(role) {
   if (roleSaveBusy || !canSwitchRole(role)) return;
   roleSaveBusy = true;
   const controls = $$('#role-form button, #role-form input, .preset-chip');
   const roleStatus = $('#role-validation-status');
   controls.forEach(button => { button.disabled = true; });
   if (roleStatus) { roleStatus.hidden = false; roleStatus.textContent = '正在核对岗位名称…'; }
   try {
     if (role !== state.role) await writeDraft();
     let result = await api('/api/role', 'POST', { role });
     if (result.status === 'needs_confirmation') {
       const confirmed = window.confirm(`${result.message}\n\n“${role}”确实是你准备应聘的岗位吗？确定后继续保存；取消可修改名称。`);
       if (!confirmed) { if (roleStatus) roleStatus.textContent = '尚未保存，请补充或修改岗位名称。'; return; }
       result = await api('/api/role', 'POST', { role, confirmation_token:result.confirmation_token });
     }
     if (result.status !== 'saved') throw Error('岗位未保存，请重试');
     await refresh();
     toast.success(`目标岗位已设定为「${role}」`);
     showRoleNext();
   } catch (err) {
     if (roleStatus) { roleStatus.hidden = false; roleStatus.textContent = err.message; }
     toast.error(err.message);
   } finally {
     roleSaveBusy = false;
     controls.forEach(button => { button.disabled = false; });
   }
 }
 $('#role-form').addEventListener('submit', e => {
   e.preventDefault();
   saveRole($('#role').value.trim());
 });
 $$('.preset-chip').forEach(btn => {
   btn.addEventListener('click', () => saveRole(btn.dataset.role));
 });

 // Dashboard Quick Actions
 document.addEventListener('click', e => {
   const actionBtn = e.target.closest('[data-action]');
   if (!actionBtn) return;
   const action = actionBtn.dataset.action;
   if (action === 'goto-search') switchTab('search');
   if (action === 'open-add-modal') openModal();
   if (action === 'goto-library') switchTab('library');
 });

 // Segmented Control for Time Range
 const segmentContainer = $('#range-segmented');
 if (segmentContainer) {
   segmentContainer.addEventListener('click', e => {
     const btn = e.target.closest('.segment-btn');
     if (!btn) return;
     segmentContainer.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
     btn.classList.add('active');
     const val = btn.dataset.val;
     const select = $('#range');
     if (select) select.value = val;
     updateSearchConditionsNotice();
   });
 }

 // Add Source form submission (macOS Sheet)
 const sourceForm = $('#source-form');
 if (sourceForm) {
   sourceForm.addEventListener('submit', async e => {
     e.preventDefault();
     try {
       await api('/api/sources', 'POST', {
         title: $('#source-title').value,
         url: $('#source-url').value,
         date: $('#source-date').value,
         interview_date: $('#source-interview-date').value,
         type: $('#source-type').value,
         question: $('#source-question').value,
         role: state.role
       });
       closeModal();
       await refresh();
      toast.success('面经来源已保存');
     } catch (err) {
      toast.error(err.message);
     }
   });
 }

 // Sources list item click actions (Practice or Delete)
 const sourcesContainer = $('#sources');
 if (sourcesContainer) {
   sourcesContainer.addEventListener('input', e => {
     const form = e.target.closest('[data-note-form]');
     if (form && e.target.name === 'note') noteDrafts.set(form.dataset.noteForm, e.target.value);
     const questionForm = e.target.closest('[data-question-form]');
     if (questionForm) questionDrafts.set(questionForm.dataset.questionForm, {text:questionForm.elements.text.value, topic:questionForm.elements.topic.value});
   });
   sourcesContainer.addEventListener('submit', async e => {
     const dateForm = e.target.closest('[data-source-date-form]');
     if (dateForm) {
       e.preventDefault();
       const button = dateForm.querySelector('button[type="submit"]');
       button.disabled = true;
       try {
         const interview_date = dateForm.elements.interview_date.value;
         await api('/api/sources/' + encodeURIComponent(dateForm.dataset.sourceDateForm) + '/interview-date', 'PUT', {interview_date});
         const source = state.sources.find(s => s.id === dateForm.dataset.sourceDateForm);
         if (source) source.interview_date = interview_date;
         renderSources();
         toast.success('面试发生时间已保存');
       } catch (err) { toast.error(err.message); button.disabled = false; }
       return;
     }
     const noteForm = e.target.closest('[data-note-form]');
     if (noteForm) {
       e.preventDefault();
       const button = noteForm.querySelector('button[type="submit"]');
       const note = noteForm.elements.note.value;
       button.disabled = true;
       try {
         await api('/api/sources/' + encodeURIComponent(noteForm.dataset.sourceId) + '/questions/' + encodeURIComponent(noteForm.dataset.noteForm) + '/note', 'PUT', {note});
         const question = state.sources.flatMap(s => s.questions || []).find(q => q.id === noteForm.dataset.noteForm);
         if (question) question.note = note;
         if (noteDrafts.get(noteForm.dataset.noteForm) === note) noteDrafts.delete(noteForm.dataset.noteForm);
         toast.success('笔记已保存');
       } catch (err) { toast.error(err.message); }
       finally { button.disabled = false; }
       return;
     }
     const form = e.target.closest('[data-question-form]');
     if (!form) return;
     e.preventDefault();
     const text = form.elements.text.value.trim();
     if (!text) return;
     const sourceId = form.dataset.questionForm;
     const source = state.sources.find(item => item.id === sourceId);
     if (!source) { toast.error('来源不存在，请刷新页面'); return; }
     if (questionSaveStates.has(sourceId)) return;
     const roleAtSubmit = state.role, revisionAtSubmit = roleRevision;
     const practice = e.submitter?.value === 'practice';
     const controls = [...form.querySelectorAll('button, textarea, input')];
     const status = form.querySelector('.question-form-status');
     questionSaveStates.set(sourceId, 'saving');
     controls.forEach(control => { control.disabled = true; });
     if (status) status.textContent = '正在保存题目…';
     let savedQuestion;
     try {
       savedQuestion = await api('/api/sources/' + encodeURIComponent(sourceId) + '/questions', 'POST', {text,topic:form.elements.topic.value});
     } catch (err) {
       questionSaveStates.delete(sourceId);
       if (status) status.textContent = '保存失败：' + err.message;
       controls.forEach(control => { control.disabled = false; });
       if (form.isConnected === false) { renderSources(); toast.error('题目保存失败：' + err.message); }
       return;
     }
     questionDrafts.delete(sourceId);
     questionSaveStates.set(sourceId, 'saved');
     try { await refresh(); }
     catch {
       if (status) status.textContent = '题目已保存，但页面刷新失败；请刷新后查看，避免重复保存。';
       controls.filter(control => control.tagName !== 'BUTTON').forEach(control => { control.disabled = false; control.readOnly = true; });
       toast.error('题目已保存，但页面刷新失败；请刷新后查看，避免重复保存');
       return;
     }
     questionSaveStates.delete(sourceId);
     renderSources();
     if (roleRevision !== revisionAtSubmit || state.role !== roleAtSubmit) {
       toast.success(`题目已保存到「${source.role || '岗位未知'}」，岗位已变化，未跳转练习`);
       return;
     }
     const updatedSource = state.sources.find(item => item.id === sourceId);
     const updatedQuestion = updatedSource?.questions?.find(item => item.id === savedQuestion.id);
     if (practice && updatedSource && updatedQuestion) {
       if (!practiceSourceQuestion(updatedSource, updatedQuestion)) toast.success('题目已保存，可稍后练习');
     } else {
       toast.success(practice ? '题目已保存，请在资料库查看后练习' : '题目已保存，可从该来源开始练习');
     }
   });
   sourcesContainer.addEventListener('click', async e => {
    const copyLegacyBtn = e.target.closest('[data-copy-legacy]');
    if (copyLegacyBtn) {
      const source = state.sources.find(s => s.id === copyLegacyBtn.dataset.copyLegacy);
      const card = copyLegacyBtn.closest('.source-item-card');
      const details = card.querySelector('.add-question-panel');
      details.open = true;
      const input = details.querySelector('textarea');
      input.value = source?.legacy_question ?? source?.question ?? '';
      const form = input.closest('[data-question-form]');
      if (form) questionDrafts.set(form.dataset.questionForm, {text:input.value, topic:form.elements.topic.value});
      input.focus();
      return;
    }
    const deleteBtn = e.target.closest('[data-delete]');
    if (deleteBtn) {
      const id = deleteBtn.dataset.delete;
      if (questionSaveStates.get(id) === 'saving' || sourceExtraction.isBusy(id)) { toast.error('请等待题目保存或提取完成后再移除来源'); return; }
      if (!deleteBtn.classList.contains('confirming')) {
        deleteBtn.classList.add('confirming');
        deleteBtn.textContent = '确认移除来源及题目？';
        setTimeout(() => {
          if (deleteBtn && deleteBtn.classList.contains('confirming')) {
            deleteBtn.classList.remove('confirming');
            deleteBtn.textContent = '移除';
          }
        }, 3000);
        return;
      }

       try {
         await api('/api/sources/' + id, 'DELETE');
         sourceExtraction.forget(id);
         questionDrafts.delete(id);
         questionSaveStates.delete(id);
         await refresh();
        toast.success('已自题库中移除');
       } catch (err) {
        toast.error(err.message);
       }
       return;
     }

     const practiceId = e.target.closest('[data-practice]')?.dataset.practice;
     if (practiceId) {
       const source = state.sources.find(s => (s.questions || []).some(q => q.id === practiceId));
       const target = source?.questions.find(q => q.id === practiceId);
       if (target && target.text) {
         practiceSourceQuestion(source, target);
       }
     }
   });
 }

 $('#attempt-role-scope').addEventListener('change', renderAttempts);

 if (sourcesContainer) sourceExtraction.attach(sourcesContainer);

 // Library Category Filter Pills
 $$('.filter-pill').forEach(pill => {
   pill.addEventListener('click', () => {
     $$('.filter-pill').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
     pill.classList.add('active');
     pill.setAttribute('aria-pressed', 'true');
     activeFilter = pill.dataset.filter;
     renderSources();
   });
 });

 $('#library-role-scope').addEventListener('change', renderSources);
 $('#personal-interview-questions').addEventListener('click', e => {
   const button = e.target.closest('[data-library-debrief-practice]');
   if (!button) return;
   const item = (state.debriefs || []).find(d => d.id === button.dataset.libraryDebriefPractice && d.include_in_library);
   if (!item) return;
   if ((!state.role || item.role !== state.role) && !window.confirm(`此题来自「${item.role || '岗位未知'}」，将按当前岗位「${state.role || '未设置'}」进行练习。是否继续？`)) return;
   if (!loadPracticeQuestion(item.question)) return;
    setQuestionContext({text:item.question,questionRef:item.role===state.role ? {kind:'debrief',id:item.id} : null,topics:item.topic ? [item.topic] : [],sources:[{title:'个人面试记录',type:'个人面试记录'}]});
   switchTab('practice');
   $('#answer').focus();
   toast('已载入个人面试记录中的问题');
 });

 const debriefForm = $('#debrief-form');
 debriefForm.addEventListener('submit', async e => {
   e.preventDefault();
   const button = debriefForm.querySelector('button[type="submit"]');
   const payload = {
     company: $('#debrief-company').value,
     role: state.role,
     interview_date: $('#debrief-date').value,
     question: $('#debrief-question').value,
     answer: $('#debrief-answer').value,
     notes: $('#debrief-notes').value,
     include_in_library: $('#debrief-library').checked
   };
   button.disabled = true;
   try {
     await api('/api/debriefs', 'POST', payload);
     debriefForm.reset();
     await refresh();
     toast.success('面试复盘已保存');
   } catch (err) { toast.error(err.message); }
   finally { button.disabled = false; }
 });

 $('#debrief-list').addEventListener('change', async e => {
   const input = e.target.closest('[data-debrief-library]');
   if (!input) return;
   const checked = input.checked;
   input.disabled = true;
   try {
     await api('/api/debriefs/' + encodeURIComponent(input.dataset.debriefLibrary) + '/library', 'PUT', {include_in_library:checked});
     const item = (state.debriefs || []).find(d => d.id === input.dataset.debriefLibrary);
     if (item) item.include_in_library = checked;
     renderDebriefs();
     renderSources();
     toast.success(checked ? '已加入个人题库' : '已从个人题库移除');
   } catch (err) { input.checked = !checked; input.disabled = false; toast.error(err.message); }
 });
 $('#debrief-list').addEventListener('click', e => {
   const button = e.target.closest('[data-practice-debrief]');
   if (!button) return;
   const item = (state.debriefs || []).find(d => d.id === button.dataset.practiceDebrief && d.include_in_library);
   if (!item) return;
   if ((!state.role || item.role !== state.role) && !window.confirm(`此题来自「${item.role || '岗位未知'}」，将按当前岗位「${state.role || '未设置'}」进行练习。是否继续？`)) return;
   if (!loadPracticeQuestion(item.question)) return;
    setQuestionContext({text:item.question,questionRef:item.role===state.role ? {kind:'debrief',id:item.id} : null,topics:item.topic ? [item.topic] : [],sources:[{title:'个人面试记录',type:'个人面试记录'}]});
   switchTab('practice');
   $('#answer').focus();
   toast('已载入个人面试记录中的问题');
 });

 // Optional AI help leaves the answer and assessment untouched.
 $('#practice-help')?.addEventListener('click', async e => {
   const button = e.target.closest('[data-practice-help]');
   if (!button || button.disabled) return;
   const modes = {hint:'AI 提示', breakdown:'AI 拆解', approach:'AI 参考思路'};
   const mode = button.dataset.practiceHelp;
   if (!Object.hasOwn(modes, mode)) return;
   const question = $('#question').value.trim(), role = state.role || '';
   const status = $('#practice-help-status'), result = $('#practice-help-result');
   if (!question) { status.hidden = false; status.textContent = '请先填写练习问题，再选择帮助方式。'; $('#question').focus(); return; }
   if (question.length > 2000) { status.hidden = false; status.textContent = '问题不能超过 2000 字，请缩短后再获取帮助。'; return; }
   helpController?.abort();
   const controller = new AbortController(), requestId = ++helpRequestId, revision = roleRevision;
   helpController = controller;
   const buttons = $$('#practice-help [data-practice-help]');
   buttons.forEach(item => { item.disabled = true; });
   status.hidden = false; status.textContent = '正在生成帮助…'; result.hidden = true;
   try {
     const data = await api('/api/practice/help', 'POST', {role,question,mode}, controller.signal);
     if (requestId !== helpRequestId || revision !== roleRevision || state.role !== role || $('#question').value.trim() !== question) return;
     $('#practice-help-label').textContent = modes[mode] + ' · 生成内容仅供参考';
     $('#practice-help-content').textContent = data.guidance;
     status.hidden = true; result.hidden = false;
   } catch (err) {
     if (requestId === helpRequestId && err.name !== 'AbortError') { status.hidden = false; status.textContent = '暂时无法获取帮助：' + err.message; }
   } finally {
     if (requestId === helpRequestId) { helpController = null; buttons.forEach(item => { item.disabled = false; }); }
   }
 });

 // Recommend a different eligible question, or let the user choose an early repeat.
 function useRecommendedQuestion(recommended) {
   if (!loadPracticeQuestion(recommended.text)) return false;
   clearRecommendationChoice();
   setQuestionContext({text:recommended.text,questionRef:recommended.question_ref || null,reason:recommended.reason,reasonDetails:recommended.reasonDetails,topics:recommended.topics,sources:recommended.sources,sourceTitle:recommended.sourceTitle,sourceUrl:recommended.sourceUrl});
   $('#answer')?.focus();
   toast(`推荐原因：${recommended.reason} · 来源：${recommended.sourceTitle}`);
   return true;
 }

 function showRecommendationChoice(recommended, role, revision, currentQuestion) {
   pendingRecommendation = {recommended,role,revision,currentQuestion};
   const notice = $('#recommendation-choice'), message = $('#recommendation-message'), action = $('#practice-suggested-anyway');
   if (!recommended) message.textContent = '当前岗位的真实面经题库还没有题目。可以先寻找面经，或选择是否生成一道 AI 题。';
   else if (recommended.availability === 'unknown') message.textContent = '上次练习时间未知，暂时无法判断是否到了建议复习时间。' + (recommended.reasonDetails || '');
   else if (recommended.sameAsCurrent && recommended.availability === 'early') message.textContent = '当前没有其他合适的题目；这道题还没到建议复习时间。' + (recommended.reasonDetails || '');
   else if (recommended.sameAsCurrent) message.textContent = '当前没有其他合适的题目，你可以继续练这道题。' + (recommended.reasonDetails || '');
   else message.textContent = '当前没有到建议时间的题目。' + (recommended.reasonDetails || '');
   if (recommended && !recommended.sameAsCurrent) {
     const preview = Array.from(recommended.text || '');
     message.textContent += ` 候选题：${preview.slice(0,80).join('')}${preview.length > 80 ? '…' : ''}`;
   }
   action.hidden = !recommended;
   action.textContent = recommended?.sameAsCurrent ? '继续练这道' : '仍要练这题';
   notice.hidden = false;
 }

 const pickFromLibBtn = $('#pick-from-lib-btn');
 if (pickFromLibBtn) {
   pickFromLibBtn.addEventListener('click', async () => {
     if (!state.role) { toast('请先在岗位设置中保存目标岗位，再从题库选题'); return; }
     clearRecommendationChoice();
     const role = state.role, revision = roleRevision, currentQuestion = $('#question').value, requestId = ++recommendationRequestId;
     pickFromLibBtn.disabled = true;
     try {
       const {question:recommended} = await api('/api/recommendation','POST',{role,exclude_question:currentQuestion,source_preference:'self_reported'});
       if (requestId !== recommendationRequestId || roleRevision !== revision || state.role !== role || $('#question').value !== currentQuestion) return;
       if (!recommended || recommended.sameAsCurrent || !['new','due'].includes(recommended.availability)) {
         showRecommendationChoice(recommended,role,revision,currentQuestion);
       } else {
         useRecommendedQuestion(recommended);
       }
     } catch(err) { if (requestId === recommendationRequestId) toast.error(err.message); }
     finally { if (requestId === recommendationRequestId) pickFromLibBtn.disabled = false; }
   });
 }
 $('#practice-suggested-anyway')?.addEventListener('click', () => {
   const pending = pendingRecommendation;
   if (!pending?.recommended) return;
   if (state.role !== pending.role || roleRevision !== pending.revision || $('#question').value !== pending.currentQuestion) {
     clearRecommendationChoice(); toast('岗位或题目已变化，请重新选择题目'); return;
   }
   useRecommendedQuestion(pending.recommended);
 });

 $('#practice-generate')?.addEventListener('click', async () => {
   const role = state.role, revision = roleRevision, question = $('#question').value, answer = $('#answer').value;
   if (!role) { toast.error('请先设置目标岗位'); return; }
   if (dialogueBusy) return;
   if (answer.trim() && !window.confirm('生成新题会替换当前未提交的回答，确定继续吗？')) return;
   const button = $('#practice-generate'), sessionRevision = dialogueRevision;
   button.disabled = true; dialogueBusy = true; renderDialogue(); dialogueStatus('正在生成 AI 练习题…','info');
   try {
     const result = await api('/api/practice/dialogue/generate','POST',{role});
     if (state.role !== role || roleRevision !== revision || dialogueRevision !== sessionRevision || $('#question').value !== question || $('#answer').value !== answer) {
       toast('岗位或草稿已变化，生成结果未替换当前内容'); return;
     }
     if (!result.question || !result.generation_token) throw Error('生成题目无效，请重试');
     clearPracticeHelp(); clearRecommendationChoice(); resetDialogue();
     $('#question').value = result.question; $('#answer').value = ''; $('#answer-char-count').textContent = '0 字';
     dialogue.role = role; dialogue.origin = 'ai'; dialogue.generation = {question:result.question, token:result.generation_token};
     try { sessionStorage.setItem('practice-generated:' + role, JSON.stringify(dialogue.generation)); } catch {}
     setQuestionContext({text:result.question,origin:'ai'}); scheduleDraft(); renderDialogue(); $('#answer').focus();
   } catch (err) { if (state.role === role && roleRevision === revision && dialogueRevision === sessionRevision) dialogueStatus('AI 题生成失败：' + err.message, 'error'); }
   finally { button.disabled = false; if (dialogueRevision === sessionRevision && state.role === role) { dialogueBusy = false; renderDialogue(); } }
 });

 // Answer character counter
 const answerInput = $('#answer');
 const charCountEl = $('#answer-char-count');
 if (answerInput && charCountEl) {
   answerInput.addEventListener('input', () => {
     charCountEl.textContent = `${answerInput.value.length} 字`;
   });
 }


 // Search form submission
 function updateSearchConditionsNotice() {
   if (!searchBatch?.statusText) return;
   const current = {company:$('#company')?.value.trim() || '', range:$('#range')?.value || 'year', source:$('#search-source')?.value || 'all', ai_relevance:$('#search-ai-relevance')?.checked === true};
   const previous = searchBatch.conditions;
   const changed = current.company !== previous.company || current.range !== previous.range || current.source !== previous.source || current.ai_relevance !== previous.ai_relevance;
   const status = $('#search-status');
   if (status) status.textContent = searchBatch.statusText + (changed ? ' 搜索条件已更改，请重新搜索以更新结果。' : '');
 }

 function searchSnippet(snippet) {
   const full = String(snippet || '').trim();
  const clean = full
    .replace(/<[^>]+>/g, '')
    .replace(/#{1,6}\s*/g, ' ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[\.\.\.\]/g, ' ')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
   const chars = Array.from(clean);
   if (!chars.length) return '<p class="result-snippet">暂无摘要，请查看原帖。</p>';
   const preview = chars.slice(0, 200).join('');
   return `<p class="result-snippet">${escapeHtml(preview)}${chars.length > 200 ? '…' : ''}</p>` +
    (chars.length > 200 ? `
      <details class="result-details">
        <summary><span>查看完整摘要</span><svg class="result-details-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg></summary>
        <div class="result-details-content"><div class="result-details-inner"><p>${escapeHtml(full)}</p></div></div>
      </details>` : '');
 }

 const searchForm = $('#search-form');
 $('#search-ai-relevance')?.addEventListener?.('change', updateSearchConditionsNotice);
 if (searchForm) {
    searchButtonMarkup = $('#search-btn')?.innerHTML || '';
   searchForm.addEventListener('input', updateSearchConditionsNotice);
   searchForm.addEventListener('change', updateSearchConditionsNotice);
   searchForm.addEventListener('submit', async e => {
     e.preventDefault();
     const button = $('#search-btn');
      if (button?.disabled) return;
      const role = state.role;
      const sourceSelect = $('#search-source');
      const source = sourceSelect?.value || 'all';
      const aiRelevance = $('#search-ai-relevance')?.checked === true;
      const sourceLabel = sourceSelect?.selectedOptions[0]?.textContent || '全部推荐来源';
      const company = $('#company')?.value.trim() || '';
      const range = $('#range')?.value || 'year';
      const rangeLabel = ({year:'近一年','6m':'近半年','3m':'近三个月',all:'不限时间'})[range] || range;
      if (!role) { toast.error('请先设置并保存目标岗位'); return; }
      if (state.roleValidation === 'unverified') {
        searchNeedsRoleCheck = true;
        const status = $('#search-status'), results = $('#results');
        if (status) { status.className = 'status-banner neutral'; status.innerHTML = '<span>当前岗位尚未核对，请确认或修改后再搜索。</span><button type="button" class="text-link-action" data-tab="role">去核对岗位</button>'; }
        if (results) results.replaceChildren();
        return;
      }
      const requestId = ++searchRequestId;
      searchController?.abort();
      const controller = new AbortController();
      searchController = controller;
      searchBatch = null;
     if (button) button.disabled = true;
     if (button) button.innerHTML = `
       <svg class="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
       <span>正在检索...</span>
     `;

     const statusBanner = $('#search-status');
     if (statusBanner) {
       statusBanner.className = 'status-banner info';
       statusBanner.innerHTML = `<span>正在搜索公开面经，请稍候；结果需要核实来源。</span>`;
     }
     const resultsEl = $('#results');
     if (resultsEl) {
       resultsEl.innerHTML = `
         <div class="result-item result-skeleton" aria-hidden="true">
           <div class="skeleton-shimmer skeleton-pills"></div>
           <div class="skeleton-shimmer skeleton-title"></div>
           <div class="skeleton-shimmer skeleton-line"></div>
           <div class="skeleton-shimmer skeleton-line short"></div>
         </div>
         <div class="result-item result-skeleton" aria-hidden="true">
           <div class="skeleton-shimmer skeleton-pills"></div>
           <div class="skeleton-shimmer skeleton-title"></div>
           <div class="skeleton-shimmer skeleton-line"></div>
           <div class="skeleton-shimmer skeleton-line short"></div>
         </div>
       `;
     }

     try {
       const data = await api('/api/search', 'POST', {
         role,
         company,
         range,
         source,
         ai_relevance: aiRelevance
        }, controller.signal);
        if (requestId !== searchRequestId || state.role !== role) return;
       const matched = data.results || [], supplemental = data.supplementary_results || [], unverified = data.unverified_results || [];
       const statusText = `「${role}」找到 ${matched.length} 条面经线索${supplemental.length ? `，另有 ${supplemental.length} 条补充内容` : ''} · ${company || '不限公司'} · ${rangeLabel} · ${sourceLabel}。${data.notice || ''}`;
       searchBatch = {role, results:[...matched,...supplemental,...unverified], conditions:{company,range,source,ai_relevance:aiRelevance}, statusText};
       updateSearchConditionsNotice();
       if (resultsEl) {
           const renderResult = (r, i) => {
             const saved = (state.sources || []).find(s => s.role === role && s.url === r.url);
             r.savedSourceId = saved?.id || '';
             const platformClass = r.platform === '牛客' ? 'platform-nowcoder' : r.platform === '掘金' ? 'platform-juejin' : r.platform === '知乎' ? 'platform-zhihu' : 'gray';
             return `
             <article class="result-item">
               <div class="result-meta">
                 <span class="apple-pill ${platformClass}">${escapeHtml(r.platform || '外部来源')}</span>
                 ${r.content_hint === 'listing' ? '<span class="apple-pill match-unknown">列表页线索</span>' : (r.content_hint === 'compilation' ? '<span class="apple-pill match-unknown">疑似整理内容</span>' : (r.content_hint === 'interview_clue' ? '<span class="apple-pill match-unknown">面经线索，待核实</span>' : ''))}
                 ${r.role_match === 'unknown' ? '<span class="apple-pill match-unknown">相关性待核实</span>' : (r.role_match === 'title_keyword' ? '<span class="apple-pill match-ok">标题含岗位关键词</span>' : '')}
                 ${r.company_match === 'unknown' ? '<span class="apple-pill match-unknown">公司待核实</span>' : (r.company_match === 'title_keyword' ? '<span class="apple-pill match-ok">标题含公司词，待核实</span>' : '')}
                 ${r.ai_relevance === 'related' ? '<span class="apple-pill match-ok">AI 初筛可能相关</span>' : (r.ai_relevance === 'unrelated' ? '<span class="apple-pill match-unknown">AI 判断可能无关</span>' : (r.ai_relevance === 'uncertain' ? '<span class="apple-pill match-unknown">AI 无法判断</span>' : ''))}
                 <span class="apple-pill date-pill">${r.date ? `日期参考 ${escapeHtml(r.date)}` : '发布时间以原帖为准'}</span>
               </div>
               <h4 class="result-title">
                 <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">
                   <span>${escapeHtml(r.title)}</span>
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline></svg>
                 </a>
               </h4>
               ${searchSnippet(r.snippet)}
               ${r.ai_evidence ? `<details class="result-details"><summary>查看 AI 判断引用的搜索摘要或标题</summary><div class="result-details-content"><p>${escapeHtml(Object.values(r.ai_evidence).filter(value => typeof value === 'string').join('；'))}</p><p>引用来自搜索结果，不代表原帖真实性。</p></div></details>` : ''}
               <div class="result-footer">
                 <div class="result-actions">
                   <button type="button" class="result-action-btn ${saved ? 'saved' : ''}" data-save="${i}" ${saved ? 'disabled' : ''}>${saved ? '已收藏' : '+ 收藏来源'}</button>
                   <button type="button" class="apple-btn apple-btn-secondary result-organize" data-organize="${i}" ${saved?.id ? '' : 'hidden'}>整理题目</button>
                 </div>
                 <a href="${escapeHtml(r.url)}" class="result-open-link" target="_blank" rel="noopener noreferrer">
                   <span>${r.content_hint === 'listing' ? '打开列表' : '打开来源'}</span>
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                 </a>
               </div>
             </article>
           `; };
           const matchesMarkup = matched.length ? matched.map(renderResult).join('') : `
             <div class="apple-empty-state" style="padding: 28px;">
               <div class="empty-state-desc">${data.partial_failure ? '部分检索失败，暂时没有可展示的面经线索，请重试。' : supplemental.length || unverified.length ? '暂时没有找到明确的面经线索，可以查看下方补充内容或调整筛选条件。' : '暂时没有找到面经线索。请检查目标岗位，或调整时间范围和公司关键词。'}</div>
             </div>`;
           const supplementalMarkup = supplemental.length ? `
             <details class="search-unverified">
               <summary>另有 ${supplemental.length} 条补充内容（整理、列表或类型待核实）</summary>
               <p>根据标题或链接识别，可能有误；列表页通常包含多个岗位，日期不代表每篇帖子的日期。</p>
               ${supplemental.map((result, index) => renderResult(result, matched.length + index)).join('')}
             </details>` : '';
           const unverifiedMarkup = unverified.length ? `
             <details class="search-unverified">
               <summary>另有 ${unverified.length} 条相关性未确认（可能无关）</summary>
               <p>以下结果的岗位、公司或面试线索不足，或 AI 判断可能无关；请打开原帖核实。</p>
               ${unverified.map((result, index) => renderResult(result, matched.length + supplemental.length + index)).join('')}
             </details>` : '';
           resultsEl.innerHTML = matchesMarkup + supplementalMarkup + unverifiedMarkup;
       }
     } catch (err) {
        if (requestId === searchRequestId && err.name !== 'AbortError' && statusBanner) {
         statusBanner.className = 'status-banner neutral';
         statusBanner.innerHTML = `<span>${escapeHtml(err.message)}</span>`;
         if (resultsEl) resultsEl.replaceChildren();
       }
     } finally {
        if (requestId === searchRequestId) {
          searchController = null;
        }
        if (requestId === searchRequestId && button) {
         button.disabled = false;
          button.innerHTML = searchButtonMarkup;
       }
     }
   });
 }

 // Save search result to library
 const resultsContainer = $('#results');
 if (resultsContainer) {
   resultsContainer.addEventListener('click', async e => {
      const summary = e.target?.closest?.('summary');
      if (summary && summary.tagName === 'SUMMARY') {
        const details = summary.closest('details');
        if (details && details.classList.contains('result-details')) {
          const toggleText = summary.querySelector('span');
          if (details.open) {
            e.preventDefault();
            if (details.dataset.animating === 'true') return;
            details.dataset.animating = 'true';
            details.classList.add('is-collapsing');
            if (toggleText) toggleText.textContent = '查看完整摘要';
            setTimeout(() => {
              details.removeAttribute('open');
              details.classList.remove('is-collapsing');
              delete details.dataset.animating;
            }, 200);
            return;
          } else if (toggleText) {
            toggleText.textContent = '收起完整摘要';
          }
        }
      }
      const organizeButton = e.target.closest('[data-organize]');
      if (organizeButton) {
        const batch = searchBatch;
        const item = batch?.results[Number(organizeButton.dataset.organize)];
        if (!item?.savedSourceId || state.role !== batch.role) { toast.error('来源或岗位已变化，请重新搜索'); return; }
        await openSourceQuestionEditor(item.savedSourceId, batch.role);
        return;
      }
      const saveButton = e.target.closest('[data-save]');
      if (!saveButton || saveButton.disabled) return;
      const batch = searchBatch;
      const item = batch?.results[Number(saveButton.dataset.save)];
     if (!item) return;
      if (state.role !== batch.role) { invalidateSearchForRoleChange(); return; }
      saveButton.disabled = true;
      let saved = false;
     try {
       const result = await api('/api/sources', 'POST', {
         ...item,
         date: item.date || '',
         type: '来源未知',
         question: '',
          role: batch.role
       });
       saved = true;
       saveButton.textContent = '已收藏';
       item.savedSourceId = result.id;
       if (searchBatch === batch && state.role === batch.role) {
         const organize = saveButton.closest?.('.result-item')?.querySelector('[data-organize]');
         if (organize) organize.hidden = false;
       }
       try { await refresh(); } catch { toast.error('来源已收藏，但页面数据刷新失败，请刷新页面查看'); return; }
       toast.success(`来源已收藏到「${batch.role}」，核实原帖后可整理题目`);
     } catch (err) {
      toast.error(err.message);
      } finally {
        if (!saved) saveButton.disabled = false;
     }
   });
 }

 $('#search-target-pill')?.addEventListener('click', () => switchTab('role'));

 // AI Review submission
 // One question at a time: each saved turn remains visible in the conversation.
 function maybeAutoSelectPractice() {
   if (!$('#pane-practice')?.classList.contains('active') || !state.role || $('#question').value || dialogueBusy || practiceAutopickRole === state.role) return;
   practiceAutopickRole = state.role;
   $('#pick-from-lib-btn')?.click();
 }

 function dialogueStatus(message, kind='neutral') {
   const el = $('#review-status');
   if (!el) return;
   el.hidden = !message; el.className = 'status-banner ' + kind; el.textContent = message || '';
 }

 function resetDialogue(forget=true) {
   const oldRole = dialogue.role || state.role;
   dialogueRevision++; dialogueBusy = false; dialogueRequest = null;
   dialogue = {role:'', turns:[], summary:'', origin:'', generation:null};
   if (forget && oldRole) {
     try { sessionStorage.removeItem('practice-dialogue:' + oldRole); sessionStorage.removeItem('practice-generated:' + oldRole); sessionStorage.removeItem('practice-request:' + oldRole); } catch {}
   }
   if ($('#question')) $('#question').readOnly = false;
   if ($('#answer')) $('#answer').readOnly = false;
   dialogueStatus(''); renderDialogue();
 }

 function renderDialogue() {
   const stream = $('#dialogue-stream'); if (!stream) return;
   const historyOpen = !!stream.querySelector?.('.dialogue-history')?.open;
   const origins = {source:'已确认的来源题', debrief:'个人面试记录', ai:'AI 生成题', user:'手动输入的题目'};
   let html = '';
   if (dialogue.turns.length) {
     if (dialogue.sourceAvailable === false) html += '<p class="dialogue-empty">原题来源已不可用，以下保留的是当时的练习记录。</p>';
     const renderTurn = (turn,index) => `
       <div class="dialogue-message"><strong>${index ? 'AI 追问' : escapeHtml(origins[dialogue.origin] || '练习题')}</strong><p>${escapeHtml(turn.question)}</p></div>
       <div class="dialogue-message dialogue-message--answer"><strong>你的回答</strong><p>${escapeHtml(turn.answer)}</p></div>
       <div class="dialogue-message dialogue-message--feedback"><strong>AI 点评 · 仅供参考</strong><p>${escapeHtml(turn.feedback)}</p>${turn.coaching ? `<details class="coaching-details"><summary>查看点评依据与建议</summary><p class="coaching-focus"><b>本题重点</b> ${escapeHtml(turn.coaching.focus)}</p><p class="coaching-evidence"><b>回答摘录</b> “${escapeHtml(turn.coaching.evidence)}”</p><p class="coaching-next"><b>可以再练</b> ${escapeHtml(turn.coaching.next_step)}</p></details>` : '<p class="coaching-unverified">本条点评没有可核对的回答摘录。</p>'}</div>`;
     const previous = dialogue.summary ? dialogue.turns : dialogue.turns.slice(0,-1);
     if (previous.length) html += `<details class="dialogue-history"${historyOpen ? ' open' : ''}><summary>查看之前的 ${previous.length} 轮对话</summary><div class="dialogue-history-content">${previous.map(renderTurn).join('')}</div></details>`;
     if (!dialogue.summary) html += renderTurn(dialogue.turns.at(-1),dialogue.turns.length-1);
     const last = dialogue.turns[dialogue.turns.length - 1];
     if (!dialogue.summary && last.follow_up && dialogue.turns.length < 8) html += `<div class="dialogue-message"><strong>AI 追问 · 非原帖问题</strong><p>${escapeHtml(last.follow_up)}</p></div>`;
     if (dialogue.summary) {
       const coaching = [...dialogue.turns].reverse().find(turn=>turn.coaching)?.coaching;
       html += `<div class="dialogue-message dialogue-message--summary"><strong>本题总结 · AI 生成，仅供参考</strong><p>${escapeHtml(dialogue.summary)}</p>${coaching ? `<div class="coaching-action"><p>下一步：${escapeHtml(coaching.next_step)}</p><button type="button" class="practice-question-action" data-dialogue-reinforce ${dialogueBusy ? 'disabled' : ''}>生成一道针对性补练</button><small>会向 AI 发送本题完整对话和已确认的岗位要求；新题由 AI 生成。</small></div>` : ''}</div>`;
     }
     const rating = (state.attempts || []).find(item=>item.id===dialogue.turns[0].id)?.rating || 'unassessed';
     html += `<div class="review-assessment" aria-label="本题自评"><strong>这道题感觉怎么样？</strong><div class="review-actions"><button type="button" class="practice-question-action" data-dialogue-rating="revisit" aria-pressed="${rating==='revisit'}">需要再练</button><button type="button" class="practice-question-action" data-dialogue-rating="comfortable" aria-pressed="${rating==='comfortable'}">比较熟悉</button><button type="button" class="practice-question-action" data-dialogue-rating="unassessed" aria-pressed="${rating==='unassessed'}">暂不评价</button></div><span class="review-assessment-status" role="status">自评会影响题库推荐。</span></div>`;
   } else {
     html = '<div class="dialogue-empty">选择题目后开始回答，我们会围绕你的回答继续交流。</div>';
   }
   stream.innerHTML = html;
   const last = dialogue.turns[dialogue.turns.length - 1];
   const cannotContinue = !!dialogue.summary || (!!last && (!last.follow_up || dialogue.turns.length >= 8));
   $('#question').readOnly = dialogueBusy || (!!last && !dialogue.summary);
   $('#answer').readOnly = dialogueBusy || cannotContinue;
   $('#review-btn').disabled = dialogueBusy || cannotContinue;
   $('#review-btn').innerHTML = dialogueBusy ? '<span>处理中…</span>' : '<span>发送回答</span><span aria-hidden="true">→</span>';
   const choice=$('#recommendation-choice'); if (choice && last) choice.hidden=true;
   const focus=$('#role-coaching-focus'); if (focus) focus.hidden=!!last || !state.role || !state.roleCoaching?.focus;
   const finish = $('#dialogue-finish');
   finish.hidden = !last || !!dialogue.summary; finish.disabled = dialogueBusy;
   $('#pick-from-lib-btn').disabled = dialogueBusy;
 }

 async function restoreDialogue(role, draft) {
   if (!role) return;
   const revision = dialogueRevision;
   dialogue.role = role;
   let saved = null, generated = null;
   try {
     saved = JSON.parse(sessionStorage.getItem('practice-dialogue:' + role) || 'null');
     generated = JSON.parse(sessionStorage.getItem('practice-generated:' + role) || 'null');
     dialogueRequest = JSON.parse(sessionStorage.getItem('practice-request:' + role) || 'null');
   } catch {}
   if (generated?.question === $('#question').value && !draft?.parent_attempt_id) {
     dialogue.generation = generated; dialogue.origin = 'ai';
     setQuestionContext({text:generated.question,origin:'ai'});
   }
   const id = saved?.id || draft?.parent_attempt_id;
   if (!id) { renderDialogue(); return; }
   const currentQuestion = $('#question').value, currentAnswer = $('#answer').value;
   try {
     const result = await api('/api/practice/dialogue/' + encodeURIComponent(id) + '?role=' + encodeURIComponent(role));
     if (dialogueRevision !== revision || state.role !== role || $('#question').value !== currentQuestion || $('#answer').value !== currentAnswer) return;
     dialogue = {role,turns:result.turns || [],origin:result.origin || 'user',summary:result.summary || '',sourceAvailable:result.source_available,generation:null};
     renderDialogue();
     if (dialogue.summary) dialogueStatus('已恢复本题总结。');
     else if (dialogue.turns.length) dialogueStatus('已恢复本题对话与当前岗位草稿。');
   } catch (err) {
     if (dialogueRevision === revision && state.role === role) dialogueStatus('之前的对话暂时无法恢复，草稿仍在：' + err.message + '。可刷新重试。', 'error');
   }
 }

 $('#question').addEventListener('input', () => {
   if (dialogue.turns.length || (dialogue.generation && $('#question').value !== dialogue.generation.question)) resetDialogue();
 });

 $('#dialogue-stream').addEventListener('click', async e => {
   const reinforceButton=e.target.closest('[data-dialogue-reinforce]');
   if (reinforceButton) {
     if (dialogueBusy || !dialogue.summary || !dialogue.turns.length) return;
     const role=state.role, revision=dialogueRevision, roleAtSubmit=roleRevision;
     const question=$('#question').value, answer=$('#answer').value, last=dialogue.turns.at(-1);
     if (answer.trim() && !window.confirm('生成补练会替换当前未发送的回答，确定继续吗？')) return;
     dialogueBusy=true; renderDialogue(); dialogueStatus('正在根据本题对话生成 AI 补练题…','info');
     try {
       await writeDraft();
       if (state.role!==role || dialogueRevision!==revision || roleRevision!==roleAtSubmit) return;
       const result=await api('/api/practice/dialogue/reinforce','POST',{role,attempt_id:last.id});
       if (state.role!==role || dialogueRevision!==revision || roleRevision!==roleAtSubmit || $('#question').value!==question || $('#answer').value!==answer) return;
       if (!result.question || !result.generation_token) throw Error('生成题目无效，请重试');
       clearPracticeHelp(); clearRecommendationChoice(); resetDialogue();
       $('#question').value=result.question; $('#answer').value=''; $('#answer-char-count').textContent='0 字';
       dialogue.role=role; dialogue.origin='ai'; dialogue.generation={question:result.question,token:result.generation_token};
       try { sessionStorage.setItem('practice-generated:' + role, JSON.stringify(dialogue.generation)); } catch {}
       setQuestionContext({text:result.question,origin:'ai'}); scheduleDraft(); renderDialogue();
       dialogueStatus('已生成 AI 补练题；它不是原帖中的题目。'); $('#question').focus();
     } catch(err) { if (state.role===role && dialogueRevision===revision) dialogueStatus('补练题生成失败，原对话和草稿仍保留：' + err.message,'error'); }
     finally { if (state.role===role && dialogueRevision===revision) { dialogueBusy=false; renderDialogue(); } }
     return;
   }
   const button = e.target.closest('[data-dialogue-rating]');
   const first = dialogue.turns[0]; if (!button || !first) return;
   const status = $('#dialogue-stream .review-assessment-status');
   const role = state.role, revision = dialogueRevision;
   const ratingButtons = [...($('#dialogue-stream')?.querySelectorAll?.('[data-dialogue-rating]') || [button])];
   ratingButtons.forEach(item=>{ item.disabled=true; }); if (status) status.textContent='正在保存自评…';
   try {
     await api('/api/attempts/' + encodeURIComponent(first.id) + '/assessment','PUT',{rating:button.dataset.dialogueRating});
     if (role !== state.role || revision !== dialogueRevision) return;
     status.textContent = button.dataset.dialogueRating === 'revisit' ? '已保存：这题会优先推荐。' : button.dataset.dialogueRating === 'comfortable' ? '已保存：这题会稍后推荐。' : '已设为尚未自评。';
     ratingButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
     await refresh();
   } catch (err) { if (status && role === state.role && revision === dialogueRevision) status.textContent = '自评保存失败：' + err.message; }
   finally { ratingButtons.forEach(item=>{ item.disabled=false; }); }
 });

 const reviewForm = $('#review-form');
 if (reviewForm) reviewForm.addEventListener('submit', async e => {
   e.preventDefault(); if (dialogueBusy) return;
   const role = state.role, question = $('#question').value.trim(), answer = $('#answer').value.trim();
   if (!role) { dialogueStatus('请先设置目标岗位。','error'); return; }
   if (!question || !answer) { dialogueStatus('请先填写问题和回答。','error'); return; }
   if (question.length > 2000 || answer.length > 10000) { dialogueStatus('问题最多 2000 字，回答最多 10000 字；请缩短后再提交。','error'); return; }
   if (dialogue.summary || dialogue.turns.length >= 8) { dialogueStatus('本题已结束，请选择新题。','error'); return; }
   const payload = {role,question,answer,parent_attempt_id:questionContext?.parentId || '',question_ref:questionContext?.questionRef || null,generation_token:dialogue.generation?.question === question ? dialogue.generation.token : ''};
   const signature = JSON.stringify(payload);
   if (!dialogueRequest || dialogueRequest.signature !== signature) dialogueRequest = {signature,id:crypto.randomUUID()};
   payload.request_id = dialogueRequest.id;
   try { sessionStorage.setItem('practice-request:' + role, JSON.stringify(dialogueRequest)); } catch {}
   const revision = dialogueRevision, roleAtSubmit = roleRevision;
   dialogueBusy = true; renderDialogue(); dialogueStatus('正在围绕你的回答生成点评和追问…','info');
   try {
     await writeDraft();
     if (dialogueRevision !== revision || roleRevision !== roleAtSubmit || state.role !== role) return;
     const result = await api('/api/practice/dialogue/turn','POST',payload);
     if (dialogueRevision !== revision || roleRevision !== roleAtSubmit || state.role !== role) return;
     dialogue.role = role; dialogue.origin = dialogue.origin || result.origin || 'user';
     dialogue.turns.push({id:result.id,question,answer,feedback:result.feedback,follow_up:result.follow_up || '',coaching:result.coaching || null});
     dialogue.generation = null; dialogueRequest = null;
     try { sessionStorage.removeItem('practice-generated:' + role); sessionStorage.removeItem('practice-request:' + role); sessionStorage.setItem('practice-dialogue:' + role, JSON.stringify({id:result.id})); } catch {}
     const canFollow = result.follow_up && dialogue.turns.length < 8;
     if (canFollow) { $('#question').value = result.follow_up; setQuestionContext({text:result.follow_up,parentId:result.id}); }
     $('#answer').value = ''; $('#answer-char-count').textContent = '0 字';
     dialogueBusy = false; renderDialogue();
     dialogueStatus(canFollow ? '可以继续回答 AI 追问，也可以结束并总结。' : dialogue.turns.length >= 8 ? '本题已达到 8 轮上限，请结束并总结。' : '本题暂时没有更多追问，可以结束并总结。');
     try { await writeDraft(); } catch { dialogueStatus('本轮已保存，但新草稿保存失败；刷新后请从练习记录查看。','error'); }
     await refresh().catch(() => {});
     if (canFollow) $('#answer').focus({preventScroll:true});
     const feedbacks=$('#dialogue-stream')?.querySelectorAll?.('.dialogue-message--feedback');
     feedbacks?.[feedbacks.length - 1]?.scrollIntoView({block:'start'});
   } catch (err) {
     if (dialogueRevision === revision && state.role === role) dialogueStatus('发送失败，回答仍保留在输入框：' + err.message + '。可重试。','error');
   } finally {
     if (dialogueRevision === revision && state.role === role) { dialogueBusy = false; renderDialogue(); }
   }
 });

 $('#dialogue-finish').addEventListener('click', async () => {
   if (dialogueBusy || !dialogue.turns.length || dialogue.summary) return;
   if ($('#answer').value.trim() && !window.confirm('当前回答尚未发送。结束后它会保留在草稿中，确定结束并总结吗？')) return;
   const role = state.role, revision = dialogueRevision, roleAtSubmit = roleRevision;
   const last = dialogue.turns[dialogue.turns.length - 1];
   dialogueBusy = true; renderDialogue(); dialogueStatus('正在整理本题对话总结…','info');
   try {
     await writeDraft();
     if (dialogueRevision !== revision || roleRevision !== roleAtSubmit || state.role !== role) return;
     const result = await api('/api/practice/dialogue/summary','POST',{role,attempt_id:last.id});
     if (dialogueRevision !== revision || roleRevision !== roleAtSubmit || state.role !== role) return;
     dialogue.summary = result.summary; dialogueBusy = false; renderDialogue();
     dialogueStatus($('#answer').value.trim() ? '总结已保存，未发送的回答仍保留在草稿中。' : '总结已保存，可以选择下一题。');
     $('#dialogue-stream')?.querySelector?.('.dialogue-message--summary')?.scrollIntoView({block:'start'});
   } catch (err) { if (dialogueRevision === revision && state.role === role) dialogueStatus('总结失败，原有对话和草稿仍保留：' + err.message,'error'); }
   finally { if (dialogueRevision === revision && state.role === role) { dialogueBusy = false; renderDialogue(); } }
 });
 // Initial Startup
 const initialHash = window.location.hash.slice(1);
 if (initialHash && tabTitles[initialHash]) {
   switchTab(initialHash);
 } else {
   switchTab('dashboard');
 }

refresh().catch(e => toast.error('加载失败：' + e.message));
