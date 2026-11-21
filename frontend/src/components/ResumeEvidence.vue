<script setup>
import { ref, watch } from 'vue';
import { request } from '../api.js';
const props = defineProps({ role: String });
const resume = ref(''); const consent = ref(false); const busy = ref(false); const error = ref(''); const result = ref(null);
let version = 0;
watch(() => props.role, () => { version++; resume.value = ''; consent.value = false; result.value = null; error.value = ''; });
async function extract() {
  busy.value = true; error.value = ''; result.value = null; const current = version;
  try {
    const output = await request('/api/career/resume', { method: 'POST', timeoutMs: 45000, body: { role: props.role, resume: resume.value, confirm: consent.value } });
    if (current === version) result.value = output;
  } catch (failure) { if (current === version) error.value = failure.message; }
  finally { busy.value = false; }
}
</script>
<template>
  <details class="panel resume-evidence"><summary>从简历核对岗位能力线索（可选）</summary><p class="muted">只提取你提供的简历原文，不读取练习历史，不判定掌握程度。</p><form @submit.prevent="extract"><label for="resume-text">简历或项目经历</label><textarea id="resume-text" v-model="resume" maxlength="6000" rows="6" :disabled="busy" placeholder="建议先移除姓名、联系方式等不必要信息" /><label class="check"><input v-model="consent" type="checkbox" :disabled="busy" />同意将以上全部文本（最多 6000 字）发送给已配置的 AI 服务</label><button :disabled="busy || !consent || !resume.trim()">{{ busy ? '正在摘录…' : '提取能力线索' }}</button></form><p v-if="error" class="error" role="alert">{{ error }}</p><div v-if="result"><p v-if="!result.abilities.length">没有获得可定位的原文线索。</p><article v-for="(item, index) in result.abilities" :key="index"><h3>{{ item.requirement }}</h3><blockquote>{{ item.evidence }}</blockquote></article><p v-for="item in result.comparison" :key="item.topic" class="muted">{{ item.topic }} · {{ item.match === 'literal_match' ? '原文提及，能力待验证' : '尚未匹配，需要核对' }}</p></div></details>
</template>
