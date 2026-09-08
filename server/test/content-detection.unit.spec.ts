import { describe, expect, it, vi } from 'vitest'
import type { ArgumentsHost } from '@nestjs/common'
import { ApiExceptionFilter } from '../src/common/api-exception.filter'
import type { ContentDetectionPolicy, ContentDetectionRule } from '@ai-learning-hub/contracts'
import { ContentDetectionError, defaultContentDetectionPolicy, detectContent, postDetectionInput, validateContentDetectionPolicy } from '@ai-learning-hub/contracts'

const policy = (patch: Partial<ContentDetectionRule> = {}): ContentDetectionPolicy => ({ version: 7, rules: [{ id: 'test-rule', content: 'rag', method: 'token', fields: ['postBody'], category: 'school', action: 'warn', enabled: true, explanation: '仅用于验证边界的合成规则，不代表学校限制。', ...patch }] })
const syntheticToken = ['ghp', 'a1b2c3'.repeat(6)].join('_')

describe('小型内容检测规则', () => {
  it('共享检测错误返回中文400，其他内部错误仍隐藏为500', () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn(), locals: { requestId: 'synthetic-request' } }
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost
    const filter = new ApiExceptionFilter()
    filter.catch(new ContentDetectionError('规则版本无效'), host)
    expect(response.status).toHaveBeenLastCalledWith(400)
    expect(response.json).toHaveBeenLastCalledWith(expect.objectContaining({ message: '规则版本无效' }))
    filter.catch(new Error('不应公开的合成内部错误'), host)
    expect(response.status).toHaveBeenLastCalledWith(500)
    expect(response.json).toHaveBeenLastCalledWith(expect.objectContaining({ message: '服务暂时不可用' }))
  })
  it('正常投稿与后台恢复共用文字投影，标签、图片说明与代码语言不遗漏', () => {
    const blocks = [{ type: 'image' as const, fileId: 'synthetic-image', alt: '合成图片说明' }, { type: 'code' as const, language: 'typescript', code: 'const example = true' }]
    expect(postDetectionInput('合成标题', '合成正文', blocks, null, ['合成标签'])).toEqual({ postTitle: '合成标题', postBody: '合成正文', postLabels: '合成标签', mediaCaption: '合成图片说明\ntypescript' })
    expect(postDetectionInput('合成资源', '合成正文', blocks, { tags: ['RAG', 'LLM'], sourceName: '合成来源', sourceUrl: 'https://example.invalid/tutorial' })).toEqual({ resourceTitle: '合成资源', resourceDescription: '合成正文\n合成来源\nhttps://example.invalid/tutorial', resourceTags: 'RAG\nLLM', postLabels: '', mediaCaption: '合成图片说明\ntypescript' })
  })
  it('正常教程、模型术语和代码默认放行，不将技术词当禁词', () => {
    expect(detectContent({ postTitle: 'LLM / RAG 教程', postBody: 'Transformer、AI Agent、ComfyUI。\nconst compass = process.env.API_KEY;\npassword = "YOUR_PASSWORD";\napi_key = "replace_with_your_key";' }, defaultContentDetectionPolicy).action).toBe('allow')
  })
  it('规范化全角、零宽和大小写但保留原文', () => {
    const input = { postBody: '  Ｒ\u200bＡＧ\ufeff！' }, original = input.postBody
    expect(detectContent(input, policy()).action).toBe('warn')
    expect(input.postBody).toBe(original)
  })
  it.each(['drag ragged RAG_INDEX', '中文rag中文', '𠀀rag𠀀'])('技术词不命中词内或Unicode字母内部：%s', (postBody) => {
    expect(detectContent({ postBody }, policy()).action).toBe('allow')
  })
  it.each(['(RAG)', 'RAG / LLM', 'tool:rag', 'ragged, rag'])('检测完整技术词：%s', (postBody) => {
    expect(detectContent({ postBody }, policy()).action).toBe('warn')
  })
  it('不把正则元字符当表达式执行', () => {
    expect(detectContent({ postBody: 'abab' }, policy({ method: 'literal', content: '(a+)+' })).action).toBe('allow')
    expect(detectContent({ postBody: '(a+)+' }, policy({ method: 'literal', content: '(a+)+' })).action).toBe('warn')
  })
  it('字段限制、禁用规则、精确匹配和策略版本有效', () => {
    expect(detectContent({ bio: 'rag' }, policy()).action).toBe('allow')
    expect(detectContent({ postBody: 'rag' }, policy({ enabled: false })).action).toBe('allow')
    expect(detectContent({ postBody: 'rag tutorial' }, policy({ method: 'exact' })).action).toBe('allow')
    expect(detectContent({ postBody: 'RAG' }, policy({ method: 'exact' }))).toMatchObject({ action: 'warn', ruleVersion: 7 })
  })
  it('凭据检测覆盖代码、字符变体、图片说明和资源标签，解释不泄露原文', () => {
    const result = detectContent({ postBody: `const token = '${syntheticToken}';`, mediaCaption: syntheticToken, resourceTags: syntheticToken.split('').join('\u200b') }, defaultContentDetectionPolicy)
    expect(result.action).toBe('review')
    expect(result.hits.map((hit) => hit.field)).toEqual(['postBody', 'resourceTags', 'mediaCaption'])
    expect(JSON.stringify(result)).not.toContain(syntheticToken)
    expect(result.mediaReview).toBe('not_performed')
  })
  it('短术语和普通数字不误作凭据，有上下文的合成隐私样本进入复核', () => {
    // 全零尾部和无效日期只用于格式检测，均不是实际身份资料。
    const id = '990000' + '00000000' + '0000'
    expect(detectContent({ postBody: `运行编号${id}，batch_size=32，API_KEY=example` }, defaultContentDetectionPolicy).action).toBe('allow')
    expect(detectContent({ bio: `身份证号：${id}` }, defaultContentDetectionPolicy).action).toBe('review')
  })
  it('反诈引用保留原文进入人工复核，不把关键词命中直接封禁', () => {
    const input = { postBody: '反诈案例：先交保证金再返佣。不要相信这种承诺。' }
    expect(detectContent(input, defaultContentDetectionPolicy).action).toBe('review')
    expect(input.postBody).toContain('反诈案例')
  })
  it('取最高风险动作；allow规则不能成为永久免检白名单', () => {
    const rules = (['allow', 'warn', 'review', 'reject'] as const).map((action) => ({ ...policy().rules[0]!, id: action, action }))
    expect(detectContent({ postBody: 'rag' }, { version: 2, rules }).action).toBe('reject')
    expect(detectContent({ postBody: 'rag' }, { version: 2, rules: rules.reverse() }).action).toBe('reject')
  })
  it.each([
    { method: 'regex', content: '(a+)+' }, { method: 'detector', content: '__proto__' }, { content: '\u200b' },
    { fields: [] }, { fields: ['unknown'] }, { action: 'ban' }, { enabled: 'true' }, { exemptionUserIds: ['test'] },
  ])('拒绝无效或可扩大权限的规则：%j', (patch) => {
    expect(() => validateContentDetectionPolicy({ version: 1, rules: [{ ...policy().rules[0], ...patch }] })).toThrow()
  })
  it('拒绝重复规则ID、无效版本、超量规则及超长输入', () => {
    expect(() => validateContentDetectionPolicy({ version: 0, rules: [] })).toThrow()
    expect(() => validateContentDetectionPolicy({ version: 1, rules: [policy().rules[0], policy().rules[0]] })).toThrow()
    expect(() => validateContentDetectionPolicy({ version: 1, rules: Array(101).fill(policy().rules[0]) })).toThrow()
    expect(() => detectContent({ postBody: 'a'.repeat(30001) }, policy())).toThrow()
  })
})
