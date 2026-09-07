<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCommunityStore } from '../stores/community'
import { useAuthStore } from '../stores/auth'
import CommunityDraftConflict from './CommunityDraftConflict.vue'
import CommunityPostMenu from './CommunityPostMenu.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { useCommunityScrollRoot } from './composables/useCommunityScrollRoot'
import { loadCommunityImage } from './imageQueue'
import { markdownToHtml } from './markdown'
import { sanitizeCommunityHtml, communityHtmlToText } from '@ai-learning-hub/contracts'
import type { CommunityPostType } from '@ai-learning-hub/contracts'
const props = defineProps<{ dialog?: boolean }>()
const store = useCommunityStore(), auth = useAuthStore(), editor = useCommunityDraft(), panel = ref<HTMLElement>()
const scrollRoot = useCommunityScrollRoot()
const { form, body, images, saving, error, savedAt } = storeToRefs(editor)
const active = computed(() => store.composerOpen && store.composerMode === 'quick' && (props.dialog || store.composerInline))
const types: Array<[CommunityPostType, string, string]> = [['question', '提出问题', 'question'], ['note', '发布笔记', 'note-edit'], ['lab_result', '分享实训', 'lab-share'], ['project', '展示项目', 'project-folder']]
const board = computed(() => auth.user?.school || '学习社区')
const open = (type: CommunityPostType = 'general') => { if (active.value) form.value.type = type; else store.openComposer({ type }) }
const contentRoot = ref<HTMLElement>()
const syncBody = () => {
  const root = contentRoot.value
  if (!root) return
  editor.body = root.innerText.replace(/\n{3,}/g, '\n\n').trim()
  const clone = root.cloneNode(true) as HTMLElement
  clone.querySelectorAll('img[data-file-id]').forEach((img) => img.remove())
  const html = sanitizeCommunityHtml(clone.innerHTML)
  editor.richHtml = communityHtmlToText(html) ? html : ''
  const kept: Array<{ fileId: string; alt: string }> = []
  root.querySelectorAll<HTMLImageElement>('img[data-file-id]').forEach((img) => {
    const fileId = img.dataset.fileId
    if (fileId) kept.push({ fileId, alt: img.alt || '' })
  })
  const existing = new Set(images.value.map((image) => image.fileId))
  for (const image of kept) if (!existing.has(image.fileId)) images.value.push(image)
  images.value = images.value.filter((image) => kept.some((item) => item.fileId === image.fileId))
}
const focus = () => {
  if (!active.value) return
  const rect = panel.value?.getBoundingClientRect(), viewport = scrollRoot.value?.getBoundingClientRect()
  if (rect && viewport && (rect.bottom <= viewport.top || rect.top >= viewport.bottom)) scrollRoot.value?.scrollTo({ top: scrollRoot.value.scrollTop + rect.top - viewport.top - 120, behavior: 'smooth' })
  else if (rect && !viewport && (rect.bottom <= 0 || rect.top >= window.innerHeight)) panel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  contentRoot.value?.focus({ preventScroll: true })
}
const restoreBody = () => { const root = contentRoot.value; if (root) root.innerHTML = sanitizeCommunityHtml(editor.richHtml) }
watch(active, async (open) => { if (open) { await nextTick(); restoreBody(); focus() } })
const keydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void editor.save() }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editor.close() }
}
const exec = (command: string, value?: string) => {
  contentRoot.value?.focus()
  document.execCommand(command, false, value)
  syncBody()
}
const insertList = (ordered: boolean) => {
  exec(ordered ? 'insertOrderedList' : 'insertUnorderedList')
}
const formatBlock = (tag: 'h3' | 'p' | 'blockquote') => {
  if (!contentRoot.value) return
  contentRoot.value.focus()
  document.execCommand('formatBlock', false, tag === 'blockquote' ? 'blockquote' : tag)
  syncBody()
}
const paste = (event: ClipboardEvent) => { const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); handleFiles(files) } }
const drop = (event: DragEvent) => { event.preventDefault(); const files = Array.from(event.dataTransfer?.files || []); if (files.length) handleFiles(files) }
const applyMarkdown = async (file: File) => {
  try {
    const html = markdownToHtml(await file.text())
    if (!form.value.title?.trim()) form.value.title = file.name.replace(/\.(md|markdown)$/i, '')
    const root = contentRoot.value
    if (!root) return
    root.focus()
    document.execCommand('insertHTML', false, html)
    syncBody()
  } catch { error.value = 'Markdown 文件读取失败' }
}
const importMarkdown = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.md,.markdown,text/markdown,text/plain'; input.onchange = () => { if (input.files?.length) void applyMarkdown(input.files[0]) }; input.click() }
const handleFiles = (files: File[]) => {
  const markdown = files.find((file) => /\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown')
  if (markdown) void applyMarkdown(markdown)
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (imageFiles.length) void addImages(imageFiles)
}
const mdPasteOpen = ref(false), mdPasteText = ref(''), mdPasteArea = ref<HTMLTextAreaElement>()
const openMdPaste = async () => { mdPasteOpen.value = !mdPasteOpen.value; if (mdPasteOpen.value) { await nextTick(); mdPasteArea.value?.focus() } }
const applyMarkdownText = () => {
  const html = markdownToHtml(mdPasteText.value)
  mdPasteOpen.value = false
  mdPasteText.value = ''
  const root = contentRoot.value
  if (!html || !root) return
  root.focus()
  document.execCommand('insertHTML', false, html)
  syncBody()
}
const addImages = async (files: File[]) => {
  const before = images.value.length
  await editor.uploadFiles(files.filter((file) => file.type.startsWith('image/')))
  const added = images.value.slice(before)
  const root = contentRoot.value
  if (root) for (const image of added) {
    const img = document.createElement('img')
    img.dataset.fileId = image.fileId
    img.alt = image.alt || ''
    img.style.maxWidth = '100%'
    const holder = document.createElement('p')
    holder.appendChild(img)
    root.appendChild(holder)
    void loadCommunityImage(image.fileId, () => true).then((url) => { if (url && img.isConnected) img.src = url })
  }
  syncBody()
}
const insertImage = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.multiple = true; input.onchange = () => { if (input.files?.length) void addImages(Array.from(input.files)) }; input.click() }
const insertLink = () => { const url = window.prompt('输入链接地址'); if (url) exec('createLink', url) }
const insertTable = () => { const root = contentRoot.value; if (!root) return; root.focus(); const html = '<p><table border="1" cellpadding="4" cellspacing="0"><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table></p>'; document.execCommand('insertHTML', false, html); syncBody() }
const insertVote = () => { const root = contentRoot.value; if (!root) return; root.focus(); document.execCommand('insertHTML', false, '<p>【投票】<br /></p>'); syncBody() }
const insertCamera = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment'; input.onchange = () => { if (input.files?.length) void addImages(Array.from(input.files)) }; input.click() }
const insertAttachment = () => { const input = document.createElement('input'); input.type = 'file'; input.onchange = () => { if (input.files?.length) handleFiles(Array.from(input.files)) }; input.click() }
const insertEmoji = () => { const root = contentRoot.value; if (!root) return; root.focus(); document.execCommand('insertHTML', false, '😊'); syncBody() }
const insertCode = () => { const root = contentRoot.value; if (!root) return; root.focus(); document.execCommand('insertHTML', false, '<pre><code>在这里输入代码</code></pre>'); syncBody() }
onMounted(() => { window.addEventListener('community-composer-focus', focus); if (active.value) { restoreBody(); focus() } })
onBeforeUnmount(() => window.removeEventListener('community-composer-focus', focus))
</script>
<template>
  <section :id="dialog ? undefined : 'community-quick-composer'" ref="panel" class="community-quick-composer" :class="{ 'quick-dialog': dialog, 'quick-active': active }">
    <template v-if="!active">
      <button class="quick-prompt" @click="open()"><CommunityAvatar :src="auth.user?.avatarUrl" :username="auth.user?.username" :name="auth.user?.displayName || '学习者'" /><span>分享你今天学到的 AI 知识……</span></button>
      <div class="quick-types"><button v-for="[type, label, icon] in types" :key="type" :class="`quick-type-${type}`" @click="open(type)"><AppIcon :name="icon" :size="21" />{{ label }}</button><CommunityPostMenu label="更多发布类型"><template #trigger><AppIcon name="more-circle" :size="21" />更多</template><button type="button" role="menuitem" @click="open('general')">普通交流</button><button type="button" role="menuitem" @click="open('frontier_discussion')">前沿讨论</button></CommunityPostMenu></div>
    </template>
    <form v-else class="inline-composer" @submit.prevent="editor.save()" @keydown="keydown" @paste="paste" @dragover.prevent @drop="drop">
      <CommunityDraftConflict />
      <header class="inline-composer-top">
        <span class="inline-composer-board">{{ board }}</span>
        <input v-model="form.title" maxlength="160" aria-label="标题" placeholder="输入标题（选填）" />
        <button class="icon-button" type="button" aria-label="收起编辑器" @click="editor.close()"><AppIcon name="close" :size="18" /></button>
      </header>
      <div class="inline-composer-toolbar" role="toolbar" aria-label="正文格式工具栏">
        <button type="button" aria-label="加粗" title="加粗" @click="exec('bold')"><strong>B</strong></button>
        <button type="button" aria-label="斜体" title="斜体" @click="exec('italic')"><em>I</em></button>
        <button type="button" aria-label="标题" title="标题" @click="formatBlock('h3')">H</button>
        <button type="button" aria-label="有序列表" title="有序列表" @click="insertList(true)">1.</button>
        <button type="button" aria-label="无序列表" title="无序列表" @click="insertList(false)">•</button>
        <button type="button" aria-label="删除线" title="删除线" @click="exec('strikeThrough')"><s>S</s></button>
        <button type="button" aria-label="代码" title="代码" @click="insertCode">&lt;/&gt;</button>
        <button type="button" aria-label="链接" title="链接" @click="insertLink">🔗</button>
        <button type="button" aria-label="图片" title="图片" @click="insertImage"><AppIcon name="image" :size="17" /></button>
        <button type="button" aria-label="表格" title="表格" @click="insertTable">▦</button>
        <button type="button" aria-label="投票" title="投票" @click="insertVote">✓</button>
        <button type="button" aria-label="相机" title="相机" @click="insertCamera">📷</button>
        <button type="button" aria-label="附件" title="附件" @click="insertAttachment">📎</button>
        <button type="button" class="md-chip" aria-label="导入 Markdown 文件" title="导入 .md 文件" @click="importMarkdown">M↓</button>
        <button type="button" aria-label="粘贴 Markdown 文本" title="粘贴 Markdown 文本导入" @click="openMdPaste">📋</button>
        <button type="button" aria-label="表情" title="表情" @click="insertEmoji">😊</button>
      </div>
      <div v-if="mdPasteOpen" class="inline-composer-md-paste">
        <textarea ref="mdPasteArea" v-model="mdPasteText" rows="6" aria-label="Markdown 文本" placeholder="粘贴 Markdown 文本，导入后转为富文本" @keydown.stop></textarea>
        <div class="inline-composer-md-paste-actions"><button class="text-link" type="button" @click="mdPasteOpen = false; mdPasteText = ''">取消</button><button class="button primary small" type="button" @click="applyMarkdownText">导入</button></div>
      </div>
      <div ref="contentRoot" class="inline-composer-content" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="在此处输入您的帖子内容，拖放图像" @input="syncBody" @blur="syncBody"></div>
      <p v-if="error" class="community-error" role="alert">{{ error }}</p>
      <footer class="inline-composer-footer"><span class="inline-composer-hint">{{ images.length ? `${images.length} 张图片` : '' }}</span><button class="text-link" type="button" @click="editor.close()">取消</button><button class="button primary small" type="submit" :disabled="saving">{{ saving ? '保存中…' : '发布' }}</button></footer>
      <div class="quick-save-state"><small role="status">{{ savedAt || 'Ctrl / ⌘ + Enter 发布' }}</small></div>
    </form>
  </section>
</template>