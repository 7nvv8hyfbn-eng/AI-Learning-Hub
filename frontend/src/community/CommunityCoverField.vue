<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { communityApi } from '../services/api/community'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { useCommunityAccess } from './composables/useCommunityAccess'

const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()
const editor = useCommunityDraft(), auth = useAuthStore(), store = useCommunityStore()
const { decision, requireWrite } = useCommunityAccess()
const allowed = computed(() => decision('upload'))
const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref(''), error = ref(''), uploading = ref(false)
let disposed = false
let releaseUpload = () => {}

watch(() => props.modelValue, async (id, _, onCleanup) => {
  let stale = false, url = ''
  preview.value = ''; error.value = ''
  onCleanup(() => { stale = true; if (url) URL.revokeObjectURL(url) })
  if (!id) return
  try {
    url = await communityApi.image(id)
    if (stale) URL.revokeObjectURL(url)
    else preview.value = url
  } catch (cause) { if (!stale) error.value = cause instanceof Error ? cause.message : '封面预览读取失败，可重新选择图片' }
}, { immediate: true })

const choose = async (event: Event) => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file || editor.saving || !requireWrite('upload')) return
  const form = editor.form, owner = auth.user?.id, epoch = store.epoch
  const current = () => !disposed && editor.form === form && auth.user?.id === owner && store.epoch === epoch
  const release = () => { if (editor.form === form && auth.user?.id === owner && store.epoch === epoch) editor.saving = false }
  releaseUpload = release
  uploading.value = true; editor.saving = true; error.value = ''
  try {
    const result = await communityApi.upload(file)
    if (current()) emit('update:modelValue', result.id)
  } catch (cause) { if (current()) error.value = cause instanceof Error ? cause.message : '封面上传失败，原封面已保留' }
  finally { release(); if (releaseUpload === release) uploading.value = false }
}
const remove = () => { if (!editor.saving) emit('update:modelValue', undefined) }
onBeforeUnmount(() => { disposed = true; if (uploading.value) releaseUpload() })
</script>

<template>
  <section class="community-cover-field" aria-label="作品封面">
    <img v-if="preview" class="cover-preview" :src="preview" alt="已选封面预览" />
    <div class="cover-controls">
      <strong>封面（选填）</strong>
      <p>PNG、JPEG 或 WebP，最大 5MB，建议使用横向图片。</p>
      <div class="cover-actions">
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择封面图片" hidden :disabled="editor.saving || !allowed.allowed" @change="choose" />
        <button class="button secondary small" type="button" :disabled="editor.saving || !allowed.allowed" @click="fileInput?.click()">{{ uploading ? '封面上传中…' : modelValue ? '更换封面' : '添加封面' }}</button>
        <button v-if="modelValue" class="text-link" type="button" :disabled="editor.saving" @click="remove">移除封面</button>
      </div>
      <p v-if="!allowed.allowed">{{ allowed.message }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
  </section>
</template>

<style scoped>
.community-cover-field { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px; border: 1px solid var(--amc-border, #e6e0d8); border-radius: 10px; flex-shrink: 0; }
.cover-preview { width: 144px; height: 81px; border-radius: 6px; object-fit: cover; }
.cover-controls { flex: 1; min-width: 180px; }
.cover-controls strong { font-size: 14px; }
.cover-controls p { margin: 5px 0; font-size: 12px; color: var(--text-secondary, #78716c); }
.cover-controls [role="alert"] { color: var(--danger, #b42318); }
.cover-actions { display: flex; align-items: center; gap: 12px; }
</style>
