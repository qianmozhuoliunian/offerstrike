<script setup>
import { computed, reactive, ref } from 'vue';
import { request } from '../api.js';
const props = defineProps({ workspace: Object, refresh: Function });
const emit = defineEmits(['notice', 'practice']);
const form = reactive({ company: '', interview_date: '', question: '', answer: '', notes: '', include_in_library: false });
const busy = ref(false); const error = ref('');
const records = computed(() => (props.workspace.debriefs || []).filter(item => item.role === props.workspace.role));
async function save() {
  busy.value = true; error.value = '';
  try {
    await request('/api/debriefs', { method: 'POST', body: { ...form, role: props.workspace.role } });
    Object.assign(form, { company: '', interview_date: '', question: '', answer: '', notes: '', include_in_library: false });
    await props.refresh(); emit('notice', '面试复盘已保存');
  } catch (failure) { error.value = failure.message; } finally { busy.value = false; }
}
async function toggle(item) {
  busy.value = true; error.value = '';
  try { await request(`/api/debriefs/${encodeURIComponent(item.id)}/library`, { method: 'PUT', body: { include_in_library: !item.include_in_library } }); await props.refresh(); }
  catch (failure) { error.value = failure.message; } finally { busy.value = false; }
}
</script>
<template>
  <section aria-labelledby="debrief-title"><div class="page-heading"><div><h1 id="debrief-title">面试复盘</h1><p class="muted">记录自己经历的问题，主动选择是否加入个人题库。</p></div></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <form class="panel" @submit.prevent="save"><label for="debrief-company">公司（可选）</label><input id="debrief-company" v-model="form.company" maxlength="200" :disabled="busy" /><label for="debrief-date">面试日期（可选）</label><input id="debrief-date" v-model="form.interview_date" type="date" :disabled="busy" /><label for="debrief-question">面试问题</label><textarea id="debrief-question" v-model="form.question" rows="3" maxlength="10000" :disabled="busy" /><label for="debrief-answer">当时的回答（可选）</label><textarea id="debrief-answer" v-model="form.answer" rows="3" maxlength="30000" :disabled="busy" /><label for="debrief-notes">复盘笔记</label><textarea id="debrief-notes" v-model="form.notes" rows="4" maxlength="30000" :disabled="busy" /><label class="check"><input v-model="form.include_in_library" type="checkbox" :disabled="busy || !form.question.trim()" />将这道问题加入个人题库</label><button :disabled="busy || (!form.question.trim() && !form.notes.trim())">保存复盘</button></form>
    <article v-for="item in records" :key="item.id" class="panel"><p class="muted small">{{ item.company || '公司未记录' }} · {{ item.interview_date || item.created.slice(0,10) }} · 用户自述</p><h2>{{ item.question || '面试复盘笔记' }}</h2><p class="preserve-lines">{{ item.answer }}</p><p class="preserve-lines">{{ item.notes }}</p><div v-if="item.question" class="button-row"><button class="secondary" :disabled="busy" @click="toggle(item)">{{ item.include_in_library ? '从个人题库移除' : '加入个人题库' }}</button><button v-if="item.include_in_library" :disabled="busy" @click="emit('practice', {question: {id: item.id, text: item.question}, question_ref: {kind: 'debrief', id: item.id}, source: {role: item.role, title: '我的面试复盘', type: '用户自述'}})">练习这道题</button></div></article>
    <p v-if="!records.length" class="muted">还没有本岗位的复盘记录。</p>
  </section>
</template>
