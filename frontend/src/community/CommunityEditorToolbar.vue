<script setup lang="ts">
const props = defineProps<{ fullscreenActive?: boolean }>()
const emit = defineEmits<{ action: [key: 'bold' | 'italic' | 'heading' | 'list' | 'code' | 'link' | 'image' | 'import-md' | 'fullscreen'] }>()
type EditorAction = 'bold' | 'italic' | 'heading' | 'list' | 'code' | 'link' | 'image' | 'import-md' | 'fullscreen'

const glyphs: Record<string, string> = {
  bold: '<path d="M7.5 5h5.2a3.5 3.5 0 0 1 0 7H7.5zM7.5 12h6.2a3.5 3.5 0 0 1 0 7H7.5z"/>',
  italic: '<path d="M11 5h7M6 19h7M14.5 5l-5 14"/>',
  heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.4" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.4" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
  code: '<path d="M9 7.5 4.5 12 9 16.5M15 7.5 19.5 12 15 16.5"/>',
  link: '<path d="M10.2 13.8a4.6 4.6 0 0 0 6.5 0l2.3-2.3a4.6 4.6 0 0 0-6.5-6.5l-1.1 1.1M13.8 10.2a4.6 4.6 0 0 0-6.5 0l-2.3 2.3a4.6 4.6 0 0 0 6.5 6.5l1.1-1.1"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M5.5 17.5 10 13l3 3 3.5-3.5 3 3"/>',
  markdown: '<path d="M6.5 3.5h7l5 5V19a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M13.5 3.5v5h5"/><path d="M12 11v5.5M12 16.5l-2.3-2.3M12 16.5l2.3-2.3"/>',
  fullscreen: '<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>',
}
type EditorTool = { key: string; label: string; group: number; action: EditorAction; activeKey?: 'fullscreenActive'; tip?: string }
const tools: EditorTool[] = [
  { key: 'bold', label: '加粗', group: 0, action: 'bold', tip: '**加粗**' },
  { key: 'italic', label: '斜体', group: 0, action: 'italic', tip: '*斜体*' },
  { key: 'heading', label: '标题', group: 0, action: 'heading', tip: '## 标题' },
  { key: 'list', label: '无序列表', group: 0, action: 'list', tip: '- 列表项' },
  { key: 'code', label: '代码块', group: 0, action: 'code', tip: '``` 代码块 ```' },
  { key: 'link', label: '插入链接', group: 1, action: 'link', tip: '[文字](链接)' },
  { key: 'image', label: '插入图片', group: 1, action: 'image' },
  { key: 'markdown', label: '导入 .md', group: 1, action: 'import-md', tip: '导入 Markdown 或 TXT 文件' },
  { key: 'fullscreen', label: '全屏', group: 1, action: 'fullscreen', activeKey: 'fullscreenActive' },
]
</script>
<template>
  <div class="editor-toolbar" role="toolbar" aria-label="正文格式">
    <template v-for="(tool, index) in tools" :key="tool.key">
      <span v-if="index && tool.group !== tools[index - 1]!.group" class="editor-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        class="editor-tool"
        :class="{ 'is-active': tool.activeKey && props[tool.activeKey] }"
        :title="tool.tip || tool.label"
        :aria-label="tool.label"
        :aria-pressed="tool.activeKey ? !!props[tool.activeKey] : undefined"
        @click="emit('action', tool.action)"
      ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="glyphs[tool.key]" /></button>
    </template>
  </div>
</template>
