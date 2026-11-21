<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { request, sourceLink } from '../api.js';
import AbilityEvaluation from './AbilityEvaluation.vue';

const props = defineProps({ workspace: { type: Object, required: true }, selection: { type: Object, default: null } });
const emit = defineEmits(['notice', 'set-role', 'updated']);
const form = reactive({ question: '', answer: '', parent_attempt_id: '', question_ref: null, generation_token: '' });
const busy = ref(false);
const error = ref('');
const autosaveError = ref('');
const dirty = ref(false);
const restoring = ref(false);
const awaitingInput = ref(true);
const history = ref([]);
const dialogue = ref(null);
const source = ref(null);
const latestId = ref('');
const requestId = ref(crypto.randomUUID());
const help = ref('');
const mock = reactive({ active: false, count: 0, completed: [], questionId: '', message: '' });
let draftTimer;
let pendingDraft;
let draftQueue = Promise.resolve();
let revision = 0;
const lastTurn = computed(() => dialogue.value?.turns.at(-1));
const unsubmittedAnswer = computed(() => form.answer.trim() && !history.value.some(attempt => attempt.question === form.question.trim() && attempt.answer === form.answer.trim()));

async function flushDraft() {
  clearTimeout(draftTimer);
  if (!pendingDraft) return draftQueue;
  const payload = pendingDraft;
  pendingDraft = null;
  const version = revision;
  draftQueue = draftQueue.catch(() => {}).then(() => request('/api/draft', { method: 'PUT', body: payload }));
  try {
    await draftQueue;
    if (revision === version) { dirty.value = false; autosaveError.value = ''; }
  } catch (failure) {
    if (props.workspace.role === payload.role) autosaveError.value = `草稿尚未保存。${failure.message}`;
    pendingDraft = pendingDraft || payload;
    throw failure;
  }
}

function queueDraft() {
  if (restoring.value || !props.workspace.role) return;
  revision++;
  dirty.value = true;
  pendingDraft = { role: props.workspace.role, question: form.question, answer: form.answer,
    parent_attempt_id: form.parent_attempt_id, question_ref: form.question_ref ? { ...form.question_ref } : null };
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { flushDraft().catch(() => {}); }, 400);
}

watch(() => [form.question, form.answer, form.parent_attempt_id, form.question_ref], queueDraft);
watch(() => [form.question, form.answer, form.parent_attempt_id], () => { requestId.value = crypto.randomUUID(); });

async function loadHistory() {
  const role = props.workspace.role;
  if (!role) return null;
  const result = await request(`/api/practice/history?${new URLSearchParams({ role })}`);
  if (props.workspace.role === role) history.value = result.attempts;
  return result;
}

async function loadRole() {
  if (pendingDraft) await flushDraft().catch(() => {});
  error.value = '';
  dialogue.value = null;
  latestId.value = '';
  source.value = null;
  awaitingInput.value = true;
  history.value = [];
  restoring.value = true;
  const role = props.workspace.role;
  try {
    Object.assign(form, { question: '', answer: '', parent_attempt_id: '', question_ref: null, generation_token: '' });
    const result = await loadHistory();
    if (result && props.workspace.role === role) Object.assign(form, {
      question: result.draft.question, answer: result.draft.answer, question_ref: result.draft.question_ref,
      parent_attempt_id: result.draft.parent_attempt_id, generation_token: '',
    });
    if (form.question_ref?.kind === 'source') source.value = props.workspace.sources.find(item => item.questions.some(question => question.id === form.question_ref.id)) || null;
  } catch (failure) {
    error.value = failure.message;
  } finally {
    // The watcher must see the restored values while autosave is suppressed.
    await nextTick();
    restoring.value = false;
  }
}

watch(() => props.workspace.role, loadRole, { immediate: true });

function startQuestion(selection = null) {
  if (busy.value) { emit('notice', '当前练习请求尚未结束，请稍后再选择题目'); return; }
  if (unsubmittedAnswer.value && !window.confirm('当前回答尚未提交，切换题目会替换这份回答。确定继续？')) return;
  mock.active = false;
  dialogue.value = null;
  latestId.value = '';
  source.value = selection?.source || null;
  Object.assign(form, { question: selection?.question.text || '', answer: '', parent_attempt_id: '',
    question_ref: selection ? (selection.question_ref || { kind: 'source', id: selection.question.id }) : null, generation_token: '' });
  awaitingInput.value = true;
  error.value = '';
  help.value = '';
}

async function nextMock(first = false) {
  if (first && unsubmittedAnswer.value && !window.confirm('当前回答尚未提交，开始模拟会替换这份回答。确定继续？')) return;
  busy.value = true; error.value = '';
  try {
    const completed = first ? [] : [...mock.completed, mock.questionId];
    if (!first && mock.count >= 3) { mock.active = false; mock.message = '三题模拟已完成，回答与总结已保存。'; return; }
    const result = await request('/api/career/plan', { method: 'POST', body: { role: props.workspace.role, mode: 'mock', completed } });
    const task = result.tasks.find(item => item.question);
    if (!task) { mock.active = false; mock.message = '当前题库没有其他适合的题目，本场模拟已结束。可以到备战计划补充题目。'; return; }
    const item = task.question;
    mock.active = true; mock.completed = completed; mock.count = first ? 1 : mock.count + 1; mock.questionId = item.question_ref.id; mock.message = '';
    dialogue.value = null; latestId.value = ''; source.value = { title: item.sourceTitle, url: item.sourceUrl, type: item.sourceType };
    Object.assign(form, { question: item.text, answer: '', parent_attempt_id: '', question_ref: item.question_ref, generation_token: '' });
    awaitingInput.value = true; help.value = '';
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}

defineExpose({ flushDraft });

watch(() => props.selection, async selection => {
  if (!selection) return;
  if (selection.attempt_id) {
    if (busy.value) { emit('notice', '当前练习请求尚未结束，请稍后再打开历史'); return; }
    if (selection.followup && unsubmittedAnswer.value && !window.confirm('当前回答尚未提交，切换追问会替换这份回答。确定继续？')) return;
    const opened = await openHistory(selection.attempt_id);
    if (opened && selection.followup && dialogue.value?.can_continue) followup();
  } else startQuestion(selection);
});

function editedQuestion() {
  form.question_ref = null;
  form.generation_token = '';
  source.value = null;
}

async function openHistory(attemptId) {
  mock.active = false;
  busy.value = true;
  error.value = '';
  try {
    const result = await request(`/api/practice/dialogue/${encodeURIComponent(attemptId)}?${new URLSearchParams({ role: props.workspace.role })}`);
    dialogue.value = result;
    latestId.value = attemptId;
    awaitingInput.value = false;
    help.value = '';
    return true;
  } catch (failure) {
    error.value = failure.message;
    return false;
  } finally {
    busy.value = false;
  }
}

async function submit(local = false) {
  busy.value = true;
  error.value = '';
  try {
    await flushDraft();
    const result = await request(local ? '/api/practice/local' : '/api/practice/dialogue/turn', {
      method: 'POST', timeoutMs: 60000,
      body: { role: props.workspace.role, ...form, request_id: requestId.value },
    });
    latestId.value = result.id;
    dialogue.value = await request(`/api/practice/dialogue/${encodeURIComponent(result.id)}?${new URLSearchParams({ role: props.workspace.role })}`);
    awaitingInput.value = false;
    await loadHistory();
    emit('notice', local ? '回答已保存，可稍后补充 AI 点评' : '本轮回答与评价已保存');
    emit('updated');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

function followup() {
  Object.assign(form, { question: lastTurn.value.follow_up, answer: '', parent_attempt_id: lastTurn.value.id,
    question_ref: null, generation_token: '' });
  awaitingInput.value = true;
  help.value = '';
}

async function finish() {
  busy.value = true;
  error.value = '';
  try {
    await request('/api/practice/dialogue/summary', { method: 'POST', timeoutMs: 60000, body: { role: props.workspace.role, attempt_id: latestId.value } });
    dialogue.value = await request(`/api/practice/dialogue/${encodeURIComponent(latestId.value)}?${new URLSearchParams({ role: props.workspace.role })}`);
    awaitingInput.value = false;
    emit('updated');
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}

async function generate(reinforce = false) {
  if (unsubmittedAnswer.value && !window.confirm('当前回答尚未提交，生成新题会替换这份回答。确定继续？')) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await request(reinforce ? '/api/practice/dialogue/reinforce' : '/api/practice/dialogue/generate', {
      method: 'POST', timeoutMs: 60000, body: { role: props.workspace.role, ...(reinforce ? { attempt_id: latestId.value } : {}) },
    });
    mock.active = false;
    dialogue.value = null;
    latestId.value = '';
    source.value = null;
    Object.assign(form, { question: result.question, answer: '', question_ref: null, parent_attempt_id: '', generation_token: result.generation_token });
    awaitingInput.value = true;
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}

async function getHelp(mode) {
  busy.value = true;
  error.value = '';
  try {
    const result = await request('/api/practice/help', { method: 'POST', timeoutMs: 60000,
      body: { role: props.workspace.role, question: form.question, mode } });
    help.value = result.guidance;
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}

async function addFeedback() {
  busy.value = true;
  error.value = '';
  try {
    await request(`/api/practice/local/${encodeURIComponent(latestId.value)}/feedback`, { method: 'POST', timeoutMs: 60000, body: { role: props.workspace.role } });
    dialogue.value = await request(`/api/practice/dialogue/${encodeURIComponent(latestId.value)}?${new URLSearchParams({ role: props.workspace.role })}`);
    await loadHistory();
    emit('updated');
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}

async function assess(rating) {
  try {
    await request(`/api/attempts/${encodeURIComponent(latestId.value)}/assessment`, { method: 'PUT', body: { rating } });
    await loadHistory();
    emit('notice', '复习自评已保存');
    emit('updated');
  } catch (failure) { error.value = failure.message; }
}

function beforeLeave(event) {
  if (!dirty.value) return;
  flushDraft().catch(() => {});
  event.preventDefault();
  event.returnValue = '';
}
function onVisibility() { if (document.visibilityState === 'hidden') flushDraft().catch(() => {}); }
onMounted(() => { window.addEventListener('beforeunload', beforeLeave); document.addEventListener('visibilitychange', onVisibility); });
onBeforeUnmount(() => { flushDraft().catch(() => {}); window.removeEventListener('beforeunload', beforeLeave); document.removeEventListener('visibilitychange', onVisibility); });
</script>

<template>
  <section aria-labelledby="practice-title">
    <div class="page-heading"><div><h1 id="practice-title">单题练习</h1><p class="muted">围绕一道题持续对话，每题最多 8 轮。</p></div><div class="button-row"><button v-if="!awaitingInput && unsubmittedAnswer" class="secondary" :disabled="busy" @click="dialogue = null; latestId = ''; awaitingInput = true">返回未提交草稿</button><button class="secondary" :disabled="busy" @click="startQuestion()">开始新题</button></div></div>
    <p v-if="!workspace.role" class="notice">先设置目标岗位。<button @click="emit('set-role')">设置岗位</button></p>
    <template v-else>
      <div class="panel mock-controls"><template v-if="mock.active"><strong>三题模拟 · 第 {{ mock.count }} / 3 题</strong><p class="muted small">逐题结束并总结后进入下一题，随时可以结束。刷新后练习记录保留，本场计数结束。</p><div class="button-row"><button v-if="dialogue?.summary" :disabled="busy" @click="nextMock()">{{ mock.count >= 3 ? '完成三题模拟' : '进入下一题' }}</button><button class="text-button" :disabled="busy" @click="mock.active = false; mock.message = '模拟已结束，已提交的回答继续保留。'">结束模拟</button></div></template><template v-else><button class="secondary" :disabled="busy || !workspace.aiConfigured" @click="nextMock(true)">开始 3 题模拟</button><p v-if="mock.message" role="status">{{ mock.message }}</p></template></div>
      <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="autosaveError" class="error" role="alert">{{ autosaveError }} <button class="text-button" @click="flushDraft().catch(() => {})">重试保存</button></p>
      <div class="practice-layout"><div>
        <div v-if="dialogue" class="dialogue-transcript">
          <p v-if="dialogue.source_available === false" class="warning">原题来源已删除。以下为保存的练习记录。</p>
          <article v-for="(turn, index) in dialogue.turns" :key="turn.id" class="panel dialogue-turn"><p class="muted small">第 {{ index + 1 }} 轮</p><h2>{{ turn.question }}</h2><p class="user-answer">{{ turn.answer }}</p><div v-if="turn.feedback" class="review-feedback"><h3>本轮点评</h3><p>{{ turn.feedback }}</p><blockquote v-if="turn.coaching">{{ turn.coaching.evidence }}</blockquote><p v-if="turn.coaching" class="muted">下一步 {{ turn.coaching.next_step }}</p></div><p v-else class="muted">回答已保存，点评待补充。</p><AbilityEvaluation :evaluation="turn.evaluation" /></article>
          <div v-if="dialogue.summary" class="panel dialogue-summary"><h2>本题总结</h2><p>{{ dialogue.summary }}</p><button class="secondary" :disabled="busy || !workspace.aiConfigured" @click="generate(true)">生成针对性补练</button></div>
          <div v-if="!awaitingInput" class="button-row"><button v-if="dialogue.can_continue" :disabled="busy" @click="followup">回答追问</button><button v-if="!dialogue.summary" class="secondary" :disabled="busy || !workspace.aiConfigured" @click="finish">结束本题并总结</button><button v-if="!lastTurn.feedback" class="secondary" :disabled="busy || !workspace.aiConfigured" @click="addFeedback">补充 AI 点评</button></div>
          <p v-if="dialogue.can_continue && !awaitingInput" class="followup-preview">{{ lastTurn.follow_up }}</p>
          <div v-if="!awaitingInput" class="self-assessment"><span>我的复习自评</span><button class="secondary" :disabled="busy" @click="assess('revisit')">需要再练</button><button class="secondary" :disabled="busy" @click="assess('comfortable')">比较熟悉</button><button class="text-button" :disabled="busy" @click="assess('unassessed')">清除自评</button></div>
        </div>
        <form v-if="awaitingInput" class="panel practice-composer" @submit.prevent="submit(false)">
          <span class="source-type">{{ form.parent_attempt_id ? '本题追问' : form.generation_token ? 'AI 生成练习题' : form.question_ref ? '资料库题目' : '手动题目' }}</span>
          <p v-if="source" class="muted small"><a :href="sourceLink(source.url)" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a> · {{ source.type }}</p>
          <label for="practice-question">{{ form.parent_attempt_id ? '本轮追问' : '练习题目' }}</label><textarea id="practice-question" v-model="form.question" rows="3" maxlength="2000" required :readonly="Boolean(form.parent_attempt_id)" :disabled="busy" @input="editedQuestion" />
          <label for="practice-answer">我的回答</label><textarea id="practice-answer" v-model="form.answer" rows="9" maxlength="10000" required :disabled="busy" placeholder="先说出自己的理解，具体说明做法和依据。" />
          <p class="muted small">{{ dirty ? '正在保存草稿…' : '草稿已保存于本机' }} · AI 点评会发送当前问题、回答、已有轮次和已确认岗位要求，合计最多 30000 字，超限时提示调整。</p>
          <div class="button-row"><button :disabled="busy || !workspace.aiConfigured">{{ busy ? '正在处理…' : '提交并点评' }}</button><button v-if="!form.parent_attempt_id" type="button" class="secondary" :disabled="busy || !form.question.trim() || !form.answer.trim()" @click="submit(true)">仅保存作答</button></div>
          <div class="help-actions"><button type="button" class="text-button" :disabled="busy || !workspace.aiConfigured || !form.question.trim()" @click="getHelp('hint')">给点提示</button><button type="button" class="text-button" :disabled="busy || !workspace.aiConfigured || !form.question.trim()" @click="getHelp('breakdown')">拆解问题</button><button type="button" class="text-button" :disabled="busy || !workspace.aiConfigured || !form.question.trim()" @click="getHelp('approach')">参考思路</button><button v-if="!form.parent_attempt_id" type="button" class="text-button" :disabled="busy || !workspace.aiConfigured" @click="generate(false)">AI 生成一道题</button></div><p v-if="help" class="guidance">{{ help }}</p>
        </form>
      </div><aside class="practice-history panel"><h2>最近练习</h2><p v-if="!history.length" class="muted">本岗位还没有练习记录。</p><ul><li v-for="attempt in history" :key="attempt.id"><button :disabled="busy" @click="openHistory(attempt.id)">{{ attempt.question }}</button><p class="muted small">{{ attempt.created.slice(0,10) }} · {{ attempt.rating === 'revisit' ? '需要再练' : attempt.rating === 'comfortable' ? '比较熟悉' : '尚未自评' }}</p></li></ul></aside></div>
    </template>
  </section>
</template>
