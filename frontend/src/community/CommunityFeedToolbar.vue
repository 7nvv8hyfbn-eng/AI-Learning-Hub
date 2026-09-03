<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityFeedMode, CommunityPostType } from '@ai-learning-hub/contracts'
import AppIcon from '../components/base/AppIcon.vue'
defineProps<{ mode: CommunityFeedMode; type: CommunityPostType | 'all'; newCount: number; loading: boolean }>()
defineEmits<{ change: [mode: CommunityFeedMode, type: CommunityPostType | 'all']; refresh: [] }>()
const router = useRouter()
const search = () => router.push('/community/search')
const keyword = ref('')
const submitSearch = () => {
  const query = new URLSearchParams()
  if (keyword.value.trim()) query.set('q', keyword.value.trim())
  void router.push(`/community/search?${query.toString()}`)
}
const shortcut = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return
  event.preventDefault()
  void search()
}
onMounted(() => window.addEventListener('keydown', shortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', shortcut))
</script>
<template>
  <div class="community-feed-sticky">
    <div class="community-feed-mode-row">
      <div class="community-feed-tabs" role="tablist" aria-label="信息流模式"><button v-for="[value, label] in [['for_you', '推荐'], ['following', '关注'], ['latest', '最新']]" :key="value" role="tab" :aria-selected="mode === value" @click="$emit('change', value as CommunityFeedMode, type)">{{ label }}</button></div>
      <button class="icon-button" aria-label="刷新信息流" :disabled="loading" @click="$emit('refresh')"><AppIcon name="refresh" :size="19" /></button>
      <button class="icon-button" aria-label="搜索社区学习内容" title="搜索（/）" @click="search"><AppIcon name="search" :size="19" /></button>
    </div>
    <div class="community-filters" aria-label="内容类型"><button v-for="[value, label] in [['all', '全部'], ['question', '学习问答'], ['note', '学习笔记'], ['lab_result', '实训成果'], ['project', '创客项目'], ['frontier_discussion', '前沿讨论']]" :key="value" :class="{ active: type === value }" :aria-pressed="type === value" @click="$emit('change', mode, value as CommunityPostType | 'all')">{{ label }}</button></div>
    <form class="community-feed-search" role="search" @submit.prevent="submitSearch"><AppIcon class="community-feed-search-icon" name="search" :size="18" /><input v-model="keyword" type="search" placeholder="搜索动态、用户、话题与学习内容" aria-label="搜索社区学习内容" maxlength="120" /><button v-if="keyword" class="icon-button community-feed-search-clear" type="button" aria-label="清除搜索" @click="keyword = ''">×</button></form>
    <button v-if="newCount" class="community-new-content" :disabled="loading" @click="$emit('refresh')">有 {{ newCount }} 条新内容，点击加载</button>
  </div>
</template>
