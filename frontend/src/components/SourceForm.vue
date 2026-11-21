<script setup>
import { reactive, ref } from 'vue';
import { request } from '../api.js';

const props = defineProps({ role: { type: String, required: true } });
const emit = defineEmits(['saved', 'cancel']);
const form = reactive({ title: '', url: '', date: '', interview_date: '', type: '来源未知', question: '' });
const busy = ref(false);
const error = ref('');

async function save() {
  busy.value = true;
  error.value = '';
  try {
    await request('/api/sources', { method: 'POST', body: { ...form, role: props.role } });
    emit('saved');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="panel source-form" @submit.prevent="save">
    <div class="section-heading"><h2>添加面经来源</h2><button type="button" class="text-button" :disabled="busy" @click="emit('cancel')">收起</button></div>
    <p class="muted">保存到 {{ role || '未关联岗位' }}。根据原帖内容选择来源类型。</p>
    <div class="form-grid">
      <div><label for="source-title">原帖标题</label><input id="source-title" v-model="form.title" maxlength="1000" required :disabled="busy" /></div>
      <div><label for="source-type">来源类型</label><select id="source-type" v-model="form.type" :disabled="busy"><option>来源未知</option><option>真实面经（自述）</option><option>博主整理</option></select></div>
      <div class="full-width"><label for="source-url">原帖链接</label><input id="source-url" v-model="form.url" type="url" required placeholder="https://" :disabled="busy" /></div>
      <div><label for="source-date">原帖发布日期（可选）</label><input id="source-date" v-model="form.date" type="date" :disabled="busy" /></div>
      <div><label for="source-interview-date">面试发生日期（可选）</label><input id="source-interview-date" v-model="form.interview_date" type="date" :disabled="busy" /></div>
      <div class="full-width"><label for="source-question">已人工核对的面试题（可选）</label><textarea id="source-question" v-model="form.question" rows="3" maxlength="10000" :disabled="busy" /></div>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="button-row"><button :disabled="busy">{{ busy ? '正在保存…' : '保存来源' }}</button><button type="button" class="secondary" :disabled="busy" @click="emit('cancel')">取消</button></div>
  </form>
</template>
