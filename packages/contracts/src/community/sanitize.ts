const elementAttributes: Record<string, string[]> = {
  p: [], h3: [], h4: [], h5: [], h6: [], ul: [], ol: [], li: [], strong: [], em: [], b: [], i: [], u: [], s: [], blockquote: [], pre: [], code: [], table: [], thead: [], tbody: [], tr: [], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], a: ['href'], img: ['src', 'alt', 'title'], br: [], hr: []
}
const voidElements = new Set(['br', 'hr', 'img'])
const suppressedElements = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'textarea', 'title', 'svg', 'math', 'form', 'button', 'input', 'select', 'option', 'video', 'audio', 'source', 'track', 'link', 'meta', 'base', 'head'])
const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const safeAttributeUrl = (value: string): string => { const url = value.trim(); return /^(https?:\/\/|mailto:)/i.test(url) ? url : '' }

const renderStartTag = (name: string, rawAttributes: string): string => {
  const allowed = elementAttributes[name] || []
  const pattern = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\/*/`]+))/g
  const seen = new Set<string>()
  let output = ''
  let match: RegExpExecArray | null
  while ((match = pattern.exec(rawAttributes))) {
    const attribute = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (seen.has(attribute) || !allowed.includes(attribute)) continue
    seen.add(attribute)
    if (attribute === 'href' || attribute === 'src') {
      const url = safeAttributeUrl(value)
      if (!url) continue
      output += ` ${attribute}="${escapeAttribute(url)}"`
      if (attribute === 'href') output += ' target="_blank" rel="noopener nofollow"'
    } else if (attribute === 'colspan' || attribute === 'rowspan') {
      if (!/^\d{1,2}$/.test(value)) continue
      output += ` ${attribute}="${value}"`
    } else output += ` ${attribute}="${escapeAttribute(value.slice(0, 300))}"`
  }
  if (name === 'img' && !output.includes(' src=')) return ''
  return `<${name}${output}>`
}

export const sanitizeCommunityHtml = (source: string): string => {
  if (typeof source !== 'string' || !source) return ''
  const output: string[] = []
  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let cursor = 0
  let skipping: string | null = null
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    if (!skipping) output.push(source.slice(cursor, match.index).replace(/</g, '&lt;'))
    cursor = pattern.lastIndex
    const closing = match[1] === '/', name = match[2].toLowerCase(), rawAttributes = match[3] || ''
    if (skipping) { if (closing && name === skipping) skipping = null; continue }
    if (!closing && suppressedElements.has(name)) { skipping = name; continue }
    if (!(name in elementAttributes)) continue
    if (closing) { if (!voidElements.has(name)) output.push(`</${name}>`); continue }
    output.push(renderStartTag(name, rawAttributes))
  }
  if (!skipping) output.push(source.slice(cursor).replace(/</g, '&lt;'))
  return output.join('')
}

export const communityHtmlToText = (html: string): string => (typeof html === 'string' ? html : '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#0?39;/g, "'")
  .replace(/[ \t\f\v]+/g, ' ')
  .replace(/\s*\n\s*/g, '\n')
  .trim()
