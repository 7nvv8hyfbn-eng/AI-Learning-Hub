<script setup lang="ts">
import type { LearningCollectionDto } from '@ai-learning-hub/contracts'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/base/AppIcon.vue'
import ResourceHubCard from '../components/ResourceHubCard.vue'
import CommunityReportDialog from '../community/CommunityReportDialog.vue'
import { resourceHubApi } from '../services/api/resourceHub'
import { useCommunityAccess } from '../community/composables/useCommunityAccess'
import { contentDetectionNotice } from '../community/labels'

const route = useRoute()
const collection = ref<LearningCollectionDto | null>(null)
const error = ref('')
const notice = ref(''), reportOpen = ref(false)
const loading = ref(false)
let loadEpoch = 0
onBeforeUnmount(() => { loadEpoch++ })
const { requireWrite } = useCommunityAccess()
const load = async (append = false) => {
  if (append && (loading.value || !collection.value?.nextCursor)) return
  const epoch = append ? loadEpoch : ++loadEpoch
  loading.value = true
  try {
    const page = await resourceHubApi.collection(String(route.params.collectionId), append ? { cursor: collection.value!.nextCursor! } : {})
    if (epoch !== loadEpoch) return
    if (append && collection.value && page.revision !== collection.value.revision) { await load(); return }
    collection.value = append && collection.value ? { ...page, items: [...new Map([...collection.value.items, ...page.items].map((item) => [item.id, item])).values()], previousCursor: collection.value.previousCursor } : page
    error.value = ''
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '合集读取失败' }
  finally { if (epoch === loadEpoch) loading.value = false }
}
const move = async (index: number, step: number) => {
  if (!collection.value || loading.value) return
  if (collection.value.visibility === 'community' && !requireWrite('collection')) return
  const current = collection.value, next = [...current.items], target = index + step, epoch = loadEpoch
  if (target < 0 || target >= next.length) return
  const first = Math.min(index, target), last = Math.max(index, target)
  ;[next[first], next[last]] = [{ ...next[last], sortOrder: next[first].sortOrder }, { ...next[first], sortOrder: next[last].sortOrder }]
  loading.value = true
  try {
    const saved = await resourceHubApi.reorderCollection(current.id, current.revision, [next[first].id, next[last].id])
    if (epoch !== loadEpoch) return
    collection.value = { ...saved, items: next, nextCursor: current.nextCursor ? next.at(-1)!.id : null, previousCursor: current.previousCursor }; error.value = ''
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '排序失败' }
  finally { if (epoch === loadEpoch) loading.value = false }
}
const remove = async (itemId: string) => {
  if (!collection.value || loading.value) return
  if (collection.value.visibility === 'community' && !requireWrite('collection')) return
  const current = collection.value, epoch = loadEpoch
  loading.value = true
  try {
    const saved = await resourceHubApi.removeFromCollection(current.id, itemId)
    if (epoch !== loadEpoch) return
    const remaining = current.items.filter((item) => item.id !== itemId)
    collection.value = remaining.length ? { ...saved, items: remaining, nextCursor: current.nextCursor ? remaining.at(-1)!.id : null, previousCursor: current.previousCursor } : saved
    notice.value = '已移出合集'; error.value = ''
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '移出合集失败' }
  finally { if (epoch === loadEpoch) loading.value = false }
}
const share = async () => {
  if (!collection.value || collection.value.visibility !== 'community' || collection.value.contentStatus === 'pending_review') return
  try {
    if (navigator.share) await navigator.share({ title: collection.value?.name || '学习合集', url: location.href })
    else { await navigator.clipboard.writeText(location.href); notice.value = '合集链接已复制' }
  } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) error.value = '分享失败' }
}
watch(() => route.params.collectionId, () => load(), { immediate: true })
</script>

<template><section class="page-container resource-collection-page"><div class="resource-collection-toolbar"><button v-if="collection?.visibility === 'community' && !collection.isOwner" class="button secondary small" @click="requireWrite('report') && (reportOpen = true)">举报合集</button><RouterLink class="resource-detail-back back-button" to="/resources" aria-label="返回教程中心" title="返回教程中心"><AppIcon name="back" /></RouterLink><button v-if="collection?.visibility === 'community' && collection.contentStatus !== 'pending_review'" class="button secondary small" @click="share"><AppIcon name="lab-share" :size="15" />分享合集</button></div><p v-if="error" class="community-error">{{ error }}</p><p v-if="notice" class="community-notice">{{ notice }}</p><template v-if="collection"><p v-if="contentDetectionNotice(collection.detection) || collection.contentStatus === 'pending_review'" class="community-notice" role="status">{{ contentDetectionNotice(collection.detection) || '合集已保存，等待人工复核，尚未公开。' }}</p><header><span>{{ collection.visibility === 'private' ? '私有合集' : '社区学习合集' }}</span><h1>{{ collection.name }}</h1><p>{{ collection.description || collection.learningGoal || '按自己的顺序整理可复用的学习内容。' }}</p><small>{{ collection.itemCount }} 项<span v-if="collection.videoCount"> · {{ collection.videoCount }} 个视频 · {{ Math.ceil(collection.durationSeconds / 60) }} 分钟</span></small></header><div v-if="collection.items.length" class="resource-collection-list"><article v-for="(entry, index) in collection.items" :key="entry.id"><b>{{ index + 1 }}</b><ResourceHubCard :item="entry.contribution" variant="compact" @changed="load()" /><div v-if="collection.isOwner" class="resource-collection-order"><button aria-label="上移" :disabled="loading || index === 0" @click="move(index, -1)"><i class="resource-direction-arrow up" aria-hidden="true" /></button><button aria-label="下移" :disabled="loading || index === collection.items.length - 1" @click="move(index, 1)"><i class="resource-direction-arrow down" aria-hidden="true" /></button><button aria-label="移出合集" @click="remove(entry.id)"><AppIcon name="close" /></button></div></article></div><div v-else class="inline-empty"><h2>这个合集还没有内容</h2><RouterLink class="button primary" to="/resources">去发现资源</RouterLink></div><button v-if="collection.nextCursor" class="button secondary small" :disabled="loading" @click="load(true)">加载更多内容</button></template><CommunityReportDialog v-if="collection" v-model="reportOpen" target-type="collection" :target-id="collection.id" @submitted="notice = '举报已提交。'" /></section></template>
