<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { request, sourceLink } from '../api.js';
import QuestionCard from './QuestionCard.vue';

const props = defineProps({ source: { type: Object, required: true }, aiConfigured: Boolean });
const emit = defineEmits(['changed', 'practice']);
const adding = ref(false);
const changingDate = ref(false);
const busy = ref(false);
const error = ref('');
const interviewDate = ref(props.source.interview_date);
const question = reactive({ text: '', topic: '' });
const sourceText = ref('');
const extracting = ref(false);
const candidates = ref(null);
const reviewed = reactive({});
const confirmed = reactive({});
const savingCandidate = ref('');
const extractionOpen = ref(false);
const link = computed(() => sourceLink(props.source.url));
const domain = computed(() => link.value ? new URL(link.value).hostname : '链接格式待核对');
const path = () => `/api/sources/${encodeURIComponent(props.source.id)}`;
watch(() => props.source.interview_date, value => { interviewDate.value = value; });

async function mutate(url, method, body, message) {
  busy.value = true;
  error.value = '';
  try {
    await request(url, { method, body });
    emit('changed', message);
    return true;
  } catch (failure) {
    error.value = failure.message;
    return false;
  } finally {
    busy.value = false;
  }
}

async function addQuestion() {
  if (await mutate(`${path()}/questions`, 'POST', { ...question }, '题目已添加')) {
    Object.assign(question, { text: '', topic: '' });
    adding.value = false;
  }
}

async function saveDate() {
  if (await mutate(`${path()}/interview-date`, 'PUT', { interview_date: interviewDate.value }, '面试日期已保存')) changingDate.value = false;
}

async function remove() {
  if (window.confirm(`删除“${props.source.title}”及其关联题目、笔记和证据？已有练习记录仍会保留。`)) {
    await mutate(path(), 'DELETE', undefined, '来源已删除');
  }
}

async function extractQuestions() {
  extracting.value = true;
  error.value = '';
  candidates.value = null;
  try {
    candidates.value = await request(`${path()}/extract-questions`, {
      method: 'POST', timeoutMs: 45000, body: { source_text: sourceText.value },
    });
  } catch (failure) {
    error.value = failure.message;
  } finally {
    extracting.value = false;
  }
}

async function confirmCandidate(candidate) {
  savingCandidate.value = candidate.id;
  error.value = '';
  try {
    await request(`${path()}/extracted-questions`, { method: 'POST', body: {
      source_text: sourceText.value, text: candidate.question, evidence: candidate.evidence,
      request_id: candidate.id, expected_source: { role: props.source.role, url: props.source.url },
    } });
    confirmed[candidate.id] = true;
    emit('changed', '候选题及其原文证据已保存');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    savingCandidate.value = '';
  }
}
</script>

<template>
  <article class="source-card panel">
    <div class="source-heading"><div><div class="source-meta"><span class="source-type">{{ source.type }}</span><span>{{ domain }}</span><span>{{ source.date || '发布日期未知' }}</span></div><h2><a v-if="link" :href="link" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a><span v-else>{{ source.title }}</span></h2></div><button class="text-button danger" :disabled="busy" @click="remove">删除来源</button></div>
    <div class="source-date"><span>面试日期 {{ source.interview_date || '待确认' }}</span><button class="text-button" :disabled="busy" @click="changingDate = !changingDate">修改日期</button></div>
    <form v-if="changingDate" class="inline-form" @submit.prevent="saveDate"><label :for="`date-${source.id}`">面试发生日期</label><input :id="`date-${source.id}`" v-model="interviewDate" type="date" :disabled="busy" /><button class="secondary" :disabled="busy">保存日期</button></form>
    <details v-if="source.legacy_question" class="legacy"><summary>旧版摘录 · 待核对</summary><p>{{ source.legacy_question }}</p></details>
    <ul v-if="source.questions.length" class="question-list"><QuestionCard v-for="item in source.questions" :key="item.id" :question="item" :source-id="source.id" @changed="emit('changed', $event)" @practice="emit('practice', {question: $event, source})" /></ul>
    <p v-else class="empty-questions">还没有关联题目。核对原帖后可以手动添加。</p>
    <form v-if="adding" class="add-question" @submit.prevent="addQuestion"><label :for="`new-question-${source.id}`">已核对的面试题目</label><textarea :id="`new-question-${source.id}`" v-model="question.text" required maxlength="10000" rows="3" :disabled="busy" /><label :for="`new-topic-${source.id}`">知识主题（可选）</label><input :id="`new-topic-${source.id}`" v-model="question.topic" maxlength="100" :disabled="busy" /><div class="button-row"><button :disabled="busy">{{ busy ? '正在保存…' : '保存题目' }}</button><button type="button" class="secondary" :disabled="busy" @click="adding = false">取消</button></div></form>
    <button v-else class="text-button add-button" @click="adding = true">＋ 添加已核对题目</button>
    <button v-if="aiConfigured" class="text-button" @click="extractionOpen = !extractionOpen">粘贴原文提题</button>
    <div v-if="extractionOpen" class="pasted-extraction">
      <label :for="`source-text-${source.id}`">面经原文</label><textarea :id="`source-text-${source.id}`" v-model="sourceText" rows="7" maxlength="12000" :disabled="extracting || Boolean(savingCandidate)" @input="candidates = null" />
      <p class="muted small">将当前粘贴的完整内容（最多 12000 字）发送给已配置的 AI。请核对每条证据与原帖一致后保存。</p>
      <button class="secondary" :disabled="extracting || !sourceText.trim()" @click="extractQuestions">{{ extracting ? '正在提取…' : '提取候选题' }}</button>
      <template v-if="candidates"><p v-if="!candidates.items.length" class="muted">没有提取到可核对的面试题。</p><p v-if="candidates.omitted" class="warning">{{ candidates.omitted }} 条缺少有效依据或重复的内容已略过。</p><div v-for="candidate in candidates.items" :key="candidate.id" class="pasted-candidate"><h3>{{ candidate.question }}</h3><blockquote>{{ candidate.evidence }}</blockquote><template v-if="!confirmed[candidate.id]"><label class="checkbox-label"><input v-model="reviewed[candidate.id]" type="checkbox" />我已核对原帖与证据</label><button :disabled="!reviewed[candidate.id] || Boolean(savingCandidate)" @click="confirmCandidate(candidate)">确认保存这道题</button></template><p v-else class="muted">已保存原文证据</p></div></template>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </article>
</template>
