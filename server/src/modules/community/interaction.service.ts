import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { CommunityReactionType } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { CommunityNotificationService } from './notification.service'
import { SignalsService } from '../signals/signals.service'
import type { ReportDto } from './community.dto'
import { actionEvent, postRevision, rateLimit } from '../../common/persistence'

@Injectable()
export class CommunityInteractionService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: CommunityVisibilityPolicyService, private readonly notifications: CommunityNotificationService, private readonly signals: SignalsService) {}
  async react(userId: string, postId: string, type: CommunityReactionType | 'bookmark', active: boolean) {
    if (!['like', 'useful', 'bookmark'].includes(type)) throw new BadRequestException('不支持的互动类型')
    const post = await this.visibility.assertPost(userId, postId)
    await this.prisma.$transaction(async (tx) => {
      const changed = type === 'bookmark'
        ? active ? await tx.communityBookmark.createMany({ data: [{ userId, postId }], skipDuplicates: true }) : await tx.communityBookmark.deleteMany({ where: { userId, postId } })
        : active ? await tx.communityPostReaction.createMany({ data: [{ userId, postId, reactionType: type }], skipDuplicates: true }) : await tx.communityPostReaction.deleteMany({ where: { userId, postId, reactionType: type } })
      if (!changed.count) return
      const field = type === 'bookmark' ? 'bookmarkCount' : type === 'like' ? 'likeCount' : 'usefulCount'
      await tx.communityPost.update({ where: { id: postId }, data: { [field]: { increment: active ? 1 : -1 } } })
      if (active) {
        const topics = await tx.communityPostTopic.findMany({ where: { postId } })
        const bindings = await tx.communityPostBinding.findMany({ where: { postId } })
        await this.signals.record(userId, `community_${type}_add`, 'post', postId, { authorId: post.authorId, postType: post.postType, topicIds: topics.map((row) => row.topicId), bindingKeys: bindings.map((row) => `${row.targetType}:${row.targetId}`) }, tx)
        if (type !== 'bookmark') await this.notifications.send(post.authorId, userId, type, 'post', postId, tx)
      }
    })
    const [row, exists] = await Promise.all([
      this.prisma.communityPost.findUniqueOrThrow({ where: { id: postId }, select: { likeCount: true, usefulCount: true, bookmarkCount: true, commentCount: true } }),
      type === 'bookmark' ? this.prisma.communityBookmark.count({ where: { userId, postId } }) : this.prisma.communityPostReaction.count({ where: { userId, postId, reactionType: type } }),
    ])
    return { active: !!exists, stats: { likes: row.likeCount, useful: row.usefulCount, bookmarks: row.bookmarkCount, comments: row.commentCount } }
  }
  async commentLike(userId: string, commentId: string, active: boolean) {
    const comment = await this.prisma.communityComment.findFirst({ where: { id: commentId, deletedAt: null, status: 'published', author: { status: 'active' } } })
    if (!comment) throw new NotFoundException('评论不存在')
    await this.visibility.assertPost(userId, comment.postId)
    if ((await this.visibility.authorExclusions(userId)).authors.includes(comment.authorId)) throw new NotFoundException('评论不存在')
    await this.prisma.$transaction(async (tx) => {
      const changed = active ? await tx.communityCommentReaction.createMany({ data: [{ userId, commentId }], skipDuplicates: true }) : await tx.communityCommentReaction.deleteMany({ where: { userId, commentId } })
      if (changed.count) {
        await tx.communityComment.update({ where: { id: commentId }, data: { likeCount: { increment: active ? 1 : -1 } } })
        if (active) await this.notifications.send(comment.authorId, userId, 'like', 'post', comment.postId, tx)
      }
    })
    const row = await this.prisma.communityComment.findUniqueOrThrow({ where: { id: commentId }, select: { likeCount: true, reactions: { where: { userId } } } })
    return { active: row.reactions.length > 0, likes: row.likeCount }
  }
  async follow(userId: string, targetId: string, topic: boolean, active: boolean) {
    await this.visibility.viewer(userId)
    if (!topic && targetId === userId) throw new BadRequestException('不能关注自己')
    if (topic) {
      if (!await this.prisma.communityTopic.findFirst({ where: { id: targetId, status: 'active' } })) throw new NotFoundException('话题不存在')
    } else {
      if (!await this.prisma.user.findFirst({ where: { id: targetId, status: 'active' } }) || (await this.visibility.authorExclusions(userId)).authors.includes(targetId)) throw new NotFoundException('用户不存在')
    }
    await this.prisma.$transaction(async (tx) => {
      const changed = topic ? active ? await tx.communityTopicFollow.createMany({ data: [{ userId, topicId: targetId }], skipDuplicates: true }) : await tx.communityTopicFollow.deleteMany({ where: { userId, topicId: targetId } })
        : active ? await tx.communityUserFollow.createMany({ data: [{ followerId: userId, followeeId: targetId }], skipDuplicates: true }) : await tx.communityUserFollow.deleteMany({ where: { followerId: userId, followeeId: targetId } })
      if (!changed.count) return
      if (topic) await tx.communityTopic.update({ where: { id: targetId }, data: { followerCount: { increment: active ? 1 : -1 } } })
      else {
        for (const id of [userId, targetId]) await tx.communityProfile.upsert({ where: { userId: id }, create: { userId: id }, update: {} })
        await tx.communityProfile.update({ where: { userId }, data: { followingCount: { increment: active ? 1 : -1 } } })
        await tx.communityProfile.update({ where: { userId: targetId }, data: { followerCount: { increment: active ? 1 : -1 } } })
        if (active) await this.notifications.send(targetId, userId, 'follow', 'user', userId, tx)
      }
      if (active) await this.signals.record(userId, topic ? 'community_topic_follow' : 'community_user_follow', topic ? 'topic' : 'user', targetId, topic ? { topicIds: [targetId] } : { authorId: targetId }, tx)
    })
    const count = topic ? await this.prisma.communityTopicFollow.count({ where: { userId, topicId: targetId } }) : await this.prisma.communityUserFollow.count({ where: { followerId: userId, followeeId: targetId } })
    const followerCount = topic ? await this.prisma.communityTopicFollow.count({ where: { topicId: targetId } }) : await this.prisma.communityUserFollow.count({ where: { followeeId: targetId } })
    return { active: !!count, followerCount }
  }
  async feedback(userId: string, targetId: string, type: 'hide' | 'not_interested' | 'mute_author' | 'block') {
    await this.visibility.viewer(userId)
    const post = ['hide', 'not_interested'].includes(type) ? await this.visibility.assertPost(userId, targetId) : null
    if (!post && (userId === targetId || !await this.prisma.user.findUnique({ where: { id: targetId } }))) throw new BadRequestException('无效用户')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.communityFeedback.createMany({ data: [{ userId, targetId, feedbackType: type, postType: post?.postType }], skipDuplicates: true })
      if (changed.count) await this.signals.record(userId, `community_${type}`, post ? 'post' : 'user', targetId, { ...(post ? { postType: post.postType, authorId: post.authorId } : { authorId: targetId }) }, tx)
      if (type === 'block') {
        await tx.communityUserFollow.deleteMany({ where: { OR: [{ followerId: userId, followeeId: targetId }, { followerId: targetId, followeeId: userId }] } })
        for (const id of [userId, targetId]) {
          await tx.communityProfile.upsert({ where: { userId: id }, create: { userId: id }, update: {} })
          await tx.communityProfile.update({
            where: { userId: id },
            data: {
              followerCount: await tx.communityUserFollow.count({ where: { followeeId: id } }),
              followingCount: await tx.communityUserFollow.count({ where: { followerId: id } }),
            },
          })
        }
      }
    })
    return { hidden: true }
  }
  async removeFeedback(userId: string, targetId: string, type: 'mute_author' | 'block') {
    await this.visibility.viewer(userId)
    if (userId === targetId || !await this.prisma.user.count({ where: { id: targetId } })) throw new BadRequestException('无效用户')
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.communityFeedback.deleteMany({ where: { userId, targetId, feedbackType: type } })
      if (changed.count) await actionEvent(tx, userId, type === 'block' ? 'community_user_unblocked' : 'community_user_unmuted', 'user', targetId)
    })
    return { active: false }
  }
  async report(userId: string, targetId: string, input: ReportDto, comment = false) {
    const row = comment ? await this.prisma.communityComment.findFirst({ where: { id: targetId, deletedAt: null, status: 'published' } }) : null
    if (comment && !row) throw new NotFoundException('评论不存在')
    if (row && (await this.visibility.authorExclusions(userId)).authors.includes(row.authorId)) throw new NotFoundException('评论不可见')
    const post = await this.visibility.assertPost(userId, row?.postId || targetId)
    await this.prisma.$transaction(async (tx) => {
      await rateLimit(tx, userId, 'report', 10)
      const added = await tx.communityReport.createMany({ data: [{ reporterId: userId, targetKey: `${comment ? 'comment' : 'post'}:${targetId}`, ...(comment ? { commentId: targetId } : { postId: targetId }), reason: input.reason, description: input.description }], skipDuplicates: true })
      if (!added.count) return
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${post.id} FOR UPDATE`
      const count = await tx.communityReport.count({ where: { postId: post.id, status: { in: ['pending', 'reviewing'] } } })
      if (count >= 5 && await tx.communityPost.count({ where: { id: post.id, status: 'published' } })) {
        await postRevision(tx, post.id, userId, 'moderation', '举报达到审核阈值')
        await tx.communityPost.update({ where: { id: post.id }, data: { status: 'limited', revision: { increment: 1 } } })
        await postRevision(tx, post.id, userId, 'moderation', '举报达到审核阈值')
        await actionEvent(tx, userId, 'moderation_applied', 'post', post.id, { action: 'auto_limit' }, 'system')
      }
      await this.signals.record(userId, 'community_report', comment ? 'comment' : 'post', targetId, {}, tx)
    })
    return { reported: true }
  }
}
