// Drafts are scoped by source and stay in this page session until refresh.
export function createSourceExtraction({api,getSource,refresh,escapeHtml,toast}) {
  const drafts=new Map();
  const get=id=>{if(!drafts.has(id)) drafts.set(id,{text:'',basis:'',items:[],index:0,busy:'',message:'',open:false}); return drafts.get(id);};
  const count=text=>Array.from(text).length;
  let container;
  const render=source=>{
    const d=get(source.id), id=escapeHtml(source.id), stale=d.items.length && d.text!==d.basis;
    const disabled=!!d.busy;
    const item=d.items[d.index], saved=d.items.filter(candidate=>candidate.saved).length;
    return `<details class="ai-extract-panel" data-extract-panel="${id}" ${d.open?'open':''}>
      <summary>AI 从原文提取题目</summary>
      <div class="ai-extract-body">
        <p>请粘贴与此来源对应的原文。点击提取会将完整内容发送给已配置的 AI 服务，最多 12000 个字符；超出请分段。原文和候选仅保留在当前页面，刷新会清空；确认保存的题目与摘录会进入本机数据库和备份。</p>
        <label for="extract-${id}">面经原文</label>
        <textarea id="extract-${id}" data-extract-text="${id}" rows="5" ${disabled?'disabled':''} placeholder="粘贴原帖中的面试内容">${escapeHtml(d.text)}</textarea>
        <div class="ai-extract-actions"><button type="button" class="apple-btn apple-btn-secondary compact" data-extract-run="${id}" ${disabled?'disabled':''}>${d.busy==='extract'?'正在提取…':'提取候选题'}</button><span data-extract-count>${count(d.text)} / 12000 字符</span></div>
        <p class="ai-extract-status" role="status" aria-live="polite" data-extract-status>${escapeHtml((d.message ? d.message+' ' : '')+(stale?'原文已修改，旧候选暂不能保存；请重新提取或恢复原文。':''))}</p>
        ${item?`<div class="ai-candidates"><p>请对照原帖和摘录逐题核对；摘录出现在粘贴内容中不代表已核实原帖。</p><div class="candidate-progress" tabindex="-1" role="status" aria-live="polite">候选题 ${d.index+1} / ${d.items.length} · 已保存 ${saved} 题</div><article class="ai-candidate"><label for="candidate-${escapeHtml(item.id)}">核对并修改题目</label><textarea id="candidate-${escapeHtml(item.id)}" rows="2" data-extract-question="${id}" data-candidate="${escapeHtml(item.id)}" ${disabled||item.saved?'disabled':''}>${escapeHtml(item.text)}</textarea><p class="ai-evidence-label">粘贴内容中的原文依据</p><blockquote>${escapeHtml(item.evidence)}</blockquote><div class="candidate-actions"><button type="button" class="apple-btn apple-btn-primary compact" data-extract-save="${id}" data-candidate="${escapeHtml(item.id)}" ${disabled||item.saved||stale?'disabled':''}>${d.busy==='save'?'正在保存…':item.saved?'已保存':'确认并保存'}</button><button type="button" class="apple-btn apple-btn-secondary compact" data-extract-prev="${id}" ${disabled||d.index===0?'disabled':''}>上一题</button><button type="button" class="apple-btn apple-btn-secondary compact" data-extract-next="${id}" ${disabled||d.index===d.items.length-1?'disabled':''}>下一题</button></div><p class="candidate-hint">切换题目不会保存，未保存的修改在本页面保留。</p></article></div>`:''}
      </div></details>`;
  };
  function redraw(id, focusProgress=false) {
    const source=getSource(id);
    const panel=[...(container?.querySelectorAll('[data-extract-panel]') || [])].find(item=>item.dataset.extractPanel===id);
    if(source && panel) {
      panel.outerHTML=render(source);
      if(focusProgress) [...container.querySelectorAll('[data-extract-panel]')].find(item=>item.dataset.extractPanel===id)?.querySelector('.candidate-progress')?.focus();
    }
  }
  function attach(element) {
    container=element;
    element.addEventListener('toggle',e=>{const panel=e.target.closest?.('[data-extract-panel]'); if(panel && panel===e.target) get(panel.dataset.extractPanel).open=panel.open;},true);
    element.addEventListener('input',e=>{
      const raw=e.target.closest?.('[data-extract-text]');
      if(raw) {
        const d=get(raw.dataset.extractText); d.text=raw.value; d.message='';
        const panel=raw.closest('[data-extract-panel]'), stale=d.items.length && d.text!==d.basis;
        const counter=panel?.querySelector('[data-extract-count]'); if(counter) counter.textContent=`${count(d.text)} / 12000 字符`;
        const status=panel?.querySelector('[data-extract-status]'); if(status) status.textContent=stale?'原文已修改，旧候选暂不能保存；请重新提取或恢复原文。':d.message;
        panel?.querySelectorAll('[data-extract-save]').forEach(button=>{const item=d.items.find(x=>x.id===button.dataset.candidate);button.disabled=!!d.busy || !!item?.saved || !!stale;});
      }
      const field=e.target.closest?.('[data-extract-question]');
      if(field) {const d=get(field.dataset.extractQuestion), item=d.items.find(x=>x.id===field.dataset.candidate); if(item&&!item.saved) item.text=field.value;}
    });
    element.addEventListener('click',async e=>{
      const previous=e.target.closest?.('[data-extract-prev]'), next=e.target.closest?.('[data-extract-next]');
      if(previous || next) {
        const id=previous ? previous.dataset.extractPrev : next.dataset.extractNext, d=get(id);
        if(d.busy) return;
        d.index=Math.max(0,Math.min(d.items.length-1,d.index+(previous?-1:1))); d.message=''; redraw(id,true);
        return;
      }
      const run=e.target.closest?.('[data-extract-run]');
      if(run) {
        const id=run.dataset.extractRun, d=get(id), source=getSource(id);
        if(!source || d.busy) return;
        if(!d.text.trim()) {d.message='请先粘贴面经原文。';d.open=true;redraw(id);return;}
        if(count(d.text)>12000) {d.message='原文超过 12000 个字符，请分段后再提取；本次未发送。';d.open=true;redraw(id);return;}
        if(d.items.some(item=>!item.saved) && !window.confirm('重新提取会替换当前未保存的候选题，确定继续吗？')) return;
        const raw=d.text, sourceUrl=source.url, sourceRole=source.role; d.busy='extract'; d.message='正在提取，请稍候…'; d.open=true; redraw(id);
        try {
          const result=await api('/api/sources/'+encodeURIComponent(id)+'/extract-questions','POST',{source_text:raw});
          if(getSource(id)?.url!==sourceUrl || getSource(id)?.role!==sourceRole) {d.message='来源已变化，请重新打开后提取。'; return;}
          d.basis=raw; d.sourceUrl=sourceUrl; d.sourceRole=sourceRole; d.items=result.items.map(item=>({id:item.id,text:item.question,evidence:item.evidence,saved:false})); d.index=0;
          d.message=d.items.length?`找到 ${d.items.length} 道候选题，请逐题核对。`:'没有找到可核对的候选题，可以检查原文或手动添加。';
          if(result.omitted) d.message+=` 已排除 ${result.omitted} 条重复、格式无效或原文依据无法核对的候选。`;
        } catch(err) {d.message='提取失败：'+err.message+'；原文和已有候选已保留。';}
        finally {d.busy=''; redraw(id);}
        return;
      }
      const save=e.target.closest?.('[data-extract-save]');
      if(!save) return;
      const id=save.dataset.extractSave, d=get(id), item=d.items.find(x=>x.id===save.dataset.candidate);
      if(!item || item.saved || d.busy || d.text!==d.basis) return;
      const source=getSource(id);
      if(!source || source.url!==d.sourceUrl || source.role!==d.sourceRole) {d.message='来源已变化，请重新打开后提取。'; redraw(id); return;}
      const text=item.text.trim();
      if(!text || text.length>2000) {d.message='题目不能为空且不能超过 2000 字，请修改后再保存。';redraw(id);return;}
      d.busy='save'; d.message='正在保存题目…'; d.open=true; redraw(id);
      try {
        await api('/api/sources/'+encodeURIComponent(id)+'/extracted-questions','POST',{text,evidence:item.evidence,source_text:d.basis,request_id:item.id,expected_source:{url:d.sourceUrl,role:d.sourceRole}});
        item.saved=true; d.message='题目和原文依据已保存。';
        try {await refresh();} catch {d.message='题目已保存，但资料库刷新失败；请刷新后查看，避免重复保存。';}
      } catch(err) {d.message='保存失败：'+err.message+'。可重试；题目和原文已保留。';}
      finally {d.busy=''; redraw(id);}
    });
  }
  return {render,attach,isBusy:id=>!!drafts.get(id)?.busy,forget:id=>drafts.delete(id)};
}
