import { randomUUID } from 'node:crypto';
import { addExtractedQuestion, setQuestionTopic } from './questions.js';
import { roleValidationStatus } from './role-validation.js';
import { careerAbilityHistory, careerPlan, resumeAbilities } from './career.js';
import { validateSource } from './core.js';
import { getProfile } from './workspace.js';
import { topicKey } from './knowledge-names.js';
import { cancelTrainingTask,createTrainingTask,readTrainingTasks,settleTrainingSearch,startTrainingSearch } from './training-tasks.js';

export function createAgentWorkflow({db,currentRole,research,extract,log,clock=Date.now}) {
  const pending = new Map();
  let researchActive = false;
  let activeTask;
  function requireRole(role) {
    if (!role || role !== currentRole() || !['valid','confirmed'].includes(roleValidationStatus(db,role))) {
      throw Error('当前目标岗位尚未核对，或已切换岗位');
    }
  }
  return async function handle(path,input,signal) {
    requireRole(input.role);
    const role = input.role;
    if (path==='/api/career/plan') return {body:careerPlan(db,role,input)};
    if (path==='/api/career/ability-history') return {body:careerAbilityHistory(db,role)};
    if (path==='/api/training/tasks') {
      return {body:{[input.id?'task':'tasks']:readTrainingTasks(db,role,input.id,clock())}};
    }
    if (path==='/api/training/tasks/create') {
      const task=createTrainingTask(db,role,input,topic=>careerPlan(db,role,{topics:topic?[topic]:[]}).tasks
        .find(item=>item.action==='research' && topicKey(item.topic)===topicKey(topic)),clock());
      return {body:{task}};
    }
    if (path==='/api/training/tasks/cancel') {
      const task=cancelTrainingTask(db,role,input.id,clock());
      if (activeTask?.id===task.id && task.status==='cancelled') activeTask.controller.abort();
      return {body:{task}};
    }
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
      const task=input.task_id ? readTrainingTasks(db,role,input.task_id,clock()) : null;
      if (task && task.status!=='proposed') {
        return task.result ? {body:{...task.result,task_status:task.status,task_reason:task.reason}} :
          {status:409,body:{error:'此训练任务已启动或结束，请查看任务状态'}};
      }
      if (!research.providers.length) return {status:503,body:{error:'尚未配置 Tavily 或 Exa'}};
      if (researchActive) return {status:409,body:{error:'已有研究正在运行，请稍等或取消后再试'}};
      const taskController=task && new AbortController();
      if (task && !startTrainingSearch(db,task,clock())) return {status:409,body:{error:'此训练任务已启动'}};
      if (task) activeTask={id:task.id,controller:taskController};
      researchActive=true;
      try {
        const company=String(input.company || '').trim();
        const searchSignal=taskController ? AbortSignal.any([taskController.signal,...(signal?[signal]:[])]) : signal;
        const result=await research.run({role,company,source:input.source || 'all',range:input.range || 'year',
          topics:task ? task.research_request.topics : input.topics,
          ...(task ? {focus:task.research_request.focus} : {})},{signal:searchSignal});
        log?.({event:'research_run',run_id:randomUUID(),stop:result.stop,rounds:result.rounds,usage:result.usage,
          tools:result.events,cached:result.cached,links:result.links.length,candidates:result.candidates.length});
        requireRole(role);
        searchSignal?.throwIfAborted();
        if (task) {
          const candidates=result.candidates.map(candidate=>({...candidate,id:randomUUID()}));
          const finished={...result,candidates};
          const reason=candidates.length ? '' : result.stop==='deadline' ? 'timeout' :
            result.events.some(event=>event.tool==='model' && event.status==='failed') ? 'model_failed' :
            result.stop==='no_candidates' ? 'no_results' :
            ['search_unavailable','model_unavailable','cost_budget','model_budget'].includes(result.stop) ? result.stop : 'insufficient_evidence';
          settleTrainingSearch(db,task,candidates.length?'review':'failed',reason,finished);
          const saved=readTrainingTasks(db,role,task.id,clock());
          if (!saved.result) return {status:409,body:{error:'任务已取消或超时，请查看任务状态'}};
          return {body:{...saved.result,task_status:saved.status,task_reason:saved.reason}};
        }
        const expires=Date.now()+15*60*1000;
        for (const [id,item] of pending) if (item.expires <= Date.now()) pending.delete(id);
        const candidates=result.candidates.map(candidate=>{
          const id=randomUUID();
          if (pending.size>=128) pending.delete(pending.keys().next().value);
          pending.set(id,{candidate,expires,role});
          return {...candidate,id};
        });
        return {body:{...result,candidates}};
      } catch (error) {
        if (task) {
          const cancelled=signal?.aborted || taskController.signal.aborted;
          settleTrainingSearch(db,task,cancelled?'cancelled':'failed',cancelled?'cancelled':'research_failed');
        }
        throw error;
      } finally { researchActive=false;activeTask=null; }
    }
    if (path==='/api/research/confirm') {
      const task=input.task_id ? readTrainingTasks(db,role,input.task_id,clock()) : null;
      if (task && ['ready','completed'].includes(task.status) && task.candidate_id===input.id && task.question) {
        const {id,source_id,text}=task.question;
        return {body:{id,source_id,text}};
      }
      const item=pending.get(input.id);
      const candidate=task ? (task.status==='review' && task.result?.candidates.find(item=>item.id===input.id)) :
        item && item.role===role && item.expires>Date.now() && item.candidate;
      if (!candidate) throw Error('候选题已过期或不属于本次待核对任务');
      if (task && input.self_reported!==true) throw Error('请核对原帖并确认属于作者自述面经');
      const type=input.self_reported===true?'真实面经（自述）':'来源未知';
      const source=validateSource({title:candidate.title.slice(0,1000),url:candidate.url,date:candidate.date,type,role});
      const saved=db.prepare('SELECT id FROM sources WHERE url=? AND role=? ORDER BY created LIMIT 1').get(source.url,role);
      const sourceId=saved?.id || randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        if (task) {
          const latest=readTrainingTasks(db,role,task.id,clock());
          if (['ready','completed'].includes(latest.status) && latest.candidate_id===input.id && latest.question) {
            db.exec('COMMIT');
            const {id,source_id,text}=latest.question;
            return {body:{id,source_id,text}};
          }
          if (latest.status!=='review') throw Error('本次训练任务已变化，请刷新');
        }
        if (!saved) db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created,interview_date) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(sourceId,source.title,source.url,source.date,source.type,'',role,new Date().toISOString(),'');
        const question=addExtractedQuestion(db,sourceId,candidate.question,candidate.evidence,input.id);
        if (candidate.topic && !question.reused) setQuestionTopic(db,'source',question.id,candidate.topic,sourceId);
        if (task) db.prepare("UPDATE training_tasks SET status='ready',candidate_id=?,question_id=? WHERE id=?")
          .run(input.id,question.id,task.id);
        db.exec('COMMIT');
        return {status:question.reused?200:201,body:{id:question.id,source_id:sourceId,text:question.text}};
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    throw Error('未找到接口');
  };
}
