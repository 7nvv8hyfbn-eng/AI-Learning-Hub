<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityAuthorDto, CommunityFeedMode, CommunityPostType } from '@ai-learning-hub/contracts'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import { useCommunityScrollRoot } from './composables/useCommunityScrollRoot'
import { useCommunityStore } from '../stores/community'
const props = defineProps<{ mode: CommunityFeedMode; type: CommunityPostType | 'all'; newCount: number; loading: boolean }>()
defineEmits<{ change: [mode: CommunityFeedMode, type: CommunityPostType | 'all']; refresh: [] }>()
const router = useRouter()
const store = useCommunityStore()
const scrollRoot = useCommunityScrollRoot()
const search = () => router.push('/community/search')
const keyword = ref('')
const submit = () => { const q = keyword.value.trim(); if (q) void router.push({ path: '/community/search', query: { q } }) }
const backToTop = () => scrollRoot.value?.scrollTo({ top: 0, behavior: 'smooth' })
const feedPublishers = computed<CommunityAuthorDto[]>(() => {
  const feed = store.feeds[`${props.mode}:${props.type}`]
  const seen = new Set<string>(), list: CommunityAuthorDto[] = []
  for (const item of feed?.items || []) {
    if (item.type !== 'post') continue
    const author = item.post.author
    if (author && !seen.has(author.id)) { seen.add(author.id); list.push(author) }
    if (list.length >= 3) break
  }
  return list
})
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
    <div class="community-filters" aria-label="内容类型"><button v-for="[value, label] in [['all', '全部'], ['question', '学习问答'], ['note', '学习笔记'], ['lab_result', '实训成果'], ['project', '创客项目'], ['frontier_discussion', '前沿讨论']]" :key="value" :class="{ active: type === value }" :aria-pressed="type === value" @click="$emit('change', mode, value as CommunityPostType | 'all')">{{ label }}</button><button class="community-published-pill" type="button" aria-label="回到顶层" title="回到顶层" @click="backToTop"><span class="pill-arrow" aria-hidden="true">↑</span><span v-if="feedPublishers.length" class="pill-avatars" aria-hidden="true"><CommunityAvatar v-for="publisher in feedPublishers" :key="publisher.id" :src="publisher.avatar" :username="publisher.username" :name="publisher.displayName" size="xs" /></span><span class="pill-text">已发布</span></button></div>
    <form class="community-search community-search-bar" @submit.prevent="submit" @keydown.esc.prevent="keyword = ''"><AppIcon name="search" :size="17" /><input v-model="keyword" placeholder="搜索动态、用户、话题与学习内容" aria-label="搜索学习内容" maxlength="120" /><button v-if="keyword" class="text-link" type="button" aria-label="清除搜索" @click="keyword = ''">清除</button></form>
    <button v-if="newCount" class="community-new-content" :disabled="loading" @click="$emit('refresh')">有 {{ newCount }} 条新内容，点击加载</button>
  </div>
</template>
<style scoped>
.community-search-bar { margin: 9px 0 0; }
.community-search-bar input { height: 34px; }
.community-published-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  margin-left: auto;
  border: 0;
  border-radius: 999px;
  padding: 5px 14px 5px 10px;
  background: var(--amc-orange);
  color: #fff;
  cursor: pointer;
  animation: amc-pill-blink 2.6s ease-in-out infinite;
  transition: background var(--amc-duration-control) var(--amc-ease), opacity var(--amc-duration-control) var(--amc-ease);
}
.community-published-pill:hover { background: color-mix(in srgb, var(--amc-orange) 80%, #000); animation: none; opacity: 1; }
.pill-arrow { font-size: 16px; line-height: 1; font-weight: 700; }
.pill-avatars { display: inline-flex; align-items: center; }
.pill-avatars :deep(.community-avatar) { width: 22px; height: 22px; border: 2px solid #fff; }
.pill-avatars :deep(.community-avatar + .community-avatar) { margin-left: -10px; }
.pill-text { font-size: 12px; font-weight: 600; letter-spacing: 0.05em; white-space: nowrap; }
@keyframes amc-pill-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
</style>
