<script setup>
import { reactive, ref, watch } from 'vue';
import { request } from '../api.js';

const props = defineProps({ workspace: { type: Object, required: true }, refresh: { type: Function, required: true } });
const emit = defineEmits(['notice']);
const form = reactive({ role: '', jd: '', confirmed_requirements: '' });
const confirmation = ref(null);
const busy = ref(false);
const error = ref('');

watch(() => [props.workspace.role, props.workspace.jd, props.workspace.confirmed_requirements], () => {
  Object.assign(form, { role: props.workspace.role, jd: props.workspace.jd, confirmed_requirements: props.workspace.confirmed_requirements });
  confirmation.value = null;
}, { immediate: true });

async function saveRole(confirm = false) {
  busy.value = true;
  error.value = '';
  try {
    const result = await request('/api/role', { method: 'POST', body: {
      role: form.role, ...(confirm && confirmation.value ? { confirmation_token: confirmation.value.confirmation_token } : {}),
    } });
    confirmation.value = result.status === 'needs_confirmation' ? result : null;
    if (result.status === 'saved') {
      await props.refresh();
      emit('notice', '目标岗位已保存');
    }
  } catch (failure) {
    error.value = failure.message;
    confirmation.value = null;
  } finally {
    busy.value = false;
  }
}

async function saveProfile() {
  busy.value = true;
  error.value = '';
  try {
    await request('/api/jd', { method: 'POST', body: { role: props.workspace.role, jd: form.jd, confirmed_requirements: form.confirmed_requirements } });
    await props.refresh();
    emit('notice', '岗位要求已保存');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

async function extractRequirements() {
  busy.value = true;
  error.value = '';
  try {
    const result = await request('/api/jd/parse', { method: 'POST', body: { jd: form.jd }, timeoutMs: 45000 });
    form.confirmed_requirements = result.requirements;
    emit('notice', '岗位要求已提取，请核对后保存');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="job-title">
    <div class="page-heading"><div><h1 id="job-title">岗位与要求</h1><p class="muted">按目标岗位分别保存题目和准备资料。</p></div></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="settings-grid">
      <form class="panel" @submit.prevent="saveRole(false)">
        <h2>目标岗位</h2>
        <label for="target-role">准备应聘什么岗位</label>
        <input id="target-role" v-model="form.role" required maxlength="100" placeholder="例如 AI Agent 开发实习" :disabled="busy" @input="confirmation = null" />
        <p class="muted">切换岗位后可以查看对应资料，历史内容按原岗位保留。</p>
        <div v-if="confirmation" class="confirmation" role="status"><p>{{ confirmation.message }}</p><div class="button-row"><button type="button" :disabled="busy" @click="saveRole(true)">确认目标岗位</button><button type="button" class="secondary" @click="confirmation = null">继续修改</button></div></div>
        <button v-else :disabled="busy">{{ busy ? '正在保存…' : '保存目标岗位' }}</button>
      </form>
      <form class="panel" @submit.prevent="saveProfile">
        <h2>岗位要求</h2>
        <template v-if="workspace.role">
          <label for="jd">岗位描述（JD）</label>
          <textarea id="jd" v-model="form.jd" rows="7" maxlength="30000" placeholder="粘贴岗位职责与任职要求" :disabled="busy" />
          <div v-if="workspace.aiConfigured" class="jd-extraction"><button type="button" class="secondary" :disabled="busy || !form.jd.trim()" @click="extractRequirements">AI 提取准备重点</button><p class="muted small">点击后将当前完整 JD（最多 30000 字）发送给已配置的 AI，提取结果由你确认。</p></div>
          <label for="requirements">已确认的准备重点</label>
          <textarea id="requirements" v-model="form.confirmed_requirements" rows="4" maxlength="10000" placeholder="每行写一个你确认需要准备的知识点" :disabled="busy" />
          <button :disabled="busy">{{ busy ? '正在保存…' : '保存岗位要求' }}</button>
        </template>
        <p v-else class="muted">保存目标岗位后，添加这个岗位的准备要求。</p>
      </form>
    </div>
  </section>
</template>
