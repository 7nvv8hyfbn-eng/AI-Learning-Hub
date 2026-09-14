<script setup lang="ts">
import { BRAND_NAME, BRAND_SLOGAN_LINES } from '@ai-learning-hub/contracts'
import type { Component } from 'vue'
import type { PublicHomepageModuleDto } from '@ai-learning-hub/contracts'
import { onBeforeUnmount, onErrorCaptured, onMounted, ref } from 'vue'

defineProps<{ component: Component; module: PublicHomepageModuleDto }>()
const failed = ref(false)
const visible = ref(false)
const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onErrorCaptured((error) => {
  failed.value = true
  console.error('首页模块渲染失败，已隔离', error)
  return false
})
onMounted(() => {
  if (!('IntersectionObserver' in window)) {
    visible.value = true
    return
  }
  observer = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting) return
    visible.value = true
    observer?.disconnect()
  }, { rootMargin: '80px' })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="root" class="homepage-module-boundary" :class="{ visible }">
    <section v-if="failed && module.moduleKey === 'hero_banner'" class="home-hero hero-fallback">
      <div class="hero-copy"><span class="eyebrow">{{ BRAND_NAME }}</span><h1><span v-for="line in BRAND_SLOGAN_LINES" :key="line">{{ line }}</span></h1><p>从基础知识到真实项目，建立学习、实践与验证闭环。</p><RouterLink class="button primary" to="/topics">开始学习</RouterLink></div>
    </section>
    <component :is="component" v-else-if="!failed" :module="module" />
  </div>
</template>
