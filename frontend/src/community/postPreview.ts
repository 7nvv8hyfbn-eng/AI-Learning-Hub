import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import { sanitizeRichHtml } from './coop/sanitize'

/** 只投影展示内容，原始块、HTML及文件引用不变。 */
export function postTextPreview(blocks: CommunityContentBlock[]) {
  let shortened = false
  const text: CommunityContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'image') continue
    if (block.type === 'rich_text') {
      const doc = new DOMParser().parseFromString(sanitizeRichHtml(block.text), 'text/html')
      doc.querySelectorAll('img').forEach((image) => image.remove())
      doc.querySelectorAll('table, pre').forEach((node) => {
        const summary = doc.createElement(node.tagName === 'PRE' ? 'pre' : 'p')
        const content = node.tagName === 'TABLE' ? [...node.querySelectorAll('th, td')].map((cell) => cell.textContent).join(' · ') : node.textContent || ''
        summary.textContent = `${node.tagName === 'TABLE' ? '表格' : '代码'}：${content.replace(/\s+/g, ' ').trim()}`
        node.replaceWith(summary); shortened = true
      })
      doc.querySelectorAll('p').forEach((node) => { if (!node.textContent?.trim()) node.remove() })
      if (doc.body.textContent?.trim()) text.push({ ...block, text: doc.body.innerHTML })
    } else if (block.type === 'code') {
      const lines = block.code.split(/\r?\n/)
      if (lines.length > 2) shortened = true
      text.push({ ...block, code: lines.slice(0, 2).join('\n') })
    } else if (block.type === 'list') {
      const items = block.items.filter((item) => item.trim())
      if (items.length) text.push({ ...block, items })
    } else if (block.text.trim()) text.push({ ...block, text: block.text.replace(/\n\s*\n/g, '\n').trim() })
  }
  return { blocks: text, shortened }
}

export const formatPostViews = (views: number) => views >= 10000 ? `${Number((views / 10000).toFixed(1))}万` : String(views)
