<script setup lang="ts">
import AppIcon from './base/AppIcon.vue'

defineProps<{ state: string; errorMessage?: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="state === 'loading'" class="page-container state-panel" aria-live="polite">
    <div v-for="index in 6" :key="index" class="skeleton" />
    <span class="sr-only">正在加载内容</span>
  </div>
  <div v-else-if="state === 'empty'" class="page-container state-message">
    <span class="state-icon"><AppIcon name="file" :size="28" /></span><h1>暂时没有内容</h1><p>调整筛选条件或稍后再来看看。</p>
    <RouterLink class="back-button" to="/" aria-label="返回首页" title="返回首页"><AppIcon name="back" /></RouterLink>
  </div>
  <div v-else-if="state === 'error'" class="page-container state-message" role="alert">
    <span class="state-icon">!</span><h1>内容加载失败</h1><p>{{ errorMessage || '请求没有完成，请重新尝试。' }}</p>
    <button class="button primary" type="button" @click="$emit('retry')">重新加载</button>
  </div>
  <slot v-else />
</template>
