<script setup lang="ts">
/**
 * RichEditPanel —— 悬浮窗式富文本编辑面板(设计稿图2 的窗口版)
 *
 * 交互:资源中心点「写图文」→ 当前页面弹出本悬浮窗(不跳路由,数据不离开页面)。
 * 布局:标题栏(徽标 + 标题输入框)→ 工具栏 → 编辑区 → 底部[导入/导出 Markdown][字数][取消][保存返回]。
 *
 * 可靠性设计:
 * 1. 关闭守卫:✕ / Esc / 取消 时如有未保存内容,先弹确认(AppDialog 的 beforeClose 钩子);
 * 2. 自动草稿:打开期间每 5 秒把标题+内容写入 localStorage,下次打开询问恢复;保存成功后清除;
 * 3. Markdown 导入/导出:双向互通(markdown-convert.ts,导入后过 XSS 白名单)。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import AppDialog from '../../components/base/AppDialog.vue'
import AppIcon from '../../components/base/AppIcon.vue'
import BaseRichEditor from './BaseRichEditor.vue'
import { sanitizeRichHtml } from './sanitize'
import { mdToHtml, htmlToMarkdown } from './markdown-convert'
import type { IDomEditor } from '@wangeditor/editor'
import type { RichEditResult } from './coop-types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 保存返回:携带标题、净化后的完整 HTML、图片信息 */
  save: [result: RichEditResult]
}>()

const title = ref('')
const richRef = ref<InstanceType<typeof BaseRichEditor> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const wordCount = ref(0) // 实时字数(去空白字符)

// ===== 3. 防丢保护:自动草稿(localStorage) =====
const DRAFT_KEY = 'resource-hub:rich-edit-draft:v1'
interface RichDraft { title: string; html: string; savedAt: number }
let draftTimer: number | undefined
let bypassClose = false // 保存时置 true,跳过关闭守卫
const pendingRestore = ref<RichDraft | null>(null)

/** 当前面板里是否有实质内容(标题/正文/图片任一) */
const hasContent = (): boolean => {
  if (title.value.trim()) return true
  if ((richRef.value?.countImages() ?? 0) > 0) return true
  const html = (richRef.value?.getSanitizedHtml() ?? '').replace(/<p><br><\/p>/g, '').trim()
  return !!html
}
const readDraft = (): RichDraft | null => {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? JSON.parse(raw) as RichDraft : null } catch { return null }
}
const removeDraft = () => { try { localStorage.removeItem(DRAFT_KEY) } catch { /* 忽略 */ } }
/** 写入自动草稿(打开期间每 5 秒调用;无内容时清除陈旧草稿) */
const writeDraft = () => {
  if (!props.modelValue) return
  if (!hasContent()) { removeDraft(); return }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: title.value, html: richRef.value?.getSanitizedHtml() ?? '', savedAt: Date.now() } as RichDraft))
  } catch { /* localStorage 满时静默跳过(草稿属额外保障,不阻塞编辑) */ }
}
const onBeforeUnload = () => { if (props.modelValue) writeDraft() }

// 打开/关闭:启停自动草稿定时器 + 关闭页面前兜底保存
watch(() => props.modelValue, (open) => {
  if (open) {
    bypassClose = false
    pendingRestore.value = readDraft() // 编辑器创建后询问恢复(见 onEditorCreated)
    draftTimer = window.setInterval(writeDraft, 5000)
    window.addEventListener('beforeunload', onBeforeUnload)
  } else {
    window.clearInterval(draftTimer)
    window.removeEventListener('beforeunload', onBeforeUnload)
  }
})
onBeforeUnmount(() => { window.clearInterval(draftTimer); window.removeEventListener('beforeunload', onBeforeUnload) })

/** 编辑器创建完成(每次打开都是新实例):如有草稿,询问是否恢复 */
const onEditorCreated = () => {
  const draft = pendingRestore.value
  pendingRestore.value = null
  if (draft && (draft.title.trim() || draft.html.replace(/<p><br><\/p>/g, '').trim())) {
    const time = new Date(draft.savedAt).toLocaleString('zh-CN')
    if (window.confirm(`检测到 ${time} 的未保存草稿,是否恢复?`)) {
      title.value = draft.title
      richRef.value?.replaceWithHtml(draft.html)
    }
  }
}

/** 关闭守卫:有未保存内容时先确认(✕/Esc/取消 都会经过这里) */
const guardClose = (): boolean => {
  if (bypassClose || !hasContent()) return true
  return window.confirm('编辑内容尚未保存,确定关闭?(草稿已自动保存,下次打开可恢复)')
}

// ===== 字数统计(去空白字符) =====
const onEditorChange = (editor: IDomEditor) => {
  wordCount.value = editor.getText().replace(/\s+/g, '').length
}

// ===== Markdown 导入 =====
/** 「导入 Markdown」:校验 → 读取 → 转换 → 替换编辑器内容 */
const onImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 清空,允许重复选择同一文件
  if (!file) return
  if (!/\.(md|markdown|txt)$/i.test(file.name)) { window.alert('请选择 .md / .markdown / .txt 文件'); return }
  if (file.size > 2 * 1024 * 1024) { window.alert('Markdown 文件不能超过 2MB'); return }
  if (hasContent() && !window.confirm('导入 Markdown 会替换当前编辑器内容,确定继续?')) return
  importing.value = true
  try {
    const text = await file.text()
    // 转换后的 HTML 再过一遍白名单,确保导入内容安全
    const html = sanitizeRichHtml(mdToHtml(text))
    richRef.value?.replaceWithHtml(html)
  } catch { window.alert('导入失败,请重试') } finally { importing.value = false }
}

// ===== Markdown 导出 =====
/** 「导出 Markdown」:编辑器 HTML → Markdown → 下载 .md 文件 */
const exportMarkdown = () => {
  const html = richRef.value?.getSanitizedHtml() ?? ''
  const markdown = htmlToMarkdown(html)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  link.href = url
  // 文件名:标题(去掉非法字符)+ 日期
  link.download = `${(title.value.trim() || '图文创作').replace(/[\\/:*?"<>|]+/g, '-')}-${stamp}.md`
  link.click()
  URL.revokeObjectURL(url)
}

/** 从 HTML 提取图片信息(带回宿主页) */
const extractImages = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('img')).map((img) => ({
    name: img.getAttribute('alt') || '图片',
    url: img.getAttribute('src') || '',
  }))
}

/** 【保存返回】:取净化后的完整 HTML,连同标题、图片交给宿主页;并清除草稿 */
const save = () => {
  bypassClose = true // 保存属于主动关闭,跳过守卫
  const html = richRef.value?.getSanitizedHtml() ?? ''
  removeDraft() // 已保存,草稿使命完成
  emit('save', { title: title.value.trim(), html, images: extractImages(html) })
}

/** 【取消】:有内容时先确认,确认后关闭(草稿保留,可下次恢复) */
const cancel = () => {
  if (!guardClose()) return
  emit('update:modelValue', false)
}
</script>

<template>
  <AppDialog v-model="props.modelValue" title="写图文" class="rich-panel-dialog" :close-on-backdrop="false" :before-close="guardClose">
    <div class="rich-panel">
      <!-- 顶部:徽标 + 标题 -->
      <header class="rich-edit-head">
        <span class="rich-edit-chip"><AppIcon name="edit" :size="13" />图文分享</span>
        <input
          v-model="title"
          class="rich-edit-title"
          type="text"
          placeholder="在此输入您主题的标题..."
          maxlength="120"
        />
        <!-- 隐藏的文件选择器(.md/.markdown/.txt) -->
        <input ref="fileInput" class="rich-import-input" type="file" accept=".md,.markdown,.txt" @change="onImportFile" />
      </header>

      <!-- 公共富文本编辑器(打开时才创建,关闭即销毁;草稿负责跨会话保存) -->
      <BaseRichEditor v-if="props.modelValue" ref="richRef" :max-images="4" @created="onEditorCreated" @change="onEditorChange" />

      <!-- 底部:导入/导出 + 字数 + 操作 -->
      <footer class="rich-edit-actions">
        <button class="button secondary small" type="button" :disabled="importing" @click="fileInput?.click()">
          <AppIcon name="upload" :size="14" />{{ importing ? '导入中…' : '导入 Markdown' }}
        </button>
        <button class="button secondary small" type="button" @click="exportMarkdown">
          <AppIcon name="download" :size="14" />导出 Markdown
        </button>
        <span class="rich-actions-gap" />
        <small class="rich-wordcount" aria-live="polite">{{ wordCount }} 字</small>
        <button class="button secondary" type="button" @click="cancel">取消</button>
        <button class="button primary" type="button" @click="save">保存返回</button>
      </footer>
    </div>
  </AppDialog>
</template>

<style scoped>
.rich-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
/* 顶部行 */
.rich-edit-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rich-edit-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  background: #eaf3f6;
  color: #2d6a7d;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.rich-edit-title {
  flex: 1;
  min-width: 200px;
  height: 40px;
  padding: 0 6px;
  border: 1px solid var(--amc-border, #e6e0d8);
  border-radius: 9px;
  outline: none;
  background: #fff;
  font-size: 16px;
  font-weight: 650;
  color: #3d3a35;
}
.rich-edit-title::placeholder { color: #a8a29b; font-weight: 500; }
.rich-import-input { display: none; }
/* 编辑器占满剩余高度 */
.rich-panel :deep(.base-rich-editor) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.rich-panel :deep(.rich-content) { flex: 1; min-height: 300px; }
/* 底部按钮 */
.rich-edit-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rich-actions-gap { flex: 1; }
.rich-wordcount { color: #a8a29b; font-size: 12px; white-space: nowrap; }
</style>

<!-- 弹窗被 Teleport 到 body,scoped 样式作用不到;这里控制悬浮窗尺寸 + 移动端全屏 -->
<style>
.rich-panel-dialog .dialog-card {
  width: min(1040px, 94vw);
  height: min(88vh, 860px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rich-panel-dialog .dialog-card > .dialog-title { flex-shrink: 0; }
.rich-panel-dialog .dialog-card > .rich-panel { flex: 1; min-height: 0; }

/* 7. 移动端适配:窄屏下悬浮窗改为全屏编辑器 */
@media (max-width: 767px) {
  .rich-panel-dialog .dialog-card {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
  /* 标题输入框在窄屏下独占一行(排到徽标下方) */
  .rich-panel-dialog .rich-edit-title { flex-basis: 100%; order: 3; min-width: 0; }
  .rich-panel-dialog .rich-edit-actions { gap: 8px; }
  .rich-panel-dialog .rich-edit-actions .button { flex: 1; justify-content: center; }
  .rich-panel-dialog .rich-actions-gap { display: none; }
}
</style>
