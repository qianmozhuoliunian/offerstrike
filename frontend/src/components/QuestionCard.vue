<script setup>
import { reactive, ref } from 'vue';
import { request } from '../api.js';

const props = defineProps({ question: { type: Object, required: true }, sourceId: { type: String, required: true } });
const emit = defineEmits(['changed', 'practice']);
const editing = ref(false);
const busy = ref(false);
const error = ref('');
const form = reactive({ text: '', topic: '', note: '' });
const path = () => `/api/sources/${encodeURIComponent(props.sourceId)}/questions/${encodeURIComponent(props.question.id)}`;

function edit() {
  Object.assign(form, { text: props.question.text, topic: props.question.topic, note: props.question.note });
  editing.value = true;
  error.value = '';
}

async function save() {
  busy.value = true;
  error.value = '';
  try {
    await request(path(), { method: 'PUT', body: { ...form } });
    editing.value = false;
    emit('changed', '题目已保存');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!window.confirm('删除这道题目及其笔记和原文证据？已有练习记录仍会保留。')) return;
  busy.value = true;
  error.value = '';
  try {
    await request(path(), { method: 'DELETE' });
    emit('changed', '题目已删除');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <li class="question-card">
    <form v-if="editing" @submit.prevent="save">
      <label :for="`question-${question.id}`">面试题目</label><textarea :id="`question-${question.id}`" v-model="form.text" required maxlength="10000" rows="3" :disabled="busy" />
      <label :for="`topic-${question.id}`">知识主题</label><input :id="`topic-${question.id}`" v-model="form.topic" maxlength="100" placeholder="例如 RAG 检索评估" :disabled="busy" />
      <label :for="`note-${question.id}`">我的笔记</label><textarea :id="`note-${question.id}`" v-model="form.note" rows="3" maxlength="30000" :disabled="busy" />
      <div class="button-row"><button :disabled="busy">{{ busy ? '正在保存…' : '保存题目' }}</button><button type="button" class="secondary" :disabled="busy" @click="editing = false">取消编辑</button></div>
    </form>
    <template v-else>
      <div class="question-heading"><h3>{{ question.text }}</h3><button class="text-button" :disabled="busy" @click="edit">编辑题目</button></div>
      <span v-if="question.topic" class="topic">{{ question.topic }}</span>
      <details v-if="question.evidence" class="evidence"><summary>查看原文证据</summary><blockquote>{{ question.evidence }}</blockquote><p v-if="question.text !== question.evidence_question" class="warning">题目已修改，请重新核对证据是否支持当前题干。</p></details>
      <p v-else class="muted small">手动添加，原文证据待补充</p>
      <p v-if="question.note" class="question-note">{{ question.note }}</p>
      <button class="secondary" :disabled="busy" @click="emit('practice', question)">开始练习</button>
      <button class="text-button danger" :disabled="busy" @click="remove">删除题目</button>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </li>
</template>
