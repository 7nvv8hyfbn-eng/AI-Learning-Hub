import type { CommunityContentBlock } from './community'

export const contentDetectionFields = [
  'username', 'displayName', 'bio', 'headline', 'location', 'websiteUrl', 'expertiseTopics',
  'postTitle', 'postBody', 'postLabels', 'commentBody', 'resourceTitle', 'resourceDescription', 'resourceTags',
  'collectionName', 'collectionDescription', 'collectionGoal', 'mediaCaption',
] as const
export type ContentDetectionField = typeof contentDetectionFields[number]
export const contentDetectionActions = ['allow', 'warn', 'review', 'reject'] as const
export type ContentDetectionAction = typeof contentDetectionActions[number]
export const contentDetectionCategories = ['spam', 'scam', 'harassment', 'privacy', 'credential', 'school'] as const
export const contentDetectionMethods = ['literal', 'token', 'exact', 'detector'] as const
export interface ContentDetectionRule {
  id: string
  content: string
  method: typeof contentDetectionMethods[number]
  fields: ContentDetectionField[]
  category: typeof contentDetectionCategories[number]
  action: ContentDetectionAction
  enabled: boolean
  explanation: string
}
export interface ContentDetectionPolicy {
  version: number
  rules: ContentDetectionRule[]
}
export type ContentDetectionInput = Partial<Record<ContentDetectionField, string>>
export interface ContentDetectionResult {
  review?: { id: string; status: 'not_required' | 'pending' | 'approved' | 'rejected' | 'superseded'; reason: string }
  action: ContentDetectionAction
  ruleVersion: number
  // 不返回命中原文，防止凭据、个人资料进入提示、日志和分析事件。
  hits: Array<{
    ruleId: string
    field: ContentDetectionField
    category: ContentDetectionRule['category']
    action: ContentDetectionAction
    explanation: string
  }>
  mediaReview: 'not_performed'
}

export interface ContentReviewDto {
  id: string
  targetType: 'post' | 'comment' | 'profile' | 'collection' | 'resource'
  targetId: string
  authorId: string
  contentRevision: number
  ruleVersion: number
  status: NonNullable<ContentDetectionResult['review']>['status']
  findings: ContentDetectionResult
  reason: string
  createdAt: string
  // 仅有复核权限的详情接口返回原文；列表不批量返回可能含隐私的输入。
  payload?: unknown
  contentAvailable?: boolean
}

export class ContentDetectionError extends Error {}

// 只操作检测副本。保留分隔符，避免把技术词、代码变量和数字串拼成另一段文字。
const normalize = (value: string) => value.normalize('NFKC').replace(/[\p{Cf}\u034f\ufe00-\ufe0f]/gu, '').toLowerCase()

// 固定且有界的检测器；管理端不能注入任意正则。格式命中只能说明疑似泄露，不能证明凭据有效。
const detectors: Record<string, RegExp> = {
  credential: /(?:\bgh[pousr]_[a-z0-9]{36,255}\b|\bgithub_pat_[a-z0-9_]{40,255}\b|\b(?:akia|asia)[a-z0-9]{16}\b|\bsk-(?:proj-|svcacct-)?[a-z0-9_-]{32,200}\b|-----begin (?:rsa |ec |dsa |openssh )?private key-----|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b[\s"']{0,4}[:=][\s"']{0,4}(?=[a-z0-9_+/.=-]{16,200}(?:[\s"';,}]|$))(?=[a-z0-9_+/.=-]{0,199}[0-9])(?=[a-z0-9_+/.=-]{0,199}[a-z])[a-z0-9_+/.=-]{16,200})/u,
  personal_data: /(?:身份证(?:号码?|号)?[\s:：="']{0,6}[1-9][0-9]{16}[0-9x](?![0-9])|(?:手机号|手机号码|联系电话)[\s:：="']{0,6}(?:\+86[ -]?)?1[3-9][0-9]{9}(?![0-9]))/u,
}

export const defaultContentDetectionPolicy: ContentDetectionPolicy = {
  version: 1,
  rules: [
    { id: 'credential-format', content: 'credential', method: 'detector', fields: [...contentDetectionFields], category: 'credential', action: 'review', enabled: true, explanation: '检测到疑似密钥、令牌或私钥格式，请移除真实凭据；合成示例可提交复核。' },
    { id: 'personal-data-context', content: 'personal_data', method: 'detector', fields: [...contentDetectionFields], category: 'privacy', action: 'review', enabled: true, explanation: '检测到带身份或联系方式说明的完整号码，请确认已获授权并优先脱敏。' },
    { id: 'advance-payment-scam', content: '先交保证金再返佣', method: 'literal', fields: [...contentDetectionFields], category: 'scam', action: 'review', enabled: true, explanation: '涉及先付款再返佣的高风险描述；反诈教学也可能命中，需结合上下文复核。' },
    { id: 'promotional-contact', content: '加群领取付费资源', method: 'literal', fields: [...contentDetectionFields], category: 'spam', action: 'warn', enabled: true, explanation: '请确认资源授权，避免通过群聊引导付费或传播未经授权的资料。' },
    { id: 'targeted-harassment', content: '大家一起去骚扰', method: 'literal', fields: [...contentDetectionFields], category: 'harassment', action: 'review', enabled: true, explanation: '涉及号召骚扰的描述，请改为针对事实的讨论；引用案例可提交复核。' },
  ],
}

export function validateContentDetectionPolicy(value: unknown): asserts value is ContentDetectionPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentDetectionError('内容检测策略必须为对象')
  const policy = value as ContentDetectionPolicy
  if (Object.keys(policy).some((key) => !['version', 'rules'].includes(key)) || !Number.isSafeInteger(policy.version) || policy.version < 1 || !Array.isArray(policy.rules) || policy.rules.length > 100) throw new ContentDetectionError('规则版本无效或规则数量超过100条')
  const ids = new Set<string>()
  for (const rule of policy.rules) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)
      || Object.keys(rule).some((key) => !['id', 'content', 'method', 'fields', 'category', 'action', 'enabled', 'explanation'].includes(key))
      || typeof rule.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(rule.id) || ids.has(rule.id)
      || typeof rule.content !== 'string' || rule.content.length > 200 || !normalize(rule.content).trim()
      || !contentDetectionMethods.includes(rule.method) || !contentDetectionCategories.includes(rule.category)
      || !contentDetectionActions.includes(rule.action) || typeof rule.enabled !== 'boolean'
      || !Array.isArray(rule.fields) || !rule.fields.length || rule.fields.some((field) => !contentDetectionFields.includes(field)) || new Set(rule.fields).size !== rule.fields.length
      || typeof rule.explanation !== 'string' || !rule.explanation.trim() || rule.explanation.length > 500
      || (rule.method === 'detector' && !Object.hasOwn(detectors, rule.content))) throw new ContentDetectionError('规则字段、匹配方式或说明无效')
    if (rule.method === 'token' && !/^[a-z0-9_][a-z0-9_ .+/-]*[a-z0-9_]$|^[a-z0-9_]$/i.test(normalize(rule.content))) throw new ContentDetectionError('技术词边界匹配仅支持以字母、数字或下划线起止的英文词或短语')
    ids.add(rule.id)
  }
}

export function detectContent(input: ContentDetectionInput, policy: ContentDetectionPolicy): ContentDetectionResult {
  validateContentDetectionPolicy(policy)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContentDetectionError('检测文本必须为字段对象')
  const copy: ContentDetectionInput = {}
  let length = 0
  for (const [field, value] of Object.entries(input)) {
    if (!contentDetectionFields.includes(field as keyof ContentDetectionInput) || typeof value !== 'string' || value.length > 30000) throw new ContentDetectionError('检测字段或文本长度无效')
    length += value.length
    if (length > 100000) throw new ContentDetectionError('一次检测文本总量不能超过100000字')
    copy[field as keyof ContentDetectionInput] = normalize(value)
  }
  const result: ContentDetectionResult = { action: 'allow', ruleVersion: policy.version, hits: [], mediaReview: 'not_performed' }
  for (const rule of policy.rules) {
    if (!rule.enabled) continue
    const term = normalize(rule.content)
    for (const field of rule.fields) {
      const value = copy[field]
      if (value === undefined) continue
      let matched = rule.method === 'detector' ? detectors[rule.content]!.test(value) : rule.method === 'exact' ? value === term : rule.method === 'literal' ? value.includes(term) : false
      if (rule.method === 'token') {
        for (let at = value.indexOf(term); at !== -1; at = value.indexOf(term, at + term.length)) {
          // 两个UTF-16码元足以保留相邻Unicode字符，无需转换整段文本。
          if (!/[\p{L}\p{N}_]$/u.test(value.slice(Math.max(0, at - 2), at)) && !/^[\p{L}\p{N}_]/u.test(value.slice(at + term.length, at + term.length + 2))) { matched = true; break }
        }
      }
      if (!matched) continue
      result.hits.push({ ruleId: rule.id, field, category: rule.category, action: rule.action, explanation: rule.explanation })
      if (contentDetectionActions.indexOf(rule.action) > contentDetectionActions.indexOf(result.action)) result.action = rule.action
    }
  }
  return result
}

// 正常投稿和后台恢复必须检查同一份公开文字，不另造管理员豁免路径。
export function postDetectionInput(title: string | null | undefined, body: string, blocks: CommunityContentBlock[], contribution?: { tags: string[]; sourceName?: string | null; sourceUrl?: string | null } | null, labels: string[] = []): ContentDetectionInput {
  // 正文纯文本之外也检测富文本链接目标，避免用链接文字掩盖敏感地址。
  body = [body, ...blocks.flatMap((block) => block.type === 'rich_text' ? [block.text] : [])].join('\n')
  return {
    ...(contribution ? { resourceTitle: title || '', resourceDescription: [body, contribution.sourceName, contribution.sourceUrl].filter(Boolean).join('\n'), resourceTags: contribution.tags.join('\n') } : { postTitle: title || '', postBody: body }),
    postLabels: labels.join('\n'),
    mediaCaption: blocks.flatMap((block) => block.type === 'image' ? [block.alt || ''] : block.type === 'code' ? [block.language] : []).join('\n'),
  }
}
