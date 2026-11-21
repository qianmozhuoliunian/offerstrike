<script setup>
defineProps({ evaluation: { type: Object, default: null } });
</script>

<template>
  <details v-if="evaluation" class="ability-evaluation" open>
    <summary>本轮能力观察<span v-if="evaluation.topic"> · {{ evaluation.topic }}</span></summary>
    <template v-if="evaluation.strengths?.length"><h3>有依据的正确表现</h3><div v-for="item in evaluation.strengths" :key="item.point"><p>{{ item.point }}</p><blockquote>{{ item.evidence }}</blockquote></div></template>
    <template v-if="evaluation.weaknesses?.length"><h3>需要继续练习的部分</h3><div v-for="item in evaluation.weaknesses" :key="item.point"><p><span class="observation-type">{{ item.type === 'missing' ? '本轮遗漏' : '明确错误' }}</span>{{ item.point }}</p><blockquote>{{ item.evidence }}</blockquote><p v-if="item.requirement" class="muted small">题目要求 “{{ item.requirement }}”</p></div></template>
    <template v-if="evaluation.unverified?.length"><h3>尚未验证</h3><ul><li v-for="point in evaluation.unverified" :key="point">{{ point }}</li></ul></template>
  </details>
</template>
