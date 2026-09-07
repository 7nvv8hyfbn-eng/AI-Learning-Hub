<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import CommunityImageGallery from './CommunityImageGallery.vue'
const props = defineProps<{ blocks: CommunityContentBlock[]; compact?: boolean }>()
const emit = defineEmits<{ overflow: [value: boolean] }>()
const textRoot = ref<HTMLElement>(), images = computed(() => props.blocks.filter((block) => block.type === 'image'))
const textBlocks = computed(() => props.blocks.filter((block) => block.type !== 'image'))
let observer: ResizeObserver | undefined
const measure = () => { if (props.compact) emit('overflow', [...(textRoot.value?.querySelectorAll<HTMLElement>('p, blockquote, pre, li') || [])].some((node) => node.scrollHeight > node.clientHeight + 1)) }
watch([() => props.blocks, () => props.compact], async () => { await nextTick(); measure() })
onMounted(() => { observer = new ResizeObserver(measure); if (textRoot.value) observer.observe(textRoot.value); measure() })
onBeforeUnmount(() => observer?.disconnect())
/* 轻量 Markdown 渲染：先整体转义再受控生成标签，用户内容不会注入 HTML */
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const inline = (value: string) => escapeHtml(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
const renderRich = (text: string) => {
  const out: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | undefined
  let table: string[][] | undefined
  const flushList = () => {
    if (!list) return
    const items = list.items.map((item) => `<li>${inline(item)}</li>`).join('')
    out.push(list.type === 'ul' ? `<ul class="md-list">${items}</ul>` : `<ol class="md-list">${items}</ol>`)
    list = undefined
  }
  const flushTable = () => {
    if (!table) return
    if (table.length > 1) {
      const [head, ...rows] = table
      const th = head.map((cell) => `<th>${inline(cell)}</th>`).join('')
      const trs = rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')
      out.push(`<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`)
    } else out.push(`<p class="md-p">${inline(table[0].join(' '))}</p>`)
    table = undefined
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const cells = line.startsWith('|') && line.endsWith('|') && line.length > 2 ? line.slice(1, -1).split('|').map((cell) => cell.trim()) : undefined
    if (cells && !cells.every((cell) => /^:?-{2,}:?$/.test(cell))) { flushList(); table ||= []; table.push(cells); continue }
    if (cells) continue
    flushTable()
    if (/^(?:-{3,}|\*{3,})\s*$/.test(line)) { flushList(); out.push('<hr class="md-hr" />'); continue }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    const ulItem = /^[-*]\s+(.+)$/.exec(line)
    const olItem = /^\d+[.、]\s+(.+)$/.exec(line)
    if (heading) { flushList(); const level = heading[1].length + 2; out.push(`<h${level} class="md-h">${inline(heading[2])}</h${level}>`); continue }
    if (ulItem) { if (list && list.type !== 'ul') flushList(); list ||= { type: 'ul', items: [] }; list.items.push(ulItem[1]); continue }
    if (olItem) { if (list && list.type !== 'ol') flushList(); list ||= { type: 'ol', items: [] }; list.items.push(olItem[1]); continue }
    flushList()
    if (!line.trim()) continue
    out.push(`<p class="md-p">${inline(line)}</p>`)
  }
  flushList(); flushTable()
  return out.join('')
}
</script>
<template><div class="community-content" :class="{ compact }"><div ref="textRoot" class="community-text-blocks"><template v-for="(block, index) in textBlocks" :key="index"><div v-if="block.type === 'paragraph'" class="community-md" v-html="renderRich(block.text)" /><blockquote v-else-if="block.type === 'quote'">{{ block.text }}</blockquote><div v-else class="community-code"><small>{{ block.language || 'text' }} · 只读代码</small><pre><code>{{ block.code }}</code></pre></div></template></div><CommunityImageGallery v-if="images.length" :images="images" /></div></template>
