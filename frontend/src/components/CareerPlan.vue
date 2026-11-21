<script setup>
import { computed, ref, watch } from 'vue';
import { request } from '../api.js';
import ResumeEvidence from './ResumeEvidence.vue';

const props = defineProps({ workspace: { type: Object, required: true }, revision: { type: Number, default: 0 } });
const emit = defineEmits(['notice', 'set-role', 'practice', 'attempt', 'research']);
const topicInput = ref('');
const plan = ref(null);
const ability = ref(null);
const tasks = ref([]);
const busy = ref(false);
const error = ref('');
let loadVersion = 0;
const statuses = { proposed: '等待确认搜索', searching: '正在搜索', review: '等待核对原帖', ready: '题目已确认，可练习', completed: '已完成练习', failed: '任务失败', cancelled: '已取消' };
const reasons = { timeout: '搜索超时或服务曾中断', question_removed: '原题被删除或证据待重新核对', no_results: '没有搜索结果',
  insufficient_evidence: '没有足够的原文证据', model_failed: '模型调用失败', research_failed: '研究服务失败',
  search_unavailable: '搜索服务不可用', model_unavailable: '模型尚未配置', cost_budget: '已达到调用预算', model_budget: '已达到处理上限' };
const changes = { improving: '已有改善', needs_review_again: '需要再次复习', consistent: '多轮表现一致', insufficient: '证据仍有限' };
const points = computed(() => ability.value?.profile.points || []);

async function load() {
  const role = props.workspace.role;
  const version = ++loadVersion;
  if (!role) { plan.value = null; ability.value = null; tasks.value = []; return; }
  busy.value = true;
  error.value = '';
  try {
    const topics = topicInput.value.split(/[,，\n]+/).map(value => value.trim()).filter(Boolean);
    const [recommendation, history, records] = await Promise.all([
      request('/api/career/plan', { method: 'POST', body: { role, topics } }),
      request(`/api/career/ability-history?${new URLSearchParams({ role })}`),
      request(`/api/training/tasks?${new URLSearchParams({ role })}`),
    ]);
    if (version === loadVersion && role === props.workspace.role) {
      plan.value = recommendation;
      ability.value = history;
      tasks.value = records.tasks;
    }
  } catch (failure) {
    if (version === loadVersion) error.value = failure.message;
  } finally {
    if (version === loadVersion) busy.value = false;
  }
}

watch(() => [props.workspace.role, props.workspace.sources, props.workspace.confirmed_requirements, props.revision], load, { immediate: true });

function practice(question) {
  emit('practice', { question: { id: question.question_ref.id, text: question.text }, question_ref: question.question_ref,
    source: { role: props.workspace.role, title: question.sourceTitle, url: question.sourceUrl, type: question.sourceType } });
}

async function createTask(topic) {
  busy.value = true;
  error.value = '';
  try {
    const result = await request('/api/training/tasks/create', { method: 'POST', body: {
      role: props.workspace.role, topic, request_id: crypto.randomUUID(),
    } });
    await load();
    emit('research', result.task);
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}

async function openTask(task) {
  busy.value = true;
  error.value = '';
  try {
    const result = await request(`/api/training/tasks?${new URLSearchParams({ role: props.workspace.role, id: task.id })}`);
    const record = result.task;
    if (['ready', 'completed'].includes(record.status) && record.question) {
      emit('practice', { question: record.question, source: props.workspace.sources.find(source => source.id === record.question.source_id),
        question_ref: { kind: 'source', id: record.question.id } });
    } else {
      emit('research', record);
    }
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}
</script>

<template>
  <section aria-labelledby="career-title">
    <div class="page-heading"><div><h1 id="career-title">备战计划</h1><p class="muted">结合岗位要求、已有题目和真实作答记录安排下一步。</p></div><button class="secondary" :disabled="busy || !workspace.role" @click="load">{{ busy ? '正在更新…' : '更新计划' }}</button></div>
    <p v-if="!workspace.role" class="notice">设置目标岗位后制定训练计划。<button @click="emit('set-role')">设置岗位</button></p>
    <template v-else>
      <form class="panel plan-targets" @submit.prevent="load"><label for="career-topics">本轮准备主题（可选，每行一个，最多 4 个）</label><textarea id="career-topics" v-model="topicInput" rows="2" maxlength="180" placeholder="留空时使用已确认岗位要求和练习记录" :disabled="busy" /><div class="button-row"><button :disabled="busy">按这些主题更新</button><button v-if="plan && !plan.has_requirements" type="button" class="text-button" @click="emit('set-role')">补充岗位要求</button></div></form>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div v-if="plan" class="career-tasks">
        <article v-for="(task, index) in plan.tasks" :key="`${task.action}-${task.topic}-${index}`" class="panel career-task">
          <p class="task-category">{{ task.action === 'research' ? '题库需要补充' : task.action === 'followup' ? '继续澄清一个薄弱点' : task.action === 'review' ? '优先复习' : task.lower_priority ? '降低重复优先级' : '下一道练习' }}</p>
          <h2>{{ task.question?.text || task.followup?.question || task.topic || '补充本岗位的真实面试题' }}</h2><p>{{ task.reason }}</p><p v-if="task.point" class="muted">对应知识点 {{ task.point }}<span v-if="task.change"> · {{ changes[task.change] }}</span></p>
          <details v-if="task.evidence.length" class="plan-evidence"><summary>查看推荐依据（{{ task.evidence.length }}）</summary><ol><li v-for="evidence in task.evidence" :key="evidence.attempt_id"><p>{{ evidence.question }}</p><blockquote v-if="evidence.evidence">{{ evidence.evidence }}</blockquote><p class="muted small">{{ evidence.created.slice(0,10) }} · {{ evidence.kind === 'incorrect' ? '明确错误' : evidence.kind === 'missing' ? '本轮遗漏' : evidence.kind === 'correct' ? '正确表现' : '用户自评记录' }}</p><button class="text-button" @click="emit('attempt', {id: evidence.attempt_id})">查看这次作答</button></li></ol></details>
          <button v-if="task.action === 'research'" :disabled="busy" @click="createTask(task.topic)">创建补题任务</button><button v-else-if="task.action === 'followup'" :disabled="busy" @click="emit('attempt', {id: task.followup.parent_attempt_id, followup: true})">继续这道追问</button><button v-else :disabled="busy" @click="practice(task.question)">开始这道练习</button>
        </article>
      </div>
      <details v-if="points.length" class="panel ability-profile"><summary>知识点表现与变化（{{ points.length }}）</summary><article v-for="point in points" :key="`${point.topic}-${point.point}`"><h3>{{ point.topic || '主题待确认' }} · {{ point.point }}</h3><p class="muted small">正确 {{ point.correct }} 次 · 错误 {{ point.incorrect }} 次 · 遗漏 {{ point.missing }} 次 · 未验证 {{ point.unverified }} 次</p><p>{{ changes[point.change] }} · {{ point.supporting_sessions }} 次独立练习提供了近期正确证据</p><details v-if="point.evidence.length"><summary>查看回答证据</summary><div v-for="record in point.evidence" :key="record.attempt_id"><p>{{ record.question }}</p><blockquote>{{ record.evidence }}</blockquote><button class="text-button" @click="emit('attempt', {id: record.attempt_id})">查看这次作答</button></div></details></article></details>
      <section v-if="tasks.length" class="panel training-task-history"><h2>补题任务</h2><ul><li v-for="task in tasks" :key="task.id"><div><strong>{{ task.topic || '岗位通用题' }}</strong><p class="muted small">{{ statuses[task.status] }}<span v-if="reasons[task.reason]"> · {{ reasons[task.reason] }}</span></p></div><button class="secondary" :disabled="busy" @click="openTask(task)">{{ ['ready','completed'].includes(task.status) ? '打开关联题目' : '查看任务' }}</button></li></ul></section>
      <ResumeEvidence :role="workspace.role" />
    </template>
  </section>
</template>
