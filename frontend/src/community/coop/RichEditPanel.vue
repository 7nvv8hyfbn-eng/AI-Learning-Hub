<script setup lang="ts">
import { ref } from 'vue'
import AppDialog from '../../components/base/AppDialog.vue'
import AppIcon from '../../components/base/AppIcon.vue'
import CommunityQuotePreview from '../CommunityQuotePreview.vue'
import BaseRichEditor from './BaseRichEditor.vue'
import CommunityDraftConflict from '../CommunityDraftConflict.vue'
import ResourceContributionFields from '../ResourceContributionFields.vue'
import CommunityCoverField from '../CommunityCoverField.vue'
import { useCommunityDraft } from '../composables/useCommunityDraft'
import { useCommunityStore } from '../../stores/community'
import { useCommunityAccess } from '../composables/useCommunityAccess'
import { mdToHtml, htmlToMarkdown } from './markdown-convert'

const editor = useCommunityDraft(), store = useCommunityStore()
const { requireWrite } = useCommunityAccess()
const richRef = ref<InstanceType<typeof BaseRichEditor> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false), wordCount = ref(0)
const onImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file || editor.saving) return
  if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 2 * 1024 * 1024) { editor.error = '请选择不超过 2MB 的 Markdown 或 TXT 文件'; return }
  if (editor.blocks.length && !window.confirm('导入将替换当前正文，是否继续？')) return
  const form = editor.form, session = store.composerSession, epoch = store.epoch
  let cancelled = false
  const current = () => !cancelled && store.composerOpen && form === editor.form && session === store.composerSession && epoch === store.epoch
  const release = editor.registerUpload(() => { cancelled = true })
  importing.value = true
  try { const text = await file.text(); if (current()) richRef.value?.replaceWithHtml(mdToHtml(text)) }
  catch (cause) { if (current()) editor.error = cause instanceof Error ? cause.message : '导入失败，当前正文已保留' }
  finally { release(); importing.value = false }
}
const exportMarkdown = () => {
  const blob = new Blob([htmlToMarkdown(richRef.value?.getSanitizedHtml() || '')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url
  link.download = '图文草稿.md'
  link.click()
  URL.revokeObjectURL(url)
}
const publish = () => { if (requireWrite('post')) void editor.save() }
</script>

<template>
  <AppDialog :model-value="store.composerOpen" title="写图文" class="rich-panel-dialog" :close-on-backdrop="false" @update:model-value="editor.close()">
    <div class="rich-panel">
      <!-- 顶部:徽标 + 标题 -->
      <header class="rich-edit-head">
        <span class="rich-edit-chip"><AppIcon name="edit" :size="13" />图文分享</span>
        <input
          v-model="editor.form.title"
          class="rich-edit-title"
          type="text"
          placeholder="在此输入您主题的标题..."
          maxlength="120"
          :disabled="editor.saving"
        />
        <!-- 隐藏的文件选择器(.md/.markdown/.txt) -->
        <input ref="fileInput" class="rich-import-input" type="file" accept=".md,.markdown,.txt" @change="onImportFile" />
      </header>

      <!-- 公共富文本编辑器(打开时才创建,关闭即销毁;草稿负责跨会话保存) -->
      <BaseRichEditor ref="richRef" @change="wordCount = $event.getText().replace(/\s+/g, '').length" />
      <CommunityQuotePreview v-if="editor.form.quotedPostId" :id="editor.form.quotedPostId" />
      <CommunityCoverField v-if="editor.form.contribution?.kind === 'article'" v-model="editor.form.contribution.coverFileId" />
      <details v-if="editor.form.contribution"><summary>分类、标签与教学引用设置</summary><ResourceContributionFields :show-cover="false" /></details>
      <p v-if="editor.error" class="community-notice" role="alert">{{ editor.error }}</p>
      <CommunityDraftConflict />

      <!-- 底部:导入/导出 + 字数 + 操作 -->
      <footer class="rich-edit-actions">
        <button class="button secondary small" type="button" :disabled="importing || editor.saving" @click="fileInput?.click()">
          <AppIcon name="upload" :size="14" />{{ importing ? '导入中…' : '导入 Markdown' }}
        </button>
        <button class="button secondary small" type="button" @click="exportMarkdown">
          <AppIcon name="download" :size="14" />导出 Markdown
        </button>
        <span class="rich-actions-gap" />
        <small class="rich-wordcount" aria-live="polite">{{ editor.savedAt }} · {{ wordCount }} 字</small>
        <button class="button secondary" type="button" :disabled="editor.saving" @click="editor.close()">取消</button>
        <button class="button secondary" type="button" :disabled="editor.saving || importing" @click="editor.save(true)">保存草稿</button>
        <button class="button primary" type="button" :disabled="editor.saving || importing || !!editor.pendingUploads" @click="publish">{{ editor.saving ? '处理中…' : '发布图文' }}</button>
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
