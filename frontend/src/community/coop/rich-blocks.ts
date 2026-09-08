import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import { sanitizeRichHtml } from './sanitize'

// 图片按原位置拆成 FileRecord 内容块；草稿和发布数据均不保存临时预览 URL。
export function richHtmlToBlocks(html: string, images: ReadonlyMap<string, string>): CommunityContentBlock[] {
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(html), 'text/html')
  const blocks: CommunityContentBlock[] = []
  const append = (fragment: DocumentFragment) => {
    if (!fragment.textContent?.trim()) return
    const container = doc.createElement('div')
    container.append(fragment.cloneNode(true))
    container.querySelectorAll('p:empty').forEach((paragraph) => paragraph.remove())
    blocks.push({ type: 'rich_text', text: container.innerHTML })
  }
  for (const img of Array.from(doc.images)) {
    const fileId = images.get(img.getAttribute('src') || '')
    if (!fileId) throw new Error('图片尚未上传或来自外部链接，请删除后使用图片按钮重新上传')
    const range = doc.createRange()
    range.setStart(doc.body, 0)
    range.setEndBefore(img)
    append(range.extractContents())
    blocks.push({ type: 'image', fileId, alt: (img.alt || '图文配图').slice(0, 200) })
    img.remove()
  }
  const remaining = doc.createDocumentFragment()
  remaining.append(...Array.from(doc.body.childNodes))
  append(remaining)
  if (blocks.filter((block) => block.type === 'image').length > 4) throw new Error('图片最多 4 张')
  return blocks
}

export function blocksToRichHtml(blocks: CommunityContentBlock[], images: ReadonlyMap<string, string>): string {
  const doc = document.createElement('div')
  for (const block of blocks) {
    if (block.type === 'rich_text') { doc.insertAdjacentHTML('beforeend', sanitizeRichHtml(block.text)); continue }
    const node = document.createElement(block.type === 'image' ? 'p' : block.type === 'heading' ? `h${block.level}` : block.type === 'list' ? block.ordered ? 'ol' : 'ul' : block.type === 'quote' ? 'blockquote' : block.type === 'code' ? 'pre' : 'p')
    if (block.type === 'image') {
      const img = document.createElement('img')
      img.src = images.get(block.fileId) || ''
      img.alt = block.alt || '图文配图'
      node.append(img)
    } else if (block.type === 'list') {
      for (const text of block.items) { const li = document.createElement('li'); li.textContent = text; node.append(li) }
    } else if (block.type === 'code') { const code = document.createElement('code'); code.textContent = block.code; node.append(code) }
    else node.textContent = block.text
    doc.append(node)
  }
  return doc.innerHTML
}
