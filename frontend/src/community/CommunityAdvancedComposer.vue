<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { CommunityPostType } from '@ai-learning-hub/contracts'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { useResourceCategories } from './composables/useResourceCategories'
import CommunityDraftConflict from './CommunityDraftConflict.vue'
import CommunityEditorToolbar from './CommunityEditorToolbar.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { postLabels } from './labels'
import ResourceContributionFields from './ResourceContributionFields.vue'
import { loadCommunityImage } from './imageQueue'

const editor = useCommunityDraft()
const { form, body, saving, error, savedAt, images } = storeToRefs(editor)
const { save, uploadFiles } = editor
const textarea = ref<HTMLTextAreaElement>(), imageInput = ref<HTMLInputElement>(), mdInput = ref<HTMLInputElement>()
const fullscreen = ref(false), menuOpen = ref(false), dragging = ref(false)
let dragDepth = 0

const typeIcons: Record<CommunityPostType, string> = { question: 'question', note: 'note-edit', lab_result: 'lab-share', project: 'project-maker', frontier_discussion: 'sparkles', achievement: 'achievement', general: 'message' }
const typeColors: Record<CommunityPostType, string> = { question: 'var(--amc-purple)', note: 'var(--amc-orange)', lab_result: 'var(--amc-green)', project: 'var(--amc-yellow)', frontier_discussion: 'var(--amc-blue)', achievement: 'var(--amc-teal)', general: 'var(--brand)' }
const categoryCovers: Record<string, string> = { 'ai-foundation': 'cover-llm', 'lab-demo': 'cover-hardware', 'model-deployment': 'cover-deployment', 'agent-practice': 'cover-agent', 'tool-tutorial': 'cover-image', 'creator-share': 'cover-security' }

const { categories, loading: categoriesLoading, load: loadCategories } = useResourceCategories()
const contributionMode = computed(() => !!form.value.contribution)
type CategoryOption = { id: string; label: string; icon: string; description: string; coverClass: string; color: string }
const categoryOptions = computed<CategoryOption[]>(() => contributionMode.value
  ? categories.value.map((item) => ({ id: item.id, label: item.name, icon: item.icon, description: item.description, coverClass: categoryCovers[item.code] || '', color: categoryCovers[item.code] ? '' : 'var(--brand)' }))
  : (Object.keys(postLabels) as CommunityPostType[]).map((type) => ({ id: type, label: postLabels[type], icon: typeIcons[type], description: '', coverClass: '', color: typeColors[type] })))
const activeCategory = computed<CategoryOption>(() => {
  if (contributionMode.value) {
    const current = categoryOptions.value.find((item) => item.id === form.value.contribution?.categoryId)
    if (current) return current
    return { id: '', label: categoriesLoading.value ? '分类读取中…' : '选择分类', icon: 'folder', description: '', coverClass: '', color: 'var(--brand)' }
  }
  return categoryOptions.value.find((item) => item.id === form.value.type) || { id: form.value.type, label: postLabels[form.value.type], icon: typeIcons[form.value.type], description: '', coverClass: '', color: typeColors[form.value.type] }
})
const pickCategory = (option: CategoryOption) => {
  menuOpen.value = false
  if (!contributionMode.value) { form.value.type = option.id as CommunityPostType; return }
  const contribution = form.value.contribution
  if (contribution && option.id) form.value.contribution = { ...contribution, categoryId: option.id }
}

const needsTitle = computed(() => ['question', 'project'].includes(form.value.type) || contributionMode.value)
const hasBody = computed(() => !!body.value.trim() || images.value.length > 0)
const publishDisabled = computed(() => saving.value || !hasBody.value || (needsTitle.value && !form.value.title?.trim()))

const toast = (message: string) => window.dispatchEvent(new CustomEvent('api-error', { detail: { message } }))
const applySelection = async (build: (selected: string) => { text: string; select: [number, number] }) => {
  const node = textarea.value
  if (!node) return
  const start = node.selectionStart ?? 0, end = node.selectionEnd ?? 0
  const plan = build(body.value.slice(start, end))
  body.value = body.value.slice(0, start) + plan.text + body.value.slice(end)
  await nextTick()
  node.focus({ preventScroll: true })
  node.setSelectionRange(start + plan.select[0], start + plan.select[1])
}
const wrapMarker = (marker: string, placeholder: string) => applySelection((selected) => {
  const inner = selected || placeholder
  return { text: `${marker}${inner}${marker}`, select: [marker.length, marker.length + inner.length] }
})
const linePrefix = async (prefix: string) => {
  const node = textarea.value
  if (!node) return
  const start = node.selectionStart ?? 0
  const lineStart = body.value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const marked = body.value.slice(lineStart).startsWith(prefix)
  body.value = marked ? body.value.slice(0, lineStart) + body.value.slice(lineStart + prefix.length) : body.value.slice(0, lineStart) + prefix + body.value.slice(lineStart)
  await nextTick()
  node.focus({ preventScroll: true })
  const caret = lineStart + (marked ? 0 : prefix.length)
  node.setSelectionRange(caret, caret)
}
const insertCodeBlock = () => applySelection((selected) => {
  const inner = selected || '在此粘贴代码'
  return { text: `\n\`\`\`\n${inner}\n\`\`\`\n`, select: [5, 5 + inner.length] }
})
const insertLink = () => applySelection((selected) => {
  const inner = selected || '链接文字'
  return { text: `[${inner}](https://)`, select: [inner.length + 3, inner.length + 11] }
})

const isImageFile = (file: File) => /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)
const isTextFile = (file: File) => /\.(md|markdown|txt)$/i.test(file.name)
const readAsText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('读取失败'))
  reader.readAsText(file, 'UTF-8')
})
const importMarkdown = async (file: File) => {
  if (file.size > 2 * 1024 * 1024) { toast(`「${file.name}」超过 2MB，无法导入`); return }
  let text: string
  try { text = (await readAsText(file)).replace(/\r\n/g, '\n').trim() } catch { toast(`「${file.name}」读取失败，请重试`); return }
  if (!text) { toast(`「${file.name}」内容为空`); return }
  const fillEmpty = !body.value.trim()
  const fill = fillEmpty ? text : `${body.value.replace(/\s+$/, '')}\n\n${text}`
  if (fill.length > 10000) { toast(`「${file.name}」超过 10000 字正文上限，请拆分后导入`); return }
  body.value = fill
  if (fillEmpty && !form.value.title?.trim()) form.value.title = file.name.replace(/\.(md|markdown|txt)$/i, '')
}
const routeFiles = (files: File[]) => {
  const images: File[] = [], docs: File[] = []
  for (const file of files) {
    if (isImageFile(file)) images.push(file)
    else if (isTextFile(file)) docs.push(file)
    else toast(`暂不支持「${file.name}」，仅支持图片或 .md / .txt 文件`)
  }
  if (images.length) void uploadFiles(images)
  for (const doc of docs) void importMarkdown(doc)
}

type ToolbarAction = 'bold' | 'italic' | 'heading' | 'list' | 'code' | 'link' | 'image' | 'import-md' | 'fullscreen'
const onAction = (key: ToolbarAction) => {
  if (key === 'bold') { void wrapMarker('**', '加粗文字'); return }
  if (key === 'italic') { void wrapMarker('*', '斜体文字'); return }
  if (key === 'heading') { void linePrefix('## '); return }
  if (key === 'list') { void linePrefix('- '); return }
  if (key === 'code') { void insertCodeBlock(); return }
  if (key === 'link') { void insertLink(); return }
  if (key === 'image') { void imageInput.value?.click(); return }
  if (key === 'import-md') { void mdInput.value?.click(); return }
  fullscreen.value = !fullscreen.value
}
const onPickImages = async (event: Event) => { const target = event.target as HTMLInputElement; await uploadFiles(Array.from(target.files || [])); target.value = '' }
const onPickMarkdown = (event: Event) => { const target = event.target as HTMLInputElement; for (const file of Array.from(target.files || [])) void importMarkdown(file); target.value = '' }
const paste = (event: ClipboardEvent) => { const files = Array.from(event.clipboardData?.files || []).filter((file) => isImageFile(file)); if (files.length) { event.preventDefault(); void uploadFiles(files) } }
const drop = (event: DragEvent) => { event.preventDefault(); dragDepth = 0; dragging.value = false; routeFiles(Array.from(event.dataTransfer?.files || [])) }
const dragEnter = () => { dragDepth++; dragging.value = true }
const dragLeave = () => { if (--dragDepth <= 0) { dragDepth = 0; dragging.value = false } }
const keydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save() }
  if (event.key === 'Escape') {
    event.stopPropagation()
    if (menuOpen.value) { menuOpen.value = false; return }
    if (fullscreen.value) { fullscreen.value = false; return }
    editor.close()
  }
}

const thumbs = ref<Record<string, string>>({})
let thumbEpoch = 0
watch(() => images.value.map((image) => image.fileId).join(':'), async () => {
  const epoch = ++thumbEpoch
  for (const image of images.value) {
    if (thumbs.value[image.fileId]) continue
    try { const url = await loadCommunityImage(image.fileId, () => epoch === thumbEpoch); if (url && epoch === thumbEpoch) thumbs.value[image.fileId] = url } catch { /* 缩略图失败不阻断编辑，发布后由画廊兜底。 */ }
  }
}, { immediate: true })
onBeforeUnmount(() => { thumbEpoch++; Object.values(thumbs.value).forEach((url) => URL.revokeObjectURL(url)) })

onMounted(() => {
  if (!contributionMode.value) return
  void loadCategories().then(() => {
    const contribution = form.value.contribution
    if (contribution && !contribution.categoryId) form.value.contribution = { ...contribution, categoryId: categories.value.find((item) => item.code === 'uncategorized')?.id }
  }).catch(() => {})
})
</script>
<template>
  <form class="community-editor" :class="{ 'is-fullscreen': fullscreen }" @submit.prevent="save()" @keydown="keydown" @paste="paste" @dragover.prevent @drop="drop">
    <CommunityDraftConflict />
    <header class="editor-head">
      <div class="editor-category">
        <button type="button" class="editor-category-toggle" :aria-expanded="menuOpen" aria-haspopup="listbox" :aria-label="contributionMode ? '选择资源分类' : '选择内容类型'" @click="menuOpen = !menuOpen">
          <span class="editor-category-chip" :class="activeCategory.coverClass" :style="activeCategory.coverClass ? undefined : { background: activeCategory.color }"><AppIcon :name="activeCategory.icon" :size="20" /></span>
          <strong>{{ activeCategory.label }}</strong>
          <AppIcon class="editor-category-caret" name="chevron-down" :size="14" />
        </button>
        <div v-if="menuOpen" class="editor-category-menu" role="listbox" :aria-label="contributionMode ? '资源分类' : '内容类型'">
          <button v-for="option in categoryOptions" :key="option.id" type="button" role="option" :aria-selected="option.id === activeCategory.id" @click="pickCategory(option)">
            <span class="editor-category-chip is-small" :class="option.coverClass" :style="option.coverClass ? undefined : { background: option.color }"><AppIcon :name="option.icon" :size="16" /></span>
            <span class="editor-category-text"><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
          </button>
        </div>
      </div>
      <input v-model="form.title" class="editor-title" maxlength="160" aria-label="标题" placeholder="在此输入您主题的标题…" autofocus />
    </header>
    <CommunityEditorToolbar :fullscreen-active="fullscreen" @action="onAction" />
    <input ref="imageInput" class="editor-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple @change="onPickImages" />
    <input ref="mdInput" class="editor-file-input" type="file" accept=".md,.markdown,.txt" multiple @change="onPickMarkdown" />
    <div class="editor-body" :class="{ 'is-dragging': dragging }" @dragenter="dragEnter" @dragleave="dragLeave">
      <textarea ref="textarea" v-model="body" maxlength="15000" aria-label="正文" placeholder="在此输入您的帖子内容，支持拖放图片和 .md 文件" />
      <div v-if="images.length" class="editor-images">
        <figure v-for="(image, index) in images" :key="image.fileId">
          <img v-if="thumbs[image.fileId]" :src="thumbs[image.fileId]" :alt="image.alt || '待发布的图片'" />
          <span v-else class="editor-image-wait">读取中…</span>
          <figcaption><input v-model="image.alt" :aria-label="`第 ${index + 1} 张图片说明`" maxlength="200" placeholder="图片说明（可选）" /><button type="button" class="text-link" @click="images.splice(index, 1)">移除</button></figcaption>
        </figure>
      </div>
      <p v-if="saving" class="editor-upload-state" role="status">正在处理图片或保存草稿…</p>
    </div>
    <div v-if="form.contribution && form.contribution.kind !== 'article'" class="editor-panel"><ResourceContributionFields /></div>
    <p v-if="error" role="alert" class="community-error">{{ error }}</p>
    <footer class="editor-actions">
      <div class="editor-actions-side">
        <RouterLink class="text-link" to="/community/drafts">草稿箱</RouterLink>
        <small role="status">{{ savedAt || 'Ctrl / ⌘ + Enter 发布' }}</small>
      </div>
      <div class="editor-actions-main">
        <label class="editor-visibility">可见范围<select v-model="form.visibility" aria-label="可见范围"><option value="public">登录社区用户</option><option value="school">仅同校用户</option></select></label>
        <button class="button secondary" type="button" :disabled="saving" @click="save(true)">存草稿</button>
        <button class="button primary" type="submit" :disabled="publishDisabled">{{ saving ? '正在保存…' : '发布' }}</button>
      </div>
    </footer>
    <p class="composer-privacy">仅发布你确认分享的内容；请勿包含私密笔记、完整成绩、实训日志或密钥。成就草稿不会自动公开。</p>
  </form>
</template>
