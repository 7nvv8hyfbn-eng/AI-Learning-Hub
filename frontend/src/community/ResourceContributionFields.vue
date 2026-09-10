<script setup lang="ts">
import type { ResourceContributionInput, ResourceHubCategoryDto, StorageCapacityDto } from '@ai-learning-hub/contracts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { resourceHubApi } from '../services/api/resourceHub'
import { useCommunityAccess } from './composables/useCommunityAccess'
import CommunityCoverField from './CommunityCoverField.vue'
import { useCommunityStore } from '../stores/community'
import { useAuthStore } from '../stores/auth'

withDefaults(defineProps<{ showCover?: boolean }>(), { showCover: true })

const editor = useCommunityDraft(), store = useCommunityStore(), auth = useAuthStore()
const session = store.composerSession, epoch = store.epoch, owner = auth.user?.id
let disposed = false
const current = () => !disposed && store.composerOpen && session === store.composerSession && epoch === store.epoch && owner === auth.user?.id
const { availability, decision, requireWrite } = useCommunityAccess()
const uploadDecision = computed(() => decision('upload'))
const { form, saving, error } = storeToRefs(editor)
const categories = ref<ResourceHubCategoryDto[]>([])
const tags = ref(form.value.contribution?.tags.join('、') || '')
const uploadProgress = ref(0)
const uploadStatus = ref('')
const scanNotice = ref('')
const capacity = ref<StorageCapacityDto | null>(null)
const capacityError = ref('')
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
const refreshCapacity = async () => {
  try { const value = await resourceHubApi.capacity(); if (current()) { capacity.value = value; capacityError.value = '' } }
  catch { if (current()) capacityError.value = '暂时无法读取存储容量，上传时由服务器校验。' }
}
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
    if (!current() || version !== operationVersion || contribution.value.videoAssetId !== id) return
    uploadProgress.value = 100
    scanNotice.value = video.securityScan?.status === 'unavailable' ? '恶意文件扫描不可用，未扫描。' : video.securityScan?.message || ''
    uploadStatus.value = video.status === 'ready'
      ? '处理完成，可发布'
      : video.status === 'failed'
        ? `处理失败${video.lastError ? `：${video.lastError}` : '，请在创作中心重试'}`
        : video.status === 'processing' ? '正在处理视频…' : '视频已上传，等待处理…'
    if (video.status === 'uploaded' || video.status === 'processing') videoStatusTimer = setTimeout(() => void readVideoStatus(id, version), 2000)
  } catch (cause) {
    if (current() && version === operationVersion) uploadStatus.value = cause instanceof Error ? `处理状态读取失败：${cause.message}` : '处理状态读取失败'
  }
}
const monitorVideo = (id: string) => {
  if (videoStatusTimer) clearTimeout(videoStatusTimer)
  videoStatusTimer = undefined
  const version = operationVersion
  void readVideoStatus(id, version)
}
watch(tags, (value) => patch({ tags: [...new Set(value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))].slice(0, 8) }))
const switchKind = (event: Event) => {
  const target = event.target as HTMLSelectElement, kind = target.value as ResourceContributionInput['kind']
  target.value = contribution.value.kind
  if (kind !== contribution.value.kind) store.openComposer({ type: kind === 'video' ? 'lab_result' : kind === 'article' ? 'frontier_discussion' : 'note', contribution: { kind, tags: [], teachingReuseConsent: false } })
}
const choose = async (event: Event) => {
  const target = event.target as HTMLInputElement, file = target.files?.[0]
  if (!file || saving.value || cancelUpload.value) return
  if (!requireWrite('upload')) { target.value = ''; return }
  stopVideoStatus()
  const version = operationVersion
  uploadProgress.value = 0; uploadStatus.value = '正在上传…'
  let release = () => {}
  const track = (cancel: () => void) => {
    cancelUpload.value = () => { stopVideoStatus(); cancel(); release(); cancelUpload.value = null; uploadStatus.value = '已取消上传，可重新选择文件' }
    release = editor.registerUpload(cancelUpload.value)
  }
  try {
    if (contribution.value.kind === 'video') {
      const handle = resourceHubApi.uploadVideo(file, (value) => { if (current() && version === operationVersion) uploadProgress.value = value })
      track(handle.cancel)
      const video = await handle.promise
      if (!current() || version !== operationVersion) return
      patch({ videoAssetId: video.id })
      uploadStatus.value = video.status === 'ready' ? '上传完成，可发布' : '上传完成，正在处理；处理完成后可发布'
      if (video.status !== 'ready' && video.status !== 'failed') monitorVideo(video.id)
    } else {
      const handle = resourceHubApi.uploadDocument(file, (value) => { if (current() && version === operationVersion) uploadProgress.value = value })
      track(handle.cancel)
      const document = await handle.promise
      if (!current() || version !== operationVersion) return
      if (document.securityScan?.quarantined) throw new Error(document.securityScan.message || '资料已隔离，不能投稿')
      patch({ attachmentFileId: document.id })
      uploadStatus.value = `资料上传完成${document.securityScan?.status === 'unavailable' ? '；恶意文件扫描不可用，未扫描' : document.securityScan?.status === 'clean' ? '；安全扫描通过' : ''}`
    }
  } catch (cause) {
    if (current() && version === operationVersion) {
      const message = cause instanceof Error ? cause.message : '上传失败'
      uploadStatus.value = message === '已取消上传' ? '已取消上传，可重新选择文件' : '上传失败，请重新选择文件'
      error.value = message
    }
  } finally {
    release()
    if (current()) void refreshCapacity()
    if (current() && version === operationVersion) {
      cancelUpload.value = null
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
  disposed = true
  stopVideoStatus()
  window.removeEventListener('beforeunload', warnBeforeUnload)
  cancelUpload.value?.()
})
onMounted(async () => {
  void refreshCapacity()
  if (contribution.value.videoAssetId) monitorVideo(contribution.value.videoAssetId)
  try {
    const rows = await resourceHubApi.categories()
    if (current()) categories.value = rows
  } catch (cause) { if (current()) error.value = cause instanceof Error ? cause.message : '资源分类读取失败' }
})
</script>

<template>
  <section class="resource-contribution-fields">
    <h3>资源共创信息</h3>
    <p v-if="capacity" class="composer-privacy">已用 {{ sizeLabel(capacity.usedBytes) }} / {{ sizeLabel(capacity.quotaBytes) }}，上传与处理预留 {{ sizeLabel(capacity.reservedBytes + capacity.temporaryReservedBytes) }}；同时上传 {{ capacity.activeUploads }}/{{ capacity.parallelUploadLimit }}，视频队列 {{ capacity.queuedTasks }}/{{ capacity.queueLimit }}。<span v-if="capacity.unavailableReason">{{ capacity.unavailableReason }}</span></p>
    <p v-else-if="capacityError" class="composer-privacy">{{ capacityError }}</p>
    <div class="composer-row">
      <label>作品形态<select :value="contribution.kind" @change="switchKind"><option value="video">视频演示</option><option value="article">图文分享</option><option value="document">配套资料</option></select></label>
      <label>资源分类<select v-model="contribution.categoryId"><option :value="undefined">未分类</option><option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    </div>
    <label>教学标签（最多 8 个）<input v-model="tags" maxlength="160" placeholder="例如：RAG、模型部署、课堂实训" /></label>
    <label v-if="contribution.kind !== 'article'">{{ contribution.kind === 'video' ? '视频文件（MP4、MOV、WebM，最大 1GB）' : '资料文件（PDF、DOCX、PPTX、ZIP、TXT，最大 100MB）' }}<input type="file" :accept="contribution.kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : '.pdf,.docx,.pptx,.zip,.txt'" :disabled="saving || !!cancelUpload || !uploadDecision.allowed" @change="choose" /></label>
    <p v-if="contribution.kind !== 'article' && !uploadDecision.allowed" class="community-notice">{{ uploadDecision.message }}<span v-if="availability('upload')">{{ availability('upload') }}</span><RouterLink v-if="uploadDecision.nextAction" class="text-link" :to="uploadDecision.nextAction.route">{{ uploadDecision.nextAction.label }}</RouterLink></p>
    <div v-if="uploadStatus" class="resource-upload-state" role="status"><progress :value="uploadProgress" max="100" /><span>{{ uploadStatus }}</span><button v-if="cancelUpload" type="button" class="text-link" @click="cancelUpload()">取消上传</button></div>
    <p v-if="scanNotice" class="composer-privacy">{{ scanNotice }}</p>
    <CommunityCoverField v-if="showCover && contribution.kind === 'article'" v-model="contribution.coverFileId" />
    <template v-if="contribution.kind === 'article'">
      <label>参考来源名称（选填）<input v-model="contribution.sourceName" maxlength="120" placeholder="原创内容可留空" /></label>
      <label>参考来源链接（选填）<input v-model="contribution.sourceUrl" type="url" maxlength="500" placeholder="https://…" /></label>
    </template>
    <label class="community-checkbox"><input v-model="contribution.teachingReuseConsent" type="checkbox" />允许平台在保留作者署名和原帖链接的前提下，将本作品引用到站内课程草稿</label>
    <p class="composer-privacy">请确认你有权分享所上传的内容；此授权仅用于站内署名教学引用，不等同于公共开源许可。</p>
  </section>
</template>
