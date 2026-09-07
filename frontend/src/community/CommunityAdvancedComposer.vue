<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { CommunityPostType } from '@ai-learning-hub/contracts'
import { useCommunityStore } from '../stores/community'
import { useAuthStore } from '../stores/auth'
import { useCommunityDraft } from './composables/useCommunityDraft'
import CommunityBlocks from './CommunityBlocks.vue'
import CommunityComposerTools from './CommunityComposerTools.vue'
import CommunityDraftConflict from './CommunityDraftConflict.vue'
import { postLabels } from './labels'
const editor = useCommunityDraft(), store = useCommunityStore(), auth = useAuthStore()
const { form, body, code, language, quote, preview, saving, error, blocks, advanced, savedAt, autoSaveEnabled } = storeToRefs(editor)
const { save } = editor
const paste = (event: ClipboardEvent) => { const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); void editor.uploadFiles(files) } }
const dragOver = ref(false)
const drop = (event: DragEvent) => {
  event.preventDefault(); dragOver.value = false
  const files = Array.from(event.dataTransfer?.files || [])
  const images = files.filter((file) => file.type.startsWith('image/'))
  const docs = files.filter((file) => /\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown')
  if (files.length - images.length - docs.length) error.value = '支持拖入图片与 Markdown 文件'
  if (images.length) void editor.uploadFiles(images)
  void (async () => { for (const doc of docs) await importMarkdown(doc) })()
}
const importMarkdown = async (file: File) => {
  if (saving.value) { error.value = '正在保存或上传，请完成后再导入'; return }
  const raw = await file.text().catch(() => '')
  if (!raw.trim()) { error.value = `${file.name} 不是有效的 Markdown 文本`; return }
  let text = raw.replace(/\r\n/g, '\n')
  const titleMatch = /^#\s+(.+)$/m.exec(text)
  if (titleMatch && !form.value.title?.trim()) { form.value.title = titleMatch[1].trim().slice(0, 160); text = text.replace(titleMatch[0], '').trimStart() }
  const codes: Array<{ lang: string; code: string }> = []
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match: string, lang: string, block: string) => { codes.push({ lang: lang.trim() || 'text', code: block.replace(/\n$/, '') }); return '' })
  if (codes.length && !code.value.trim()) { language.value = codes[0].lang; code.value = codes.map((item) => item.code).join('\n\n').slice(0, 12000); codeOpen.value = true }
  const quoteLines = text.split('\n').filter((line) => line.startsWith('> ')).map((line) => line.slice(2))
  if (quoteLines.length && !quote.value.trim()) quote.value = quoteLines.join('\n').slice(0, 2000)
  text = text.split('\n').filter((line) => !line.startsWith('> ')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text.trim() && !codes.length) { error.value = `${file.name} 没有可导入的内容`; return }
  const room = Math.max(0, 15000 - body.value.length - (body.value ? 2 : 0))
  const chunk = text.slice(0, room)
  body.value = body.value ? `${body.value}\n\n${chunk}` : chunk
  savedAt.value = text.length > room ? `已导入 ${file.name}（超出长度限制部分截断）` : `已导入 ${file.name}`
}
const area = ref<HTMLTextAreaElement>()
const focusArea = (start: number, end: number) => { void nextTick(() => { const el = area.value; if (!el) return; el.focus(); el.setSelectionRange(start, end) }) }
const surround = (prefix: string, suffix: string, placeholder: string) => {
  const el = area.value; if (!el) return
  const start = el.selectionStart ?? body.value.length, end = el.selectionEnd ?? start
  const selected = body.value.slice(start, end) || placeholder
  body.value = `${body.value.slice(0, start)}${prefix}${selected}${suffix}${body.value.slice(end)}`
  focusArea(start + prefix.length, start + prefix.length + selected.length)
}
const insertText = (text: string) => {
  const el = area.value; if (!el) return
  const start = el.selectionStart ?? body.value.length
  body.value = `${body.value.slice(0, start)}${text}${body.value.slice(start)}`
  focusArea(start + text.length, start + text.length)
}
const setHeadingLevel = (level: number) => {
  const el = area.value; if (!el) return
  const value = body.value, start = el.selectionStart ?? 0
  const from = value.lastIndexOf('\n', start - 1) + 1
  const to = value.indexOf('\n', start) === -1 ? value.length : value.indexOf('\n', start)
  const line = value.slice(from, to), bare = line.replace(/^#{1,3}\s+/, '')
  const prefix = level === 0 ? '' : `${'#'.repeat(level)} `
  body.value = `${value.slice(0, from)}${prefix}${bare}${value.slice(to)}`
  focusArea(from + prefix.length, from + prefix.length + bare.length)
}
const headingValue = ref('0')
const applyHeading = () => { const level = Number(headingValue.value); headingValue.value = '0'; if (level > 0) setHeadingLevel(level) }
const toggleList = (ordered: boolean) => {
  const el = area.value; if (!el) return
  const value = body.value, start = el.selectionStart ?? 0, end = el.selectionEnd ?? start
  const from = value.lastIndexOf('\n', start - 1) + 1
  const to = value.indexOf('\n', end) === -1 ? value.length : value.indexOf('\n', end)
  const lines = (value.slice(from, to) || '').split('\n')
  const pattern = ordered ? /^\d+[.、]\s*/ : /^[-*]\s*/, other = ordered ? /^[-*]\s*/ : /^\d+[.、]\s*/
  const all = lines.length > 0 && lines.every((line) => line.trim() && pattern.test(line))
  const next = lines.map((line, index) => {
    if (all) return line.replace(pattern, '')
    if (!line.trim()) return line
    const bare = line.replace(other, '')
    return ordered ? `${index + 1}. ${bare}` : `- ${bare}`
  }).join('\n')
  body.value = `${value.slice(0, from)}${next}${value.slice(to)}`
  focusArea(from, from + next.length)
}
const insertLink = () => {
  const el = area.value; if (!el) return
  const start = el.selectionStart ?? 0, end = el.selectionEnd ?? start
  const selected = body.value.slice(start, end) || '链接文字'
  const url = window.prompt('输入链接地址', 'https://')
  if (!url) return
  body.value = `${body.value.slice(0, start)}[${selected}](${url})${body.value.slice(end)}`
}
const insertHr = () => insertText('\n---\n')
const tableOpen = ref(false)
const insertTable = (rows: number, cols: number) => {
  const head = Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(' | ')
  const sep = Array.from({ length: cols }, () => '---').join(' | ')
  const row = Array.from({ length: cols }, () => '内容').join(' | ')
  insertText(`\n| ${head} |\n| ${sep} |\n${Array.from({ length: rows }, () => row).join('\n')} |\n`)
  tableOpen.value = false
}
/* 撤销 / 重做：正文快照历史 */
let histTimer: ReturnType<typeof setTimeout> | undefined
const history = ref<string[]>([body.value]), historyIndex = ref(0), histSuppress = ref(false)
watch(body, () => {
  if (histSuppress.value) return
  clearTimeout(histTimer)
  histTimer = setTimeout(() => {
    const current = body.value
    if (history.value[historyIndex.value] === current) return
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push(current)
    if (history.value.length > 120) history.value.shift()
    historyIndex.value = history.value.length - 1
  }, 350)
})
const timeTravel = (step: number) => {
  const target = historyIndex.value + step
  if (target < 0 || target >= history.value.length) return
  histSuppress.value = true
  historyIndex.value = target
  body.value = history.value[target]
  void nextTick(() => { histSuppress.value = false })
}
const undo = () => timeTravel(-1)
const redo = () => timeTravel(1)
const codeOpen = ref(false), emojiOpen = ref(false), livePreview = ref(true)
const imageInput = ref<HTMLInputElement>(), cameraInput = ref<HTMLInputElement>(), fileInput = ref<HTMLInputElement>()
const EMOJIS = ['😀', '😄', '😂', '🤔', '😅', '😍', '😎', '😭', '🤯', '👍', '👏', '🙏', '💪', '🤝', '🔥', '✨', '🎉', '❤️', '✅', '❌', '⚠️', '💡', '📚', '🚀', '🤖', '🧠', '🎯', '📌', '📝', '🎓']
const onPick = (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  const images = files.filter((file) => file.type.startsWith('image/'))
  const docs = files.filter((file) => /\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown')
  if (files.length - images.length - docs.length) error.value = '仅支持图片与 Markdown 文件，已忽略其他文件'
  if (images.length) void editor.uploadFiles(images)
  target.value = ''
  void (async () => { for (const doc of docs) await importMarkdown(doc) })()
}
const addEmoji = (emoji: string) => { insertText(emoji); emojiOpen.value = false }
const mdInput = ref<HTMLInputElement>()
const onPickMd = (event: Event) => {
  const target = event.target as HTMLInputElement
  const docs = Array.from(target.files || []).filter((file) => /\.(md|markdown)$/i.test(file.name) || file.type === 'text/markdown')
  if (!docs.length) error.value = '请选择 .md 或 .markdown 文件'
  target.value = ''
  void (async () => { for (const doc of docs) await importMarkdown(doc) })()
}
const exportMarkdown = () => {
  const parts: string[] = []
  if (form.value.title?.trim()) parts.push(`# ${form.value.title.trim()}`, '')
  if (body.value.trim()) parts.push(body.value.trimEnd(), '')
  if (quote.value.trim()) parts.push(quote.value.trim().split('\n').map((line) => `> ${line}`).join('\n'), '')
  if (code.value.trim()) parts.push('```' + (language.value || 'text') + '\n' + code.value.trimEnd() + '\n```', '')
  const content = parts.join('\n').trimEnd() + '\n'
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  anchor.href = url
  anchor.download = `${(form.value.title?.trim() || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}-${stamp}.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  savedAt.value = '已导出 Markdown 文件'
}
const keydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void editor.save() }
  else if (event.key === 'Escape') { event.stopPropagation(); editor.close() }
  else if ((event.ctrlKey || event.metaKey) && (event.key === 'b' || event.key === 'i') && event.target === area.value) { event.preventDefault(); if (event.key === 'b') surround('**', '**', '加粗文字'); else surround('*', '*', '斜体文字') }
}
const tools = ref({ binding: false, topics: false })
onMounted(() => { history.value = [body.value]; historyIndex.value = 0 })
</script>
<template>
  <form class="dialog-form composer-form lite-composer" @submit.prevent="save()" @keydown="keydown" @paste="paste" @dragover.prevent @drop="drop">
    <CommunityDraftConflict />
    <header class="composer-mobile-top"><button type="button" class="text-link" @click="editor.close()">取消</button><select v-model="form.type" aria-label="发布内容类型"><option v-for="(label, type) in postLabels" :key="type" :value="type">{{ label }}</option></select><button class="button primary small" type="submit" :disabled="saving">{{ saving ? '保存中…' : '发布' }}</button></header>
    <div class="lite-editor" :class="{ dragover: dragOver }">
      <div class="lite-head">
        <label class="lite-category"><select v-model="form.type" aria-label="内容分类"><option v-for="(label, type) in postLabels" :key="type" :value="type as CommunityPostType">{{ label }}</option></select></label>
        <input v-model="form.title" class="lite-title" maxlength="160" placeholder="在此输入您主题的标题..." aria-label="标题" />
      </div>
      <div class="lite-toolbar" role="toolbar" aria-label="富文本工具栏">
        <button type="button" class="lite-glyph" title="加粗 (Ctrl+B)" @mousedown.prevent @click="surround('**', '**', '加粗文字')"><strong>B</strong></button>
        <button type="button" class="lite-glyph" title="斜体 (Ctrl+I)" @mousedown.prevent @click="surround('*', '*', '斜体文字')"><em>I</em></button>
        <select v-model="headingValue" class="lite-heading" title="标题级别" @change="applyHeading"><option value="0">正文</option><option value="1">标题 1</option><option value="2">标题 2</option><option value="3">标题 3</option></select>
        <button type="button" title="有序列表" @mousedown.prevent @click="toggleList(true)"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" /><text x="2.2" y="8.4" font-size="8" fill="currentColor" stroke="none" font-family="Georgia, serif">1</text><text x="2.2" y="14.6" font-size="8" fill="currentColor" stroke="none" font-family="Georgia, serif">2</text><text x="2.2" y="20.8" font-size="8" fill="currentColor" stroke="none" font-family="Georgia, serif">3</text></svg></button>
        <button type="button" title="无序列表" @mousedown.prevent @click="toggleList(false)"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="10" y1="6" x2="20" y2="6" /><line x1="10" y1="12" x2="20" y2="12" /><line x1="10" y1="18" x2="20" y2="18" /><circle cx="4.8" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="4.8" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="4.8" cy="18" r="1.3" fill="currentColor" stroke="none" /></svg></button>
        <button type="button" title="撤销" :disabled="historyIndex <= 0" @mousedown.prevent @click="undo"><svg class="app-icon" width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M452.266667 413.866667V305.066667a25.173333 25.173333 0 0 0-40.106667-20.906667L145.066667 469.333333a25.6 25.6 0 0 0 0 42.666667l267.093333 186.453333a25.6 25.6 0 0 0 40.106667-21.333333V610.133333a25.6 25.6 0 0 1 26.88-25.6 341.333333 341.333333 0 0 1 301.653333 263.68 336.64 336.64 0 0 0-304.213333-409.173333 25.173333 25.173333 0 0 1-24.32-25.173333z" /></svg></button>
        <button type="button" title="重做" :disabled="historyIndex >= history.length - 1" @mousedown.prevent @click="redo"><svg class="app-icon" width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M594.944 321.024V153.6L921.6 450.048l-326.656 296.448v-179.2c-90.624 0-371.2 0-492.544 277.504v-30.72c0-123.392 120.832-519.168 492.544-493.056z m0 0" /></svg></button>
        <button type="button" :class="{ on: codeOpen }" title="代码块 / 引用" @mousedown.prevent @click="codeOpen = !codeOpen"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></button>
        <button type="button" title="插入链接" @mousedown.prevent @click="insertLink"><svg class="app-icon" width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M490.057143 863.085714c-80.457143 80.457143-241.371429 80.457143-329.142857 0-43.885714-43.885714-65.828571-102.4-65.828572-168.228571 0-58.514286 21.942857-117.028571 65.828572-168.228572l117.028571-117.028571-65.828571-51.2-117.028572 117.028571C36.571429 533.942857 0 621.714286 0 702.171429s36.571429 168.228571 95.085714 226.742857 146.285714 80.457143 226.742857 80.457143 168.228571-36.571429 226.742858-95.085715l117.028571-117.028571-65.828571-58.514286-109.714286 124.342857zM928.914286 95.085714c-117.028571-117.028571-329.142857-117.028571-446.171429 0L365.714286 212.114286l58.514285 58.514285 117.028572-117.028571c80.457143-80.457143 241.371429-80.457143 329.142857 0 43.885714 43.885714 65.828571 102.4 65.828571 168.228571s-21.942857 117.028571-65.828571 168.228572l-117.028571 109.714286 58.514285 58.514285 117.028572-117.028571c58.514286-58.514286 95.085714-146.285714 95.085714-226.742857s-36.571429-160.914286-95.085714-219.428572z" /><path fill="currentColor" d="M352.768 615.862857L626.834286 341.869714l56.905143 56.905143L409.6 672.841143z" /></svg></button>
        <button type="button" title="插入图片" @mousedown.prevent @click="imageInput?.click()"><svg class="app-icon" width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M777.244444 345.0176c0 26.635378-21.592178 48.226844-48.227556 48.226844l-0.255289 0c-26.635378 0-48.227556-21.592178-48.227556-48.226844l0-0.256711c0-26.635378 21.592178-48.226844 48.227556-48.226844l0.255289 0c26.635378 0 48.227556 21.592178 48.227556 48.226844L777.244444 345.0176z" /><path fill="currentColor" d="M798.577778 193.422222l187.022222 0 0 44.8-187.022222 0 0-44.8Z" /><path fill="currentColor" d="M868.977778 122.311111l44.8 0 0 187.022222-44.8 0 0-187.022222Z" /><path fill="currentColor" d="M913.066667 856.940089 913.066667 438.755556l-41.955556 0 0 361.441422L599.657244 433.065956l-165.4784 89.891556-66.388622-89.8496L93.155556 582.2784 93.155556 236.8l581.688889 0 0-42.666667L51.2 194.133333l0 410.934044L51.2 835.555556l0 22.044444 574.712178 0L913.066667 857.6l0.487822 0L913.066667 856.940089zM586.801067 491.032178 824.713956 812.8 648.507022 812.8 461.112178 559.3088 586.801067 491.032178zM96 815.644444 96 631.716267 354.921956 491.079111l54.8544 74.239289 0.042667-0.031289L594.896356 815.644444 96 815.644444z" /></svg></button>
        <span class="lite-menu-holder">
          <button type="button" :class="{ on: tableOpen }" title="插入表格" @mousedown.prevent @click="tableOpen = !tableOpen"><svg class="app-icon" width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M512 593.92h57.344V655.36c0 12.288 12.288 24.576 24.576 24.576s24.576-12.288 24.576-24.576v-57.344H675.84c12.288 0 24.576-12.288 24.576-24.576s-12.288-24.576-24.576-24.576h-57.344V491.52c0-12.288-12.288-24.576-24.576-24.576s-24.576 12.288-24.576 24.576v57.344H512c-12.288 0-24.576 12.288-24.576 24.576s12.288 20.48 24.576 20.48z" /><path fill="currentColor" d="M708.608 217.088H315.392c-53.248 0-94.208 40.96-94.208 94.208v372.736C221.184 737.28 266.24 778.24 315.392 778.24h389.12c53.248 0 94.208-40.96 94.208-94.208V311.296c4.096-53.248-40.96-94.208-90.112-94.208zM389.12 733.184H315.392c-24.576 0-49.152-20.48-49.152-49.152v-94.208h122.88v143.36z m0-188.416H270.336v-126.976H389.12v126.976z m364.544 139.264c0 24.576-20.48 49.152-49.152 49.152h-270.336v-315.392h319.488v266.24z m0-311.296H270.336V311.296c0-24.576 20.48-49.152 49.152-49.152h389.12c24.576 0 49.152 20.48 49.152 49.152v61.44z" /></svg></button>
          <div v-if="tableOpen" class="lite-menu"><button type="button" @mousedown.prevent @click="insertTable(3, 3)">3 列 × 3 行</button><button type="button" @mousedown.prevent @click="insertTable(4, 2)">4 列 × 2 行</button></div>
        </span>
        <button type="button" title="分割线" @mousedown.prevent @click="insertHr"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12" /><circle cx="7" cy="12" r="0.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="0.5" fill="currentColor" stroke="none" /><circle cx="17" cy="12" r="0.5" fill="currentColor" stroke="none" /></svg></button>
        <button type="button" :class="{ on: emojiOpen }" title="表情" @mousedown.prevent @click="emojiOpen = !emojiOpen"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8.5" /><path d="M7.8 13.3s1.2 1.7 3.2 1.7 3.2-1.7 3.2-1.7" /><circle cx="8.6" cy="9" r="0.8" fill="currentColor" stroke="none" /><circle cx="13.4" cy="9" r="0.8" fill="currentColor" stroke="none" /><path d="M21.5 18.5l-2.2 3h4.4z" fill="currentColor" stroke="none" /></svg></button>
        <button type="button" title="拍照上传" @mousedown.prevent @click="cameraInput?.click()"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg></button>
        <button type="button" title="附件（图片 / Markdown）" @mousedown.prevent @click="fileInput?.click()"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg></button>
        <button type="button" class="lite-eye" :class="{ on: livePreview }" title="实时预览开关" @mousedown.prevent @click="livePreview = !livePreview"><svg class="app-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg></button>
      </div>
      <div v-if="codeOpen" class="lite-code-panel">
        <label>代码语言<input v-model="language" maxlength="30" placeholder="text / js / python…" /></label>
        <label>代码块（仅展示，不执行）<textarea v-model="code" rows="4" maxlength="12000" placeholder="粘贴代码…" /></label>
        <label>引用<textarea v-model="quote" rows="2" maxlength="2000" placeholder="引用一段重要的话…" /></label>
      </div>
      <textarea ref="area" v-model="body" class="lite-body" rows="12" maxlength="15000" placeholder="在此处输入您的帖子内容，拖放图像" aria-label="正文" @dragenter.prevent="dragOver = true" @dragleave="dragOver = false"></textarea>
      <div v-if="emojiOpen" class="lite-emoji"><button v-for="emoji in EMOJIS" :key="emoji" type="button" @mousedown.prevent @click="addEmoji(emoji)">{{ emoji }}</button></div>
      <div v-if="livePreview" class="lite-live"><small>实时预览</small><CommunityBlocks :blocks="blocks" /></div>
      <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="onPick" />
      <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="onPick" />
      <input ref="fileInput" type="file" accept="image/*,.md,.markdown" multiple hidden @change="onPick" />
      <input ref="mdInput" type="file" accept=".md,.markdown" multiple hidden @change="onPickMd" />
    </div>
    <CommunityBlocks v-if="preview" :blocks="blocks" />
    <details @toggle="tools.binding = ($event.target as HTMLDetailsElement).open"><summary>添加学习关联（{{ advanced ? 8 : 1 }} 项）</summary><CommunityComposerTools v-if="tools.binding" panel="binding" /></details>
    <details @toggle="tools.topics = ($event.target as HTMLDetailsElement).open"><summary>设置话题</summary><CommunityComposerTools v-if="tools.topics" panel="topics" /></details>
    <p v-if="auth.dataMode === 'mock'" class="community-notice">演示图片仅保存在当前浏览器会话，不代表真实上传。</p><p class="composer-privacy">仅发布你确认分享的内容；请勿包含私密笔记、完整成绩、实训日志或密钥。成就草稿不会自动公开。</p><p v-if="error" role="alert" class="community-error">{{ error }}</p>
    <p v-if="savedAt" role="status" class="muted">{{ savedAt }}</p>
    <div class="composer-actions">
      <div class="composer-actions-left">
        <button class="text-link" type="button" title="选择本地 .md 文件导入到编辑器" @click="mdInput?.click()">导入 MD</button>
        <button class="text-link" type="button" title="把当前内容导出为 .md 文件" @click="exportMarkdown">导出 MD</button>
        <button v-if="!advanced" class="text-link" type="button" @click="store.composerMode = 'advanced'; store.composerInline = false">高级编辑</button>
        <button type="button" class="composer-autosave" :class="{ off: !autoSaveEnabled }" :title="autoSaveEnabled ? '点击关闭自动保存' : '点击开启自动保存'" @click="autoSaveEnabled = !autoSaveEnabled">{{ autoSaveEnabled ? '自动保存已开启' : '自动保存已关闭' }}</button>
      </div>
      <button class="button secondary" type="button" @click="preview = !preview">{{ preview ? '继续编辑' : '发布预览' }}</button>
      <button class="button secondary" type="button" :disabled="saving" @click="save(true)">保存草稿</button>
      <button class="button primary" type="submit" :disabled="saving">{{ saving ? '正在保存…' : '确认发布' }}</button>
    </div>
  </form>
</template>
