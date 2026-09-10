import { describe, expect, it } from 'vitest'
import { communityInlineAtCaret, communityInlineTokens, normalizeTopicName } from '@ai-learning-hub/contracts'
describe('正文话题和提及规则', () => {
  it('中文和大小写话题保持显示文本，统一查询；普通编号、URL、邮箱、代码不识别', () => {
    const text = '#模型部署，#RebelHeart #rebelheart @Zhang_01 #123 #___ https://site.test/#fake a@user.test `#code @fake`\n```ts\n#hidden\n```\n[标题#fake](https://test/#url)'
    expect(communityInlineTokens(text).map(({ kind, text, query }) => ({ kind, text, query }))).toEqual([
      { kind: 'topic', text: '#模型部署', query: '模型部署' }, { kind: 'topic', text: '#RebelHeart', query: 'rebelheart' },
      { kind: 'topic', text: '#rebelheart', query: 'rebelheart' }, { kind: 'mention', text: '@Zhang_01', query: 'zhang_01' },
    ])
    expect(normalizeTopicName('ＡＩ')).toBe('ai')
  })
  it('中间位置仅替换当前标记，保留 UTF-16 光标偏移，空白和标点结束', () => {
    const text = '前文😀 #模型 后文 @zhang'
    const caret = text.indexOf(' 后文')
    expect(communityInlineAtCaret(text, caret)).toMatchObject({ text: '#模型', start: 5, end: caret })
    expect(communityInlineAtCaret('#', 1)).toMatchObject({ kind: 'topic', query: '' })
    expect(communityInlineAtCaret('@', 1)).toMatchObject({ kind: 'mention', query: '' })
    for (const value of ['#模型 ', '#模型，', 'plain', 'a@valid.test', '`@code`', 'https://test/#模型']) expect(communityInlineAtCaret(value, value.length)).toBeNull()
    expect(communityInlineAtCaret('name@user.test', 6)).toBeNull()
    expect(communityInlineTokens(`#${'话'.repeat(31)} @___ @abc #话题_2026`).map((token) => token.text)).toEqual(['#话题_2026'])
  })
})
