<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { request, sourceLink } from '../api.js';

const props = defineProps({ workspace: { type: Object, required: true }, refresh: { type: Function, required: true }, task: { type: Object, default: null } });
const emit = defineEmits(['notice', 'set-role', 'library', 'practice', 'task-updated', 'standalone']);
const form = reactive({ company: '', source: 'all', range: 'year', topic: '', confirm: false, aiRelevance: false });
const busy = ref(false);
const error = ref('');
const result = ref(null);
const resultRole = ref('');
const saved = reactive({});
const reviewed = reactive({});
const reported = reactive({});
const saving = ref('');
const mode = ref('deep');
const taskStatus = ref('');
const stopMessages = {
  covered: '已找到带原文证据的候选题，请逐题核对后保存。',
  no_candidates: '没有找到符合本次条件的面经线索，可以调整关键词或时间范围。',
  model_unavailable: '搜索已完成，AI 服务尚未配置，暂时无法提取题目。',
  search_unavailable: '搜索服务暂不可用，请检查密钥、网络和服务额度。',
  deadline: '已达到本次研究时间上限，以下展示已完成的结果。',
  cost_budget: '已达到本次调用预算，以下展示已完成的结果。',
  model_budget: '已达到本次模型处理上限，以下展示已完成的结果。',
  tool_budget: '本次检索与读取额度已用完，以下展示已完成的结果。',
  round_limit: '本次研究已结束，请核对结果或调整检索条件。',
};
const searchLinks = computed(() => result.value?.links || [
  ...(result.value?.results || []), ...(result.value?.supplementary_results || []), ...(result.value?.unverified_results || []),
]);
const statuses = { manual: '需手动打开', not_read: '尚未读取', read_failed: '读取失败', read: '已读取',
  date_unverified: '正文日期未通过', extraction_failed: '提取失败', no_questions: '未找到有依据的问题',
  evidence: '已提取候选题', supplementary: '补充资料' };
watch(() => props.workspace.role, () => { result.value = null; form.confirm = false; });
watch(() => props.task, task => {
  result.value = task?.result || null;
  resultRole.value = props.workspace.role;
  taskStatus.value = task?.status || '';
  form.topic = task?.research_request.topics.join('，') || '';
  form.confirm = false;
  if (task) mode.value = 'deep';
  if (task?.candidate_id && task.question) saved[task.candidate_id] = task.question;
});

async function search() {
  busy.value = true;
  error.value = '';
  result.value = null;
  resultRole.value = props.workspace.role;
  const taskId = props.task?.id || '';
  try {
    const response = await request(mode.value === 'deep' ? '/api/research' : '/api/search', {
      method: 'POST', timeoutMs: 85000,
      body: { role: resultRole.value, company: form.company, source: form.source, range: form.range,
        topics: form.topic.trim() ? [form.topic.trim()] : [], confirm: form.confirm,
        ai_relevance: mode.value === 'links' && form.aiRelevance, task_id: taskId },
    });
    if (props.workspace.role === resultRole.value && taskId === (props.task?.id || '')) {
      result.value = response;
      taskStatus.value = response.task_status || '';
      if (taskId) emit('task-updated');
    }
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

async function confirm(candidate) {
  saving.value = candidate.id;
  error.value = '';
  try {
    const record = await request('/api/research/confirm', { method: 'POST', body: {
      role: resultRole.value, id: candidate.id, self_reported: reported[candidate.id] === true, task_id: props.task?.id || '',
    } });
    saved[candidate.id] = record;
    await props.refresh();
    if (props.task) { taskStatus.value = 'ready'; emit('task-updated'); }
    emit('notice', '题目及其原文证据已加入资料库');
  } catch (failure) {
    error.value = failure.message;
  } finally {
    saving.value = '';
  }
}

async function cancelTask() {
  error.value = '';
  try {
    const response = await request('/api/training/tasks/cancel', { method: 'POST', body: { role: props.workspace.role, id: props.task.id } });
    taskStatus.value = response.task.status;
    result.value = response.task.result;
    emit('task-updated');
  } catch (failure) { error.value = failure.message; }
}
</script>

<template>
  <section aria-labelledby="research-title">
    <div class="page-heading"><div><h1 id="research-title">找面经</h1><p class="muted">找到原帖，核对证据，再加入自己的题库。</p></div></div>
    <div v-if="task" class="panel task-banner"><h2>补题目标 {{ task.topic || '岗位通用题' }}</h2><p v-if="task.point">需要训练的知识点 {{ task.point }}</p><p>{{ ({proposed:'等待确认公开关键词后执行搜索', searching:'正在搜索', review:'等待核对原帖', ready:'题目已确认', completed:'训练已完成', failed:'本次任务失败，请回到备战计划查看原因', cancelled:'此任务已取消'})[taskStatus] }}</p><div class="button-row"><button v-if="['proposed','searching','review','ready'].includes(taskStatus)" class="secondary" @click="cancelTask">取消补题任务</button><button class="text-button" @click="emit('standalone')">返回独立搜索</button></div></div>
    <p v-if="!workspace.role" class="notice">设置目标岗位后开始搜索。<button @click="emit('set-role')">设置岗位</button></p>
    <form v-else class="panel research-form" @submit.prevent="search">
      <p class="current-search-role">目标岗位 <strong>{{ workspace.role }}</strong></p>
      <div class="form-grid"><div><label for="research-company">公司（可选）</label><input id="research-company" v-model="form.company" maxlength="100" :disabled="busy" placeholder="留空查看各家公司" /></div><div><label for="research-topic">知识主题（可选）</label><input id="research-topic" v-model="form.topic" maxlength="40" :disabled="busy || Boolean(task)" placeholder="例如 RAG 检索评估" /></div><div><label for="research-source">来源</label><select id="research-source" v-model="form.source" :disabled="busy"><option value="all">全部平台</option><option value="nowcoder">牛客</option><option value="cnblogs">博客园</option><option value="juejin">掘金</option><option value="zhihu">知乎</option><option value="csdn">CSDN</option><option value="51cto">51CTO</option><option value="segmentfault">SegmentFault</option></select></div><div><label for="research-range">发布时间</label><select id="research-range" v-model="form.range" :disabled="busy"><option value="3m">近三个月</option><option value="6m">近半年</option><option value="year">近一年</option><option value="all">全部时间</option></select></div></div>
      <fieldset class="search-mode"><legend>搜索方式</legend><label><input v-model="mode" type="radio" value="deep" :disabled="busy || Boolean(task)" />读取原帖并提取候选题</label><label><input v-model="mode" type="radio" value="links" :disabled="busy || Boolean(task)" />只找原帖链接</label></fieldset>
      <template v-if="mode === 'links' && workspace.aiConfigured"><label class="checkbox-label"><input v-model="form.aiRelevance" type="checkbox" :disabled="busy" />AI 辅助判断标题与摘要的相关性</label><p v-if="form.aiRelevance" class="muted small">将向已配置的 AI 发送最多 100 条公开标题和摘要。标题超过 500 字、摘要超过 2000 字的结果保留为待核实，处理范围会在结果中提示。</p></template>
      <p class="muted small">查询将发送岗位、公司和主题给搜索服务。<template v-if="mode === 'deep'">提题会读取公开原帖，并将最多 6000 字正文发送给已配置的 AI。每次最多检索 4 次、读取 2 篇，75 秒结束。</template><template v-else>本次最多执行 3 次检索请求。</template></p>
      <label class="checkbox-label"><input v-model="form.confirm" type="checkbox" required :disabled="busy" />我确认使用这些公开关键词及上述处理范围</label>
      <p v-if="!workspace.searchProviders?.length" class="warning">尚未配置搜索服务，请在项目根目录 .env 设置 Tavily 或 Exa 后重启。</p>
      <div class="button-row"><button :disabled="busy || !workspace.searchProviders?.length || (mode === 'deep' && !workspace.aiConfigured) || (Boolean(task) && taskStatus !== 'proposed')">{{ busy ? '正在搜索与核对…' : mode === 'deep' ? '搜索并提题' : '搜索原帖' }}</button></div>
      <p v-if="mode === 'deep' && !workspace.aiConfigured" class="warning">AI 服务尚未配置。可以先选择“只找原帖链接”。</p>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="busy" class="notice" role="status">正在执行本次研究，请稍候…</div>
    <template v-if="result">
      <div class="research-summary"><p role="status">{{ stopMessages[result.stop] || result.notice }}</p><p v-if="result.usage" class="muted small">检索 {{ result.usage.search }} 次 · 读取 {{ result.usage.read }} 篇 · AI {{ result.usage.model }} 次 · {{ (result.usage.duration_ms / 1000).toFixed(1) }} 秒 · 实际费用待服务商账单核对<span v-if="result.cached"> · 复用最近结果</span></p></div>
      <article v-for="candidate in result.candidates || []" :key="candidate.id" class="panel candidate-card">
        <h2>{{ candidate.question }}</h2><a :href="sourceLink(candidate.url)" target="_blank" rel="noopener noreferrer">{{ candidate.title }} ↗</a>
        <blockquote>{{ candidate.evidence }}</blockquote>
        <p class="muted small">公司 {{ candidate.company || '待人工确认' }} · 岗位 {{ candidate.role || '待人工确认' }} · 日期 {{ candidate.date || '未知' }}</p>
        <template v-if="!saved[candidate.id]"><label class="checkbox-label"><input v-model="reviewed[candidate.id]" type="checkbox" />已打开原帖，核对题目、证据、公司和岗位</label><label class="checkbox-label"><input v-model="reported[candidate.id]" type="checkbox" />确认属于作者自述面经{{ task ? '（本任务必选）' : '（可选）' }}</label><button :disabled="!reviewed[candidate.id] || Boolean(saving) || (Boolean(task) && !reported[candidate.id])" @click="confirm(candidate)">{{ saving === candidate.id ? '正在保存…' : '确认加入题库' }}</button></template>
        <div v-else class="button-row"><span class="muted">已保存原文证据</span><button class="secondary" @click="emit('library')">查看资料库</button><button @click="emit('practice', {question: saved[candidate.id], source: workspace.sources.find(item => item.id === saved[candidate.id].source_id)})">开始练习</button></div>
      </article>
      <details v-if="searchLinks.length" class="panel research-links" :open="!result.candidates?.length"><summary>原帖线索与读取情况（{{ searchLinks.length }}）</summary><ul><li v-for="item in searchLinks" :key="item.url"><a :href="sourceLink(item.url)" target="_blank" rel="noopener noreferrer">{{ item.title }} ↗</a><p class="muted small">{{ statuses[item.status] || item.content_hint || '待核实' }} · {{ item.date || '发布日期未知' }}<span v-if="item.source_truncated"> · 本次发送正文前 {{ item.model_source_chars }} 字，余文未发送</span></p></li></ul></details>
      <p v-else-if="!result.candidates?.length" class="empty-state">本次没有可展示的面经结果。</p>
    </template>
  </section>
</template>
