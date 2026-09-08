import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import type { CommunityProfileInput, ContentDetectionInput, ContentDetectionPolicy, ContentDetectionResult, ContentDetectionRule } from '@ai-learning-hub/contracts'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { defaultContentDetectionPolicy, detectContent, validateContentDetectionPolicy } from '@ai-learning-hub/contracts'
import { lockFileReferences } from '../../common/persistence'
import { normalizeUsername } from '../auth/username'
import { CommunityNotificationService } from './notification.service'
import { SignalsService } from '../signals/signals.service'

const policyKey = 'content_detection_policy'
type ProfileTextChange = Partial<Pick<CommunityProfileInput, 'displayName' | 'bio' | 'headline' | 'location' | 'websiteUrl' | 'expertiseTopics'>> & { username?: string }

@Injectable()
export class ContentDetectionService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: CommunityNotificationService, private readonly signals: SignalsService) {}

  async policy(tx: Prisma.TransactionClient = this.prisma): Promise<ContentDetectionPolicy> {
    const row = await tx.systemSetting.findUnique({ where: { key: policyKey } })
    const policy = row?.value ?? structuredClone(defaultContentDetectionPolicy)
    validateContentDetectionPolicy(policy)
    return policy
  }

  async history(): Promise<ContentDetectionPolicy[]> {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: `${policyKey}:` } } })
    const current = await this.policy()
    const versions = rows.map((row) => { validateContentDetectionPolicy(row.value); return row.value })
    return [...versions.filter((version) => version.version !== current.version), current].sort((a, b) => b.version - a.version)
  }

  async configure(actorId: string, input: { expectedVersion: number; rules?: ContentDetectionRule[]; rollbackVersion?: number; reason: string }) {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500
      || (input.rules === undefined) === (input.rollbackVersion === undefined)
      || (input.rollbackVersion !== undefined && (!Number.isSafeInteger(input.rollbackVersion) || input.rollbackVersion < 1))) throw new BadRequestException('请提供当前版本、规则或回退版本，以及操作理由')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('content_detection_policy'))::text`
      const previous = await this.policy(tx)
      if (previous.version !== input.expectedVersion) throw new ConflictException('检测规则已有新版本，请刷新后再修改')
      let rules = input.rules
      if (input.rollbackVersion !== undefined) {
        if (input.rollbackVersion >= previous.version) throw new BadRequestException('只能回退到当前版本之前的历史规则')
        const snapshot = await tx.systemSetting.findUnique({ where: { key: `${policyKey}:${input.rollbackVersion}` } })
        if (!snapshot) throw new BadRequestException('目标规则版本不存在')
        validateContentDetectionPolicy(snapshot.value)
        rules = snapshot.value.rules
      }
      const policy = { version: previous.version + 1, rules }
      validateContentDetectionPolicy(policy)
      // 回退也创建递增新版本；旧检测和复核记录始终指向原来的规则快照。
      await tx.systemSetting.createMany({ data: [{ key: `${policyKey}:${previous.version}`, value: previous as unknown as Prisma.InputJsonValue }], skipDuplicates: true })
      await tx.systemSetting.upsert({ where: { key: policyKey }, create: { key: policyKey, value: policy as unknown as Prisma.InputJsonValue }, update: { value: policy as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } })
      await tx.communityModerationAction.create({ data: { actorId, targetType: 'content_detection_policy', targetId: String(policy.version), action: input.rollbackVersion ? 'rollback' : 'configure', reason: input.reason.trim(), metadata: { previousVersion: previous.version, version: policy.version, rollbackVersion: input.rollbackVersion ?? null } } })
      return policy
    })
  }

  // 必须在业务写事务内调用；持有共享锁至提交，规则变更不会插入检测与保存之间。
  async check(tx: Prisma.TransactionClient, input: ContentDetectionInput) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('content_detection_policy'))::text`
    // 首次实际检测才冻结默认版本；仅浏览配置不写库，后续部署也不会悄悄改变已有规则版本。
    if (!await tx.systemSetting.findUnique({ where: { key: policyKey } })) await tx.systemSetting.createMany({ data: [{ key: policyKey, value: defaultContentDetectionPolicy as unknown as Prisma.InputJsonValue }], skipDuplicates: true })
    const result = detectContent(input, await this.policy(tx))
    if (result.action === 'reject') throw new BadRequestException({ errorCode: 'CONTENT_REJECTED', message: `内容未发布，请保留并修改当前输入：${[...new Set(result.hits.filter((hit) => hit.action === 'reject').map((hit) => hit.explanation))].join('；')}` })
    return result
  }

  async record(tx: Prisma.TransactionClient, target: { type: 'post' | 'comment' | 'profile' | 'collection' | 'resource'; id: string; revision: number; authorId: string; submittedById: string }, result: ContentDetectionResult, payload: Prisma.InputJsonValue = {}) {
    await tx.contentReview.updateMany({ where: { targetType: target.type, targetId: target.id, status: 'pending' }, data: { status: 'superseded' } })
    return tx.contentReview.create({ data: {
      targetType: target.type, targetId: target.id, contentRevision: target.revision,
      authorId: target.authorId, submittedById: target.submittedById, ruleVersion: result.ruleVersion,
      action: result.action, status: result.action === 'review' ? 'pending' : 'not_required',
      findings: result as unknown as Prisma.InputJsonValue, payload,
    } })
  }

  async result(targetType: string, targetId: string, contentRevision: number): Promise<ContentDetectionResult | undefined> {
    const row = await this.prisma.contentReview.findUnique({ where: { targetType_targetId_contentRevision: { targetType, targetId, contentRevision } } })
    if (!row) return undefined
    return { ...row.findings as unknown as ContentDetectionResult, review: { id: row.id, status: row.status as NonNullable<ContentDetectionResult['review']>['status'], reason: row.reason } }
  }

  async assertUsernameAvailable(tx: Prisma.TransactionClient, username: string, userId?: string) {
    const normalized = normalizeUsername(username)
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`content-username:${normalized}`}, 0))::text`
    const [used, pending] = await Promise.all([
      tx.user.count({ where: { username: { equals: normalized, mode: 'insensitive' }, ...(userId ? { id: { not: userId } } : {}) } }),
      tx.contentReview.count({ where: { targetType: 'profile', status: 'pending', ...(userId ? { targetId: { not: userId } } : {}), payload: { path: ['changes', 'username'], equals: normalized } } }),
    ])
    if (used || pending) throw new ConflictException('此用户名已被使用或正在复核')
  }

  // 所有公开资料写入口共用暂存。账号其他字段仍由原入口校验和保存，不写入审核载荷。
  async saveProfile(tx: Prisma.TransactionClient, userId: string, changes: ProfileTextChange, actorId = userId, expectedProfileRevision?: number) {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    const profile = await tx.communityProfile.upsert({ where: { userId }, create: { userId }, update: {} })
    if (expectedProfileRevision !== undefined && profile.revision !== expectedProfileRevision) throw new ConflictException('社区资料已更新，请重新读取')
    const previous = await tx.contentReview.findFirst({ where: { targetType: 'profile', targetId: userId }, orderBy: { contentRevision: 'desc' } })
    const heldPayload = previous && ['pending', 'rejected'].includes(previous.status) ? previous.payload as unknown as { changes: ProfileTextChange; initialUsername?: boolean } : null
    changes = { ...heldPayload?.changes, ...changes }
    if (changes.username !== undefined) {
      changes = { ...changes, username: normalizeUsername(changes.username) }
      if (user.usernameChangedAt) throw new BadRequestException('公开用户名只能修改一次')
      await this.assertUsernameAvailable(tx, changes.username!, userId)
    }
    const { username, displayName, ...profileChanges } = changes
    const snapshot = {
      username: username ?? user.username, displayName: displayName ?? user.displayName,
      bio: changes.bio ?? profile.bio, headline: changes.headline ?? profile.headline,
      location: changes.location ?? profile.location ?? '', websiteUrl: changes.websiteUrl ?? profile.websiteUrl ?? '',
      expertiseTopics: (changes.expertiseTopics ?? profile.expertiseTopics).join('\n'),
    }
    const detection = await this.check(tx, snapshot)
    const held = detection.action === 'review'
    if (!held && (username !== undefined || displayName !== undefined)) await tx.user.update({ where: { id: userId }, data: { ...(username !== undefined ? { username, ...(!heldPayload?.initialUsername ? { usernameChangedAt: new Date() } : {}) } : {}), ...(displayName !== undefined ? { displayName } : {}) } })
    const changed = await tx.communityProfile.updateMany({ where: { userId, revision: profile.revision }, data: { ...(!held ? profileChanges : {}), revision: { increment: 1 } } })
    if (!changed.count) throw new ConflictException('社区资料已更新，请重新读取')
    await this.record(tx, { type: 'profile', id: userId, revision: profile.revision + 1, authorId: userId, submittedById: actorId }, detection, { changes, snapshot, userRevision: user.revision, initialUsername: heldPayload?.initialUsername || false })
    return detection
  }

  async decide(actorId: string, id: string, input: { expectedRevision: number; ruleVersion: number; action: 'approve' | 'reject'; reason: string }) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !Number.isSafeInteger(input.ruleVersion) || input.ruleVersion < 1 || !['approve', 'reject'].includes(input.action) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw new BadRequestException('请提供准确的内容修订、规则版本、复核动作和理由')
    return this.prisma.$transaction((tx) => this.decideTx(tx, actorId, id, input))
  }
  async decideTx(tx: Prisma.TransactionClient, actorId: string, id: string, input: { expectedRevision: number; ruleVersion: number; action: 'approve' | 'reject'; reason: string }) {
      await lockFileReferences(tx)
      await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('content_detection_policy'))::text`
      const review = await tx.contentReview.findUnique({ where: { id } })
      if (!review || review.status !== 'pending' || review.contentRevision !== input.expectedRevision || review.ruleVersion !== input.ruleVersion) throw new ConflictException('复核记录已变化，请读取当前修订，不能审核旧版本')
      if (review.assignedToId && review.assignedToId !== actorId) throw new ConflictException('此复核已被其他管理员领取')
      if ((await this.policy(tx)).version !== review.ruleVersion) throw new ConflictException('检测规则已有新版本，请编辑后重新提交检测')
      const approved = input.action === 'approve'
      if (approved && !await tx.user.count({ where: { id: review.authorId, status: 'active' } })) throw new BadRequestException('作者账号当前不可用，不能放行')
      // 复核只改变可见性，不改原文和内容修订号；作者下次编辑仍递增修订并重新检测。
      if (review.targetType === 'post') {
        const changed = await tx.communityPost.updateMany({ where: { id: review.targetId, authorId: review.authorId, revision: review.contentRevision, status: 'pending_review', deletedAt: null }, data: { status: approved ? 'published' : 'pending_review', publishedAt: approved ? new Date() : null } })
        if (!changed.count) throw new ConflictException('正文或状态已变化，旧复核不能放行新内容')
        await tx.communityProfile.updateMany({ where: { userId: review.authorId }, data: { postCount: await tx.communityPost.count({ where: { authorId: review.authorId, status: 'published', deletedAt: null } }) } })
        const topics = await tx.communityPostTopic.findMany({ where: { postId: review.targetId } })
        for (const { topicId } of topics) await tx.communityTopic.update({ where: { id: topicId }, data: { postCount: await tx.communityPostTopic.count({ where: { topicId, post: { status: 'published', deletedAt: null } } }) } })
        if (approved) {
          const post = await tx.communityPost.findUniqueOrThrow({ where: { id: review.targetId }, include: { bindings: true } })
          await this.signals.record(review.authorId, 'community_post_publish', 'post', post.id, { postType: post.postType, topicIds: topics.map((topic) => topic.topicId), bindingKeys: post.bindings.map((binding) => `${binding.targetType}:${binding.targetId}`) }, tx)
        }
      } else if (review.targetType === 'comment') {
        const changed = await tx.communityComment.updateMany({ where: { id: review.targetId, authorId: review.authorId, revision: review.contentRevision, status: 'pending_review', deletedAt: null, post: { status: 'published', deletedAt: null } }, data: { status: approved ? 'published' : 'pending_review' } })
        if (!changed.count) throw new ConflictException('评论或所属动态已变化，旧复核不能放行新内容')
        const comment = await tx.communityComment.findUniqueOrThrow({ where: { id: review.targetId }, include: { post: { select: { authorId: true, postType: true } }, parent: { select: { authorId: true, status: true, deletedAt: true } } } })
        await tx.communityPost.update({ where: { id: comment.postId }, data: { commentCount: await tx.communityComment.count({ where: { postId: comment.postId, status: 'published', deletedAt: null } }) } })
        if (approved) {
          if (comment.parent && (comment.parent.status !== 'published' || comment.parent.deletedAt)) throw new ConflictException('被回复的评论已不可见，请修改后重新提交')
          await this.signals.record(review.authorId, comment.parentId ? 'community_reply_create' : 'community_comment_create', 'post', comment.postId, { authorId: comment.post.authorId, postType: comment.post.postType, commentId: comment.id }, tx)
          await this.notifications.send(comment.parent?.authorId || comment.post.authorId, review.authorId, comment.parentId ? 'reply' : 'comment', 'post', comment.postId, tx)
        }
      } else if (review.targetType === 'collection') {
        const changed = await tx.learningCollection.updateMany({ where: { id: review.targetId, revision: review.contentRevision, contentStatus: 'pending_review', visibility: 'community', ownerId: review.authorId }, data: { contentStatus: approved ? 'published' : 'pending_review' } })
        if (!changed.count) throw new ConflictException('合集内容或可见范围已变化，旧复核不能放行新内容')
      } else if (review.targetType === 'profile') {
        const payload = review.payload as unknown as { changes: ProfileTextChange; userRevision: number; initialUsername?: boolean }
        const { username, displayName, ...profileChanges } = payload.changes
        if (approved && username !== undefined) await this.assertUsernameAvailable(tx, username, review.authorId)
        const userChanged = await tx.user.updateMany({ where: { id: review.targetId, revision: payload.userRevision }, data: { ...(approved ? { ...(username !== undefined ? { username, ...(!payload.initialUsername ? { usernameChangedAt: new Date() } : {}) } : {}), ...(displayName !== undefined ? { displayName } : {}) } : {}), revision: { increment: 1 } } })
        if (!userChanged.count) throw new ConflictException('账号已有新修订，请修改后重新提交公开资料')
        const changed = await tx.communityProfile.updateMany({ where: { userId: review.targetId, revision: review.contentRevision }, data: { ...(approved ? profileChanges : {}), revision: review.contentRevision } })
        if (!changed.count) throw new ConflictException('公开资料已有新修订，旧复核不能放行新资料')
      } else if (review.targetType === 'resource') {
        if (!await tx.userRole.count({ where: { userId: actorId, role: { permissions: { some: { permission: { code: 'resource.publish' } } } } } })) throw new BadRequestException('资源复核还需要资源发布权限')
        const payload = review.payload as unknown as { draftVersionId: string }
        const changed = await tx.resource.updateMany({ where: { id: review.targetId, version: review.contentRevision, currentDraftVersionId: payload.draftVersionId, status: 'reviewing', deletedAt: null }, data: approved ? { status: 'published', publishedAt: new Date(), publishedVersionId: payload.draftVersionId } : { status: 'reviewing' } })
        if (!changed.count) throw new ConflictException('资源已有新修订，旧复核不能发布新资源')
      } else throw new BadRequestException('当前复核对象不支持此操作')
      const changed = await tx.contentReview.updateMany({ where: { id, status: 'pending', contentRevision: input.expectedRevision, ruleVersion: input.ruleVersion }, data: { status: approved ? 'approved' : 'rejected', reviewedById: actorId, reviewedAt: new Date(), reason: input.reason.trim() } })
      if (!changed.count) throw new ConflictException('该复核已由其他审核人员处理，请刷新')
      await tx.communityModerationAction.create({ data: { actorId, targetType: review.targetType, targetId: review.targetId, action: approved ? 'content_review_approved' : 'content_review_rejected', reason: input.reason.trim(), metadata: { reviewId: id, contentRevision: review.contentRevision, ruleVersion: review.ruleVersion, exemptionScope: 'this_revision_only', mediaReview: 'not_performed' } } })
      await this.notifications.send(review.authorId, actorId, 'moderation', 'content_review', id, tx)
      return { id, status: approved ? 'approved' : 'rejected', targetType: review.targetType, targetId: review.targetId, contentRevision: review.contentRevision, ruleVersion: review.ruleVersion }
  }
}
