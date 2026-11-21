import { renderAbilityEvaluation } from './ability-evaluation.js';

export function mountPractice({api:send,fetchLocal,refresh,toast,escapeHtml,openSource,openTab,onAnswered,onCompleted,onAssessed,onTraining}) {
 const $ = selector => document.querySelector(selector);
 const $$ = selector => document.querySelectorAll(selector);
 let state = {role:'',sources:[],attempts:[]};
 let roleRevision = 0;
 const agents = {answered:onAnswered,completed:onCompleted,assessed:onAssessed};
 const requests = new Set();
 async function api(path, method = 'GET', data, signal) {
   const controller = new AbortController();
   requests.add(controller);
   const abort = () => controller.abort();
   if (signal?.aborted) abort();
   else signal?.addEventListener('abort',abort,{once:true});
   try { return await send(path,method,data,controller.signal); }
   finally { requests.delete(controller); signal?.removeEventListener('abort',abort); }
 }
 let draftLoadedRole = null;
 let draftTimer;
 let draftWrite = Promise.resolve();
 let questionContext = null;
 let helpRequestId = 0;
 let helpController = null;
 let recommendationRequestId = 0;
 let pendingRecommendation = null;
 let dialogue = {role:'', turns:[], summary:'', origin:'', generation:null};
 let dialogueRevision = 0;
 let dialogueBusy = false;
 let dialogueRequest = null;
 let practiceAutopickRole = null;
 function writeDraft() {
   clearTimeout(draftTimer);
   const role = state.role;
   if (!role) return draftWrite;
    const payload = {role, question: $('#question').value, answer: $('#answer').value, parent_attempt_id:questionContext?.parentId || '', question_ref:questionContext?.questionRef || null};
   $('#draft-status').textContent = '正在保存草稿…';
   draftWrite = draftWrite.catch(() => {}).then(() => send('/api/draft', 'PUT', payload)).then(() => {
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
   renderQuestionContext();
 }

 function renderQuestionContext() {
   const el=$('#question-context'); if(!el) return;
   el.replaceChildren(); el.hidden=!questionContext;
   if(!questionContext) return;
   if(questionContext.origin === 'ai') { el.textContent='AI 生成题 · 非真实面经，仅供练习。'; return; }
   if(questionContext.parentId) {
     el.textContent='正在回答 AI 追问；点评会发送本题之前的完整对话。';
     const attempt=(state.attempts || []).find(item=>item.id===(dialogue.turns[0]?.id || questionContext.parentId) && item.role===state.role);
     const sourceId=questionContext.sourceQuestionId || (attempt?.question_link_kind==='source' ? attempt.question_link_id : '');
     if(sourceId) appendPracticeSourceLink(el,sourceId);
     return;
   }
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
   const ref=questionContext.questionRef;
   if(ref?.kind==='source') appendPracticeSourceLink(el,ref.id);
 }

 function appendPracticeSourceLink(el,questionId) {
   if(state.sources.some(source=>source.role===state.role && (source.questions || []).some(question=>question.id===questionId))) {
     const button=document.createElement('button'); button.type='button'; button.className='text-link-action'; button.textContent='在资料库查看原题';
     button.addEventListener('click',()=>openSource(questionId)); el.append(button);
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

 function loadPracticeQuestion(text,{restart=false}={}) {
   if (restart && dialogueBusy) return false;
   const question = $('#question');
   const answer = $('#answer');
   const replacing=question.value!==text || (restart && !!dialogue.turns.length);
   if (replacing && answer.value.trim() && !window.confirm('切换题目会替换当前回答，确定继续吗？')) return false;
   if (replacing && typeof resetDialogue === 'function') resetDialogue();
   if (replacing) {
     clearPracticeHelp(); clearRecommendationChoice();
     answer.value = ''; $('#answer-char-count').textContent = '0 字';
   }
    question.value = text;
    setQuestionContext(null);
   scheduleDraft();
   return true;
 }

 function practiceSourceQuestion(source, target) {
   if ((!state.role || source.role !== state.role) && !window.confirm(`此题来自「${source.role || '岗位未知'}」，将按当前岗位「${state.role || '未设置'}」进行练习。是否继续？`)) return false;
   if (!loadPracticeQuestion(target.text)) return false;
   const matches = state.sources.filter(item => item.role === source.role && (item.questions || []).some(question => question.text.trim() === target.text.trim()));
   const sources = (matches.length ? matches : [source]).map(item => ({title:item.title,url:item.url,date:item.date,type:item.type}));
   setQuestionContext({text:target.text,questionRef:source.role===state.role ? {kind:'source',id:target.id} : null,topics:target.topic ? [target.topic] : [],sources});
   openTab('practice');
   $('#answer')?.focus();
   toast('考题已载入复习面板');
   return true;
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
    fetchLocal('/api/draft', {method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify({role:state.role,question:$('#question').value,answer:$('#answer').value,parent_attempt_id:questionContext?.parentId || '',question_ref:questionContext?.questionRef || null}), keepalive:true}).catch(() => {});
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
 function useRecommendedQuestion(recommended,options) {
   if (!loadPracticeQuestion(recommended.text,options)) return false;
   clearRecommendationChoice();
   setQuestionContext({text:recommended.text,questionRef:recommended.question_ref || null,reason:recommended.reason,reasonDetails:recommended.reasonDetails,topics:recommended.topics,sources:recommended.sources,sourceTitle:recommended.sourceTitle,sourceUrl:recommended.sourceUrl});
   $('#answer')?.focus();
   if (recommended.reason) toast(`推荐原因：${recommended.reason} · 来源：${recommended.sourceTitle || '来源未知'}`);
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
     rememberGeneration(dialogue.generation);
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


 // AI Review submission
 async function practiceFingerprint(text) {
   const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
   return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 }

 function rememberGeneration(generation) {
   practiceFingerprint(generation.question).then(signature=>{
     if (dialogue.generation===generation) storePractice('generated',{signature,token:generation.token});
   }).catch(()=>{});
 }

 function storePractice(kind, value) {
   if (!state.practiceScope) return;
   const key = `offerpilot-practice:${state.practiceScope}:${kind}`;
   try {
     if (value) sessionStorage.setItem(key,JSON.stringify(value));
     else sessionStorage.removeItem(key);
   } catch {}
 }

 function readPractice(kind) {
   if (!state.practiceScope) return null;
   try { return JSON.parse(sessionStorage.getItem(`offerpilot-practice:${state.practiceScope}:${kind}`)); }
   catch { return null; }
 }
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
   for (const controller of requests) controller.abort();
   requests.clear();
   dialogueRevision++; dialogueBusy = false; dialogueRequest = null;
   dialogue = {role:'', turns:[], summary:'', origin:'', generation:null};
   if (forget) for (const kind of ['dialogue','generated','request']) storePractice(kind,null);
   if ($('#question')) $('#question').readOnly = false;
   if ($('#answer')) $('#answer').readOnly = false;
   if ($('#save-local-practice')) $('#save-local-practice').disabled = false;
   if ($('#practice-generate')) $('#practice-generate').disabled = false;
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
       <div class="dialogue-message dialogue-message--feedback"><strong>AI 点评 · 仅供参考</strong><p>${escapeHtml(turn.feedback)}</p>${turn.coaching ? `<details class="coaching-details"><summary>查看点评依据与建议</summary><p class="coaching-focus"><b>本题重点</b> ${escapeHtml(turn.coaching.focus)}</p><p class="coaching-evidence"><b>回答摘录</b> “${escapeHtml(turn.coaching.evidence)}”</p><p class="coaching-next"><b>可以再练</b> ${escapeHtml(turn.coaching.next_step)}</p></details>` : '<p class="coaching-unverified">本条点评没有可核对的回答摘录。</p>'}${renderAbilityEvaluation(turn.evaluation,escapeHtml)}</div>`;
     const previous = dialogue.summary ? dialogue.turns : dialogue.turns.slice(0,-1);
     if (previous.length) html += `<details class="dialogue-history"${historyOpen ? ' open' : ''}><summary>查看之前的 ${previous.length} 轮对话</summary><div class="dialogue-history-content">${previous.map(renderTurn).join('')}</div></details>`;
     if (!dialogue.summary) html += renderTurn(dialogue.turns.at(-1),dialogue.turns.length-1);
     const last = dialogue.turns[dialogue.turns.length - 1];
     if (!dialogue.summary && !dialogue.inactive && last.follow_up && dialogue.turns.length < 8) html += `<div class="dialogue-message"><strong>AI 追问 · 非原帖问题</strong><p>${escapeHtml(last.follow_up)}</p></div>`;
     if (dialogue.summary) {
       const coaching = [...dialogue.turns].reverse().find(turn=>turn.coaching)?.coaching;
       html += `<div class="dialogue-message dialogue-message--summary"><strong>本题总结 · AI 生成，仅供参考</strong><p>${escapeHtml(dialogue.summary)}</p>${coaching ? `<div class="coaching-action"><p>下一步：${escapeHtml(coaching.next_step)}</p><button type="button" class="practice-question-action" data-dialogue-reinforce ${dialogueBusy ? 'disabled' : ''}>生成一道针对性补练</button><small>会向 AI 发送本题完整对话和已确认的岗位要求；新题由 AI 生成。</small></div>` : ''}</div>`;
     }
     if (dialogue.summary || !last.follow_up || dialogue.inactive) html += '<button type="button" class="practice-question-action" data-dialogue-training>查看下一步备战计划</button>';
     const rating = (state.attempts || []).find(item=>item.id===dialogue.turns[0].id)?.rating || 'unassessed';
     html += `<div class="review-assessment" aria-label="本题自评"><strong>这道题感觉怎么样？</strong><div class="review-actions"><button type="button" class="practice-question-action" data-dialogue-rating="revisit" aria-pressed="${rating==='revisit'}">需要再练</button><button type="button" class="practice-question-action" data-dialogue-rating="comfortable" aria-pressed="${rating==='comfortable'}">比较熟悉</button><button type="button" class="practice-question-action" data-dialogue-rating="unassessed" aria-pressed="${rating==='unassessed'}">暂不评价</button></div><span class="review-assessment-status" role="status">自评会影响题库推荐。</span></div>`;
   } else {
     html = '<div class="dialogue-empty">选择题目后开始回答，我们会围绕你的回答继续交流。</div>';
   }
   stream.innerHTML = html;
   const last = dialogue.turns[dialogue.turns.length - 1];
   const cannotContinue = !!dialogue.summary || !!dialogue.inactive || (!!last && (!last.follow_up || dialogue.turns.length >= 8));
   $('#question').readOnly = dialogueBusy || (!!last && !dialogue.summary);
   $('#answer').readOnly = dialogueBusy || cannotContinue;
   $('#review-btn').disabled = dialogueBusy || cannotContinue;
   $('#review-btn').innerHTML = dialogueBusy ? '<span>处理中…</span>' : '<span>发送回答</span><span aria-hidden="true">→</span>';
   const choice=$('#recommendation-choice'); if (choice && last) choice.hidden=true;
   const focus=$('#role-coaching-focus'); if (focus) focus.hidden=!!last || !state.role || !state.roleCoaching?.focus;
   const finish = $('#dialogue-finish');
   finish.hidden = !last || !!dialogue.summary || !!dialogue.inactive; finish.disabled = dialogueBusy;
   $('#pick-from-lib-btn').disabled = dialogueBusy;
 }

 async function restoreDialogue(role, draft) {
   if (!role) return;
   const revision = dialogueRevision;
   dialogue.role = role;
   const saved = readPractice('dialogue'), generated = readPractice('generated');
   dialogueRequest = readPractice('request');
   const currentQuestion = $('#question').value, currentAnswer = $('#answer').value;
   if (generated && currentQuestion && !draft?.parent_attempt_id) {
     const signature = await practiceFingerprint(currentQuestion);
     if (dialogueRevision !== revision || state.role !== role || $('#question').value !== currentQuestion) return;
     if (generated.signature === signature) {
       dialogue.generation = {question:currentQuestion,token:generated.token}; dialogue.origin = 'ai';
       setQuestionContext({text:currentQuestion,origin:'ai'});
     }
   }
   const id = saved?.id || draft?.parent_attempt_id;
   if (!id) { renderDialogue(); return; }
   try {
     const result = await api('/api/practice/dialogue/' + encodeURIComponent(id) + '?role=' + encodeURIComponent(role));
     if (dialogueRevision !== revision || state.role !== role || $('#question').value !== currentQuestion || $('#answer').value !== currentAnswer) return;
     dialogue = {role,turns:result.turns || [],origin:result.origin || 'user',summary:result.summary || '',sourceAvailable:result.source_available,generation:null,
       inactive:result.can_continue===false && !result.summary && !!result.turns?.at(-1)?.follow_up};
     if (typeof renderQuestionContext === 'function') renderQuestionContext();
     renderDialogue();
     if (dialogue.summary) dialogueStatus('已恢复本题总结。');
     else if (dialogue.inactive) dialogueStatus('这道追问已有后续回答。可以查看练习记录或选择下一步。');
     else if (dialogue.turns.length) dialogueStatus('已恢复本题对话与当前岗位草稿。');
   } catch (err) {
     if (dialogueRevision === revision && state.role === role) dialogueStatus('之前的对话暂时无法恢复，草稿仍在：' + err.message + '。可刷新重试。', 'error');
   }
 }

 async function openFollowup({parent_attempt_id:id,question}) {
   const role=state.role, revision=roleRevision, session=dialogueRevision;
   if (!role || dialogueBusy || $('#save-local-practice')?.disabled) return false;
   const result=await api('/api/practice/dialogue/'+encodeURIComponent(id)+'?role='+encodeURIComponent(role));
   if (revision!==roleRevision || session!==dialogueRevision || dialogueBusy || $('#save-local-practice')?.disabled) return false;
   if (!result.can_continue || result.turns?.at(-1)?.follow_up!==question) throw Error('这道追问已变化，请重新安排下一步。');
   const sameDraft=questionContext?.parentId===id && $('#question').value===question;
   if (!sameDraft) {
     if ($('#answer').value.trim() && !window.confirm('继续追问会替换当前未发送的回答，确定继续吗？')) return false;
     resetDialogue(); clearPracticeHelp(); clearRecommendationChoice();
     $('#answer').value=''; $('#answer-char-count').textContent='0 字';
   }
   dialogue={role,turns:result.turns,origin:result.origin,summary:'',sourceAvailable:result.source_available,generation:null};
   $('#question').value=question;
   setQuestionContext({text:question,parentId:id});
   storePractice('dialogue',{id});
   scheduleDraft(); renderDialogue();
   dialogueStatus('已恢复本题，可以回答追问或结束总结。');
   $('#answer').focus();
   return true;
 }

 $('#question').addEventListener('input', () => {
   if (dialogue.turns.length || (dialogue.generation && $('#question').value !== dialogue.generation.question)) resetDialogue();
 });

 $('#dialogue-stream').addEventListener('click', async e => {
   if (e.target.closest('[data-dialogue-training]')) { onTraining?.(); return; }
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
       rememberGeneration(dialogue.generation);
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
     if (typeof agents !== 'undefined') agents.assessed();
     const suggestion=$('#today-practice-status'); if (suggestion) suggestion.textContent='';
     ratingButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
     await refresh();
   } catch (err) { if (status && role === state.role && revision === dialogueRevision) status.textContent = '自评保存失败：' + err.message; }
   finally { ratingButtons.forEach(item=>{ item.disabled=false; }); }
 });

 const reviewForm = $('#review-form');
 if (reviewForm) reviewForm.addEventListener('submit', async e => {
   e.preventDefault(); if (dialogueBusy || $('#save-local-practice')?.disabled) return;
   const role = state.role, question = $('#question').value.trim(), answer = $('#answer').value.trim();
   if (!role) { dialogueStatus('请先设置目标岗位。','error'); return; }
   if (!question || !answer) { dialogueStatus('请先填写问题和回答。','error'); return; }
   if (question.length > 2000 || answer.length > 10000) { dialogueStatus('问题最多 2000 字，回答最多 10000 字；请缩短后再提交。','error'); return; }
   if (dialogue.summary || dialogue.inactive || dialogue.turns.length >= 8) { dialogueStatus('本题无法继续，请查看练习记录或选择新题。','error'); return; }
   const payload = {role,question,answer,parent_attempt_id:questionContext?.parentId || '',question_ref:questionContext?.questionRef || null,generation_token:dialogue.generation?.question === question ? dialogue.generation.token : ''};
   const revision = dialogueRevision, roleAtSubmit = roleRevision;
   dialogueBusy = true; renderDialogue(); dialogueStatus('正在围绕你的回答生成点评和追问…','info');
   try {
     const signature = await practiceFingerprint(JSON.stringify(payload));
     if (dialogueRevision !== revision || roleRevision !== roleAtSubmit || state.role !== role) return;
     if (!dialogueRequest || dialogueRequest.signature !== signature) dialogueRequest = {signature,id:crypto.randomUUID()};
     payload.request_id = dialogueRequest.id;
     storePractice('request',dialogueRequest);
     await writeDraft();
     if (dialogueRevision !== revision || roleRevision !== roleAtSubmit || state.role !== role) return;
     const result = await api('/api/practice/dialogue/turn','POST',payload);
     if (dialogueRevision !== revision || roleRevision !== roleAtSubmit || state.role !== role) return;
     dialogue.role = role; dialogue.origin = dialogue.origin || result.origin || 'user';
     dialogue.turns.push({id:result.id,question,answer,feedback:result.feedback,follow_up:result.follow_up || '',coaching:result.coaching || null,evaluation:result.evaluation || null});
     if (typeof agents !== 'undefined') agents.answered?.(questionContext?.questionRef,dialogue.turns[0].id);
     dialogue.generation = null; dialogueRequest = null;
     storePractice('generated',null); storePractice('request',null); storePractice('dialogue',{id:result.id});
     const canFollow = result.follow_up && dialogue.turns.length < 8;
     if (canFollow) { const sourceQuestionId=questionContext?.sourceQuestionId || (questionContext?.questionRef?.kind==='source' ? questionContext.questionRef.id : ''); $('#question').value = result.follow_up; setQuestionContext({text:result.follow_up,parentId:result.id,sourceQuestionId}); }
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
     if (typeof agents !== 'undefined') agents.completed(dialogue.turns[0].id,result.summary);
     dialogueStatus($('#answer').value.trim() ? '总结已保存，未发送的回答仍保留在草稿中。' : '总结已保存，可以选择下一题。');
     $('#dialogue-stream')?.querySelector?.('.dialogue-message--summary')?.scrollIntoView({block:'start'});
   } catch (err) { if (dialogueRevision === revision && state.role === role) dialogueStatus('总结失败，原有对话和草稿仍保留：' + err.message,'error'); }
   finally { if (dialogueRevision === revision && state.role === role) { dialogueBusy = false; renderDialogue(); } }
 });
 // Initial Startup
 function renderReturnPractice() {
   const panel=$('#return-practice');
   if (!panel) return;
   const hasQuestions = state.sources.some(source=>source.role===state.role && source.questions?.length) ||
     (state.debriefs || []).some(item=>item.role===state.role && item.include_in_library);
   panel.hidden=!state.role || (!hasQuestions && !state.draft?.question?.trim());
   const draft=state.draft?.question?.trim() || '';
   $('#resume-draft').hidden=!draft;
   $('#return-draft').textContent=draft ? '已保留草稿：'+draft : '查看当前岗位的下一道推荐题。';
 }
 $('#today-practice')?.addEventListener('click',async event=>{
   const button=event.currentTarget, status=$('#today-practice-status'), role=state.role, revision=roleRevision;
   button.disabled=true;status.textContent='正在从本机题库选择…';
   try {
     const {question}=await api('/api/recommendation','POST',{role});
     if (revision!==roleRevision) return;
     if (!question) {status.textContent='本岗位还没有题目，可以先添加面经或题目。';return;}
     status.textContent=`${question.text} · ${question.reason}。${question.reasonDetails || ''}`;
     const start=document.createElement('button');
     start.type='button';start.className='apple-btn apple-btn-secondary compact';start.textContent='练习这题';
     start.addEventListener('click',()=>{if(revision===roleRevision && useRecommendedQuestion(question)) openTab('practice');});
     status.append(' ',start);
   } catch(error){if(revision===roleRevision) status.textContent=error.message;}
   finally{button.disabled=false;}
 });
 let localRequest;
 $('#save-local-practice')?.addEventListener('click',async event=>{
   const button=event.currentTarget, role=state.role, revision=roleRevision, sessionRevision=dialogueRevision;
   if (dialogueBusy || dialogue.turns.length) {dialogueStatus('请结束当前 AI 对话，或选择新题后仅保存作答。','error');return;}
   const question=$('#question').value.trim(), answer=$('#answer').value.trim();
   if(!role || !question || !answer) {dialogueStatus('请先设置岗位、填写题目和回答。','error');return;}
   const data={role,question,answer,question_ref:questionContext?.questionRef || null};
   const signature=JSON.stringify(data);
   if(localRequest?.signature!==signature) localRequest={signature,id:crypto.randomUUID()};
   const request = localRequest;
   button.disabled=true;
   try {
     const result=await api('/api/practice/local','POST',{...data,request_id:request.id});
     if(localRequest===request) localRequest=null;
     if(revision!==roleRevision || sessionRevision!==dialogueRevision) return;
     if($('#answer').value.trim()===answer && $('#question').value.trim()===question) {
       $('#answer').value=''; $('#answer-char-count').textContent='0 字';
       await writeDraft().catch(()=>{});
     }
     if (revision!==roleRevision || sessionRevision!==dialogueRevision) return;
     await refresh().catch(()=>{});
     if (revision!==roleRevision || sessionRevision!==dialogueRevision) return;
     dialogueStatus('作答已保存在本机，可以在下方记录自评。');
     const rating=document.querySelector(`[data-attempt-assessment="${result.id}"]`);
     rating?.focus();
   } catch(error){if(revision===roleRevision && sessionRevision===dialogueRevision) dialogueStatus(error.message,'error');}
   finally{if(revision===roleRevision && sessionRevision===dialogueRevision) button.disabled=false;}
 });
 $('#attempts-list')?.addEventListener('click',async event=>{
   const button=event.target.closest('[data-local-feedback]');
   if(!button || !window.confirm('获取点评会把这道题和这次回答完整发给已配置的 AI 服务。继续吗？')) return;
   button.disabled=true;
   const roleAtRequest=roleRevision;
   try {
     await api('/api/practice/local/'+encodeURIComponent(button.dataset.localFeedback)+'/feedback','POST',{role:state.role});
     if (roleAtRequest!==roleRevision) return;
     agents.answered?.();
     await refresh();toast.success('点评已添加到原记录');
   }
   catch(error){toast.error(error.message);button.disabled=false;}
 });

 function sync(nextState) {
   const changedRole = state.role !== nextState.role;
   if (changedRole) {
     roleRevision++;
     clearTimeout(draftTimer);
     clearPracticeHelp();
     clearRecommendationChoice();
     resetDialogue(false);
     const suggestion = $('#today-practice-status');
     if (suggestion) suggestion.textContent = '';
   }
   state = nextState;
   if (draftLoadedRole !== state.role) {
     $('#question').value = state.draft?.question || '';
     $('#answer').value = state.draft?.answer || '';
     $('#answer-char-count').textContent = `${$('#answer').value.length} 字`;
     $('#draft-status').textContent = state.role ? '已恢复本岗位草稿' : '设置岗位后可保存草稿';
     draftLoadedRole = state.role;
      questionContext = null;
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

   const roleFocus = $('#role-coaching-focus');
   if (roleFocus) {
     roleFocus.hidden = !!dialogue.turns.length || !state.role || !state.roleCoaching?.focus;
     roleFocus.textContent = state.role && state.roleCoaching?.focus ? `本岗位练习参考 · ${state.roleCoaching.name}：${state.roleCoaching.focus}` : '';
   }

   renderReturnPractice();
   if (changedRole) restoreDialogue(state.role,state.draft).then(maybeAutoSelectPractice).catch(() => {});
 }
 return {sync,flushDraft:writeDraft,enter:maybeAutoSelectPractice,openQuestion:useRecommendedQuestion,openSourceQuestion:practiceSourceQuestion,openFollowup};
}
