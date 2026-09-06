<script setup lang="ts">
import type { ResourceContributionInput, ResourceHubCategoryDto } from '@ai-learning-hub/contracts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { resourceHubApi } from '../services/api/resourceHub'

const editor = useCommunityDraft()
const { form, saving, error } = storeToRefs(editor)
const categories = ref<ResourceHubCategoryDto[]>([])
const tags = ref(form.value.contribution?.tags.join('、') || '')
const uploadProgress = ref(0)
const uploadStatus = ref('')
const cancelUpload = ref<(() => void) | null>(null)
let videoStatusTimer: ReturnType<typeof setTimeout> | undefined
let operationVersion = 0
const contribution = computed({
  get: () => form.value.contribution!,
  set: (value: ResourceContributionInput) => { form.value.contribution = value },
})
const patch = (value: Partial<ResourceContributionInput>) => { contribution.value = { ...contribution.value, ...value } }
const stopVideoStatus = () => {
  operationVersion++
  if (videoStatusTimer) clearTimeout(videoStatusTimer)
  videoStatusTimer = undefined
}
const readVideoStatus = async (id: string, version: number) => {
  try {
    const video = await resourceHubApi.video(id)
    if (version !== operationVersion || contribution.value.videoAssetId !== id) return
    uploadProgress.value = 100
    uploadStatus.value = video.status === 'ready'
      ? '处理完成，可发布'
      : video.status === 'failed'
        ? `处理失败${video.lastError ? `：${video.lastError}` : '，请在创作中心重试'}`
        : video.status === 'processing' ? '正在处理视频…' : '视频已上传，等待处理…'
    if (video.status === 'uploaded' || video.status === 'processing') videoStatusTimer = setTimeout(() => void readVideoStatus(id, version), 2000)
  } catch (cause) {
    if (version === operationVersion) uploadStatus.value = cause instanceof Error ? `处理状态读取失败：${cause.message}` : '处理状态读取失败'
  }
}
const monitorVideo = (id: string) => {
  if (videoStatusTimer) clearTimeout(videoStatusTimer)
  videoStatusTimer = undefined
  const version = operationVersion
  void readVideoStatus(id, version)
}
watch(tags, (value) => patch({ tags: [...new Set(value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))].slice(0, 8) }))
watch(() => contribution.value.kind, (kind) => {
  stopVideoStatus()
  if (cancelUpload.value) {
    cancelUpload.value()
    cancelUpload.value = null
    saving.value = false
  }
  form.value.type = kind === 'video' ? 'lab_result' : kind === 'article' ? 'frontier_discussion' : 'note'
  uploadStatus.value = ''
  patch(kind === 'video'
    ? { attachmentFileId: undefined, sourceName: undefined, sourceUrl: undefined }
    : kind === 'document'
      ? { videoAssetId: undefined, sourceName: undefined, sourceUrl: undefined }
      : { videoAssetId: undefined, attachmentFileId: undefined })
})
const choose = async (event: Event) => {
  const target = event.target as HTMLInputElement, file = target.files?.[0]
  if (!file) return
  stopVideoStatus()
  const version = operationVersion
  saving.value = true
  uploadProgress.value = 0; uploadStatus.value = '正在上传…'
  try {
    if (contribution.value.kind === 'video') {
      const handle = resourceHubApi.uploadVideo(file, (value) => { uploadProgress.value = value })
      cancelUpload.value = handle.cancel
      const video = await handle.promise
      if (version !== operationVersion) return
      patch({ videoAssetId: video.id })
      uploadStatus.value = video.status === 'ready' ? '上传完成，可发布' : '上传完成，正在处理；处理完成后可发布'
      if (video.status !== 'ready' && video.status !== 'failed') monitorVideo(video.id)
    } else {
      const handle = resourceHubApi.uploadDocument(file, (value) => { uploadProgress.value = value })
      cancelUpload.value = handle.cancel
      const document = await handle.promise
      if (version !== operationVersion) return
      patch({ attachmentFileId: document.id })
      uploadStatus.value = '资料上传完成'
    }
  } catch (cause) {
    if (version === operationVersion) {
      const message = cause instanceof Error ? cause.message : '上传失败'
      uploadStatus.value = message === '已取消上传' ? '已取消上传，可重新选择文件' : '上传失败，请重新选择文件'
      error.value = message
    }
  } finally {
    if (version === operationVersion) {
      cancelUpload.value = null
      saving.value = false
      target.value = ''
    }
  }
}
const warnBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!cancelUpload.value) return
  event.preventDefault()
}
watch(cancelUpload, (active) => active ? window.addEventListener('beforeunload', warnBeforeUnload) : window.removeEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => {
  stopVideoStatus()
  window.removeEventListener('beforeunload', warnBeforeUnload)
  cancelUpload.value?.()
})
onMounted(async () => {
  if (contribution.value.videoAssetId) monitorVideo(contribution.value.videoAssetId)
  try {
    categories.value = await resourceHubApi.categories()
    if (!contribution.value.categoryId) patch({ categoryId: categories.value.find((item) => item.code === 'uncategorized')?.id })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '资源分类读取失败' }
})
</script>

<template>
  <section class="resource-contribution-fields">
    <h3>资源共创信息</h3>
    <div class="composer-row">
      <label>作品形态<select v-model="contribution.kind"><option value="video">视频演示</option><option value="article">图文分享</option><option value="document">配套资料</option></select></label>
      <label>资源分类<select v-model="contribution.categoryId"><option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    </div>
    <label>教学标签（最多 8 个）<input v-model="tags" maxlength="160" placeholder="例如：RAG、模型部署、课堂实训" /></label>
    <label v-if="contribution.kind !== 'article'">{{ contribution.kind === 'video' ? '视频文件（MP4、MOV、WebM，最大 1GB）' : '资料文件（PDF、DOCX、PPTX、ZIP、TXT，最大 100MB）' }}<input type="file" :accept="contribution.kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : '.pdf,.docx,.pptx,.zip,.txt'" :disabled="saving || !!cancelUpload" @change="choose" /></label>
    <div v-if="uploadStatus" class="resource-upload-state" role="status"><progress :value="uploadProgress" max="100" /><span>{{ uploadStatus }}</span><button v-if="cancelUpload" type="button" class="text-link" @click="cancelUpload()">取消上传</button></div>
    <template v-if="contribution.kind === 'article'">
      <label>参考来源名称（选填）<input v-model="contribution.sourceName" maxlength="120" placeholder="原创内容可留空" /></label>
      <label>参考来源链接（选填）<input v-model="contribution.sourceUrl" type="url" maxlength="500" placeholder="https://…" /></label>
    </template>
    <label class="community-checkbox"><input v-model="contribution.teachingReuseConsent" type="checkbox" />允许平台在保留作者署名和原帖链接的前提下，将本作品引用到站内课程草稿</label>
    <p class="composer-privacy">请确认你有权分享所上传的内容；此授权仅用于站内署名教学引用，不等同于公共开源许可。</p>
  </section>
</template>
