<script setup lang="ts">
import type { ResourceContributionInput } from '@ai-learning-hub/contracts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { resourceHubApi } from '../services/api/resourceHub'

const editor = useCommunityDraft()
const { form, saving, error } = storeToRefs(editor)
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
onMounted(() => { if (contribution.value.videoAssetId) monitorVideo(contribution.value.videoAssetId) })
</script>

<template>
  <label>{{ contribution.kind === 'video' ? '视频文件（MP4、MOV、WebM，最大 1GB）' : '资料文件（PDF、DOCX、PPTX、ZIP、TXT，最大 100MB）' }}<input type="file" :accept="contribution.kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : '.pdf,.docx,.pptx,.zip,.txt'" :disabled="saving || !!cancelUpload" @change="choose" /></label>
  <div v-if="uploadStatus" class="resource-upload-state" role="status"><progress :value="uploadProgress" max="100" /><span>{{ uploadStatus }}</span><button v-if="cancelUpload" type="button" class="text-link" @click="cancelUpload()">取消上传</button></div>
</template>
