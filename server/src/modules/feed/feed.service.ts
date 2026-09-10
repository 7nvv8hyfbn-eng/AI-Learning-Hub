import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { CommunityContextDto, CommunityFeedDto, CommunityFeedPolicyDto, CommunityImpressionsDto, CommunityViewContextDto, FeedUnitDto } from '@ai-learning-hub/contracts'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CommunityVisibilityPolicyService } from '../community/visibility.service'
import { CommunityPostService, postInclude } from '../community/post.service'
import { CommunityContextService } from '../community/context.service'
import { SignalsService } from '../signals/signals.service'
import { authorDto, json } from '../community/community.mapper'
import type { CommunityQueryDto, ImpressionsDto } from '../community/community.dto'
import { freshnessHours, learningFeedPolicy } from './feed-policy'
import { ContentReferenceService } from '../../common/content-reference/content-reference.service'
import type { CommunityBindingInput } from '@ai-learning-hub/contracts'

export interface FeedCandidateRef { postId: string; source: string; reasonCodes: string[] }
interface ScoredCandidate extends FeedCandidateRef { total: number; dimensions: Record<string, number>; authorId: string; postType: string; official: boolean; publishedAt: string; contentHash?: string; bindingIds?: string[] }
interface SessionEntry { type: 'post'; id: string; score: ScoredCandidate }
type StoredEntry = SessionEntry | Exclude<FeedUnitDto, { type: 'post' }>
const normalized = (value: number) => Math.max(0, Math.min(1, value))
const affinity = (value: Prisma.JsonValue): Record<string, number> => value as Record<string, number>
const stable = (value: string) => parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) / 0xffffffff

@Injectable()
export class LearningFeedPipeline {
  constructor(private readonly prisma: PrismaService, private readonly visibility: CommunityVisibilityPolicyService, private readonly posts: CommunityPostService, private readonly context: CommunityContextService, private readonly signals: SignalsService, private readonly config: ConfigService, private readonly references: ContentReferenceService) {}
  async policy(): Promise<CommunityFeedPolicyDto> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'community_feed_policy' } })
    return setting ? { ...setting.value as unknown as CommunityFeedPolicyDto, revision: setting.revision } : structuredClone(learningFeedPolicy)
  }
  private key() { return createHash('sha256').update(this.config.getOrThrow<string>('JWT_SECRET')).digest() }
  private encode(value: object) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
  }
  private decode(cursor: string): { session: string; offset: number; viewer: string; mode: string; type: string; policy: string } {
    try {
      const bytes = Buffer.from(cursor, 'base64url'), decipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString())
    } catch { throw new BadRequestException('游标无效，请刷新信息流') }
  }
  /** 候选只召回 ID，各来源有界；统一批量补齐避免逐帖查询。 */
  async collect(userId: string, query: CommunityQueryDto, policy: CommunityFeedPolicyDto, now: Date) {
    const [viewer, followed, followedTopics, progress, runs, favorites, attempts, snapshot, articleViews] = await Promise.all([
      this.visibility.viewer(userId),
      this.prisma.communityUserFollow.findMany({ where: { followerId: userId }, select: { followeeId: true } }),
      this.prisma.communityTopicFollow.findMany({ where: { userId }, select: { topicId: true } }),
      this.prisma.lessonProgress.findMany({ where: { userId }, select: { courseId: true, lessonId: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      this.prisma.labRun.findMany({ where: { userId }, select: { labId: true, lab: { select: { labType: true } } }, orderBy: { startedAt: 'desc' }, take: 20 }),
      this.prisma.favorite.findMany({ where: { userId }, select: { targetType: true, targetId: true }, orderBy: { createdAt: 'desc' }, take: 40 }),
      this.prisma.assessmentAttempt.findMany({ where: { userId }, select: { challengeId: true }, orderBy: { submittedAt: 'desc' }, take: 10 }),
      this.signals.snapshot(userId),
      this.prisma.articleView.findMany({ where: { userId }, select: { articleId: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ])
    const authorIds = followed.map((row) => row.followeeId), topicIds = followedTopics.map((row) => row.topicId)
    const favoriteRefs = await this.references.resolveMany(favorites.map((row) => ({ type: row.targetType as CommunityBindingInput['type'], id: row.targetId })), userId)
    const learnedIds = [...progress.flatMap((row) => [row.courseId, ...(row.lessonId ? [row.lessonId] : [])]), ...runs.map((row) => row.labId), ...[...favoriteRefs.values()].map((row) => row.id), ...attempts.map((row) => row.challengeId), ...articleViews.map((row) => row.articleId)]
    const highAffinityTopics = Object.entries(affinity(snapshot.topicAffinity)).filter(([, value]) => value > 0).map(([key]) => key)
    const [relatedCourses, relatedTopics, similarLabs] = await Promise.all([
      this.prisma.course.findMany({ where: { OR: [{ id: { in: learnedIds } }, { labs: { some: { labId: { in: learnedIds } } } }], status: 'published', deletedAt: null }, select: { themeId: true }, take: 60 }),
      this.prisma.communityPostTopic.findMany({ where: { post: { AND: [await this.visibility.where(userId), { bindings: { some: { targetId: { in: learnedIds } } } }] }, topic: { status: 'active' } }, select: { topicId: true }, distinct: ['topicId'], take: 60 }),
      this.prisma.lab.findMany({ where: { labType: { in: runs.map((row) => row.lab.labType) }, status: 'published', deletedAt: null }, select: { id: true }, take: 40 }),
    ])
    const interestTopics = [...new Set([...topicIds, ...highAffinityTopics, ...relatedTopics.map((row) => row.topicId), ...viewer.communityProfile?.expertiseTopics || []])]
    const interestThemes = relatedCourses.flatMap((row) => row.themeId ? [row.themeId] : [])
    const base: Prisma.CommunityPostWhereInput = { AND: [await this.visibility.where(userId), { publishedAt: { lte: now }, ...(query.type !== 'all' ? { postType: query.type } : {}) }] }
    const following: Prisma.CommunityPostWhereInput = { OR: [{ authorId: { in: authorIds } }, { topics: { some: { topicId: { in: topicIds } } } }] }
    if (query.mode !== 'for_you') {
      const rows = await this.prisma.communityPost.findMany({ where: { AND: [base, ...(query.mode === 'following' ? [following] : [])] }, select: { id: true }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 300 })
      return { candidates: rows.map((row) => ({ postId: row.id, source: query.mode, reasonCodes: [] })), authorIds, topicIds, learnedIds, viewer, snapshot }
    }
    const providers: Array<{ key: string; where: Prisma.CommunityPostWhereInput; orderBy?: Prisma.CommunityPostOrderByWithRelationInput[] }> = [
      { key: 'following', where: following },
      { key: 'learning_context', where: { bindings: { some: { targetId: { in: learnedIds } } } } },
      { key: 'topic_affinity', where: { OR: [{ topics: { some: { OR: [{ topicId: { in: interestTopics } }, { topic: { themeId: { in: interestThemes } } }] } } }, { bindings: { some: { targetType: 'lab', targetId: { in: similarLabs.map((row) => row.id) } } } }] } },
      { key: 'same_school', where: viewer.schoolId ? { author: { schoolId: viewer.schoolId } } : { id: '__no_school__' } },
      { key: 'quality', where: {}, orderBy: [{ usefulCount: 'desc' }, { bookmarkCount: 'desc' }, { commentCount: 'desc' }] },
      { key: 'unanswered', where: { postType: 'question', question: { status: 'open' }, ...(interestTopics.length || interestThemes.length ? { topics: { some: { OR: [{ topicId: { in: interestTopics } }, { topic: { themeId: { in: interestThemes } } }] } } } : {}) } },
      { key: 'official', where: { author: { communityProfile: { verifiedType: 'official' }, userRoles: { some: { role: { code: 'community_official' } } } } } },
      { key: 'exploration', where: { authorId: { notIn: authorIds }, publishedAt: { gte: new Date(now.getTime() - 30 * 86400000) } }, orderBy: [{ impressionCount: 'asc' }] },
    ]
    const collected = await Promise.all(providers.map(async (provider) => {
      const rows = await this.prisma.communityPost.findMany({ where: { AND: [base, provider.where] }, select: { id: true }, orderBy: [...provider.orderBy || [], { publishedAt: 'desc' }, { id: 'desc' }], take: Math.min(60, policy.candidateLimits[provider.key] || 30) })
      return rows.map((row) => ({ postId: row.id, source: provider.key, reasonCodes: [provider.key] }))
    }))
    const merged = new Map<string, FeedCandidateRef>()
    for (const candidate of collected.flat()) {
      const existing = merged.get(candidate.postId)
      if (existing) existing.reasonCodes.push(...candidate.reasonCodes)
      else if (merged.size < 300) merged.set(candidate.postId, candidate)
    }
    return { candidates: [...merged.values()], authorIds, topicIds, learnedIds, viewer, snapshot }
  }
  async rank(userId: string, query: CommunityQueryDto, policy: CommunityFeedPolicyDto, now: Date): Promise<ScoredCandidate[]> {
    const collected = await this.collect(userId, query, policy, now), ids = collected.candidates.map((row) => row.postId)
    const [rows, reactions, bookmarks, schoolComments, actions, seen, teacherComments] = await Promise.all([
      this.prisma.communityPost.findMany({ where: { AND: [await this.visibility.where(userId), { id: { in: ids } }] }, include: { ...postInclude, _count: { select: { reports: { where: { status: { in: ['pending', 'reviewing'] } } } } } } }),
      this.prisma.communityPostReaction.groupBy({ by: ['postId'], where: { postId: { in: ids }, userId: { in: collected.authorIds } }, _count: true }),
      this.prisma.communityBookmark.groupBy({ by: ['postId'], where: { postId: { in: ids }, userId: { in: collected.authorIds } }, _count: true }),
      this.prisma.communityComment.groupBy({ by: ['postId'], where: { postId: { in: ids }, deletedAt: null, author: { schoolId: collected.viewer.schoolId || '__none__' } }, _count: true }),
      this.prisma.activityEvent.groupBy({ by: ['targetId'], where: { targetType: 'post', targetId: { in: ids }, eventType: { in: ['community_to_course', 'community_to_lab', 'community_to_resource', 'community_to_challenge', 'community_course_started', 'community_lab_started'] } }, _count: true }),
      this.prisma.communityFeedImpression.findMany({ where: { viewerId: userId, postId: { in: ids }, impressedAt: { gt: new Date(now.getTime() - 86400000) } }, select: { postId: true } }),
      this.prisma.communityComment.findMany({ where: { postId: { in: ids }, deletedAt: null, status: 'published', author: { status: 'active', communityProfile: { verifiedType: { in: ['teacher', 'mentor'] } }, userRoles: { some: { role: { code: { in: ['teacher', 'mentor'] } } } } } }, select: { postId: true } }),
    ])
    const rowMap = new Map(rows.map((row) => [row.id, row]))
    const scored = collected.candidates.flatMap((candidate): ScoredCandidate[] => {
      const row = rowMap.get(candidate.postId)
      if (!row) return []
      const source = candidate.reasonCodes, blocks = row.contentBlocks as Array<{ type: string }>, author = authorDto(row.author)
      const overlap = row.bindings.some((ref) => collected.learnedIds.includes(ref.targetId)), topicOverlap = row.topics.some((ref) => collected.topicIds.includes(ref.topicId))
      const topicStrength = Math.max(0, ...row.topics.map((ref) => affinity(collected.snapshot.topicAffinity)[ref.topicId] || 0))
      const contentStrength = Math.max(0, ...row.bindings.map((ref) => affinity(collected.snapshot.learningContentAffinity)[`${ref.targetType}:${ref.targetId}`] || 0))
      const teacherAnswered = teacherComments.some((comment) => comment.postId === row.id)
      const socialCount = (reactions.find((r) => r.postId === row.id)?._count || 0) + (bookmarks.find((r) => r.postId === row.id)?._count || 0) + (schoolComments.find((r) => r.postId === row.id)?._count || 0)
      const dimensions = {
        learning: normalized((overlap ? 0.6 : 0) + (topicOverlap ? 0.3 : 0) + topicStrength / 50 + contentStrength / 100),
        quality: normalized((row.plainText.length > 80 ? 0.3 : 0.05) + (row.bindings.length ? 0.2 : 0) + (blocks.some((b) => b.type === 'code' || b.type === 'image') ? 0.15 : 0) + (row.question?.acceptedCommentId ? 0.2 : 0) + (teacherAnswered || ['teacher', 'mentor'].includes(author.verifiedType) ? 0.15 : 0)),
        relationship: normalized((collected.authorIds.includes(row.authorId) ? 0.7 : 0) + (row.author.schoolId && row.author.schoolId === collected.viewer.schoolId ? 0.2 : 0) + (row.author.departmentId && row.author.departmentId === collected.viewer.departmentId ? 0.1 : 0)),
        useful: normalized((row.usefulCount * 4 + row.bookmarkCount * 3 + row.commentCount * 2 + row.likeCount) / (row.impressionCount + 30)),
        freshness: normalized(Math.exp(-(now.getTime() - (row.publishedAt || row.createdAt).getTime()) / (freshnessHours[row.postType] * 3600000))),
        social: normalized(socialCount / 10),
        learningAction: normalized((actions.find((r) => r.targetId === row.id)?._count || 0) / 10),
        exploration: source.includes('exploration') ? stable(`${userId}:${now.toISOString().slice(0, 10)}:${row.id}`) : 0,
      }
      const penalties = (seen.some((r) => r.postId === row.id) ? policy.penalties.seen : 0) + (row.status === 'limited' ? policy.penalties.limited : 0) + normalized(row._count.reports / 10) * policy.penalties.report + (row.plainText.length < 30 ? policy.penalties.short : 0) + ((row.plainText.match(/https?:\/\//g) || []).length > 3 ? policy.penalties.links : 0)
      const total = normalized(Object.entries(dimensions).reduce((sum, [key, value]) => sum + value * (policy.weights[key] || 0), 0) - penalties)
      return [{ ...candidate, reasonCodes: [...candidate.reasonCodes, ...(teacherAnswered ? ['teacher_answered'] : [])], total, dimensions, authorId: row.authorId, postType: row.postType, official: author.verifiedType === 'official', publishedAt: (row.publishedAt || row.createdAt).toISOString(), contentHash: row.contentHash, bindingIds: row.bindings.map((binding) => binding.targetId) }]
    })
    return scored.sort((a, b) => (query.mode === 'for_you' ? b.total - a.total : 0) || b.publishedAt.localeCompare(a.publishedAt) || b.postId.localeCompare(a.postId))
  }
  assemble(candidates: ScoredCandidate[], policy: CommunityFeedPolicyDto, context: CommunityContextDto, personalized: boolean, contentType = 'all'): StoredEntry[] {
    const ordered: ScoredCandidate[] = []
    const remaining = [...candidates]
    const hashes = new Set<string>()
    while (remaining.length) {
      if (personalized && ordered.length) remaining.sort((a, b) => {
        const prior = new Set(ordered.slice(-9).flatMap((row) => row.bindingIds || []))
        const penalty = (row: ScoredCandidate) => row.bindingIds?.some((id) => prior.has(id)) ? policy.penalties.duplicateBinding || 0 : 0
        return (b.total - penalty(b)) - (a.total - penalty(a)) || b.publishedAt.localeCompare(a.publishedAt) || b.postId.localeCompare(a.postId)
      })
      const index = remaining.findIndex((row) => {
        if (!personalized) return true
        const window = ordered.slice(-(policy.diversity.authorWindowSize - 1))
        const last = ordered.slice(-policy.diversity.maxSameTypeConsecutive)
        return window.filter((item) => item.authorId === row.authorId).length < policy.diversity.maxSameAuthorInWindow
          && (!row.official || window.filter((item) => item.official).length < policy.diversity.maxOfficialInWindow)
          && !(contentType === 'all' && last.length === policy.diversity.maxSameTypeConsecutive && last.every((item) => item.postType === row.postType))
          && !(contentType === 'all' && ordered.length === 9 && !ordered.some((item) => ['question', 'lab_result'].includes(item.postType)) && !['question', 'lab_result'].includes(row.postType) && remaining.some((item) => ['question', 'lab_result'].includes(item.postType)))
      })
      if (index < 0) break
      const item = remaining.splice(index, 1)[0]
      const hash = item.contentHash || item.postId
      if (!hashes.has(hash)) { ordered.push(item); hashes.add(hash) }
    }
    const entries: StoredEntry[] = ordered.map((score) => ({ type: 'post', id: score.postId, score }))
    if (personalized) {
      const continueItem = context.continueCourse ? { type: 'continue_learning' as const, id: 'continue-course', content: context.continueCourse }
        : context.continueLab ? { type: 'continue_lab' as const, id: 'continue-lab', content: context.continueLab } : null
      if (continueItem && entries.length >= 4) entries.splice(4, 0, continueItem)
      if (context.currentChallenge && entries.length >= 9) entries.splice(9, 0, { type: 'challenge', id: 'weekly-challenge', content: context.currentChallenge })
      if (context.trendingTopics.length && entries.length >= 14) entries.splice(14, 0, { type: 'topic_suggestion', id: 'topics', topics: context.trendingTopics.slice(0, 3) })
      if (context.officialNotice && entries.length >= 19) entries.splice(19, 0, { type: 'official_notice', id: `notice-${context.officialNotice.id}`, content: context.officialNotice })
    }
    return entries
  }
  async feed(userId: string, query: CommunityQueryDto): Promise<CommunityFeedDto> {
    await this.visibility.viewer(userId)
    let offset = 0
    let session
    if (query.cursor) {
      const decoded = this.decode(query.cursor)
      if (decoded.viewer !== userId || decoded.mode !== query.mode || decoded.type !== query.type || !Number.isInteger(decoded.offset) || decoded.offset < 0 || decoded.offset > 350) throw new BadRequestException('游标与当前用户或筛选不匹配')
      session = await this.prisma.communityFeedSession.findFirst({ where: { id: decoded.session, viewerId: userId, mode: query.mode, contentType: query.type, policyVersion: decoded.policy, expiresAt: { gt: new Date() } } })
      if (!session) throw new BadRequestException('信息流已过期，请手动刷新')
      offset = decoded.offset
    } else {
      const policy = await this.policy(), now = new Date()
      let context: CommunityContextDto = { todayPlan: null, continueCourse: null, continueLab: null, currentChallenge: null, trendingTopics: [], suggestedUsers: [], needsInterests: false }
      let degraded = false, candidates: ScoredCandidate[]
      try { context = await this.context.context(userId); candidates = await this.rank(userId, query, policy, now) }
      catch {
        degraded = true
        const rows = await this.prisma.communityPost.findMany({ where: { AND: [await this.visibility.where(userId), { publishedAt: { lte: now }, ...(query.type !== 'all' ? { postType: query.type } : {}) }, ...(query.mode === 'following' ? [{ OR: [{ authorId: { in: (await this.prisma.communityUserFollow.findMany({ where: { followerId: userId } })).map((f) => f.followeeId) } }, { topics: { some: { topic: { follows: { some: { userId } } } } } }] }] : [])] }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 300 })
        candidates = rows.map((row) => ({ postId: row.id, source: 'safe_chronological_fallback', reasonCodes: [], dimensions: {}, total: 0, authorId: row.authorId, postType: row.postType, official: false, publishedAt: (row.publishedAt || row.createdAt).toISOString() }))
      }
      session = await this.prisma.communityFeedSession.create({ data: { viewerId: userId, mode: query.mode, contentType: query.type, policyVersion: policy.version, entries: json(this.assemble(candidates, policy, context, query.mode === 'for_you' && !degraded, query.type)), context: json(context), degraded, expiresAt: new Date(now.getTime() + 3600000) } })
      await this.prisma.communityFeedSession.deleteMany({ where: { expiresAt: { lt: now } } })
    }
    const entries = session.entries as unknown as StoredEntry[]
    const selected = entries.slice(offset, offset + query.limit), ids = selected.filter((entry) => entry.type === 'post').map((entry) => entry.id)
    const rows = await this.prisma.communityPost.findMany({ where: { AND: [await this.visibility.where(userId), { id: { in: ids } }] }, include: postInclude })
    const mapped = new Map((await this.posts.mapMany(userId, rows)).map((row) => [row.id, row]))
    const labels: Record<string, string> = { following: '来自你关注的老师、同学或话题', learning_context: '与你正在学习的内容相关', topic_affinity: '来自你感兴趣的学习方向', same_school: '同校同学的学习交流', quality: '近期有帮助的学习内容', unanswered: '这个学习问题期待你的回答', official: '官方学习指导', exploration: '探索一个新方向' }
    labels.teacher_answered = '认证教师或导师参与了讨论'
    const actionRefs = await this.references.resolveMany(selected.flatMap((entry) => entry.type !== 'post' && entry.type !== 'topic_suggestion' && entry.content.type ? [{ type: entry.content.type, id: entry.content.id }] : []), userId)
    const activeTopics = await this.context.topics(userId)
    const notices = await this.prisma.notification.findMany({ where: { id: { in: selected.flatMap((entry) => entry.type === 'official_notice' ? [entry.content.id] : []) }, status: 'published', audience: { in: ['all', 'student'] } } })
    const items = selected.flatMap((entry): FeedUnitDto[] => {
      if (entry.type === 'post') return mapped.has(entry.id) ? [{ type: 'post', id: entry.id, post: { ...mapped.get(entry.id)!, recommendationReasons: entry.score.reasonCodes.map((code) => labels[code]).filter(Boolean).slice(0, 2) } }] : []
      if (entry.type === 'topic_suggestion') return [{ ...entry, topics: activeTopics.filter((topic) => entry.topics.some((stored) => stored.id === topic.id)) }]
      if (entry.type === 'official_notice') {
        const notice = notices.find((row) => row.id === entry.content.id)
        return notice ? [{ ...entry, content: { id: notice.id, title: notice.title, summary: notice.content, route: '/notifications' } }] : []
      }
      const current = actionRefs.get(`${entry.content.type}:${entry.content.id}`)
      return current ? [{ ...entry, content: { ...entry.content, ...current } }] : []
    })
    await this.prisma.communityFeedImpression.createMany({ data: selected.filter((entry): entry is SessionEntry => entry.type === 'post' && mapped.has(entry.id)).map((entry) => ({ requestId: session.id, viewerId: userId, postId: entry.id, position: entries.indexOf(entry), candidateSource: entry.score.source, policyVersion: session.policyVersion, reasonCodes: entry.score.reasonCodes, scoreBucket: Math.round(entry.score.total * 100) })), skipDuplicates: true })
    const nextOffset = offset + selected.length
    return { requestId: session.id, policyVersion: session.policyVersion, items, degraded: session.degraded, invalidPriorityIds: await this.invalidPriorities(userId, query.priorityIds), nextCursor: nextOffset < entries.length ? this.encode({ session: session.id, offset: nextOffset, viewer: userId, mode: query.mode, type: query.type, policy: session.policyVersion }) : null }
  }
  async invalidPriorities(userId: string, ids: string[] = []): Promise<string[]> {
    if (!ids.length) return []
    const rows = await this.prisma.communityPost.findMany({ where: { AND: [await this.visibility.where(userId), { id: { in: ids }, authorId: userId, status: 'published' }] }, select: { id: true } })
    const visible = new Set(rows.map((row) => row.id))
    return ids.filter((id) => !visible.has(id))
  }
  async viewContext(userId: string): Promise<CommunityViewContextDto> {
    await this.visibility.viewer(userId)
    const session = await this.prisma.communityFeedSession.create({ data: { viewerId: userId, mode: 'post_view', contentType: 'all', policyVersion: 'visible-1s-v1', entries: [], context: {}, expiresAt: new Date(Date.now() + 3600000) } })
    return { requestId: session.id, expiresAt: session.expiresAt.toISOString() }
  }
  async impressions(userId: string, input: ImpressionsDto, dwell = false): Promise<CommunityImpressionsDto> {
    const visibility = await this.visibility.where(userId)
    const sessions = await this.prisma.communityFeedSession.findMany({ where: { id: { in: input.items.map((item) => item.requestId) }, viewerId: userId, expiresAt: { gt: new Date() } } })
    const items = input.items.filter((item) => sessions.some((session) => session.id === item.requestId) && (dwell || (item.dwellMs || 0) >= 1000))
    if (!items.length) return { received: true, items: [] }
    return this.prisma.$transaction(async (tx) => {
      // 与下架/编辑的帖子行锁保持同一顺序；可见性在锁内重新读取。
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id IN (${Prisma.join([...new Set(items.map((item) => item.postId))].sort())}) ORDER BY id FOR UPDATE`
      const visible = await tx.communityPost.findMany({ where: { AND: [visibility, { id: { in: items.map((item) => item.postId) }, status: 'published' }] }, select: { id: true } })
      const accepted = items.filter((item) => visible.some((row) => row.id === item.postId))
      // 详情/搜索/作者页使用服务端签发的上下文，复用同一张曝光表和主键去重。
      if (!dwell) await tx.communityFeedImpression.createMany({ data: accepted.filter((item) => sessions.some((session) => session.id === item.requestId && session.mode === 'post_view')).map((item) => ({ requestId: item.requestId, postId: item.postId, viewerId: userId, position: 0, candidateSource: 'post_view', policyVersion: 'visible-1s-v1', reasonCodes: [], scoreBucket: 0 })), skipDuplicates: true })
      for (const item of accepted) {
        const where = { requestId: item.requestId, postId: item.postId, viewerId: userId }
        if (!dwell) {
          const changed = await tx.communityFeedImpression.updateMany({ where: { ...where, impressedAt: null }, data: { impressedAt: new Date() } })
          if (changed.count) {
            await tx.communityPost.update({ where: { id: item.postId }, data: { impressionCount: { increment: 1 } } })
            await this.signals.record(userId, 'community_feed_impression', 'post', item.postId, {}, tx, { requestId: item.requestId })
          }
        }
        const stayed = await tx.communityFeedImpression.updateMany({ where: { ...where, impressedAt: { not: null }, dwellMs: { lt: item.dwellMs || 0 } }, data: { dwellMs: item.dwellMs || 0 } })
        if (stayed.count) await this.signals.record(userId, 'community_dwell', 'post', item.postId, { dwellMs: item.dwellMs || 0 }, tx, { requestId: item.requestId })
      }
      const confirmed = await tx.communityFeedImpression.findMany({ where: { viewerId: userId, impressedAt: { not: null }, OR: accepted.map(({ requestId, postId }) => ({ requestId, postId })) }, select: { requestId: true, postId: true } })
      const counts = await tx.communityPost.findMany({ where: { id: { in: visible.map((row) => row.id) } }, select: { id: true, impressionCount: true } })
      return { received: true, items: confirmed.map((row) => ({ ...row, views: counts.find((post) => post.id === row.postId)!.impressionCount })) }
    })
  }
}
