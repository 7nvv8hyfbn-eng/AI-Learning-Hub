import { loadBadgeContext } from './user-badges'
import { Injectable, NotFoundException } from '@nestjs/common'
import type { CommunityNotificationDto } from '@ai-learning-hub/contracts'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { authorDto, authorInclude } from './community.mapper'
import { CommunityVisibilityPolicyService } from './visibility.service'

@Injectable()
export class CommunityNotificationService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: CommunityVisibilityPolicyService) {}
  async governance(recipientId: string, entityType: string, entityId: string, message: string, tx: Prisma.TransactionClient) {
    await tx.userNotification.createMany({ data: [{ recipientId, notificationType: 'moderation', entityType, entityId, dedupeKey: `governance:${recipientId}:${entityType}:${entityId}`, payload: { message } }], skipDuplicates: true })
  }
  async send(recipientId: string, actorId: string, type: CommunityNotificationDto['type'], entityType: string, entityId: string, tx: Prisma.TransactionClient = this.prisma) {
    if (recipientId === actorId) return
    const day = new Date().toISOString().slice(0, 13)
    const dedupeKey = `${recipientId}:${type}:${entityType}:${entityId}${['mention', 'quote'].includes(type) ? '' : `:${day}`}`
    await tx.userNotification.createMany({ data: [{ recipientId, actorId, notificationType: type, entityType, entityId, dedupeKey, actorIds: [actorId] }], skipDuplicates: true })
    await tx.userNotification.updateMany({ where: { dedupeKey, NOT: { actorIds: { has: actorId } } }, data: { actorId, actorIds: { push: actorId }, readAt: null } })
  }
  async list(userId: string) {
    await this.visibility.viewer(userId)
    const feedback = await this.visibility.authorExclusions(userId)
    const rows = await this.prisma.userNotification.findMany({ where: { recipientId: userId, OR: [{ notificationType: 'moderation' }, { NOT: { actorId: { in: feedback.authors } } }] }, orderBy: { createdAt: 'desc' }, take: 100 })
    const reviewIds = rows.filter((row) => row.entityType === 'content_review' && row.notificationType === 'moderation').map((row) => row.entityId)
    const [authors, posts, notices, reviews] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: rows.flatMap((row) => row.actorIds), notIn: feedback.authors }, status: 'active' }, include: authorInclude }),
      this.prisma.communityPost.findMany({ where: { AND: [await this.visibility.where(userId), { id: { in: rows.filter((row) => row.entityType === 'post').map((row) => row.entityId) } }] }, select: { id: true } }),
      this.prisma.notification.findMany({ where: { status: 'published', audience: { in: ['all', 'student'] } }, include: { reads: { where: { userId } } }, orderBy: { publishedAt: 'desc' }, take: 20 }),
      reviewIds.length ? this.prisma.contentReview.findMany({ where: { id: { in: reviewIds }, authorId: userId, status: { in: ['approved', 'rejected'] } }, select: { id: true, targetType: true, targetId: true, contentRevision: true, status: true, reason: true } }) : [],
    ])
    const visibleIds = new Set(posts.map((row) => row.id))
    const badgeContext = await loadBadgeContext(this.prisma)
    const authorMap = new Map(authors.map((row) => [row.id, authorDto(row, badgeContext)]))
    const reviewMap = new Map(reviews.map((row) => [row.id, row]))
    const targetLabels: Record<string, string> = { post: '投稿', comment: '评论', profile: '公开资料', collection: '合集', resource: '资源' }
    const labels: Record<string, string> = { comment: '回答了你的动态', reply: '回复了你的评论', like: '赞了你的内容', useful: '认为你的内容有帮助', answer_accepted: '采纳了你的回答', follow: '关注了你', mention: '提到了你', quote: '引用了你的帖子', official: '发布了学习提醒', moderation: '你的内容有新的处理结果' }
    const items: CommunityNotificationDto[] = rows.filter((row) => row.entityType === 'content_review' ? reviewMap.has(row.entityId) : row.notificationType === 'moderation' || (!row.actorId || authorMap.has(row.actorId)) && (row.entityType !== 'post' || visibleIds.has(row.entityId))).map((row) => {
      const review = row.entityType === 'content_review' ? reviewMap.get(row.entityId) : undefined
      const governanceMessage = row.dedupeKey?.startsWith('governance:') ? (row.payload as { message?: string }).message : undefined
      const item: CommunityNotificationDto = {
      id: row.id, type: row.notificationType as CommunityNotificationDto['type'], actor: row.actorId ? authorMap.get(row.actorId) || null : null,
      entityType: review?.targetType || row.entityType, entityId: review?.targetId || row.entityId,
      text: review ? `你的${targetLabels[review.targetType] || '内容'}第 ${review.contentRevision} 次修订${review.status === 'approved' ? '已通过复核' : '复核未通过，尚未公开'}。${review.reason}` : `${row.actorIds.filter((id) => authorMap.has(id)).length > 1 ? `${row.actorIds.filter((id) => authorMap.has(id)).length} 位同学` : ''}${labels[row.notificationType] || '有新的社区互动'}`,
      count: row.actorIds.filter((id) => authorMap.has(id)).length, readAt: row.readAt?.toISOString() || null, createdAt: row.createdAt.toISOString(), source: 'community',
    }
      if (governanceMessage) { item.text = governanceMessage; item.actor = null; item.count = 1 }
      return item
    })
    items.push(...notices.map((row): CommunityNotificationDto => ({ id: row.id, type: 'official', actor: null, entityType: 'notification', entityId: row.id, text: `${row.title}：${row.content}`, count: 1, readAt: row.reads[0]?.readAt.toISOString() || null, createdAt: row.createdAt.toISOString(), source: 'platform' })))
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async read(userId: string, id?: string) {
    await this.visibility.viewer(userId)
    if (!id) {
      await this.prisma.userNotification.updateMany({ where: { recipientId: userId, readAt: null }, data: { readAt: new Date() } })
      const notices = await this.prisma.notification.findMany({ where: { status: 'published', audience: { in: ['all', 'student'] } }, select: { id: true } })
      await this.prisma.notificationRead.createMany({ data: notices.map((row) => ({ notificationId: row.id, userId })), skipDuplicates: true })
      return { read: true }
    }
    const updated = await this.prisma.userNotification.updateMany({ where: { id, recipientId: userId }, data: { readAt: new Date() } })
    if (!updated.count) {
      const notice = await this.prisma.notification.findFirst({ where: { id, status: 'published', audience: { in: ['all', 'student'] } } })
      if (!notice) throw new NotFoundException('通知不存在')
      await this.prisma.notificationRead.upsert({ where: { notificationId_userId: { notificationId: id, userId } }, update: {}, create: { notificationId: id, userId } })
    }
    return { read: true }
  }
}
