/** 前后端共用的正文标记规则；HTML 由调用方先按安全文本节点读取。 */
export const COMMUNITY_USERNAME_PATTERN = /^(?!_)(?!.*__)[a-z0-9_]{4,24}(?<!_)$/
export const topicMarkerName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, '_')
export const normalizeTopicName = (name: string) => topicMarkerName(name).toLowerCase()
export interface CommunityInlineToken { kind: 'topic' | 'mention'; text: string; query: string; start: number; end: number }
export interface CommunityInlineReference { kind: 'topic' | 'mention'; text: string; id: string }
export interface CommunityInlineReferenceDto extends CommunityInlineReference { route?: string }
export interface CommunityInlineCandidateDto {
  kind: 'topic' | 'mention'; id: string; name: string
  username?: string; avatar?: string | null; verifiedType?: 'none' | 'teacher' | 'mentor' | 'official'; badges?: import('./badges').CommunityUserBadge[]; postCount?: number
}

// 只屏蔽不应识别标记的区段，保留 UTF-16 偏移供 textarea 光标使用。
const maskedText = (text: string) => text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*(?:`|$)|!?\[[^\]\n]*\]\([^\)\n]*\)|(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, (value) => ' '.repeat(value.length))
const marker = /(^|[^\p{L}\p{N}_@#/\\])([#@])([\p{L}\p{N}_]*)/gu
const token = (match: RegExpExecArray): CommunityInlineToken => {
  const text = match[2]! + match[3]!, start = match.index + match[1]!.length
  return { kind: match[2] === '#' ? 'topic' : 'mention', text, query: normalizeTopicName(match[3]!), start, end: start + text.length }
}
export const communityInlineTokens = (text: string): CommunityInlineToken[] => {
  const result: CommunityInlineToken[] = []
  for (const match of maskedText(text).matchAll(marker)) {
    const value = token(match), name = value.text.slice(1)
    if (value.kind === 'topic' ? !name || [...name].length > 30 || /^[\p{N}_]+$/u.test(name) : !COMMUNITY_USERNAME_PATTERN.test(value.query)) continue
    result.push(value)
  }
  return result
}
export const communityInlineAtCaret = (text: string, caret: number): CommunityInlineToken | null => {
  if (caret < 0 || caret > text.length) return null
  // 屏蔽完整原文后再截断，避免 URL、邮箱中间位置被当作新标记。
  const prefix = maskedText(text).slice(0, caret)
  const matches = [...prefix.matchAll(marker)], last = matches.at(-1)
  if (!last) return null
  const value = token(last)
  if (value.end !== caret || [...value.text.slice(1)].length > (value.kind === 'topic' ? 30 : 24)) return null
  if (value.kind === 'mention' && !/^[\p{L}\p{N}_]*$/u.test(value.text.slice(1))) return null
  const suffix = /^[\p{L}\p{N}_]*/u.exec(text.slice(caret))![0]
  return { ...value, end: caret + suffix.length }
}
