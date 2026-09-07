/**
 * 第三方库类型补充声明(shim)
 *
 * @wangeditor/editor-for-vue 的 package.json "exports" 未正确映射 d.ts,
 * TypeScript 无法自动解析其类型,这里手动声明 Vue3 组件的 Props/Events。
 */
declare module '@wangeditor/editor-for-vue' {
  import type { DefineComponent } from 'vue'
  import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor'

  /** 编辑区组件(wangEditor V5) */
  export const Editor: DefineComponent<{
    /** 编辑器模式:default(完整) / simple(精简) */
    mode?: string
    /** 初始 HTML 内容(用于回填) */
    defaultHtml?: string
    /** 初始 JSON 内容(优先于 defaultHtml) */
    defaultContent?: unknown
    /** 编辑器配置(placeholder、MENU_CONF 等) */
    defaultConfig?: Partial<IEditorConfig>
    /** 编辑内容(v-model,HTML 字符串) */
    modelValue?: string
    /** 编辑器实例创建完成回调 */
    onCreated?: (editor: IDomEditor) => void
    /** 编辑内容变化回调 */
    onChange?: (editor: IDomEditor) => void
    /** 编辑器销毁回调 */
    onDestroyed?: (editor: IDomEditor) => void
  }>

  /** 工具栏组件(wangEditor V5) */
  export const Toolbar: DefineComponent<{
    /** 编辑器实例(未创建时传 null,组件内部会等待) */
    editor: IDomEditor | null
    /** 工具栏模式:default / simple */
    mode?: string
    /** 工具栏配置(toolbarKeys 自定义按钮顺序等) */
    defaultConfig?: Partial<IToolbarConfig>
  }>
}
