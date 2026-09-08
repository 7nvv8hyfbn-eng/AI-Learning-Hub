// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { blocksToRichHtml, richHtmlToBlocks } from '../src/community/coop/rich-blocks'

it('真实图片预览转换为 FileRecord，恢复再保存仍保留图文顺序和格式', () => {
  const url = 'blob:http://localhost/uploaded-file'
  const blocks = richHtmlToBlocks(`<h2>实践</h2><p><strong>结论</strong></p><p><img src="${url}" alt="实验截图"></p><p>复盘</p>`, new Map([[url, 'file-1']]))
  expect(blocks.map(block => block.type)).toEqual(['rich_text', 'image', 'rich_text'])
  expect(blocks[1]).toEqual({ type: 'image', fileId: 'file-1', alt: '实验截图' })
  expect(JSON.stringify(blocks)).not.toContain('blob:')
  const restored = blocksToRichHtml(blocks, new Map([['file-1', url]]))
  expect(richHtmlToBlocks(restored, new Map([[url, 'file-1']]))).toEqual(blocks)
})

it('未知外部图片和未上传 Blob 不可提交；脚本及危险链接被净化', () => {
  for (const src of ['https://example.com/image.png', 'blob:http://localhost/unknown', 'data:image/png;base64,AA']) {
    expect(() => richHtmlToBlocks(`<p><img src="${src}"></p>`, new Map())).toThrow('图片尚未上传')
  }
  const blocks = richHtmlToBlocks('<p onclick="alert(1)"><a href="javascript:alert(1)">安全正文</a></p><script>alert(1)</script>', new Map())
  expect(JSON.stringify(blocks)).not.toMatch(/javascript:|onclick|<script/)
  expect(JSON.stringify(blocks)).toContain('安全正文')
})
