<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CommunityFeedMode, CommunityPostType } from '@ai-learning-hub/contracts'
import { useThemesStore } from '../stores/content/themes'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../services/api/community'
import CommunityPostCard from './CommunityPostCard.vue'
import CommunityQuickComposer from './CommunityQuickComposer.vue'
import CommunitySkeleton from './CommunitySkeleton.vue'
import CommunityFeedToolbar from './CommunityFeedToolbar.vue'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityEmptyState from './CommunityEmptyState.vue'
import { postLabels } from './labels'
import { useCommunityScrollRoot } from './composables/useCommunityScrollRoot'
import { useCommunityAccess } from './composables/useCommunityAccess'
const store = useCommunityStore(), route = useRoute(), router = useRouter()
const { decision, requireWrite } = useCommunityAccess()
const canEditProfile = computed(() => decision('profile').allowed)
const themes = useThemesStore(), demoThemes = computed(() => themes.items)
const mode = computed<CommunityFeedMode>(() => ['for_you', 'following', 'latest'].includes(String(route.query.mode)) ? route.query.mode as CommunityFeedMode : 'for_you')
const type = computed<CommunityPostType | 'all'>(() => Object.keys(postLabels).includes(String(route.query.type)) ? route.query.type as CommunityPostType : 'all')
const key = computed(() => `${mode.value}:${type.value}`), feed = computed(() => store.feeds[key.value])
const loading = ref(false), error = ref(''), newCount = ref(0), since = ref(new Date().toISOString())
const interestsOpen = ref(false), interests = ref<string[]>([]), sentinel = ref<HTMLElement | null>(null), feedRoot = ref<HTMLElement | null>(null)
const scrollRoot = useCommunityScrollRoot()
let alive = true
let observer: IntersectionObserver | undefined, polling: number | undefined
const visibleAnchor = () => {
  const top = scrollRoot.value?.getBoundingClientRect().top || 0
  const toolbar = feedRoot.value?.querySelector('.community-feed-sticky')?.getBoundingClientRect().height || 0
  const row = [...(feedRoot.value?.querySelectorAll<HTMLElement>('[data-feed-id]') || [])].find((item) => item.getBoundingClientRect().bottom > top + toolbar)
  return row ? { id: row.dataset.feedId!, offset: row.getBoundingClientRect().top - top } : undefined
}
const remember = (feedKey = key.value) => {
  const anchor = visibleAnchor()
  store.rememberFeed(feedKey, scrollRoot.value?.scrollTop || 0, anchor)
}
const restore = (anchor?: { id: string; offset: number }) => {
  const root = scrollRoot.value
  if (!root) return
  const row = anchor && [...(feedRoot.value?.querySelectorAll<HTMLElement>('[data-feed-id]') || [])].find((item) => item.dataset.feedId === anchor.id)
  if (row && anchor) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset
  else root.scrollTop = feed.value?.scroll || 0
}
const revealPublished = () => {
  const entry = feed.value, root = scrollRoot.value
  if (!entry?.revealPostId || !root) return false
  const row = [...(feedRoot.value?.querySelectorAll<HTMLElement>('[data-feed-id]') || [])].find((item) => item.dataset.feedId === entry.revealPostId)
  if (!row) return false
  const toolbar = feedRoot.value?.querySelector('.community-feed-sticky')?.getBoundingClientRect().height || 0
  root.scrollTo({ top: Math.max(0, root.scrollTop + row.getBoundingClientRect().top - root.getBoundingClientRect().top - toolbar - 12), behavior: 'smooth' })
  entry.revealPostId = undefined
  return true
}
const pending = new Set<string>()
const load = async (reset = false) => {
  const requestKey = key.value
  if (pending.has(requestKey) || !alive) return
  const anchor = reset ? undefined : feed.value?.evicted ? feed.value.anchor : visibleAnchor()
  const newest = store.publishedPosts[0]
  pending.add(requestKey); loading.value = true; error.value = ''
  try {
    await store.loadFeed(mode.value, type.value, reset)
    if (!alive || key.value !== requestKey) return
    if (reset) { newCount.value = 0; since.value = new Date().toISOString() }
    await nextTick()
    if (!revealPublished() && (newest === store.publishedPosts[0] || reset && !store.publishedPosts.length)) {
      if (reset) scrollRoot.value?.scrollTo({ top: 0, behavior: 'smooth' })
      else if (anchor) restore(anchor)
    }
  } catch (cause) { if (alive && key.value === requestKey) error.value = cause instanceof Error ? cause.message : '信息流加载失败' }
  finally { pending.delete(requestKey); loading.value = pending.has(key.value) }
}
const change = async (nextMode: CommunityFeedMode, nextType: CommunityPostType | 'all') => {
  store.lastFeedLocation = `/community?${new URLSearchParams({ mode: nextMode, type: nextType })}`
  await router.replace({ query: { mode: nextMode, type: nextType } })
}
watch(key, async (_next, previous) => {
  remember(previous); newCount.value = 0
  store.touchFeed(key.value)
  if (!feed.value?.loaded) await load()
  else { await nextTick(); if (alive && !revealPublished()) restore(feed.value?.anchor) }
})
watch(() => store.publishNotice, async (notice) => {
  if (!notice) return
  if (mode.value !== 'for_you' && feed.value && !feed.value.loaded) await load(true)
  await nextTick()
  if (alive) revealPublished()
}, { flush: 'post' })
watch(() => store.context?.needsInterests, async (needs) => { if (needs && canEditProfile.value) { try { await themes.load(); interestsOpen.value = true } catch (cause) { error.value = cause instanceof Error ? cause.message : '学习方向读取失败' } } }, { immediate: true })
watch(canEditProfile, (allowed) => { if (!allowed) interestsOpen.value = false })
const saveInterests = async () => { if (!requireWrite('profile')) return; const epoch = store.epoch; try { const context = await communityApi.interests(interests.value); if (epoch !== store.epoch) return; store.context = context; store.invalidateFollowing(); interestsOpen.value = false; await load(true) } catch (cause) { error.value = cause instanceof Error ? cause.message : '兴趣保存失败' } }
const askQuestion = () => store.openComposer({ type: 'question' })
const checkUpdates = async () => {
  const requestKey = key.value, epoch = store.epoch
  try {
    const result = await communityApi.updates(since.value, mode.value, type.value, store.publishedPosts.map((item) => item.post.id))
    if (alive && requestKey === key.value && epoch === store.epoch) { newCount.value = result.count; store.prunePublished(result.invalidPriorityIds) }
  } catch { /* 保留当前列表，手动刷新仍可重试。 */ }
}
onMounted(async () => {
  store.touchFeed(key.value)
  if (!feed.value?.loaded) await load()
  else { if (store.publishedPosts.length) await checkUpdates(); await nextTick(); if (alive && !revealPublished()) restore(feed.value?.anchor) }
  if (!alive) return
  await nextTick()
  observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting && feed.value?.cursor && !loading.value && !error.value) void load() }, { rootMargin: '250px', root: scrollRoot.value })
  if (sentinel.value) observer.observe(sentinel.value)
  polling = window.setInterval(() => { if (document.visibilityState === 'visible') void checkUpdates() }, 60000)
})
onBeforeUnmount(() => { alive = false; remember(); observer?.disconnect(); window.clearInterval(polling) })
</script>
<template><section ref="feedRoot" class="community-feed">
  <CommunityFeedToolbar :mode="mode" :type="type" :new-count="newCount" :loading="loading" @change="change" @refresh="load(true)" />
  <CommunityQuickComposer />
  <CommunitySkeleton v-if="loading && !feed?.items.length" />
  <p v-if="store.error" class="community-notice">{{ store.error }}</p>
  <p v-if="error" class="community-error" role="alert">{{ error }} <button class="text-link" @click="load(true)">重试</button></p>
  <div v-for="item in feed?.items || []" :key="item.id" :data-feed-id="item.id"><CommunityPostCard v-if="item.type === 'post'" :post="item.post" :request-id="feed?.requestId" @changed="store.refreshPost(item.id)" /><section v-else-if="item.type === 'topic_suggestion'" class="community-learning-unit"><span class="eyebrow">发现新方向</span><h2>让兴趣多走一步</h2><div class="community-topic-list"><RouterLink v-for="topic in item.topics" :key="topic.id" :to="`/community/topic/${topic.slug}`"># {{ topic.name }}</RouterLink></div></section><section v-else class="community-learning-unit"><span class="eyebrow">{{ item.type === 'challenge' ? '用实践验证理解' : '回到你的学习节奏' }}</span><h2>{{ item.content.title }}</h2><p>{{ item.content.summary }}</p><RouterLink class="button primary small" :to="item.content.route">{{ item.type === 'challenge' ? '参加挑战' : '继续学习' }} <AppIcon name="arrow-up-right" :size="14" /></RouterLink></section></div>
  <CommunityEmptyState v-if="feed?.loaded && !feed.items.length && !loading" :title="mode === 'following' ? '关注老师、同学或学习话题' : '还没有可见的内容'" description="从一个问题开始，把学习过程分享给同伴。"><button class="button primary" @click="askQuestion">提出问题</button></CommunityEmptyState>
  <div ref="sentinel" class="community-load-more"><span v-if="loading" role="status">正在加载学习内容…</span><button v-else-if="feed?.cursor" class="button secondary" @click="load()">加载更多</button><small v-else-if="feed?.items.length">已读完这一组内容，随时手动刷新。</small></div>
  <AppDialog v-model="interestsOpen" title="选择 3 个感兴趣的学习方向"><p>用于关注相关话题；你随时可以调整。</p><div class="community-interest-options"><label v-for="theme in demoThemes" :key="theme.slug"><input v-model="interests" type="checkbox" :value="theme.slug" :disabled="interests.length >= 3 && !interests.includes(theme.slug)" /><strong>{{ theme.title }}</strong></label></div><button class="button primary" :disabled="interests.length !== 3" @click="saveInterests">开始发现学习内容</button></AppDialog>
</section></template>
