import { randomUUID } from 'node:crypto';
import { addExtractedQuestion, setQuestionTopic } from './questions.js';
import { roleValidationStatus } from './role-validation.js';
import { careerPlan, resumeAbilities } from './career.js';
import { validateSource } from './core.js';
import { getProfile } from './workspace.js';

export function createAgentWorkflow({db,currentRole,research,extract,log}) {
  const pending = new Map();
  let researchActive = false;
  function requireRole(role) {
    if (!role || role !== currentRole() || !['valid','confirmed'].includes(roleValidationStatus(db,role))) {
      throw Error('当前目标岗位尚未核对，或已切换岗位');
    }
  }
  return async function handle(path,input,signal) {
    requireRole(input.role);
    const role = input.role;
    if (path==='/api/career/plan') return {body:careerPlan(db,role,input)};
    if (path==='/api/career/resume') {
      if (input.confirm !== true) throw Error('请先确认发送简历');
      if (!extract) return {status:503,body:{error:'尚未配置 AI 服务'}};
      const result = await resumeAbilities(input.resume,extract,AbortSignal.any([signal,AbortSignal.timeout(30000)]),
        getProfile(db,role).confirmed_requirements);
      requireRole(role);
      return {body:result};
    }
    if (path==='/api/research') {
      if (input.confirm !== true) throw Error('请确认公开查询关键词和正文处理范围');
      if (!research.providers.length) return {status:503,body:{error:'尚未配置 Tavily 或 Exa'}};
      if (researchActive) return {status:409,body:{error:'已有研究正在运行，请稍等或取消后再试'}};
      researchActive=true;
      try {
        const company=String(input.company || '').trim();
        const result=await research.run({role,company,source:input.source || 'all',range:input.range || 'year',topics:input.topics},{signal});
        log?.({event:'research_run',run_id:randomUUID(),stop:result.stop,rounds:result.rounds,usage:result.usage,
          tools:result.events,cached:result.cached,links:result.links.length,candidates:result.candidates.length});
        requireRole(role);
        signal.throwIfAborted();
        const expires=Date.now()+15*60*1000;
        for (const [id,item] of pending) if (item.expires <= Date.now()) pending.delete(id);
        const candidates=result.candidates.map(candidate=>{
          const id=randomUUID();
          if (pending.size>=128) pending.delete(pending.keys().next().value);
          pending.set(id,{candidate,expires,role});
          return {...candidate,id};
        });
        return {body:{...result,candidates}};
      } finally { researchActive=false; }
    }
    if (path==='/api/research/confirm') {
      const item=pending.get(input.id);
      if (!item || item.role!==role || item.expires<=Date.now()) throw Error('候选题已过期，请重新研究');
      const {candidate}=item;
      const type=input.self_reported===true?'真实面经（自述）':'来源未知';
      const source=validateSource({title:candidate.title.slice(0,1000),url:candidate.url,date:candidate.date,type,role});
      const saved=db.prepare('SELECT id FROM sources WHERE url=? AND role=? ORDER BY created LIMIT 1').get(source.url,role);
      const sourceId=saved?.id || randomUUID();
      db.exec('BEGIN');
      try {
        if (!saved) db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created,interview_date) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(sourceId,source.title,source.url,source.date,source.type,'',role,new Date().toISOString(),'');
        const question=addExtractedQuestion(db,sourceId,candidate.question,candidate.evidence,input.id);
        if (candidate.topic && !question.reused) setQuestionTopic(db,'source',question.id,candidate.topic,sourceId);
        db.exec('COMMIT');
        return {status:question.reused?200:201,body:{id:question.id,source_id:sourceId,text:question.text}};
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    throw Error('未找到接口');
  };
}
