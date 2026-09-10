import { loadBadgeContext } from './user-badges'
import { BadRequestException, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { CommunityPost, Prisma } from '@prisma/client'
import sanitizeHtml from 'sanitize-html'
import { communityInlineTokens, normalizeTopicName, type CommunityContentBlock, type CommunityInlineReference, type CommunityInlineReferenceDto, type CommunityQuotedPostDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { CommunityNotificationService } from './notification.service'
import { visibleProfile, visiblePublicPost } from './governance-policy'
import { authorDto, authorInclude, json } from './community.mapper'
import { rateLimit } from '../../common/persistence'

export function postInlineTokens(blocks: CommunityContentBlock[]) {
  return blocks.flatMap((block) => {
    if (block.type === 'code' || block.type === 'image') return []
    if (block.type !== 'rich_text') return communityInlineTokens(block.type === 'list' ? block.items.join('\n') : block.text)
    let text = '', ignored = 0
    sanitizeHtml(block.text, {
      onOpenTag(name) { if (['a', 'code', 'pre'].includes(name)) { ignored++; text += '\n' } else if (!['span', 'b', 'strong', 'i', 'em', 'u', 's'].includes(name)) text += '\n' },
      onCloseTag(name) { if (['a', 'code', 'pre'].includes(name)) { ignored--; text += '\n' } else if (!['span', 'b', 'strong', 'i', 'em', 'u', 's'].includes(name)) text += '\n' },
      textFilter(value) { if (!ignored) text += value; return value },
    })
    return communityInlineTokens(text)
  })
}
const refKey = (ref: Pick<CommunityInlineReference, 'kind' | 'text'>) => `${ref.kind}:${normalizeTopicName(ref.text.slice(1))}`
const readRefs = (value: Prisma.JsonValue): CommunityInlineReference[] => Array.isArray(value) ? value as unknown as CommunityInlineReference[] : []

@Injectable()
export class CommunityPostRelationsService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: CommunityVisibilityPolicyService, private readonly notifications: CommunityNotificationService) {}

  async quote(tx: Prisma.TransactionClient, authorId: string, targetId: string | null, current: CommunityPost | null, publishing: boolean) {
    if (current?.id === targetId) throw new BadRequestException('不能引用自己这篇帖子')
    if (current && current.quotedPostId !== targetId && (current.publishedAt || await tx.communityPostRevision.count({ where: { postId: current.id, statusSnapshot: 'published' } }))) throw new BadRequestException('已公开帖子的引用目标不能更换')
    if (!targetId || current?.quotedPostId === targetId && current.status === 'published') return
    const target = await tx.communityPost.findFirst({ where: { AND: [visiblePublicPost(), await this.visibility.where(authorId), { id: targetId }] }, select: { id: true } })
    // 原帖失效仍可保存已有草稿，重新发布时必须重新核验。
    if (!target && (publishing || current?.quotedPostId !== targetId)) throw new BadRequestException('只能引用当前可见的公开帖子')
  }

  async resolve(tx: Prisma.TransactionClient, post: CommunityPost, manualIds: string[], proposed: CommunityInlineReference[] = [], previous: CommunityInlineReference[] = []) {
    const tokens = [...new Map(postInlineTokens(post.contentBlocks as CommunityContentBlock[]).map((token) => [refKey(token), token])).values()]
    if (tokens.filter((token) => token.kind === 'mention').length > 8) throw new BadRequestException('每篇帖子最多提及 8 位用户')
    const topicTokens = tokens.filter((token) => token.kind === 'topic')
    if (topicTokens.length > 5) throw new BadRequestException('每篇帖子最多关联 5 个话题')
    const prior = new Map(previous.map((ref) => [refKey(ref), ref])), selected = new Map(proposed.map((ref) => [refKey(ref), ref]))
    const exclusions = tokens.some((token) => token.kind === 'mention') ? await this.visibility.authorExclusions(post.authorId) : { authors: [] }
    const users = tokens.some((token) => token.kind === 'mention') ? await tx.user.findMany({ where: { ...visibleProfile(), id: { notIn: exclusions.authors }, username: { in: tokens.filter((token) => token.kind === 'mention').map((token) => token.query), mode: 'insensitive' } }, select: { id: true, username: true } }) : []
    const topics = await tx.communityTopic.findMany({ where: { OR: [{ id: { in: [...manualIds, ...previous.filter((ref) => ref.kind === 'topic').map((ref) => ref.id), ...proposed.filter((ref) => ref.kind === 'topic').map((ref) => ref.id)] } }, { normalizedName: { in: topicTokens.map((token) => token.query) } }] } })
    if (manualIds.some((id) => !topics.some((topic) => topic.id === id && topic.status === 'active'))) throw new BadRequestException('话题已关闭或不存在')
    const joins = new Map(manualIds.map((id) => [id, true])), refs: CommunityInlineReference[] = []
    let unresolvedTopics = 0
    for (const token of tokens) {
      const key = refKey(token), old = prior.get(key), pick = selected.get(key)
      if (token.kind === 'mention') {
        // 已保存的 ID 是历史关联；即使用户名被别人复用也绝不重新绑定。
        if (old) { refs.push({ ...old, text: token.text }); continue }
        const user = users.find((user) => user.username?.toLowerCase() === token.query)
        if (pick && pick.id !== user?.id) throw new BadRequestException('所选用户已改名或不可互动，请重新选择；正文已保留')
        if (user) refs.push({ kind: 'mention', text: token.text, id: user.id })
        continue
      }
      let topic = old ? topics.find((topic) => topic.id === old.id) : topics.find((topic) => topic.normalizedName === token.query)
      if (!topic && pick) topic = topics.find((topic) => topic.id === pick.id && normalizeTopicName(topic.name) === token.query)
      if (topic && topic.status !== 'active') continue
      if (!topic && post.status === 'published' && post.visibility === 'public') {
        await rateLimit(tx, post.authorId, 'community-new-topic', 10, 3600000, '新建话题过于频繁，请稍后再试')
        topic = await tx.communityTopic.upsert({ where: { normalizedName: token.query }, update: {}, create: { name: token.text.slice(1), normalizedName: token.query, slug: `inline-${createHash('sha256').update(token.query).digest('hex').slice(0, 32)}` } })
        if (topic.status !== 'active') continue
      }
      if (!topic) { unresolvedTopics++; continue }
      joins.set(topic.id, joins.get(topic.id) || false)
      refs.push({ kind: 'topic', text: token.text, id: topic.id })
    }
    if (joins.size + unresolvedTopics > 5) throw new BadRequestException('正文和手动选择合计最多关联 5 个话题')
    await tx.communityPost.update({ where: { id: post.id }, data: { inlineReferences: json(refs) } })
    await tx.communityPostTopic.deleteMany({ where: { postId: post.id } })
    await tx.communityPostTopic.createMany({ data: [...joins].map(([topicId, manual]) => ({ postId: post.id, topicId, manual })), skipDuplicates: true })
    return { refs, topicIds: [...joins.keys()] }
  }

  async notify(tx: Prisma.TransactionClient, post: CommunityPost, refs: CommunityInlineReference[], previous: CommunityInlineReference[] = []) {
    if (post.status !== 'published') return
    const targets: Array<{ id: string; type: 'mention' | 'quote' }> = refs.filter((ref) => ref.kind === 'mention' && !previous.some((old) => old.kind === 'mention' && old.id === ref.id)).map((ref) => ({ id: ref.id, type: 'mention' as const }))
    const quote = post.quotedPostId ? await tx.communityPost.findFirst({ where: { AND: [visiblePublicPost(), { id: post.quotedPostId }] }, select: { authorId: true } }) : null
    if (quote) targets.push({ id: quote.authorId, type: 'quote' })
    for (const target of [...new Map(targets.map((item) => [`${item.type}:${item.id}`, item])).values()]) {
      if (target.id === post.authorId || !await tx.user.count({ where: { id: target.id, ...visibleProfile() } })) continue
      if (!await tx.communityPost.count({ where: { AND: [await this.visibility.where(target.id), { id: post.id }] } })) continue
      await this.notifications.send(target.id, post.authorId, target.type, 'post', post.id, tx)
    }
  }

  async approve(tx: Prisma.TransactionClient, postId: string) {
    const post = await tx.communityPost.findUniqueOrThrow({ where: { id: postId }, include: { topics: true } })
    await this.quote(tx, post.authorId, post.quotedPostId, null, true)
    const resolved = await this.resolve(tx, post, post.topics.filter((topic) => topic.manual).map((topic) => topic.topicId), [], readRefs(post.inlineReferences))
    await this.notify(tx, post, resolved.refs)
  }

  async links(userId: string, values: Prisma.JsonValue[]): Promise<Map<string, CommunityInlineReferenceDto[]>> {
    const refs = values.flatMap(readRefs), excluded = await this.visibility.authorExclusions(userId)
    const [users, topics] = await Promise.all([
      refs.some((ref) => ref.kind === 'mention') ? this.prisma.user.findMany({ where: { ...visibleProfile(), id: { in: refs.filter((ref) => ref.kind === 'mention').map((ref) => ref.id), notIn: excluded.authors } }, select: { id: true } }) : [],
      refs.some((ref) => ref.kind === 'topic') ? this.prisma.communityTopic.findMany({ where: { status: 'active', id: { in: refs.filter((ref) => ref.kind === 'topic').map((ref) => ref.id) } }, select: { id: true, slug: true } }) : [],
    ])
    return new Map(values.map((value) => [JSON.stringify(value), readRefs(value).map((ref) => ({ ...ref, route: ref.kind === 'mention' ? users.some((user) => user.id === ref.id) ? `/community/people/${encodeURIComponent(ref.id)}` : undefined : topics.find((topic) => topic.id === ref.id) ? `/community/topic/${encodeURIComponent(topics.find((topic) => topic.id === ref.id)!.slug)}` : undefined }))]))
  }

  async quotes(userId: string, rows: CommunityPost[]) {
    const where = await this.visibility.where(userId), ids = rows.flatMap((row) => row.quotedPostId ? [row.quotedPostId] : [])
    const [targets, counts] = await Promise.all([
      ids.length ? this.prisma.communityPost.findMany({ where: { AND: [visiblePublicPost(), where, { id: { in: ids } }] }, include: { author: { include: authorInclude } } }) : [],
      rows.length ? this.prisma.communityPost.groupBy({ by: ['quotedPostId'], where: { AND: [where, { status: 'published', quotedPostId: { in: rows.map((row) => row.id) } }] }, _count: { _all: true } }) : [],
    ])
    const links = await this.links(userId, targets.map((target) => target.inlineReferences))
    const badgeContext = await loadBadgeContext(this.prisma)
    const previews = new Map<string, CommunityQuotedPostDto>(ids.map((id) => [id, { id, available: false }]))
    for (const target of targets) {
      const blocks = target.contentBlocks as CommunityContentBlock[]
      // 摘要不含媒体块和原帖的引用对象；文件仍由原帖自己的访问策略校验。
      const excerpt = target.plainText.slice(0, 280).replace(/[#@][\p{L}\p{N}_]*$/u, '')
      previews.set(target.id, { id: target.id, available: true, author: authorDto(target.author, badgeContext), publishedAt: target.publishedAt!.toISOString(), title: target.title, contentBlocks: [{ type: 'paragraph', text: excerpt }], inlineReferences: links.get(JSON.stringify(target.inlineReferences)) || [], thumbnailFileId: blocks.find((block) => block.type === 'image')?.fileId || undefined })
    }
    return { previews, counts: new Map(counts.map((row) => [row.quotedPostId, row._count._all])) }
  }
}
