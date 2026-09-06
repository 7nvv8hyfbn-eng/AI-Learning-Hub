<script setup lang="ts">
import type { LearningCollectionDto } from '@ai-learning-hub/contracts'
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/base/AppIcon.vue'
import ResourceHubCard from '../components/ResourceHubCard.vue'
import { resourceHubApi } from '../services/api/resourceHub'

const route = useRoute()
const collection = ref<LearningCollectionDto | null>(null)
const error = ref('')
const notice = ref('')
const load = async () => { try { collection.value = await resourceHubApi.collection(String(route.params.collectionId)); error.value = '' } catch (cause) { error.value = cause instanceof Error ? cause.message : '合集读取失败' } }
const move = async (index: number, step: number) => {
  if (!collection.value) return
  const next = [...collection.value.items], target = index + step
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target], next[index]]
  try { collection.value = await resourceHubApi.reorderCollection(collection.value.id, collection.value.revision, next.map((item) => item.id)) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '排序失败' }
}
const remove = async (itemId: string) => {
  if (!collection.value) return
  try { collection.value = await resourceHubApi.removeFromCollection(collection.value.id, itemId); notice.value = '已移出合集'; error.value = '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '移出合集失败' }
}
const share = async () => {
  try {
    if (navigator.share) await navigator.share({ title: collection.value?.name || '学习合集', url: location.href })
    else { await navigator.clipboard.writeText(location.href); notice.value = '合集链接已复制' }
  } catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) error.value = '分享失败' }
}
onMounted(load)
</script>

<template><section class="page-container resource-collection-page"><div class="resource-collection-toolbar"><RouterLink class="resource-detail-back" to="/resources"><i class="resource-direction-arrow back" aria-hidden="true" />返回资源中心</RouterLink><button class="button secondary small" @click="share"><AppIcon name="lab-share" :size="15" />分享合集</button></div><p v-if="error" class="community-error">{{ error }}</p><p v-if="notice" class="community-notice">{{ notice }}</p><template v-if="collection"><header><span>{{ collection.visibility === 'private' ? '私有合集' : '社区学习合集' }}</span><h1>{{ collection.name }}</h1><p>{{ collection.description || collection.learningGoal || '按自己的顺序整理可复用的学习内容。' }}</p><small>{{ collection.itemCount }} 项<span v-if="collection.videoCount"> · {{ collection.videoCount }} 个视频 · {{ Math.ceil(collection.durationSeconds / 60) }} 分钟</span></small></header><div v-if="collection.items.length" class="resource-collection-list"><article v-for="(entry, index) in collection.items" :key="entry.id"><b>{{ index + 1 }}</b><ResourceHubCard :item="entry.contribution" variant="compact" /><div v-if="collection.isOwner" class="resource-collection-order"><button aria-label="上移" :disabled="index === 0" @click="move(index, -1)"><i class="resource-direction-arrow up" aria-hidden="true" /></button><button aria-label="下移" :disabled="index === collection.items.length - 1" @click="move(index, 1)"><i class="resource-direction-arrow down" aria-hidden="true" /></button><button aria-label="移出合集" @click="remove(entry.id)"><AppIcon name="close" /></button></div></article></div><div v-else class="inline-empty"><h2>这个合集还没有内容</h2><RouterLink class="button primary" to="/resources">去发现资源</RouterLink></div></template></section></template>
