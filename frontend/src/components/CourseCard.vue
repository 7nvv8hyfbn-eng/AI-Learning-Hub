<script setup lang="ts">
import { computed } from 'vue'
import { dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
import { useLearningStore } from '../stores/learning'
import ProgressBar from './ProgressBar.vue'
import BaseContentCard from './base/BaseContentCard.vue'
import AppIcon from './base/AppIcon.vue'
import type { Course } from '../types'

const props = withDefaults(defineProps<{
  course: Course
  compact?: boolean
  variant?: 'default' | 'topics-board'
}>(), { compact: false, variant: 'default' })
const store = useLearningStore()
const auth = useAuthStore()
const favorite = computed(() => store.isFavorite('course', props.course.id))
const accountDataReady = computed(() => dataMode === 'mock' || store.accountSyncState === 'synced')
const accountDataMessage = computed(() => {
  if (!auth.user) return '登录后查看课程进度'
  return store.accountSyncState === 'sync-error' ? '账号进度暂不可用' : '正在同步账号进度…'
})
</script>

<template>
  <BaseContentCard class="course-card" :class="{ 'course-card--topics-board': variant === 'topics-board' }" :compact="compact" :title="course.title" :to="`/courses/${course.id}`" :media="course" :cover-variant="course.coverVariant" :icon="course.icon" :tag="course.category">
      <div class="meta">
        <span><AppIcon v-if="variant === 'topics-board'" name="target" :size="14" />{{ course.level }}</span>
        <span><AppIcon v-if="variant === 'topics-board'" name="clock" :size="14" />{{ course.hours == null ? '时长 —' : `${course.hours} 小时` }}</span>
        <span><AppIcon v-if="variant === 'topics-board'" name="users" :size="14" />{{ course.learners == null ? '学习人数 —' : `${(course.learners / 1000).toFixed(1)}k 人` }}</span>
      </div>
      <RouterLink :to="`/courses/${course.id}`"><h3>{{ course.title }}</h3></RouterLink>
      <p>{{ course.description }}</p>
      <ProgressBar v-if="accountDataReady" :value="store.courseProgress[course.id] ?? course.progress ?? 0" label="学习进度" />
      <p v-else class="account-data-placeholder">{{ accountDataMessage }}</p>
      <div class="card-actions">
        <RouterLink class="button primary ghost-primary" :to="`/courses/${course.id}`">{{ store.courseProgress[course.id] || course.progress ? '继续学习' : '开始学习' }}</RouterLink>
        <button class="icon-button" type="button" :class="{ active: favorite }" :aria-pressed="favorite" :aria-label="favorite ? `取消收藏${course.title}` : `收藏${course.title}`" @click="store.toggleFavorite('course', course.id)"><AppIcon name="bookmark" :size="18" /></button>
      </div>
  </BaseContentCard>
</template>
