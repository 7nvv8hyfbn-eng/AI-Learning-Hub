/**
 * 富文本 HTML 的前端 XSS 白名单过滤(DOMPurify)。
 *
 * ⚠️ 安全要求:这只是「前端第一道防线」;富文本提交到后端后,
 * 后端必须再做一层服务端 XSS 过滤(如 sanitize-html / isomorphic-dompurify),绝不能直接入库!
 */
import DOMPurify from 'dompurify'

export const sanitizeRichHtml = (raw: string): string =>
  DOMPurify.sanitize(raw, {
    // 只保留排版所需的安全标签
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'span'],
    // 只保留安全的属性
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'],
    // Blob 只供已上传 FileRecord 的内存预览；提交时转换器还会校验 URL 与文件 ID 映射。
    ALLOWED_URI_REGEXP: /^(?:(?:https?|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    // 显式禁止危险标签与内联事件
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
  })
