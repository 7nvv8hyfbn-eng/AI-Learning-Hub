<script setup lang="ts">
import type { LearningCollectionSummaryDto, ResourceContributionDetailDto, VideoPlaybackDto } from '@ai-learning-hub/contracts'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import ResourceHubCard from '../components/ResourceHubCard.vue'
import CommunityPostCard from '../community/CommunityPostCard.vue'
import CommunityPostView from '../community/CommunityPostView.vue'
import { resourceHubApi } from '../services/api/resourceHub'
import { communityApi } from '../services/api/community'
import { useCommunityAccess } from '../community/composables/useCommunityAccess'

const route = useRoute(), router = useRouter()
const { requireWrite } = useCommunityAccess()
const detail = ref<ResourceContributionDetailDto | null>(null)
const playback = ref<VideoPlaybackDto | null>(null)
const player = ref<HTMLVideoElement>()
const collections = ref<LearningCollectionSummaryDto[]>([])
const collectionsCursor = ref<string | null>(null), collectionsLoading = ref(false), seriesLoading = ref(false)
const collectionOpen = ref(false)
const error = ref('')
const notice = ref('')
let lastSavedAt = 0
let watchedSeconds = 0
let lastPosition: number | null = null
let loadEpoch = 0
let displayedPostId = ''
const nextItem = computed(() => {
  const items = detail.value?.collection?.items || []
  const index = items.findIndex((item) => item.contribution.postId === detail.value?.post.id)
  return index >= 0 ? items[index + 1]?.contribution || null : null
})
const load = async () => {
  const epoch = ++loadEpoch, postId = String(route.params.postId)
  error.value = ''; detail.value = null; playback.value = null
  collectionsCursor.value = null; collectionsLoading.value = false; seriesLoading.value = false
  try {
    const resource = await resourceHubApi.detail(postId)
    if (epoch !== loadEpoch) return
    detail.value = resource
    if (displayedPostId !== postId && resource.contribution.kind !== 'video') void communityApi.signals({ eventType: 'community_post_click', targetType: 'post', targetId: postId }).catch(() => undefined)
    displayedPostId = postId
    const choices = await resourceHubApi.collections()
    if (epoch !== loadEpoch) return
    collections.value = choices.items; collectionsCursor.value = choices.nextCursor
    if (resource.contribution.video) {
      const currentPlayback = await resourceHubApi.playback(resource.contribution.video.id)
      if (epoch !== loadEpoch) return
      playback.value = currentPlayback
      watchedSeconds = playback.value.progress?.watchedSeconds || 0
      await nextTick()
      if (epoch === loadEpoch && player.value && currentPlayback.progress?.positionSeconds) player.value.currentTime = currentPlayback.progress.positionSeconds
    }
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '资源读取失败' }
}
const moreCollections = async () => {
  if (!collectionsCursor.value || collectionsLoading.value) return
  const epoch = loadEpoch
  collectionsLoading.value = true
  try {
    const page = await resourceHubApi.collections(collectionsCursor.value)
    if (epoch !== loadEpoch) return
    collections.value = [...new Map([...collections.value, ...page.items].map((item) => [item.id, item])).values()]; collectionsCursor.value = page.nextCursor
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '合集读取失败' }
  finally { if (epoch === loadEpoch) collectionsLoading.value = false }
}
const moreSeries = async (direction: 'before' | 'after') => {
  const current = detail.value?.collection, cursor = direction === 'before' ? current?.previousCursor : current?.nextCursor
  if (!current || !cursor || seriesLoading.value) return
  const epoch = loadEpoch
  seriesLoading.value = true
  try {
    const page = await resourceHubApi.collection(current.id, { cursor, direction })
    if (epoch !== loadEpoch || !detail.value) return
    if (page.revision !== current.revision) { await load(); return }
    const merged = direction === 'before' ? [...page.items, ...current.items] : [...current.items, ...page.items]
    detail.value.collection = { ...page, items: [...new Map(merged.map((item) => [item.id, item])).values()], previousCursor: direction === 'before' ? page.previousCursor : current.previousCursor, nextCursor: direction === 'after' ? page.nextCursor : current.nextCursor }
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '播放列表读取失败' }
  finally { if (epoch === loadEpoch) seriesLoading.value = false }
}
const saveProgress = async (completed = false) => {
  if (!player.value || !playback.value || !Number.isFinite(player.value.currentTime)) return
  const now = Date.now()
  if (!completed && now - lastSavedAt < 15000) return
  lastSavedAt = now
  await resourceHubApi.progress(playback.value.assetId, {
    positionSeconds: Math.round(player.value.currentTime),
    watchedSeconds: Math.floor(watchedSeconds),
    completed,
    eventKey: `watch-${playback.value.assetId}-${Math.floor(now / 15000)}`,
  }).catch(() => undefined)
}
const countPlayback = () => {
  if (!player.value || player.value.paused || lastPosition === null) return
  const delta = player.value.currentTime - lastPosition
  if (delta > 0 && delta <= 2.5) watchedSeconds += delta
  lastPosition = player.value.currentTime
}
const playing = () => { if (player.value) lastPosition = player.value.currentTime }
const seeking = () => { lastPosition = null }
const seeked = () => { if (player.value) lastPosition = player.value.currentTime }
const pause = () => { countPlayback(); void saveProgress(); lastPosition = null }
const ended = () => {
  countPlayback()
  void saveProgress(true)
  lastPosition = null
  notice.value = nextItem.value ? `本节已完成，可继续学习“${nextItem.value.title}”` : '本节已完成'
}
const add = async (id: string) => {
  if (collections.value.find((item) => item.id === id)?.visibility === 'community' && !requireWrite('collection')) return
  try { await resourceHubApi.addToCollection(id, String(route.params.postId)); collectionOpen.value = false; notice.value = '已加入学习合集' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '加入合集失败' }
}
const addToWatchLater = async () => {
  try { await resourceHubApi.addToCollection('watch-later', String(route.params.postId)); notice.value = '已加入稍后再看' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '加入稍后再看失败' }
}
const download = async () => {
  const attachment = detail.value?.contribution.attachment
  if (!attachment) return
  if (!attachment.downloadUrl) { error.value = '资料下载地址不可用'; return }
  const link = document.createElement('a')
  link.href = attachment.downloadUrl
  link.download = attachment.name
  link.click()
}
const share = async () => {
  try {
    if (navigator.share) await navigator.share({ title: detail.value?.post.title || '学习资源', url: location.href })
    else { await navigator.clipboard.writeText(location.href); notice.value = '链接已复制' }
  } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) error.value = '分享失败' }
}
watch(() => route.params.postId, load, { immediate: true })
onBeforeUnmount(() => { loadEpoch++; void saveProgress() })
</script>

<template>
  <section class="page-container resource-detail-page">
    <header class="resource-detail-breadcrumb"><RouterLink to="/resources" class="back-button" aria-label="返回教程中心" title="返回教程中心"><AppIcon name="back" /></RouterLink><button class="button secondary small" @click="share">分享</button></header>
    <p v-if="error" class="community-error" role="alert">{{ error }} <button class="text-link" @click="load">重试</button></p>
    <p v-if="notice" class="community-notice" role="status">{{ notice }}</p>
    <template v-if="detail">
      <div v-if="playback" class="resource-player-layout" :class="{ single: !detail.collection }">
        <section class="resource-player-shell">
          <video ref="player" controls playsinline preload="metadata" :poster="playback.poster || undefined" @playing="playing" @timeupdate="countPlayback(); saveProgress()" @seeking="seeking" @seeked="seeked" @pause="pause" @ended="ended">
            <source v-for="source in playback.sources" :key="source.src" :src="source.src" :type="source.type" />
            <track v-for="caption in playback.captions" :key="caption.src" kind="subtitles" v-bind="caption" />
          </video>
        </section>
        <aside v-if="detail.collection" class="resource-detail-series">
          <span>所在合集</span><h2>{{ detail.collection.name }}</h2>
          <button v-if="detail.collection.previousCursor" class="text-link" :disabled="seriesLoading" @click="moreSeries('before')">加载前面的内容</button>
          <RouterLink v-for="entry in detail.collection.items" :key="entry.id" :to="entry.contribution.route" :class="{ active: entry.contribution.postId === detail.post.id }"><b>{{ entry.sortOrder + 1 }}</b><span>{{ entry.contribution.title }}</span></RouterLink>
          <button v-if="detail.collection.nextCursor" class="text-link" :disabled="seriesLoading" @click="moreSeries('after')">加载后面的内容</button>
        </aside>
      </div>
      <CommunityPostCard :post="detail.post" detail @changed="load" @hidden="router.push('/resources')" />
      <p class="resource-detail-observation">{{ detail.contribution.kind === 'video' ? '有效播放' : '浏览' }} {{ detail.stats.views.toLocaleString('zh-CN') }} 次 · 发布于 {{ new Date(detail.post.publishedAt).toLocaleDateString('zh-CN') }}</p>
      <div class="resource-detail-actions">
        <button v-if="detail.contribution.attachment" class="button primary" @click="download"><AppIcon name="download" />下载 {{ detail.contribution.attachment.name }}</button>
        <button class="button secondary" @click="addToWatchLater"><AppIcon name="bookmark" />稍后再看</button>
        <button class="button secondary" @click="collectionOpen = true"><AppIcon name="folder" />加入合集</button>
      </div>
      <RouterLink v-if="nextItem" class="resource-detail-next" :to="nextItem.route"><span>下一项</span><strong>{{ nextItem.title }}</strong><i class="resource-direction-arrow" aria-hidden="true" /></RouterLink>
      <CommunityPostView :post-id="detail.post.id" discussion-only />
      <section v-if="detail.related.length" class="resource-detail-related"><div class="resource-section-heading"><div><span>继续探索</span><h2>相关推荐</h2></div></div><div class="resource-hub-grid three"><ResourceHubCard v-for="item in detail.related" :key="item.id" :item="item" @changed="load()" /></div></section>
    </template>
  </section>
  <AppDialog v-model="collectionOpen" title="加入学习合集"><div class="resource-collection-picker"><button v-for="item in collections" :key="item.id" @click="add(item.id)"><strong>{{ item.name }}</strong><small>{{ item.itemCount }} 项 · {{ item.visibility === 'private' ? '私有' : '社区可见' }}</small></button><button v-if="collectionsCursor" :disabled="collectionsLoading" @click="moreCollections">加载更多合集</button><button @click="add('watch-later')"><strong>稍后再看</strong><small>仅自己可见</small></button></div></AppDialog>
</template>
