<script setup>
import { onMounted, reactive, ref } from 'vue';
import { request } from '../api.js';
const props = defineProps({ workspace: Object, refresh: Function });
const emit = defineEmits(['notice', 'restored']);
const busy = ref(false);
const error = ref('');
const backup = ref(null);
const preview = ref(null);
const status = ref(null);
const desktop = window.offerPilotDesktop;
const fields = reactive({ TAVILY_API_KEY: '', EXA_API_KEY: '', AI_API_KEY: '', AI_MODEL: '', AI_BASE_URL: '' });
const clear = reactive({});
const labels = { TAVILY_API_KEY: 'Tavily API Key', EXA_API_KEY: 'Exa API Key（可选）', AI_API_KEY: 'AI API Key', AI_MODEL: '模型名称', AI_BASE_URL: '模型服务地址' };
onMounted(async () => {
  if (!desktop) return;
  try { status.value = await desktop.serviceStatus(); fields.AI_MODEL = status.value.AI_MODEL; fields.AI_BASE_URL = status.value.AI_BASE_URL; }
  catch { error.value = '无法读取桌面服务配置状态'; }
});
async function exportBackup() {
  busy.value = true; error.value = '';
  try {
    const data = await request('/api/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `OfferStrike-${new Date().toISOString().slice(0,10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    emit('notice', '备份已生成，包含个人练习内容，请妥善保存');
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}
async function inspectBackup(event) {
  busy.value = true; error.value = ''; backup.value = null; preview.value = null;
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 29000000) throw new Error('备份文件超过 29 MB，请使用更小的备份');
    const data = JSON.parse(await file.text());
    preview.value = await request('/api/import', { method: 'POST', body: { mode: 'preview', data }, timeoutMs: 60000 });
    backup.value = data;
  } catch (failure) { error.value = failure instanceof SyntaxError ? '文件不是有效的 JSON 备份' : failure.message; }
  finally { busy.value = false; event.target.value = ''; }
}
async function restore() {
  busy.value = true; error.value = '';
  try {
    await request('/api/import', { method: 'POST', body: { mode: 'merge', data: backup.value }, timeoutMs: 60000 });
    backup.value = null; preview.value = null;
    await props.refresh(); emit('restored'); emit('notice', '备份已合并，已有记录保留');
  } catch (failure) { error.value = failure.message; }
  finally { busy.value = false; }
}
async function saveServices() {
  busy.value = true; error.value = '';
  try {
    const values = {};
    for (const key of Object.keys(fields)) {
      if (!key.endsWith('_KEY') || fields[key].trim() || clear[key]) values[key] = clear[key] ? '' : fields[key];
    }
    status.value = await desktop.saveServices(values);
    for (const key of Object.keys(fields).filter(key => key.endsWith('_KEY'))) { fields[key] = ''; clear[key] = false; }
    emit('notice', '配置已加密保存，重启工作台后生效');
  } catch { error.value = '服务配置保存失败，请检查服务地址与系统密钥存储'; }
  finally { busy.value = false; }
}
</script>
<template>
  <section aria-labelledby="settings-title">
    <div class="page-heading"><div><h1 id="settings-title">设置与备份</h1><p class="muted">保留自己的资料，按需连接搜索和 AI 服务。</p></div></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <section class="panel"><h2>本机资料备份</h2><p>备份包含岗位、来源、题目、回答、能力观察、草稿和训练任务，不包含 API Key。文件中可能含有个人信息。</p><div class="button-row"><button :disabled="busy" @click="exportBackup">导出备份</button><label class="file-label">选择备份文件<input type="file" accept=".json,application/json" :disabled="busy" @change="inspectBackup" /></label></div>
      <div v-if="preview" class="notice"><p>预计新增 {{ preview['新增'] }} 项，保留现有 {{ preview['保留现有'] }} 项。合并不会覆盖已有记录。</p><button :disabled="busy" @click="restore">确认合并备份</button><button class="text-button" :disabled="busy" @click="backup = null; preview = null">取消</button></div>
    </section>
    <section class="panel"><h2>搜索与 AI 服务</h2><p>搜索 {{ workspace.searchConfigured ? '已配置' : '未配置' }} · AI {{ workspace.aiConfigured ? '已配置' : '未配置' }}<span v-if="workspace.aiModel"> · {{ workspace.aiModel }}</span></p>
      <form v-if="desktop" @submit.prevent="saveServices">
        <div v-for="(label, key) in labels" :key="key"><label :for="`service-${key}`">{{ label }}<span v-if="key.endsWith('_KEY') && status?.configured[key]" class="muted">（已配置，留空保留）</span></label><input :id="`service-${key}`" v-model="fields[key]" :type="key.endsWith('_KEY') ? 'password' : 'text'" autocomplete="off" maxlength="2048" :disabled="busy || clear[key]" :placeholder="key === 'AI_MODEL' ? 'deepseek-flash' : key === 'AI_BASE_URL' ? 'https://api.deepseek.com' : ''" /><label v-if="key.endsWith('_KEY') && status?.configured[key]" class="check"><input v-model="clear[key]" type="checkbox" />清除此密钥</label></div>
        <p class="muted small">密钥由系统加密后保存在本机，不进入备份。搜索服务只需配置 Tavily 或 Exa 其中之一，AI 使用独立密钥。</p><div class="button-row"><button :disabled="busy">加密保存配置</button><button type="button" class="secondary" :disabled="busy" @click="desktop.restart()">重启使配置生效</button></div>
      </form>
      <p v-else class="muted">网页版从项目根目录的 .env 读取配置，修改后重启服务。可参考同目录的 .env.example。请勿将真实密钥写入代码或备份。</p>
    </section>
  </section>
</template>
