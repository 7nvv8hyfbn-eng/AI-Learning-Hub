<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityImageGallery from './CommunityImageGallery.vue'
const props = defineProps<{ blocks: CommunityContentBlock[]; compact?: boolean; author?: string; origin?: string }>()
const emit = defineEmits<{ overflow: [value: boolean] }>()
const textRoot = ref<HTMLElement>(), images = computed(() => props.blocks.filter((block) => block.type === 'image'))
const textBlocks = computed(() => props.blocks.filter((block) => block.type !== 'image'))
const copiedIndex = ref(-1), failedIndex = ref(-1), menuIndex = ref(-1)
let copyTimer: ReturnType<typeof setTimeout> | undefined
const copyLabel = (index: number) => copiedIndex.value === index ? '已复制' : failedIndex.value === index ? '复制失败，请手动选择' : '复制'
const copyCode = async (index: number, code: string) => {
  try {
    await navigator.clipboard.writeText(code)
    copiedIndex.value = index; failedIndex.value = -1
  } catch {
    failedIndex.value = index; copiedIndex.value = -1
  } finally {
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copiedIndex.value = -1; failedIndex.value = -1 }, 1800)
  }
}
const codeExtensions: Record<string, string> = { python: 'py', py: 'py', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', go: 'go', rust: 'rs', ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt', sql: 'sql', json: 'json', yaml: 'yml', toml: 'toml', html: 'html', xml: 'xml', css: 'css', markdown: 'md', md: 'md' }
const commentPrefixes: Record<string, string> = { python: '#', py: '#', bash: '#', sh: '#', shell: '#', zsh: '#', yaml: '#', yml: '#', toml: '#', ruby: '#', r: '#', sql: '--', lua: '--', haskell: '--' }
const codeExt = (language: string) => codeExtensions[language.trim().toLowerCase()] || 'txt'
const watermarkLines = (prefix = '') => {
  const lines = ['来源：AI 数智化学习平台 · 题盒社区', `作者：${props.author || '社区学习者'}`, ...(props.origin ? [`出处：${props.origin}`] : []), `下载时间：${new Date().toLocaleString('zh-CN')}`]
  return prefix ? lines.map((line) => `${prefix} ${line}`) : lines
}
const download = (index: number, code: string, language: string, format: 'txt' | 'md' | 'code') => {
  const key = language.trim().toLowerCase()
  const base = `${(props.author || 'community').replace(/[\\/:*?"<>|\s]+/g, '-')}-code-${index + 1}`
  let content = '', name = base, type = 'text/plain;charset=utf-8'
  if (format === 'md') {
    content = [`> ${watermarkLines().join(' · ')}`, '', `\`\`\`${language.trim()}`, code, '```'].join('\n')
    name = `${base}.md`; type = 'text/markdown;charset=utf-8'
  } else if (format === 'code') {
    content = [...watermarkLines(commentPrefixes[key] || '//'), '', code].join('\n')
    name = `${base}.${codeExt(language)}`
  } else {
    content = [...watermarkLines(), '————————————', code].join('\n')
  }
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  URL.revokeObjectURL(url)
  menuIndex.value = -1
}
const onDocClick = (event: MouseEvent) => { if (menuIndex.value >= 0 && !(event.target as HTMLElement).closest('.community-code-download')) menuIndex.value = -1 }
onMounted(() => { if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', onDocClick) })
let observer: ResizeObserver | undefined
const measure = () => { if (props.compact) emit('overflow', [...(textRoot.value?.querySelectorAll<HTMLElement>('p, blockquote, pre') || [])].some((node) => node.scrollHeight > node.clientHeight + 1)) }
watch([() => props.blocks, () => props.compact], async () => { await nextTick(); measure() })
onMounted(() => { observer = new ResizeObserver(measure); if (textRoot.value) observer.observe(textRoot.value); measure() })
onBeforeUnmount(() => { if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('click', onDocClick); clearTimeout(copyTimer); observer?.disconnect() })
</script>
<template><div class="community-content" :class="{ compact }"><div ref="textRoot" class="community-text-blocks"><template v-for="(block, index) in textBlocks" :key="index"><p v-if="block.type === 'paragraph'">{{ block.text }}</p><blockquote v-else-if="block.type === 'quote'">{{ block.text }}</blockquote><div v-else class="community-code"><div class="community-code-head"><small>{{ block.language || 'text' }} · 只读代码</small><div class="community-code-actions"><button type="button" class="community-code-copy" :class="{ 'is-copied': copiedIndex === index, 'is-failed': failedIndex === index }" aria-label="复制代码全文" @click="copyCode(index, block.code)"><AppIcon name="git" :size="13" /><span>{{ copyLabel(index) }}</span></button><details class="community-code-download" :open="menuIndex === index" @toggle="menuIndex = ($event.target as HTMLDetailsElement).open ? index : -1"><summary aria-label="下载代码文件">下载<AppIcon name="chevron-down" :size="12" /></summary><div class="community-code-menu"><button type="button" @click="download(index, block.code, block.language || '', 'txt')">纯文本 .txt</button><button type="button" @click="download(index, block.code, block.language || '', 'md')">Markdown .md</button><button type="button" @click="download(index, block.code, block.language || '', 'code')">源码文件 .{{ codeExt(block.language || '') }}</button></div></details></div></div><pre><code>{{ block.code }}</code></pre></div></template></div><CommunityImageGallery v-if="images.length" :images="images" /></div></template>
