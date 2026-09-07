<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import { sanitizeCommunityHtml } from '@ai-learning-hub/contracts'
import AppDialog from '../components/base/AppDialog.vue'
import CommunityImageGallery from './CommunityImageGallery.vue'
const props = defineProps<{ blocks: CommunityContentBlock[]; compact?: boolean }>()
const emit = defineEmits<{ overflow: [value: boolean] }>()
const textRoot = ref<HTMLElement>(), images = computed(() => props.blocks.filter((block) => block.type === 'image'))
const safeHtml = (block: CommunityContentBlock) => sanitizeCommunityHtml(block.type === 'html' ? block.html : '')
const viewerOpen = ref(false), viewerSrc = ref(''), viewerAlt = ref('')
const textClick = (event: MouseEvent) => {
  const image = (event.target as HTMLElement).closest('img')
  if (!image || !image.closest('.community-html-block') || image.closest('a')) return
  viewerSrc.value = image.getAttribute('src') || ''
  viewerAlt.value = image.getAttribute('alt') || '帖子配图'
  if (viewerSrc.value) viewerOpen.value = true
}
const textBlocks = computed(() => props.blocks.filter((block) => block.type !== 'image'))
let observer: ResizeObserver | undefined
const measure = () => { if (props.compact) emit('overflow', [...(textRoot.value?.querySelectorAll<HTMLElement>('p, blockquote, pre') || [])].some((node) => node.scrollHeight > node.clientHeight + 1)) }
watch([() => props.blocks, () => props.compact], async () => { await nextTick(); measure() })
onMounted(() => { observer = new ResizeObserver(measure); if (textRoot.value) observer.observe(textRoot.value); measure() })
onBeforeUnmount(() => observer?.disconnect())
</script>
<template><div class="community-content" :class="{ compact }"><div ref="textRoot" class="community-text-blocks" @click="textClick"><template v-for="(block, index) in textBlocks" :key="index"><p v-if="block.type === 'paragraph'">{{ block.text }}</p><blockquote v-else-if="block.type === 'quote'">{{ block.text }}</blockquote><div v-else-if="block.type === 'html'" class="community-html-block" v-html="safeHtml(block)"></div><div v-else class="community-code"><small>{{ block.language || 'text' }} · 只读代码</small><pre><code>{{ block.code }}</code></pre></div></template></div><CommunityImageGallery v-if="images.length" :images="images" /></div>
  <AppDialog v-model="viewerOpen" title="查看图片"><section v-if="viewerOpen" class="community-image-viewer"><img :src="viewerSrc" :alt="viewerAlt" /></section></AppDialog>
</template>
