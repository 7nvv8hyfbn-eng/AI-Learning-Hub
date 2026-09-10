import { communityInlineTokens, normalizeTopicName, type CommunityInlineReferenceDto } from '@ai-learning-hub/contracts'
import { sanitizeRichHtml } from './coop/sanitize'

export function communityInlineHtml(html: string, refs: CommunityInlineReferenceDto[] = []) {
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(html), 'text/html')
  let group: Text[] = []
  const flush = () => {
    const text = group.map((node) => node.data).join(''), nodes = group
    group = []
    for (const token of communityInlineTokens(text).reverse()) {
      const ref = refs.find((ref) => ref.kind === token.kind && normalizeTopicName(ref.text.slice(1)) === token.query)
      if (!ref?.route?.match(/^\/community\/(topic|people)\//)) continue
      const point = (offset: number) => { for (const node of nodes) { if (offset <= node.length) return { node, offset }; offset -= node.length }; return null }
      const start = point(token.start), end = point(token.end)
      if (!start || !end) continue
      const range = doc.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset)
      const anchor = doc.createElement('a'); anchor.href = ref.route; anchor.dataset.communityInline = 'true'; anchor.append(range.extractContents()); range.insertNode(anchor)
    }
  }
  // DOMParser 文档没有 Window；用 nodeType/tagName 遍历安全节点。
  const walk = (node: Node) => {
    if (node.nodeType === 3) { group.push(node as Text); return }
    if (node.nodeType !== 1) return
    const element = node as Element, block = !['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S'].includes(element.tagName)
    if (block) flush()
    if (!['A', 'CODE', 'PRE', 'IMG'].includes(element.tagName)) [...node.childNodes].forEach(walk)
    if (block) flush()
  }
  walk(doc.body); flush()
  return doc.body.innerHTML
}
