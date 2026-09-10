<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import CommunityInlineSuggestions from '../CommunityInlineSuggestions.vue'
import { DomEditor, SlateEditor, SlateElement, SlateNode, SlateRange, SlateTransforms } from '@wangeditor/editor'
import type { InlineEditorAdapter } from '../inlineEditor'
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor'
import { sanitizeRichHtml } from './sanitize'
import { richHtmlToBlocks, blocksToRichHtml } from './rich-blocks'
import { communityApi } from '../../services/api/community'
import { useCommunityDraft } from '../composables/useCommunityDraft'
import { useCommunityAccess } from '../composables/useCommunityAccess'
import { useAuthStore } from '../../stores/auth'
import { useCommunityStore } from '../../stores/community'

const root = ref<HTMLElement>()
const adapter: InlineEditorAdapter = {
  read() {
    const editor = editorRef.value, selection = editor?.selection
    if (!editor || !selection || !SlateRange.isCollapsed(selection) || !editor.isFocused()) return null
    if (SlateEditor.above(editor, { match: (node) => SlateElement.isElement(node) && ['link', 'code', 'pre'].includes((node as { type?: string }).type || '') })) return null
    const block = SlateEditor.above(editor, { match: (node) => SlateElement.isElement(node) && SlateEditor.isBlock(editor, node) })
    if (!block) return null
    const start = SlateEditor.start(editor, block[1])
    return { text: SlateNode.string(block[0]), caret: SlateEditor.string(editor, { anchor: start, focus: selection.anchor }).length, rect: DomEditor.toDOMRange(editor, selection).getBoundingClientRect() }
  },
  replace(start, end, text) {
    const editor = editorRef.value, selection = editor?.selection
    if (!editor || !selection || !current()) return
    const context = adapter.read()
    if (!context) return
    const anchor = SlateEditor.before(editor, selection.anchor, { distance: context.caret - start, unit: 'offset' })
    const focus = end === context.caret ? selection.anchor : SlateEditor.after(editor, selection.anchor, { distance: end - context.caret, unit: 'offset' })
    if (!anchor || !focus) return
    editor.focus(); SlateTransforms.select(editor, { anchor, focus })
    // 先让 Slate 完成选区事务，补全替换单独进入撤销记录。
    queueMicrotask(() => { if (current()) { editor.insertText(text); updateBlocks() } })
  },
}
const emit = defineEmits<{ change: [editor: IDomEditor] }>()
const editorRef = shallowRef<IDomEditor | null>(null), htmlValue = ref('')
const draft = useCommunityDraft(), auth = useAuthStore(), store = useCommunityStore()
const { requireWrite } = useCommunityAccess()
const imageIds = new Map<string, string>()
let disposed = false, lastBlocks = '', restoreVersion = 0
const hydrating = ref(false), uploads = new Set<AbortController>()
const owner = auth.user?.id, epoch = store.epoch, session = store.composerSession
const current = () => !disposed && store.composerOpen && owner === auth.user?.id && epoch === store.epoch && session === store.composerSession
const toolbarConfig: Partial<IToolbarConfig> = {
  toolbarKeys: ['bold', 'italic', 'headerSelect', 'numberedList', 'bulletedList', 'undo', 'redo', 'codeBlock', 'insertLink', 'uploadImage', 'insertTable', 'divider', 'emotion'],
}
const getSanitizedHtml = () => sanitizeRichHtml(editorRef.value?.getHtml() || '')
const updateBlocks = () => {
  if (hydrating.value || !current()) return
  try {
    const blocks = richHtmlToBlocks(getSanitizedHtml(), imageIds)
    lastBlocks = JSON.stringify(blocks)
    draft.richBlocks = blocks
    draft.richError = ''
  } catch (cause) { draft.richError = (cause as Error).message; draft.error = draft.richError }
}
const editorConfig: Partial<IEditorConfig> = {
  placeholder: '在此处输入您的帖子内容，拖放图像', scroll: true,
  hoverbarKeys: { image: { menuKeys: ['imageWidth30', 'imageWidth50', 'imageWidth100', 'deleteImage'] } },
  MENU_CONF: { uploadImage: {
    async customUpload(file: File, insertFn: (url: string, alt?: string) => void) {
      if (draft.saving || hydrating.value || uploads.size || !current() || !requireWrite('upload')) return
      if ((editorRef.value?.getHtml().match(/<img\s/g) || []).length >= 4) { draft.error = '图片最多 4 张'; return }
      const controller = new AbortController()
      uploads.add(controller)
      const release = draft.registerUpload(() => controller.abort())
      draft.error = ''
      try {
        const row = await communityApi.upload(file, { signal: controller.signal })
        if (!current() || controller.signal.aborted) return
        const url = URL.createObjectURL(file)
        imageIds.set(url, row.id)
        insertFn(url, file.name)
        updateBlocks()
      } catch (cause) { if (current() && !controller.signal.aborted) draft.error = cause instanceof Error ? cause.message : '图片上传失败，请重试' }
      finally { release(); uploads.delete(controller) }
    },
  } },
}
const restoreBlocks = async () => {
  if (!editorRef.value || JSON.stringify(draft.richBlocks || []) === lastBlocks) return
  const version = ++restoreVersion
  const active = () => current() && version === restoreVersion
  const release = draft.registerUpload(() => { restoreVersion++; hydrating.value = false })
  hydrating.value = true
  const blocks = JSON.parse(JSON.stringify(draft.richBlocks || [])) as NonNullable<typeof draft.richBlocks>
  try {
    const urls = new Map(Array.from(imageIds, ([url, id]) => [id, url]))
    for (const block of blocks) {
      if (block.type !== 'image' || urls.has(block.fileId)) continue
      const url = await communityApi.image(block.fileId)
      if (!active()) { URL.revokeObjectURL(url); return }
      urls.set(block.fileId, url); imageIds.set(url, block.fileId)
    }
    if (!active()) return
    editorRef.value.enable()
    editorRef.value.setHtml(blocksToRichHtml(blocks, urls))
    lastBlocks = JSON.stringify(blocks)
    draft.richError = ''
  } catch (cause) { if (active()) { draft.richError = '图片或草稿读取失败，请关闭后重试，原稿已保留'; draft.error = cause instanceof Error ? cause.message : draft.richError } }
  finally { release(); if (active()) hydrating.value = false }
}
const handleCreated = (editor: IDomEditor) => { editorRef.value = editor; void restoreBlocks() }
const customPaste = (_editor: IDomEditor, event: ClipboardEvent, callback: (allow: boolean) => void) => {
  try { richHtmlToBlocks(event.clipboardData?.getData('text/html') || '', imageIds); callback(true) }
  catch (cause) { draft.error = (cause as Error).message; callback(false) }
}
watch(() => draft.richBlocks, () => { void restoreBlocks() }, { deep: true })
watch(computed(() => draft.saving || hydrating.value), (busy) => busy ? editorRef.value?.disable() : editorRef.value?.enable())
watch(htmlValue, () => { if (editorRef.value) { updateBlocks(); emit('change', editorRef.value) } })
const replaceWithHtml = (html: string) => {
  if (!current() || hydrating.value || draft.saving) return
  const clean = sanitizeRichHtml(html)
  richHtmlToBlocks(clean, imageIds)
  editorRef.value?.setHtml(clean)
  updateBlocks()
}
onBeforeUnmount(() => {
  disposed = true
  restoreVersion++
  for (const controller of uploads) controller.abort()
  for (const url of imageIds.keys()) URL.revokeObjectURL(url)
  imageIds.clear()
  editorRef.value?.destroy()
  editorRef.value = null
})
defineExpose({ getSanitizedHtml, replaceWithHtml })
</script>

<template>
  <div ref="root" class="base-rich-editor">
    <CommunityInlineSuggestions :target="root" :adapter="adapter" />
    <Toolbar class="rich-toolbar" :editor="editorRef" :defaultConfig="toolbarConfig" mode="default" />
    <Editor class="rich-content" v-model="htmlValue" :defaultConfig="editorConfig" mode="default" @onCreated="handleCreated" @customPaste="customPaste" />
  </div>
</template>

<style scoped>
/* 浅色简约,贴合设计稿图2 */
.base-rich-editor {
  border: 1px solid var(--amc-border, #e6e0d8);
  border-radius: 0 0 10px 10px;
  background: #fff;
  overflow: hidden;
}
.rich-toolbar { border-bottom: 1px solid var(--amc-border, #e6e0d8); background: #fff; }
.rich-toolbar :deep(.w-e-toolbar) { background: #fff; padding: 4px 6px; }
.rich-content { min-height: 430px; }
.rich-content :deep(.w-e-text-container) { background: #fff; }
.rich-content :deep(.w-e-text-placeholder) { color: #a8a29b; font-style: normal; }
.rich-content :deep(.w-e-text-container [data-slate-editor]) { padding: 16px 18px; font-size: 14px; line-height: 1.8; color: #3d3a35; }
.rich-content :deep(img) { max-width: 100%; border-radius: 8px; margin: 6px 0; }
.rich-content :deep(pre) { background: #f7f5f2; border-radius: 8px; padding: 12px; }
</style>
