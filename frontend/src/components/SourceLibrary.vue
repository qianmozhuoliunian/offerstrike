<script setup>
import { computed, ref, watch } from 'vue';
import SourceForm from './SourceForm.vue';
import SourceCard from './SourceCard.vue';
import { request } from '../api.js';

const props = defineProps({ workspace: { type: Object, required: true }, refresh: { type: Function, required: true } });
const emit = defineEmits(['notice', 'set-role', 'practice']);
const adding = ref(false);
const query = ref('');
const selectedRole = ref(props.workspace.role);
const error = ref('');
const topicDrafts = ref({});
const savingTopic = ref('');
const roles = computed(() => [...new Set([props.workspace.role, ...props.workspace.sources.map(source => source.role), ...(props.workspace.debriefs || []).filter(item=>item.include_in_library).map(item=>item.role)])]);
const sources = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return props.workspace.sources.filter(source => source.role === selectedRole.value &&
    (!search || [source.title, ...source.questions.flatMap(question => [question.text, question.topic])].join('\n').toLocaleLowerCase().includes(search)));
});
const questionCount = computed(() => sources.value.reduce((total, source) => total + source.questions.length, 0));
const personal = computed(() => (props.workspace.debriefs || []).filter(item => item.include_in_library && item.role === selectedRole.value && (!query.value.trim() || [item.question, item.topic, item.company].join(' ').toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))));
watch(() => props.workspace.role, role => { selectedRole.value = role; adding.value = false; });

async function changed(message) {
  error.value = '';
  try {
    await props.refresh();
    emit('notice', message);
  } catch (failure) {
    error.value = `操作已提交，列表刷新失败。${failure.message}`;
  }
}

async function saved() {
  adding.value = false;
  selectedRole.value = props.workspace.role;
  query.value = '';
  await changed('面经来源已保存');
}

async function savePersonalTopic(item) {
  savingTopic.value = item.id; error.value = '';
  try {
    await request(`/api/debriefs/${encodeURIComponent(item.id)}/topic`, { method: 'PUT', body: { topic: topicDrafts.value[item.id] ?? item.topic ?? '' } });
    await changed('复盘题主题已保存');
    delete topicDrafts.value[item.id];
  } catch (failure) { error.value = failure.message; }
  finally { savingTopic.value = ''; }
}
</script>

<template>
  <section aria-labelledby="library-title">
    <div class="page-heading"><div><h1 id="library-title">我的资料库</h1><p class="muted">{{ sources.length }} 篇来源，{{ questionCount }} 道已添加题目</p></div><button v-if="workspace.role" :disabled="adding" @click="adding = true">＋ 添加来源</button><button v-else @click="emit('set-role')">设置目标岗位</button></div>
    <p v-if="error" class="error" role="alert">{{ error }} <button class="text-button" @click="changed('列表已刷新')">刷新列表</button></p>
    <SourceForm v-if="adding" :role="workspace.role" @saved="saved" @cancel="adding = false" />
    <div class="library-filters"><div><label for="library-role">资料所属岗位</label><select id="library-role" v-model="selectedRole"><option v-for="role in roles" :key="role" :value="role">{{ role || '未关联岗位' }}</option></select></div><div class="search-field"><label for="library-search">搜索标题、题目或主题</label><input id="library-search" v-model="query" type="search" placeholder="例如 检索评估、SQL…" /></div></div>
    <div v-if="!sources.length && !personal.length" class="empty-state"><div class="empty-book" aria-hidden="true">▤</div><h2>{{ query ? '没有找到匹配的资料' : '收藏你的第一篇面经' }}</h2><p class="muted">{{ query ? '调整关键词，或切换资料所属岗位。' : '保存原帖链接，核对其中的问题，逐步建立自己的面试题库。' }}</p><button v-if="!query && workspace.role && !adding" class="secondary" @click="adding = true">添加面经来源</button></div>
    <SourceCard v-for="source in sources" :key="source.id" :source="source" :ai-configured="workspace.aiConfigured === true" @changed="changed" @practice="emit('practice', $event)" />
    <section v-if="personal.length" class="panel personal-library"><h2>我的面试复盘题</h2><article v-for="item in personal" :key="item.id"><p class="muted small">用户自述 · {{ item.company || '公司未记录' }} · {{ item.topic || '主题未标注' }}</p><h3>{{ item.question }}</h3><button class="secondary" @click="emit('practice', {question: {id: item.id, text: item.question}, question_ref: {kind: 'debrief', id: item.id}, source: {role: item.role, title: '我的面试复盘', type: '用户自述'}})">练习这道题</button><form class="inline-form" @submit.prevent="savePersonalTopic(item)"><label :for="`personal-topic-${item.id}`">知识主题</label><input :id="`personal-topic-${item.id}`" :value="topicDrafts[item.id] ?? item.topic" maxlength="100" :disabled="Boolean(savingTopic)" @input="topicDrafts[item.id] = $event.target.value" /><button class="secondary" :disabled="Boolean(savingTopic)">保存主题</button></form></article></section>
  </section>
</template>
