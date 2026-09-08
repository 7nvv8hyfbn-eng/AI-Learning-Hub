<script setup lang="ts">
import type { CreatorContentSummaryDto, LearningCollectionSummaryDto, ResourceContributionKind } from '@ai-learning-hub/contracts'
import { onMounted, reactive, ref } from 'vue'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import ResourceHubCard from '../components/ResourceHubCard.vue'
import { resourceHubApi } from '../services/api/resourceHub'
import { useCommunityStore } from '../stores/community'
import { useCommunityAccess } from '../community/composables/useCommunityAccess'
import { contentDetectionNotice } from '../community/labels'

const community = useCommunityStore()
const { requireWrite } = useCommunityAccess()
const studio = ref<CreatorContentSummaryDto | null>(null)
const collections = ref<LearningCollectionSummaryDto[]>([])
const error = ref('')
const notice = ref('')
const collectionOpen = ref(false)
const collectionForm = reactive({ id: '', name: '', description: '', learningGoal: '', visibility: 'private' as 'private' | 'community', expectedRevision: undefined as number | undefined })

const load = async () => {
  try {
    ;[studio.value, collections.value] = await Promise.all([resourceHubApi.studio(), resourceHubApi.collections()])
    error.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创作中心读取失败' }
}
const publish = (kind: ResourceContributionKind) => {
  community.openComposer({
    type: kind === 'video' ? 'lab_result' : kind === 'article' ? 'frontier_discussion' : 'note',
    title: '',
    contentBlocks: [],
    bindings: [],
    topicIds: [],
    visibility: 'public',
    status: 'published',
    contribution: { kind, tags: [], teachingReuseConsent: false },
  })
  community.composerMode = 'advanced'
  community.composerInline = false
}
const editCollection = (item?: LearningCollectionSummaryDto) => {
  if (item?.visibility === 'community' && !requireWrite('collection')) return
  Object.assign(collectionForm, item
    ? { id: item.id, name: item.name, description: item.description, learningGoal: item.learningGoal, visibility: item.visibility, expectedRevision: item.revision }
    : { id: '', name: '', description: '', learningGoal: '', visibility: 'private', expectedRevision: undefined })
  collectionOpen.value = true
}
const saveCollection = async () => {
  if (collectionForm.visibility === 'community' && !requireWrite('collection')) return
  error.value = ''; notice.value = ''
  try {
    const input = { name: collectionForm.name, description: collectionForm.description, learningGoal: collectionForm.learningGoal, visibility: collectionForm.visibility, expectedRevision: collectionForm.expectedRevision }
    const saved = collectionForm.id ? await resourceHubApi.updateCollection(collectionForm.id, input) : await resourceHubApi.createCollection(input)
    collectionOpen.value = false
    notice.value = contentDetectionNotice(saved.detection) || (saved.contentStatus === 'pending_review' ? '合集已保存，等待人工复核，尚未公开。' : collectionForm.id ? '合集已更新' : '合集已创建')
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '合集保存失败' }
}
const retry = async (assetId: string) => {
  if (!requireWrite('upload')) return
  try { await resourceHubApi.retryVideo(assetId); notice.value = '已重新进入处理队列'; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '视频重试失败' }
}
onMounted(load)
</script>

<template>
  <section class="page-container resource-studio-page">
    <header>
      <div><span>个人工作台</span><h1>我的资源创作</h1><p>管理已发布作品、待复核投稿、草稿、处理中的视频和学习合集。</p></div>
      <div><button class="button primary" @click="publish('video')"><AppIcon name="upload" />上传视频</button><button class="button secondary" @click="publish('article')">写图文</button><button class="button secondary" @click="publish('document')">分享资料</button></div>
    </header>
    <p v-if="error" class="community-error" role="alert">{{ error }} <button class="text-link" @click="load">重试</button></p>
    <p v-if="notice" class="community-notice" role="status">{{ notice }}</p>
    <template v-if="studio">
      <section>
        <div class="resource-section-heading"><div><span>公开作品</span><h2>我的作品</h2></div><strong>{{ studio.items.length }} 项</strong></div>
        <div v-if="studio.items.length" class="resource-hub-grid three"><ResourceHubCard v-for="item in studio.items" :key="item.id" :item="item" /></div>
        <div v-else class="inline-empty"><p>还没有已发布的资源作品。</p></div>
      </section>
      <section>
        <div class="resource-section-heading"><div><span>保存与处理</span><h2>待完成内容</h2></div></div>
        <div class="resource-studio-status"><RouterLink to="/community/drafts"><strong>{{ studio.drafts.length }}</strong><span>资源草稿</span></RouterLink><div><strong>{{ studio.processing.length }}</strong><span>待处理视频</span></div></div>
        <div v-if="studio.pendingReview.length" class="resource-processing-list">
          <h3>待复核投稿（尚未公开）</h3>
          <article v-for="item in studio.pendingReview" :key="item.id">
            <RouterLink :to="`/community/post/${item.id}`"><strong>{{ item.title || item.bodyPreview }}</strong><small>查看复核结果并修改投稿</small></RouterLink>
          </article>
        </div>
        <div v-if="studio.processing.length" class="resource-processing-list">
          <article v-for="item in studio.processing" :key="item.id">
            <RouterLink :to="item.route"><strong>{{ item.title }}</strong><small>{{ item.mediaStatus === 'failed' ? '处理失败' : item.mediaStatus === 'processing' ? '正在处理' : '等待处理' }}</small></RouterLink>
            <button v-if="item.mediaStatus === 'failed' && item.videoAssetId" class="button secondary small" @click="retry(item.videoAssetId)">重新处理</button>
          </article>
        </div>
      </section>
      <section>
        <div class="resource-section-heading"><div><span>内容编排</span><h2>我的学习合集</h2></div><button class="button secondary small" @click="editCollection()"><AppIcon name="plus" :size="14" />新建合集</button></div>
        <div class="resource-studio-collections">
          <article v-for="item in collections" :key="item.id">
            <RouterLink :to="`/resources/collections/${item.systemKind === 'watch_later' ? 'watch-later' : item.id}`"><AppIcon :name="item.systemKind === 'watch_later' ? 'bookmark' : 'folder'" /><span><strong>{{ item.name }}</strong><small>{{ item.itemCount }} 项 · {{ item.visibility === 'private' ? '私有' : item.contentStatus === 'pending_review' ? '待复核，尚未公开' : '社区可见' }}</small></span></RouterLink>
            <button v-if="!item.systemKind" class="text-link" @click="editCollection(item)">编辑</button>
          </article>
        </div>
      </section>
    </template>
  </section>
  <AppDialog v-model="collectionOpen" :title="collectionForm.id ? '编辑学习合集' : '创建学习合集'">
    <form class="dialog-form" @submit.prevent="saveCollection">
      <p v-if="error" class="community-error" role="alert">{{ error }}</p>
      <label>合集名称<input v-model="collectionForm.name" required maxlength="80" /></label>
      <label>简介<textarea v-model="collectionForm.description" rows="3" maxlength="500" /></label>
      <label>学习目标<textarea v-model="collectionForm.learningGoal" rows="3" maxlength="500" /></label>
      <label>可见范围<select v-model="collectionForm.visibility"><option value="private">仅自己可见</option><option value="community">社区可见</option></select></label>
      <button class="button primary">{{ collectionForm.id ? '保存合集' : '创建合集' }}</button>
    </form>
  </AppDialog>
</template>
