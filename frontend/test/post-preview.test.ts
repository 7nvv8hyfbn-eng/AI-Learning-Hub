// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import { formatPostViews, postTextPreview } from '../src/community/postPreview'

describe('帖子折叠展示投影', () => {
  it('多种文本共用预览内容，图片alt不混入摘要且原始顺序与数据不变', () => {
    const blocks: CommunityContentBlock[] = [
      { type: 'paragraph', text: '' }, { type: 'paragraph', text: '原始\n\n换行保留' },
      { type: 'image', fileId: 'image-1', alt: '不属于正文的说明' },
      { type: 'heading', level: 2, text: '下一步' }, { type: 'list', ordered: true, items: ['检查', '', '运行'] },
      { type: 'quote', text: '引用正文' }, { type: 'code', language: 'js', code: 'one\ntwo\nthree' },
      { type: 'rich_text', text: '<p><br></p><p>富文本 <a href="https://example.com">链接</a></p><table><tr><td>A</td><td>B</td></tr></table><img src="https://example.com/a.png" alt="不能当正文"><script>evil()</script>' },
      { type: 'image', fileId: 'image-2' },
    ]
    const original = structuredClone(blocks), result = postTextPreview(blocks)
    expect(blocks).toEqual(original)
    expect(result.shortened).toBe(true)
    expect(result.blocks.some((block) => block.type === 'image')).toBe(false)
    expect(result.blocks).toContainEqual({ type: 'list', ordered: true, items: ['检查', '运行'] })
    const rich = result.blocks.find((block) => block.type === 'rich_text')!
    expect(rich.text).toContain('链接'); expect(rich.text).toContain('href="https://example.com"')
    expect(rich.text).not.toMatch(/<img|<table|<script|不能当正文|evil/)
    expect(JSON.stringify(result)).not.toContain('不属于正文的说明')
  })
  it('短文和没有内容的段落不伪造溢出，代码摘要不截HTML标签', () => {
    expect(postTextPreview([{ type: 'paragraph', text: '短文' }, { type: 'paragraph', text: '  \n ' }])).toEqual({ blocks: [{ type: 'paragraph', text: '短文' }], shortened: false })
    expect(postTextPreview([{ type: 'rich_text', text: '<p><br></p>' }]).blocks).toEqual([])
    const result = postTextPreview([{ type: 'code', code: '<tag>\n</tag>', language: 'html' }])
    expect(result.shortened).toBe(false)
    expect(result.blocks[0]).toMatchObject({ type: 'code', language: 'html', code: '<tag>\n</tag>' })
  })
  it.each([[0, '0'], [9999, '9999'], [10000, '1万'], [12000, '1.2万']])('浏览量%s显示为%s', (value, display) => {
    expect(formatPostViews(Number(value))).toBe(display)
  })
})
