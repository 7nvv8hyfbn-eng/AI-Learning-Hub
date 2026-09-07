import { visibleComment } from './governance-policy'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { CommunityCommentDto, CommunityContentBlock, ContentDetectionResult } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { CommunityPostService } from './post.service'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { CommunityNotificationService } from './notification.service'
import { SignalsService } from '../signals/signals.service'
import { GrowthService } from '../growth/growth.service'
import { authorDto, authorInclude, json } from './community.mapper'
import type { CommentDto } from './community.dto'
import { actionEvent, idempotency, lockFileReferences } from '../../common/persistence'
import { ContentDetectionService } from './content-detection.service'

@Injectable()
export class CommunityCommentService {
  constructor(private readonly prisma: PrismaService, private readonly posts: CommunityPostService, private readonly visibility: CommunityVisibilityPolicyService, private readonly notifications: CommunityNotificationService, private readonly signals: SignalsService, private readonly detection: ContentDetectionService, private readonly growth: GrowthService) {}
  async list(userId: string, postId: string, admin = false, id?: string): Promise<CommunityCommentDto[]> {
    if (!admin) await this.visibility.assertPost(userId, postId)
    const [rows, question, feedback] = await Promise.all([
      this.prisma.communityComment.findMany({ where: { postId, ...(id ? { id } : {}), ...(!admin ? { ...visibleComment(), OR: [{ status: { not: 'pending_review' } }, { authorId: userId }] } : {}) }, include: { author: { include: authorInclude }, reactions: { where: { userId } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: id ? 1 : 500 }),
      this.prisma.communityQuestionState.findUnique({ where: { postId } }),
      this.visibility.authorExclusions(userId),
    ])
    const targets = rows.filter((row) => admin || row.authorId === userId).map((row) => ({ targetId: row.id, contentRevision: row.revision }))
    const reviews = new Map((targets.length ? await this.prisma.contentReview.findMany({ where: { targetType: 'comment', OR: targets } }) : []).map((row) => [row.targetId, row]))
    const order = new Map(rows.map((row, index) => [row.id, index]))
    rows.sort((a, b) => (order.get(a.parentId || a.id) ?? rows.length) - (order.get(b.parentId || b.id) ?? rows.length) || Number(!!a.parentId) - Number(!!b.parentId))
    return rows.map((row) => {
      const deleted = !!row.deletedAt || row.status !== 'published' && !(row.status === 'pending_review' && (admin || row.authorId === userId)) || row.author.status !== 'active' || (!admin && feedback.authors.includes(row.authorId))
      const review = !deleted ? reviews.get(row.id) : undefined
      const detection = review ? { ...review.findings as unknown as ContentDetectionResult, review: { id: review.id, status: review.status as NonNullable<ContentDetectionResult['review']>['status'], reason: review.reason } } : undefined
      return { id: row.id, revision: row.revision, status: row.status as CommunityCommentDto['status'], detection, postId, author: deleted ? { id: '', username: '', displayName: '不可见用户', avatar: null, school: null, major: null, verifiedType: 'none' } : authorDto(row.author), parentId: row.parentId, rootId: row.rootId, body: deleted ? '该评论已删除或不可见' : row.body, contentBlocks: deleted ? [] : row.contentBlocks as CommunityContentBlock[], deleted, likes: deleted ? 0 : row.likeCount, liked: row.reactions.length > 0, accepted: !deleted && row.status === 'published' && question?.acceptedCommentId === row.id, createdAt: row.createdAt.toISOString() }
    })
  }
  async save(userId: string, postId: string, input: CommentDto, id?: string, key?: string, ip?: string) {
    await this.visibility.assertOperation(userId, 'comment')
    const post = await this.visibility.assertPost(userId, postId)
    if (post.status !== 'published') throw new BadRequestException('复核中的内容暂不可评论')
    const current = id ? await this.prisma.communityComment.findUnique({ where: { id } }) : null
    if (id && (!current || current.authorId !== userId || current.deletedAt || !['published', 'pending_review'].includes(current.status) || current.postId !== postId)) throw new ForbiddenException('只能编辑自己的可见或待复核评论')
    if (current && input.expectedRevision === undefined) throw new BadRequestException('编辑评论必须提供 expectedRevision')
    const parent = input.parentId ? await this.prisma.communityComment.findUnique({ where: { ...visibleComment(), id: input.parentId } }) : null
    if (input.parentId && (!parent || parent.postId !== postId || parent.parentId || parent.deletedAt || parent.status !== 'published')) throw new BadRequestException('仅允许回复同一动态下的一级评论')
    if (parent && (await this.visibility.authorExclusions(userId)).authors.includes(parent.authorId)) throw new NotFoundException('评论不可见')
    const { clean, plainText } = await this.posts.blocks(userId, input.contentBlocks)
    if (plainText.length > 6000) throw new BadRequestException('评论最多 6000 字')
    const row = await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const request = await idempotency(tx, userId, `comment:${postId}:${id || 'new'}`, key, input)
      if (request.resourceId) return tx.communityComment.findUniqueOrThrow({ where: { id: request.resourceId } })
      const fileIds = clean.flatMap((block) => block.type === 'image' ? [block.fileId] : [])
      if (fileIds.length && await tx.fileRecord.count({ where: { quarantinedAt: null, id: { in: fileIds }, uploadedBy: userId } }) !== new Set(fileIds).size) throw new BadRequestException('图片已失效，请重新上传')
      const detection = await this.detection.check(tx, { commentBody: plainText, mediaCaption: clean.flatMap((block) => block.type === 'image' ? [block.alt || ''] : block.type === 'code' ? [block.language] : []).join('\n') })
      const status = detection.action === 'review' ? 'pending_review' : 'published'
      if (!id) await this.visibility.consumeQuota(tx, userId, 'comment', ip)
      if (current && !(await tx.communityComment.updateMany({ where: { id, revision: input.expectedRevision, deletedAt: null, status: { in: ['published', 'pending_review'] } }, data: { revision: { increment: 1 } } })).count) throw new ConflictException('评论已更新，请重新读取')
      const saved = id ? await tx.communityComment.update({ where: { id }, data: { body: plainText, contentBlocks: json(clean), status } })
        : await tx.communityComment.create({ data: { postId, authorId: userId, parentId: parent?.id, rootId: parent?.id, body: plainText, contentBlocks: json(clean), status } })
      await this.detection.record(tx, { type: 'comment', id: saved.id, revision: saved.revision, authorId: userId, submittedById: userId }, detection, json(clean))
      const countChange = Number(status === 'published') - Number(current?.status === 'published')
      if (countChange) await tx.communityPost.update({ where: { id: postId }, data: { commentCount: { increment: countChange } } })
      if (status === 'pending_review') await tx.communityQuestionState.updateMany({ where: { acceptedCommentId: saved.id }, data: { acceptedCommentId: null, status: 'open', solvedAt: null } })
      if (countChange === 1) {
        await this.signals.record(userId, parent ? 'community_reply_create' : 'community_comment_create', 'post', postId, { authorId: post.authorId, postType: post.postType, commentId: saved.id }, tx)
        await this.growth.award(tx, userId, 'community_comment_create', `comment:${saved.id}:create`)
        await this.notifications.send(parent?.authorId || post.authorId, userId, parent ? 'reply' : 'comment', 'post', postId, tx)
      }
      if (id) await actionEvent(tx, userId, 'comment_edited', 'comment', saved.id)
      await request.complete(saved.id)
      return saved
    })
    void this.growth.checkAchievements(userId).catch(() => undefined)
    const result = (await this.list(userId, postId, false, row.id))[0]
    if (!result) throw new NotFoundException('评论已保存，但当前不可见，请重新加载')
    return result
  }
  async remove(userId: string, id: string) {
    await this.visibility.viewer(userId)
    const comment = await this.prisma.communityComment.findUnique({ where: { id } })
    if (!comment || comment.authorId !== userId) throw new ForbiddenException('只能删除自己的评论')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.communityComment.updateMany({ where: { id, authorId: userId, deletedAt: null }, data: { deletedAt: new Date(), status: 'removed', revision: { increment: 1 } } })
      if (changed.count) { await actionEvent(tx, userId, 'comment_deleted', 'comment', id); await this.growth.rollbackContent(tx, [`comment:${id}:`]) }
      if (changed.count && comment.status === 'published') await tx.communityPost.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } })
      await tx.communityQuestionState.updateMany({ where: { acceptedCommentId: id }, data: { acceptedCommentId: null, status: 'open', solvedAt: null } })
    })
    return { deleted: true }
  }
  async accept(userId: string, postId: string, commentId: string) {
    await this.visibility.assertOperation(userId, 'comment')
    const post = await this.visibility.assertPost(userId, postId)
    if (post.authorId !== userId || post.postType !== 'question') throw new ForbiddenException('只有问题作者可以采纳回答')
    const comment = await this.prisma.communityComment.findFirst({ where: { id: commentId, postId, deletedAt: null, status: 'published', ...visibleComment() } })
    if (!comment || (await this.visibility.authorExclusions(userId)).authors.includes(comment.authorId)) throw new NotFoundException('回答不存在')
    await this.prisma.$transaction(async (tx) => {
      await tx.communityQuestionState.update({ where: { postId }, data: { status: 'solved', acceptedCommentId: commentId, solvedAt: new Date() } })
      await this.growth.award(tx, comment.authorId, 'answer_accepted', `comment:${commentId}:accepted`)
      await this.notifications.send(comment.authorId, userId, 'answer_accepted', 'post', postId, tx)
    })
    void this.growth.checkAchievements(comment.authorId).catch(() => undefined)
    return this.posts.detail(userId, postId)
  }
}
