<script setup lang="ts">
import type { ResourceContributionKind, ResourceHubHomeDto, ResourceHubItemDto } from '@ai-learning-hub/contracts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/base/AppIcon.vue'
import ResourceHubCard from '../components/ResourceHubCard.vue'
import ResourcePreviewDialog from '../components/ResourcePreviewDialog.vue'
import { behaviorApi } from '../services/api/behavior'
import { dataMode } from '../services/api/client'
import { useCommunityStore } from '../stores/community'
import { useAuthStore } from '../stores/auth'
import { mapSelectedResource, useResourcesStore } from '../stores/content/resources'
import { resourceHubApi } from '../services/api/resourceHub'
import { ensureAuth } from '../composables/useRequireAuth'

const route = useRoute()
const router = useRouter()
const community = useCommunityStore()
const auth = useAuthStore()
const legacyResources = useResourcesStore()
const home = ref<ResourceHubHomeDto | null>(null)
const results = ref<ResourceHubItemDto[]>([])
const queryKind = ['video', 'article', 'document'].includes(String(route.query.kind)) ? String(route.query.kind) as ResourceContributionKind : 'all'
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '')
const category = ref(typeof route.query.category === 'string' ? route.query.category : '')
const kind = ref<'all' | ResourceContributionKind>(queryKind)
const rankingPeriod = ref<'week' | 'month' | 'all'>('week')
const bannerIndex = ref(0)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const nextCursor = ref<string | null>(null)
let requestVersion = 0
const isFiltering = computed(() => !!(keyword.value.trim() || category.value || kind.value !== 'all'))
const ranking = computed(() => home.value?.rankings[rankingPeriod.value] || [])
const activeBanner = computed(() => home.value?.banners[bannerIndex.value])
const legacySlug = computed(() => typeof route.query.preview === 'string' ? route.query.preview : typeof route.query.resource === 'string' ? route.query.resource : '')
const legacyPreview = computed(() => legacyResources.items.find((item) => item.id === legacySlug.value) || mapSelectedResource(legacyResources.selected, legacySlug.value))
const legacyPreviewOpen = computed({
  get: () => !!legacySlug.value,
  set: (open) => {
    if (open) return
    const query = { ...route.query }
    delete query.preview
    delete query.resource
    void router.replace({ query })
  },
})
const publish = (value: ResourceContributionKind) => {
  if (!ensureAuth('登录后可发布共创内容', () => publish(value))) return
  if (value === 'article') {
    community.openComposer({
      type: 'frontier_discussion',
      title: '',
      contentBlocks: [],
      bindings: [],
      topicIds: [],
      visibility: 'public',
      status: 'published',
    })
    community.composerInline = false
    return
  }
  community.openComposer({
    type: value === 'video' ? 'lab_result' : 'note',
    title: '',
    contentBlocks: [],
    bindings: [],
    topicIds: [],
    visibility: 'public',
    status: 'published',
    contribution: { kind: value, tags: [], teachingReuseConsent: false },
  })
  community.composerMode = 'advanced'
  community.composerInline = false
}
const load = async () => {
  loading.value = true; error.value = ''
  try { home.value = await resourceHubApi.home() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '资源中心读取失败' }
  finally { loading.value = false }
}
const syncFilters = async () => {
  const query = {
    ...route.query,
    q: keyword.value.trim() || undefined,
    category: category.value || undefined,
    kind: kind.value === 'all' ? undefined : kind.value,
  }
  await router.replace({ query })
}
const search = async (syncUrl = true, append = false) => {
  const version = ++requestVersion
  loading.value = true; error.value = ''
  try {
    if (syncUrl) await syncFilters()
    const response = await resourceHubApi.list({ keyword: keyword.value.trim(), category: category.value, kind: kind.value, cursor: append ? nextCursor.value || undefined : undefined, limit: 18 })
    if (version !== requestVersion) return
    results.value = append ? [...results.value, ...response.items] : response.items
    nextCursor.value = response.nextCursor
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '资源搜索失败' }
  finally { if (version === requestVersion) loading.value = false }
}
const selectCategory = async (code: string) => { category.value = code; await search() }
const selectKind = async (value: typeof kind.value) => { kind.value = value; await search() }
const watchLater = async (postId: string) => {
  try { await resourceHubApi.addToCollection('watch-later', postId); notice.value = '已加入稍后再看' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '加入稍后再看失败' }
}
const banner = (step: number) => {
  const count = home.value?.banners.length || 0
  if (count > 1) bannerIndex.value = (bannerIndex.value + step + count) % count
}
onMounted(async () => {
  void load()
  void legacyResources.load().catch((cause) => { error.value = cause instanceof Error ? cause.message : '旧资源读取失败' })
  if (isFiltering.value) void search(false)
  await nextTick()
  const saved = Number(sessionStorage.getItem(`resource-hub-scroll:${route.fullPath}`) || 0)
  if (saved > 0) window.scrollTo({ top: saved })
})
onBeforeUnmount(() => sessionStorage.setItem(`resource-hub-scroll:${route.fullPath}`, String(window.scrollY)))
watch(() => [route.query.q, route.query.category, route.query.kind], ([q, nextCategory, nextKind]) => {
  const normalizedKind = ['video', 'article', 'document'].includes(String(nextKind)) ? nextKind as ResourceContributionKind : 'all'
  const normalizedQ = typeof q === 'string' ? q : ''
  const normalizedCategory = typeof nextCategory === 'string' ? nextCategory : ''
  if (normalizedQ === keyword.value && normalizedCategory === category.value && normalizedKind === kind.value) return
  keyword.value = normalizedQ; category.value = normalizedCategory; kind.value = normalizedKind
  void search(false)
})
watch(legacySlug, async (slug) => {
  if (!slug || dataMode !== 'api') return
  try {
    await legacyResources.detail(slug)
    if (auth.user) await behaviorApi.recordView('resource', slug)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '旧资源读取失败' }
}, { immediate: true })
</script>

<template>
  <div class="page-container resource-hub-page">
    <header class="resource-hub-heading">
      <div><h1>资源中心</h1><p>分享实践过程，沉淀可复用的高校 AI 学习资源</p></div>
      <form class="resource-hub-search" role="search" @submit.prevent="search()">
        <AppIcon name="search" :size="17" />
        <input v-model="keyword" aria-label="搜索资源" placeholder="搜索视频、图文或资料…" />
        <button type="submit" aria-label="搜索"><AppIcon name="search" :size="19" /></button>
      </form>
    </header>

    <p v-if="error" class="community-error" role="alert">{{ error }} <button class="text-link" @click="load">重试</button></p>
    <p v-if="notice" class="community-notice" role="status">{{ notice }}</p>
    <div v-if="loading && !home" class="resource-hub-loading">正在读取共创资源…</div>
    <template v-else-if="home">
      <section v-if="activeBanner" class="resource-hub-banner">
        <img v-if="activeBanner.coverUrl" :src="activeBanner.coverUrl" :alt="`${activeBanner.title}推荐图`" />
        <div class="resource-hub-banner-mask" />
        <div class="resource-hub-banner-copy"><span>本周共创推荐</span><h2>{{ activeBanner.title }}</h2><p>{{ activeBanner.summary }}</p><RouterLink class="button primary" :to="activeBanner.route">{{ activeBanner.kind === 'video' ? '观看演示' : '阅读作品' }}<i class="resource-direction-arrow" aria-hidden="true" /></RouterLink></div>
        <template v-if="home.banners.length > 1">
          <button class="resource-banner-arrow prev" aria-label="上一条推荐" @click="banner(-1)"><i class="resource-direction-arrow" aria-hidden="true" /></button>
          <button class="resource-banner-arrow next" aria-label="下一条推荐" @click="banner(1)"><i class="resource-direction-arrow" aria-hidden="true" /></button>
          <div class="resource-banner-dots"><button v-for="(_, index) in home.banners" :key="index" :class="{ active: index === bannerIndex }" :aria-label="`切换到第 ${index + 1} 条推荐`" @click="bannerIndex = index" /></div>
        </template>
      </section>
      <section v-else class="resource-hub-banner resource-hub-banner-empty">
        <div class="resource-hub-banner-copy"><span>资源共创</span><h2>还没有可推荐的公开作品</h2><p>从一次实训、一个教程或一份学习资料开始，把过程沉淀给更多同学。</p><button class="button primary" @click="publish('article')">发布第一份作品<i class="resource-direction-arrow" aria-hidden="true" /></button></div>
      </section>

      <nav class="resource-category-nav" aria-label="资源分类">
        <button :class="{ active: !category }" @click="selectCategory('')"><AppIcon name="resource" :size="25" /><span>全部资源</span></button>
        <button v-for="entry in home.categories.filter((value) => value.code !== 'uncategorized')" :key="entry.id" :class="{ active: category === entry.code }" @click="selectCategory(entry.code)"><AppIcon :name="entry.icon" :size="25" /><span>{{ entry.name }}</span></button>
      </nav>
      <div class="resource-hub-toolbar">
        <div class="resource-kind-tabs" role="tablist" aria-label="内容形态">
          <button v-for="entry in [{ key: 'all', label: '全部' }, { key: 'video', label: '视频' }, { key: 'article', label: '图文' }, { key: 'document', label: '资料' }]" :key="entry.key" :class="{ active: kind === entry.key }" @click="selectKind(entry.key as typeof kind)">{{ entry.label }}</button>
        </div>
        <div class="resource-hub-contribute-actions" aria-label="资源投稿">
          <button class="button primary" @click="publish('video')"><AppIcon name="upload" :size="16" />上传视频</button>
          <button class="button secondary" @click="publish('article')"><AppIcon name="edit" :size="16" />写图文</button>
          <button class="button secondary" @click="publish('document')"><AppIcon name="file" :size="16" />分享资料</button>
        </div>
      </div>

      <section v-if="isFiltering" class="resource-results">
        <div class="resource-section-heading"><div><span>搜索与筛选</span><h2>{{ category ? home.categories.find((entry) => entry.code === category)?.name : '全部资源' }}</h2></div><strong>{{ results.length }} 项</strong></div>
        <div v-if="results.length" class="resource-hub-grid three"><ResourceHubCard v-for="entry in results" :key="entry.id" :item="entry" show-watch-later @watch-later="watchLater" /></div>
        <div v-else class="inline-empty"><h3>没有匹配的共创资源</h3><p>调整搜索词或内容形态后再试。</p></div>
        <button v-if="nextCursor" class="button secondary resource-load-more" :disabled="loading" @click="search(false, true)">{{ loading ? '读取中…' : '加载更多' }}</button>
      </section>

      <template v-else>
        <div class="resource-hub-main-layout">
          <main>
            <section>
              <div class="resource-section-heading"><div><span>值得先看</span><h2>本周精选</h2></div><button class="text-link" @click="selectKind('video')">查看全部<i class="resource-direction-arrow" aria-hidden="true" /></button></div>
              <div class="resource-hub-grid featured"><ResourceHubCard v-for="entry in home.featured" :key="entry.id" :item="entry" variant="featured" show-watch-later @watch-later="watchLater" /></div>
            </section>
            <section v-for="section in home.sections" :key="section.key">
              <div class="resource-section-heading"><div><span>师生共创</span><h2>{{ section.title }}</h2></div><button class="text-link" @click="selectCategory(section.categoryCode || '')">更多内容<i class="resource-direction-arrow" aria-hidden="true" /></button></div>
              <div class="resource-hub-grid three"><ResourceHubCard v-for="entry in section.items.slice(0, 3)" :key="entry.id" :item="entry" show-watch-later @watch-later="watchLater" /></div>
            </section>
          </main>
          <aside class="resource-hub-rail">
            <section><h2>热门榜单</h2><div class="resource-ranking-tabs"><button v-for="entry in [{ key: 'week', label: '本周' }, { key: 'month', label: '本月' }, { key: 'all', label: '总榜' }]" :key="entry.key" :class="{ active: rankingPeriod === entry.key }" @click="rankingPeriod = entry.key as typeof rankingPeriod">{{ entry.label }}</button></div><ol><li v-for="(entry, index) in ranking" :key="entry.id"><b>{{ index + 1 }}</b><RouterLink :to="entry.route"><img v-if="entry.coverUrl" :src="entry.coverUrl" alt="" loading="lazy" /><span><strong>{{ entry.title }}</strong><small><AppIcon name="play" :size="12" />{{ entry.stats.views.toLocaleString() }}</small></span></RouterLink></li></ol></section>
            <section><div class="resource-rail-title"><h2>我的播放列表</h2><RouterLink to="/resources/studio">查看全部</RouterLink></div><RouterLink class="resource-playlist-row" to="/resources/collections/watch-later"><AppIcon name="bookmark" /><span><strong>稍后再看</strong><small>仅自己可见</small></span></RouterLink><RouterLink v-for="entry in home.collections.slice(0, 3)" :key="entry.id" class="resource-playlist-row" :to="`/resources/collections/${entry.id}`"><AppIcon name="folder" /><span><strong>{{ entry.name }}</strong><small>{{ entry.itemCount }} 项 · {{ entry.visibility === 'private' ? '私有' : '社区可见' }}</small></span></RouterLink><RouterLink class="resource-playlist-row" :to="`/community/user/${auth.user?.username || 'student'}?tab=liked`"><AppIcon name="heart" /><span><strong>喜欢的视频</strong><small>{{ home.likedVideos.length }} 项</small></span></RouterLink><button class="button primary full-width" @click="publish('video')"><AppIcon name="upload" :size="16" />上传视频</button></section>
          </aside>
        </div>

        <section v-if="home.liveReplay.length" class="resource-live-replay">
          <div class="resource-section-heading"><div><span>课堂与活动</span><h2>直播回放</h2></div></div>
          <div class="resource-hub-grid replay"><ResourceHubCard v-for="entry in home.liveReplay" :key="entry.id" :item="entry" variant="compact" show-watch-later @watch-later="watchLater" /></div>
        </section>
      </template>
    </template>
  </div>
  <ResourcePreviewDialog v-model="legacyPreviewOpen" :resource="legacyPreview" :detail="legacyResources.selected?.slug === legacyPreview?.id ? legacyResources.selected : null" />
</template>
