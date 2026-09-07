/**
 * 图文创作(资源中心「写图文」)—— 跨文件共享类型
 */

/** 编辑页【保存返回】带回的结果 */
export interface RichEditResult {
  /** 顶部标题输入框内容 */
  title: string
  /** 编辑器输出的完整 HTML(已经 DOMPurify 前端过滤;后端入库前必须再做一层 XSS 过滤) */
  html: string
  /** 从 HTML 提取的图片信息 */
  images: Array<{ name: string; url: string }>
}

/** 跳转编辑页时通过 router state 携带的上下文 */
export interface RichEditContext {
  /** 左上角徽标文字(如「图文分享」) */
  chipLabel?: string
  /** 保存返回的目标路由 */
  returnTo?: string
  /** 资源投稿形态(写图文=article) */
  kind?: 'article' | 'video' | 'document'
}
