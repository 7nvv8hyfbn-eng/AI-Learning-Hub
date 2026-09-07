const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const inline = (text: string) => escapeHtml(text)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%" />')
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  .replace(/~~([^~]+)~~/g, '<s>$1</s>')

export const markdownToHtml = (source: string): string => {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let list: 'ul' | 'ol' | null = null
  let inCode = false
  let codeLines: string[] = []
  const flushParagraph = () => { if (paragraph.length) { out.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = [] } }
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const fence = /^```/.test(line)
    if (inCode) {
      if (fence) { out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`); codeLines = []; inCode = false } else codeLines.push(raw)
      continue
    }
    if (fence) { flushParagraph(); flushList(); inCode = true; continue }
    const heading = line.match(/^(#{1,6})\s+(.*)/)
    if (heading) { flushParagraph(); flushList(); const level = Math.min(heading[1].length + 2, 6); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue }
    const quote = line.match(/^>\s?(.*)/)
    if (quote) { flushParagraph(); flushList(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue }
    if (/^(-{3,}|\*{3,})$/.test(line)) { flushParagraph(); flushList(); out.push('<hr />'); continue }
    const unordered = line.match(/^[-*+]\s+(.*)/)
    const ordered = line.match(/^\d+[.)]\s+(.*)/)
    if (unordered || ordered) {
      flushParagraph()
      const want = unordered ? 'ul' : 'ol'
      if (list !== want) { flushList(); out.push(`<${want}>`); list = want }
      out.push(`<li>${inline(String((unordered || ordered)![1]))}</li>`)
      continue
    }
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  if (inCode) out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  return out.join('')
}
