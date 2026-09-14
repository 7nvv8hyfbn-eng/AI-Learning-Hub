<script setup lang="ts">
import { BRAND_NAME, BRAND_SLOGAN_LINES } from '@ai-learning-hub/contracts'
import type { PublicHomepageModuleDto } from '@ai-learning-hub/contracts'
import { computed } from 'vue'
import heroCampus from '../../assets/hero-campus.webp'
import { configArray, configText } from '../module-utils'

const props = defineProps<{ module: PublicHomepageModuleDto }>()
const titleLines = computed(() => configArray<string>(props.module, 'titleLines').length ? configArray<string>(props.module, 'titleLines') : BRAND_SLOGAN_LINES)
const floatingLabels = computed(() => configArray<string>(props.module, 'floatingLabels'))
const stats = computed(() => configArray<{ label: string; value: string }>(props.module, 'stats'))
const primary = computed(() => props.module.config.primaryAction as { label?: string; route?: string } | undefined)
const secondary = computed(() => props.module.config.secondaryAction as { label?: string; route?: string } | undefined)
</script>
<template>
  <section class="home-hero">
    <div class="hero-copy">
      <span class="eyebrow">{{ configText(module, 'eyebrow', BRAND_NAME) }}</span>
      <h1><span v-for="line in titleLines" :key="line">{{ line }}</span></h1>
      <p>{{ configText(module, 'subtitle', '从基础知识到真实项目，建立学习、实践与验证闭环。') }}</p>
      <div class="hero-actions">
        <RouterLink class="button primary" :to="primary?.route || '/topics'">{{ primary?.label || '开始学习' }}</RouterLink>
        <RouterLink class="button secondary" :to="secondary?.route || '/labs'">{{ secondary?.label || '查看实训项目' }}</RouterLink>
      </div>
      <div class="hero-stats" aria-label="平台演示数据">
        <span v-for="stat in stats" :key="stat.label"><strong>{{ stat.value }}</strong>{{ stat.label }}</span>
      </div>
    </div>
    <div class="hero-visual">
      <img :src="heroCampus" alt="AI Agent 工作流、课程与算力设备组成的校园学习场景" />
      <span v-for="(label, index) in floatingLabels" :key="label" :class="`floating-label label-${index + 1}`">{{ label }}</span>
      <div class="hero-terminal"><span>AI Agent 工作流</span><code>plan / tools / review</code><small>学习进度 68%</small></div>
    </div>
  </section>
</template>
