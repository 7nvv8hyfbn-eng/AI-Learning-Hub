import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { postDetectionInput } from '@ai-learning-hub/contracts'
import { BlockDto } from '../src/modules/community/community.dto'
import { CommunityPostService } from '../src/modules/community/post.service'

describe('社区图文发布内容边界', () => {
  const count = vi.fn()
  const service = new CommunityPostService({ fileRecord: { count } } as never, {} as never, {} as never, {} as never, {} as never)
  it('DTO接受安全图文；入库保留格式，移除事件、样式、脚本和HTML媒体', async () => {
    const block = { type: 'rich_text' as const, text: '<h2>实践</h2><p style="position:fixed" onclick="alert(1)"><strong>学习</strong><a href="javascript:alert(1)">链接</a></p><script>alert(1)</script><img src="https://outside.example/a.png"><table><tr><td>结果</td></tr></table>' }
    expect(await validate(plainToInstance(BlockDto, block))).toHaveLength(0)
    const result = await service.blocks('owner', [block])
    expect(result.clean[0]).toEqual({ type: 'rich_text', text: '<h2>实践</h2><p><strong>学习</strong><a>链接</a></p><table><tr><td>结果</td></tr></table>' })
    expect(result.plainText).toBe('实践学习链接结果')
    expect(result.plainText).not.toContain('<')
    await expect(service.blocks('owner', [{ type: 'rich_text', text: '<img src="blob:x"><script>x</script>' }])).rejects.toThrow('图文正文不能为空')
  })
  it('图片沿用本人上传检查，不允许用富文本字段绕过；内容顺序保持', async () => {
    const blocks = [{ type: 'rich_text' as const, text: '<p>图片之前</p>' }, { type: 'image' as const, fileId: 'file-1', alt: '实验截图' }, { type: 'rich_text' as const, text: '<p>图片之后</p>' }]
    count.mockResolvedValueOnce(1)
    expect((await service.blocks('owner', blocks)).clean).toEqual(blocks)
    expect(count).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ uploadedBy: 'owner', id: { in: ['file-1'] } }) }))
    count.mockResolvedValueOnce(0)
    await expect(service.blocks('owner', blocks)).rejects.toThrow('图片必须由本人上传')
    await expect(service.blocks('owner', [{ type: 'rich_text', text: '<p>内容</p>', fileId: 'forged' } as never])).rejects.toThrow('字段与类型不匹配')
  })
  it('历史标题列表可回填，文字与链接目标均进入现有检测', async () => {
    const { clean, plainText } = await service.blocks('owner', [{ type: 'heading', level: 2, text: '阶段' }, { type: 'list', ordered: true, items: ['第一步', '第二步'] }, { type: 'rich_text', text: '<p>敏<strong>感</strong><a href="https://example.com/risk">参考</a></p>' }])
    expect(plainText).toContain('敏感')
    const detection = postDetectionInput('标题', plainText, clean, { tags: [] })
    expect(detection.resourceDescription).toContain('https://example.com/risk')
    expect(detection.resourceDescription).toContain('第一步\n第二步')
  })
})
