<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import CommunityImageGallery from './CommunityImageGallery.vue'
const props = defineProps<{ blocks: CommunityContentBlock[]; compact?: boolean }>()
const emit = defineEmits<{ overflow: [value: boolean] }>()
const textRoot = ref<HTMLElement>(), images = computed(() => props.blocks.filter((block) => block.type === 'image'))
const textBlocks = computed(() => props.blocks.filter((block) => block.type !== 'image'))
let observer: ResizeObserver | undefined
const measure = () => { if (props.compact) emit('overflow', [...(textRoot.value?.querySelectorAll<HTMLElement>('p, blockquote, pre') || [])].some((node) => node.scrollHeight > node.clientHeight + 1)) }
watch([() => props.blocks, () => props.compact], async () => { await nextTick(); measure() })
onMounted(() => { observer = new ResizeObserver(measure); if (textRoot.value) observer.observe(textRoot.value); measure() })
onBeforeUnmount(() => observer?.disconnect())
</script>
<template><div class="community-content" :class="{ compact }"><div ref="textRoot" class="community-text-blocks"><template v-for="(block, index) in textBlocks" :key="index"><p v-if="block.type === 'paragraph'">{{ block.text }}</p><component :is="`h${Math.min(6, Math.max(1, block.level))}`" v-else-if="block.type === 'heading'" class="community-heading-block">{{ block.text }}</component><ul v-else-if="block.type === 'list' && !block.ordered"><li v-for="(item, itemIndex) in block.items" :key="itemIndex">{{ item }}</li></ul><ol v-else-if="block.type === 'list'"><li v-for="(item, itemIndex) in block.items" :key="itemIndex">{{ item }}</li></ol><blockquote v-else-if="block.type === 'quote'">{{ block.text }}</blockquote><div v-else class="community-code"><small>{{ block.language || 'text' }} · 只读代码</small><pre><code>{{ block.code }}</code></pre></div></template></div><CommunityImageGallery v-if="images.length" :images="images" /></div></template>
