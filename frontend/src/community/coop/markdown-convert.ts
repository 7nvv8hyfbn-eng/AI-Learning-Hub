/**
 * Markdown ↔ HTML 轻量双向转换(图文创作悬浮窗「导入/导出 Markdown」用,零依赖)。
 *
 * 覆盖常用语法:标题、有序/无序列表、引用、代码块、分割线、图片、链接、加粗、斜体、行内代码、表格。
 * 嵌套列表等复杂结构按"平铺"处理(作业级够用;如需完美嵌套可换 markdown-it)。
 * 转换结果请务必再过 sanitizeRichHtml 白名单后再进编辑器/入库。
 */

/** 行内元素转义 */
const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Markdown → HTML(供「导入 Markdown」使用) */
export const mdToHtml = (markdown: string): string => {
  // 行内转换:先整体转义,再做白名单内的内联标记替换
  const inline = (s: string) => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []                                  // 段落缓冲
  let listItems: string[] = [], listTag: 'ul' | 'ol' | null = null
  let quoteLines: string[] = []                            // 引用缓冲
  let codeLines: string[] | null = null                    // 代码块缓冲(null = 不在代码块中)
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = [] } }
  const flushList = () => { if (listTag && listItems.length) out.push(`<${listTag}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${listTag}>`); listItems = []; listTag = null }
  const flushQuote = () => { if (quoteLines.length) { out.push(`<blockquote>${quoteLines.map(inline).join('<br>')}</blockquote>`); quoteLines = [] } }
  const flushAll = () => { flushPara(); flushList(); flushQuote() }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const fence = line.match(/^```(.*)$/)
    if (codeLines !== null) {                              // 代码块内容行
      if (fence) { out.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>'); codeLines = null }
      else codeLines.push(raw)
      continue
    }
    if (fence) { flushAll(); codeLines = []; continue }
    if (!line.trim()) { flushAll(); continue }             // 空行 = 块结束
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) { flushAll(); const level = Math.min(6, Math.max(1, heading[1].length)); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushAll(); out.push('<hr>'); continue }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) { flushPara(); flushList(); quoteLines.push(quote[1]); continue }
    const unordered = line.match(/^\s*[-*+]\s+(.*)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (unordered || ordered) {
      flushPara(); flushQuote()
      const tag: 'ul' | 'ol' = unordered ? 'ul' : 'ol'
      if (listTag && listTag !== tag) flushList()
      listTag = tag
      listItems.push(inline((unordered || ordered)![1]))
      continue
    }
    para.push(line.trim())
  }
  if (codeLines !== null) out.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>')
  flushAll()
  return out.join('\n') || '<p><br></p>'
}

/** HTML → Markdown(供「导出 Markdown」使用;基于 DOM 遍历) */
export const htmlToMarkdown = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    const children = Array.from(el.childNodes).map(walk).join('')
    switch (el.tagName.toLowerCase()) {
      case 'p': return children + '\n\n'
      case 'br': return '\n'
      case 'h1': return `# ${children}\n\n`
      case 'h2': return `## ${children}\n\n`
      case 'h3': return `### ${children}\n\n`
      case 'h4': return `#### ${children}\n\n`
      case 'h5': return `##### ${children}\n\n`
      case 'h6': return `###### ${children}\n\n`
      case 'strong': case 'b': return `**${children}**`
      case 'em': case 'i': return `*${children}*`
      case 's': case 'del': return `~~${children}~~`
      case 'code': return el.parentElement && el.parentElement.tagName.toLowerCase() === 'pre' ? children : '`' + children + '`'
      case 'pre': return '```\n' + children.replace(/\n$/, '') + '\n```\n\n'
      case 'blockquote': return children.trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n'
      case 'ul': return Array.from(el.children).filter((li) => li.tagName.toLowerCase() === 'li').map((li) => `- ${walk(li).trim()}`).join('\n') + '\n\n'
      case 'ol': return Array.from(el.children).filter((li) => li.tagName.toLowerCase() === 'li').map((li, index) => `${index + 1}. ${walk(li).trim()}`).join('\n') + '\n\n'
      case 'li': return children
      case 'img': return `![${el.getAttribute('alt') || ''}](${el.getAttribute('src') || ''})`
      case 'a': return `[${children}](${el.getAttribute('href') || ''})`
      case 'hr': return '---\n\n'
      case 'table': {
        // 基础表格:第一行作表头,生成管道表格
        const rows = Array.from(el.querySelectorAll('tr'))
        const body = rows.map((tr, rowIndex) => {
          const cells = Array.from(tr.children).map((cell) => walk(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim())
          let line = `| ${cells.join(' | ')} |`
          if (rowIndex === 0) line += `\n| ${cells.map(() => '---').join(' | ')} |`
          return line
        })
        return body.join('\n') + '\n\n'
      }
      default: return children
    }
  }
  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
