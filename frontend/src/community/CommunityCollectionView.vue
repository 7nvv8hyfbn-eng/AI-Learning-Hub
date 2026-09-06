<script setup lang="ts">
import AppIcon from '../components/base/AppIcon.vue'
import FollowButton from '../components/base/FollowButton.vue'
import CommunityEmptyState from './CommunityEmptyState.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CommunitySkeleton from './CommunitySkeleton.vue'
import type { CommunityPostDetailDto, CommunityTopicDto } from '@ai-learning-hub/contracts'
import { useCommunityStore } from '../stores/community'
import { useLearningStore } from '../stores/learning'
import { communityApi } from '../services/api/community'
import CommunityPostCard from './CommunityPostCard.vue'
const route = useRoute(), store = useCommunityStore(), learning = useLearningStore()
const posts = ref<CommunityPostDetailDto[]>([]), topic = ref<CommunityTopicDto | null>(null), error = ref(''), tab = ref('posts'), loading = ref(false)
let loadEpoch = 0
const view = computed(() => String(route.meta.communityView || 'search'))
const title = computed(() => view.value === 'bookmarks' ? '收藏与笔记' : view.value === 'topic' ? `# ${topic.value?.name || '学习话题'}` : `搜索：${String(route.query.q || '')}`)
const load = async () => {
  const epoch = ++loadEpoch, accountEpoch = store.epoch
  const current = () => epoch === loadEpoch && accountEpoch === store.epoch
  const requestedView = view.value, slug = String(route.params.slug)
  const query = new URLSearchParams({ keyword: String(route.query.q || ''), ...(route.query.bindingId ? { bindingId: String(route.query.bindingId) } : {}) }).toString()
  posts.value = []; topic.value = null
  loading.value = true; error.value = ''
  try {
    if (requestedView === 'topic') {
      const [nextTopics, nextPosts] = await Promise.all([communityApi.topics(), communityApi.list('topic', slug)])
      if (!current()) return
      topic.value = nextTopics.find((item) => item.slug === slug) || null; posts.value = nextPosts
    } else {
      const nextPosts = await communityApi.list(requestedView === 'bookmarks' ? 'bookmarks' : 'posts', '', query)
      if (!current()) return
      posts.value = nextPosts
    }
    if (requestedView === 'topic' && topic.value) void communityApi.signals({ eventType: 'community_topic_visit', targetType: 'topic', targetId: topic.value.id }).catch(() => undefined)
  } catch (cause) { if (current()) error.value = cause instanceof Error ? cause.message : '内容读取失败' } finally { if (current()) loading.value = false }
}
const follow = async () => {
  const target = view.value === 'topic' ? topic.value : null, epoch = loadEpoch
  if (!target) return
  try { await store.follow(target.id, view.value === 'topic', !target.following, target) } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '关注失败' }
}
watch([() => route.path, () => route.query.tab], ([, value]) => { const allowed = view.value === 'bookmarks' ? ['posts', 'notes', 'learning'] : ['posts']; tab.value = allowed.includes(String(value)) ? String(value) : 'posts' }, { immediate: true })
watch([() => route.fullPath, tab], load, { immediate: true })
onBeforeUnmount(() => { loadEpoch++ })
</script>
<template><section><header class="community-page-heading"><div><RouterLink to="/community"><AppIcon name="arrow-left" :size="15" />社区发现</RouterLink><h1>{{ title }}</h1><p v-if="topic">{{ topic.description }}</p></div><FollowButton v-if="topic" :active="topic.following" :pending="store.operations[`follow:topic:${topic.id}`]" @click="follow" /></header>
  <div v-if="view === 'bookmarks'" class="community-feed-tabs"><button :aria-selected="tab === 'posts'" @click="tab = 'posts'">社区收藏</button><button :aria-selected="tab === 'notes'" @click="tab = 'notes'">私人笔记</button><button :aria-selected="tab === 'learning'" @click="tab = 'learning'">学习收藏</button></div>
  <p v-if="error" class="community-error" role="alert">{{ error }} <button @click="load">重试</button></p><CommunitySkeleton v-if="loading" />
  <div v-if="view === 'bookmarks' && tab === 'notes'" class="community-collection"><article v-for="(note, key) in learning.notes" :key="key" class="community-note"><h2>{{ String(key).split(':')[0] }}</h2><p>{{ note }}</p><button class="button secondary small" @click="store.openComposer({ type: 'note', contentBlocks: [{ type: 'paragraph', text: note }], bindings: [{ type: 'course', id: String(key).split(':')[0] }] })">主动发布为学习笔记</button></article><p v-if="!Object.keys(learning.notes).length">你还没有私人课程笔记。笔记不会自动公开。</p></div>
  <div v-else-if="view === 'bookmarks' && tab === 'learning'" class="community-collection"><RouterLink v-for="favorite in learning.favorites" :key="`${favorite.type}:${favorite.id}`" class="community-binding" :to="favorite.type === 'course' ? `/courses/${favorite.id}` : favorite.type === 'lab' ? `/labs/${favorite.id}` : favorite.type === 'resource' ? `/resources?resource=${favorite.id}` : `/frontier?article=${favorite.id}`">{{ favorite.id }} <AppIcon name="arrow-up-right" :size="14" /></RouterLink><p v-if="!learning.favorites.length">还没有收藏学习内容。</p></div>
  <template v-else><CommunityPostCard v-for="post in posts" :key="post.id" :post="post" @changed="load" @hidden="load" /><CommunityEmptyState v-if="!posts.length && !error" title="这里还没有内容" description="分享一个发现，或从社区首页开始探索。"><RouterLink class="button secondary" to="/community">探索社区</RouterLink></CommunityEmptyState></template>
</section></template>
