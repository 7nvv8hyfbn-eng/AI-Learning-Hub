import { communityInlineTokens, type CommunityContentBlock } from '@ai-learning-hub/contracts'
import { sanitizeRichHtml } from './coop/sanitize'
export const inlineBlocksTokens = (blocks: CommunityContentBlock[]) => blocks.flatMap((block) => {
  if (block.type === 'code' || block.type === 'image') return []
  if (block.type !== 'rich_text') return communityInlineTokens(block.type === 'list' ? block.items.join('\n') : block.text)
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(block.text), 'text/html')
  doc.querySelectorAll('a,code,pre,img').forEach((node) => node.replaceWith(doc.createTextNode('\n')))
  doc.querySelectorAll('p,br,li,h1,h2,h3,h4,h5,h6,td,th,blockquote').forEach((node) => node.append(doc.createTextNode('\n')))
  return communityInlineTokens(doc.body.textContent || '')
})
