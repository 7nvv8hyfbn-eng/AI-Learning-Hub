<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { apiBlob } from '../services/api'

const props = withDefaults(defineProps<{ assetId?: string | null; fileId?: string; publicUrl?: string; alt?: string; focalX?: number; focalY?: number; revision?: number; aspectRatio?: string }>(), { alt: '素材预览', focalX: .5, focalY: .5, aspectRatio: '16 / 9' })
const url = ref(''), error = ref(''), loading = ref(false)
let abort: AbortController | undefined
let epoch = 0
const release = () => { if (url.value.startsWith('blob:')) URL.revokeObjectURL(url.value); url.value = '' }
watch(() => [props.assetId, props.fileId, props.publicUrl, props.revision], async () => {
  const request = ++epoch
  abort?.abort(); release(); error.value = ''; loading.value = false
  if (!props.assetId) { url.value = props.publicUrl || ''; return }
  abort = new AbortController(); loading.value = true
  try {
    const blob = await apiBlob(`/admin/media-assets/${encodeURIComponent(props.assetId)}/preview${props.fileId ? `?fileId=${encodeURIComponent(props.fileId)}` : ''}`, abort.signal)
    if (request !== epoch) return
    url.value = URL.createObjectURL(blob)
  } catch (cause) {
    if (request === epoch && !abort.signal.aborted) error.value = cause instanceof Error ? cause.message : '图片暂不可用'
  } finally { if (request === epoch) loading.value = false }
}, { immediate: true })
onBeforeUnmount(() => { epoch++; abort?.abort(); release() })
</script>

<template>
  <div class="media-preview" :style="{ aspectRatio: aspectRatio.replace(':', '/') }">
    <img v-if="url && !error" :src="url" :alt="alt" loading="lazy" :style="{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }" @error="error = '图片文件暂不可用'" />
    <span v-else role="status">{{ loading ? '图片读取中…' : error || '尚无可用图片' }}</span>
  </div>
</template>

<style scoped>
.media-preview { display: grid; place-items: center; width: 100%; min-width: 0; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 12px; background: #f5f4f0; color: #77716a; }
.media-preview img { width: 100%; height: 100%; object-fit: cover; }
.media-preview span { padding: 12px; font-size: 12px; text-align: center; overflow-wrap: anywhere; }
</style>
