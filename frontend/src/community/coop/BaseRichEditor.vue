<script setup lang="ts">
/**
 * BaseRichEditor —— 公共富文本编辑器组件(wangEditor V5)
 *
 * 职责:
 * 1. 固定工具栏按钮顺序(与设计稿图2完全一致):
 *    加粗B、斜体I、标题H、有序列表、无序列表、撤销、重做、代码块、链接、图片、表格、分割线、表情
 * 2. 图片统一入口:点击上传 / 粘贴 / 拖拽 都走 customUpload 校验(最多 4 张、单张 ≤5MB);
 * 3. XSS 白名单过滤(DOMPurify):页面只能通过 getSanitizedHtml() 拿净化后的 HTML;
 * 4. 组件卸载时 editor.destroy() 防止内存泄漏。
 */
import '@wangeditor/editor/dist/css/style.css'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor'
import { sanitizeRichHtml } from './sanitize'

const props = withDefaults(defineProps<{
  /** 初始 HTML(用于回填) */
  defaultHtml?: string
  /** 编辑区占位文字 */
  placeholder?: string
  /** 图片数量上限 */
  maxImages?: number
}>(), {
  defaultHtml: '',
  placeholder: '在此处输入您的帖子内容，拖放图像',
  maxImages: 4,
})

const emit = defineEmits<{ created: [editor: IDomEditor]; change: [editor: IDomEditor] }>()

// 官方要求:编辑器实例用 shallowRef,避免 Vue 深层响应式代理导致性能问题
const editorRef = shallowRef<IDomEditor | null>(null)
const htmlValue = ref(props.defaultHtml)

// 工具栏按钮顺序严格对齐设计稿图2
const toolbarConfig: Partial<IToolbarConfig> = {
  toolbarKeys: [
    'bold',          // 加粗 B
    'italic',        // 斜体 I
    'headerSelect',  // 标题 H
    'numberedList',  // 有序列表
    'bulletedList',  // 无序列表
    'undo',          // 撤销
    'redo',          // 重做
    'codeBlock',     // 代码块
    'insertLink',    // 链接
    'uploadImage',   // 图片
    'insertTable',   // 表格
    'divider',       // 分割线
    'emotion',       // 表情
  ],
}

/** 取编辑器纯文本(字数统计等使用) */
const getText = (): string => editorRef.value?.getText() ?? ''

/** 统计编辑器当前图片数量(插入前校验用;删除后名额自动释放) */
const countImages = (): number => {
  const html = editorRef.value?.getHtml() ?? ''
  return (html.match(/<img\s/g) || []).length
}

const editorConfig: Partial<IEditorConfig> = {
  placeholder: props.placeholder,
  scroll: true,
  // 注意:onChange/onCreated 等回调不能放在 config 里 —— @wangeditor/editor-for-vue 的封装
  // 组件会用内部实现覆盖它们,并在检测到时直接抛错。内容变化监听改用 v-model(htmlValue)的 watch。
  MENU_CONF: {
    uploadImage: {
      /**
       * 自定义上传:点击「图片」按钮、粘贴、拖拽三种方式都会进入这里,校验只写这一处。
       * 本地演示:生成 blob 预览地址(SPA 内路由跳转不销毁文档,地址始终有效)。
       * 生产环境:改为调用后端上传接口(如 /api/v1/community/media),用返回的 URL 调 insertFn。
       */
      customUpload(file: File, insertFn: (url: string, alt?: string, href?: string) => void) {
        if (!file.type.startsWith('image/')) { window.alert('只能上传图片文件'); return }
        if (file.size > 5 * 1024 * 1024) { window.alert('单张图片不能超过 5MB'); return }
        if (countImages() >= props.maxImages) { window.alert(`图片最多 ${props.maxImages} 张`); return }
        insertFn(URL.createObjectURL(file), file.name)
      },
    },
  },
}

const handleCreated = (editor: IDomEditor) => {
  editorRef.value = editor
  emit('created', editor)
}

// 内容变化(v-model 同步)→ 通知父组件(字数统计等使用)。
// 封装组件的 onChange 被内部占用,所以走 v-model 数据流,这是最可靠的变化信号。
watch(htmlValue, () => {
  const editor = editorRef.value
  if (editor) emit('change', editor)
})

/**
 * 取当前编辑器的完整 HTML 并做前端 XSS 白名单过滤。
 * ⚠️ 安全要求:DOMPurify 只是前端第一道防线,后端入库前必须再做一层服务端 XSS 过滤(如 sanitize-html)!
 */
const getSanitizedHtml = (): string => sanitizeRichHtml(editorRef.value?.getHtml() ?? '')

/**
 * 用一段 HTML 替换编辑器全部内容(Markdown 导入等场景使用)。
 * 传入的 HTML 应已通过 getSanitizedHtml 同等规则过滤。
 */
const replaceWithHtml = (html: string) => {
  const editor = editorRef.value
  if (editor == null) return
  editor.clear()
  editor.dangerouslyInsertHtml(html)
}

// 组件卸载时销毁编辑器,防止内存泄漏
onBeforeUnmount(() => {
  const editor = editorRef.value
  if (editor == null) return
  editor.destroy()
  editorRef.value = null
})

defineExpose({ getSanitizedHtml, countImages, replaceWithHtml, getText, editorRef })
</script>

<template>
  <div class="base-rich-editor">
    <Toolbar class="rich-toolbar" :editor="editorRef" :defaultConfig="toolbarConfig" mode="default" />
    <Editor class="rich-content" v-model="htmlValue" :defaultConfig="editorConfig" mode="default" @onCreated="handleCreated" />
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
