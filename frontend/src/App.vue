<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { request } from './api.js';
import JobSettings from './components/JobSettings.vue';
import SourceLibrary from './components/SourceLibrary.vue';
import ResearchSearch from './components/ResearchSearch.vue';
import PracticeSession from './components/PracticeSession.vue';
import CareerPlan from './components/CareerPlan.vue';
import DataSettings from './components/DataSettings.vue';
import InterviewDebrief from './components/InterviewDebrief.vue';

const workspace = reactive({ role: '', roleValidation: 'unset', jd: '', confirmed_requirements: '', sources: [] });
const tab = ref('career');
const loading = ref(true);
const error = ref('');
const message = ref('');
const authenticated = ref(false);
const practiceSelection = ref(null);
const activeTask = ref(null);
const abilityRevision = ref(0);
const restoreRevision = ref(0);
const practice = ref(null);
const activeSources = computed(() => workspace.sources.filter(source => source.role === workspace.role));
const questionCount = computed(() => activeSources.value.reduce((total, source) => total + source.questions.length, 0));

async function refresh() {
  const state = await request('/api/workspace');
  Object.assign(workspace, state);
  authenticated.value = true;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await refresh();
    if (!workspace.role) tab.value = 'job';
  } catch (failure) {
    error.value = failure.message;
  } finally {
    loading.value = false;
  }
}

function notify(text) {
  message.value = text;
}

function openPractice(selection) {
  if (!selection.source || selection.source.role !== workspace.role) {
    message.value = '请先在岗位设置切换到这道题所属的岗位';
    tab.value = 'job';
    return;
  }
  practiceSelection.value = selection;
  tab.value = 'practice';
}

function openAttempt(attempt) {
  practiceSelection.value = { attempt_id: attempt.id, followup: attempt.followup === true };
  tab.value = 'practice';
}

function openResearch(task) {
  if (task.role !== workspace.role) { message.value = '岗位已变化，请重新选择训练任务'; return; }
  activeTask.value = task;
  tab.value = 'research';
}

watch(() => workspace.role, () => { practiceSelection.value = null; activeTask.value = null; });

onMounted(() => {
  load();
  window.offerPilotDesktop?.onClose(() => practice.value?.flushDraft());
});
</script>

<template>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <div class="workbench">
    <header class="topbar">
      <a class="brand" href="#main" aria-label="OfferStrike 工作台"><span class="brand-mark" aria-hidden="true">O</span>OfferStrike<span class="brand-subtitle">面试突击</span></a>
      <span class="local-label"><span aria-hidden="true">●</span> 资料存于本机</span>
    </header>

    <div class="layout">
      <aside class="sidebar">
        <p class="sidebar-label">我的备战</p>
        <nav aria-label="工作台导航">
          <button :class="{ active: tab === 'library' }" :aria-current="tab === 'library' ? 'page' : undefined" @click="tab = 'library'">我的资料库<span>{{ questionCount }}</span></button>
          <button :class="{ active: tab === 'research' }" :aria-current="tab === 'research' ? 'page' : undefined" @click="activeTask = null; tab = 'research'">找面经</button>
          <button :class="{ active: tab === 'practice' }" :aria-current="tab === 'practice' ? 'page' : undefined" @click="tab = 'practice'">单题练习</button>
          <button :class="{ active: tab === 'career' }" :aria-current="tab === 'career' ? 'page' : undefined" @click="tab = 'career'">备战计划</button>
          <button :class="{ active: tab === 'job' }" :aria-current="tab === 'job' ? 'page' : undefined" @click="tab = 'job'">岗位与要求</button>
          <button :class="{ active: tab === 'debrief' }" :aria-current="tab === 'debrief' ? 'page' : undefined" @click="tab = 'debrief'">面试复盘</button>
          <button :class="{ active: tab === 'settings' }" :aria-current="tab === 'settings' ? 'page' : undefined" @click="tab = 'settings'">设置与备份</button>
        </nav>
        <div class="target-role"><span>当前目标</span><strong>{{ workspace.role || '还未设置岗位' }}</strong><button class="text-button" @click="tab = 'job'">调整岗位 ↗</button></div>
      </aside>

      <main id="main" tabindex="-1" :aria-busy="loading">
        <div v-if="loading" class="empty-state" role="status">正在读取本机资料…</div>
        <div v-else-if="!authenticated" class="empty-state"><h1>连接工作台</h1><p role="alert">{{ error }}</p><button @click="load">重新连接</button><p class="muted">重新打开服务启动窗口中的完整链接，可恢复本次访问。</p></div>
        <template v-else>
          <div v-if="message" class="notice" role="status">{{ message }}<button class="text-button" aria-label="关闭提示" @click="message = ''">关闭</button></div>
          <JobSettings v-show="tab === 'job'" :workspace="workspace" :refresh="refresh" @notice="notify" />
          <SourceLibrary v-show="tab === 'library'" :workspace="workspace" :refresh="refresh" @notice="notify" @set-role="tab = 'job'" @practice="openPractice" />
          <ResearchSearch v-show="tab === 'research'" :workspace="workspace" :refresh="refresh" :task="activeTask" @notice="notify" @set-role="tab = 'job'" @library="tab = 'library'" @practice="openPractice" @task-updated="abilityRevision++" @standalone="activeTask = null" />
          <PracticeSession ref="practice" v-show="tab === 'practice'" :key="`${workspace.role}-${restoreRevision}`" :workspace="workspace" :selection="practiceSelection" @notice="notify" @set-role="tab = 'job'" @updated="abilityRevision++" />
          <CareerPlan v-show="tab === 'career'" :key="`career-${workspace.role}`" :workspace="workspace" :revision="abilityRevision" @notice="notify" @set-role="tab = 'job'" @practice="openPractice" @attempt="openAttempt" @research="openResearch" />
          <InterviewDebrief v-show="tab === 'debrief'" :workspace="workspace" :refresh="refresh" @notice="notify" @practice="openPractice" />
          <DataSettings v-show="tab === 'settings'" :workspace="workspace" :refresh="refresh" @notice="notify" @restored="restoreRevision++; abilityRevision++" />
        </template>
      </main>
    </div>
  </div>
</template>
