import { CommunityPostRelationsService } from './post-relations.service'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import sanitizeHtml from 'sanitize-html'
import { Prisma } from '@prisma/client'
import type { CommunityInlineReference, CommunityContentBlock, CommunityPostDetailDto, CommunityTopicDto, CommunityPostSummaryDto, CommunityBindingInput, ResourceContributionDto, ResourceContributionInput } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { ContentReferenceService } from '../../common/content-reference/content-reference.service'
import { SignalsService } from '../signals/signals.service'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { authorDto, authorInclude, json } from './community.mapper'
import type { CommunityQueryDto, PostDto } from './community.dto'
import { actionEvent, idempotency, lockFileReferences, postRevision } from '../../common/persistence'
import { ContentDetectionService } from './content-detection.service'
import { postDetectionInput } from '@ai-learning-hub/contracts'
import { availableAccount, visibleComment } from './governance-policy'

export const postInclude = {
  author: { include: authorInclude }, bindings: { orderBy: { sortOrder: 'asc' as const } },
  topics: { include: { topic: true } }, question: true,
  contribution: { include: { category: true, videoAsset: { include: { sourceFile: true, posterFile: true } }, attachmentFile: true } },
} satisfies Prisma.CommunityPostInclude
export type HydratedPost = Prisma.CommunityPostGetPayload<{ include: typeof postInclude }>

@Injectable()
export class CommunityPostService {
  constructor(private readonly prisma: PrismaService, private readonly refs: ContentReferenceService, private readonly visibility: CommunityVisibilityPolicyService, private readonly signals: SignalsService, private readonly detection: ContentDetectionService, private readonly relations: CommunityPostRelationsService) {}

  async blocks(userId: string, blocks: CommunityContentBlock[], draft = false) {
    if (!blocks.length && !draft) throw new BadRequestException('请填写正文')
    let imageCount = 0
    const files: string[] = []
    const clean = blocks.map((block): CommunityContentBlock => {
      const keys = Object.keys(block).filter((key) => (block as unknown as Record<string, unknown>)[key] !== undefined)
      const allowed = block.type === 'image' ? ['type', 'fileId', 'alt'] : block.type === 'code' ? ['type', 'code', 'language'] : block.type === 'heading' ? ['type', 'text', 'level'] : block.type === 'list' ? ['type', 'ordered', 'items'] : ['type', 'text']
      if (keys.some((key) => !allowed.includes(key))) throw new BadRequestException('内容块字段与类型不匹配')
      if (block.type === 'image') {
        if (!block.fileId || ++imageCount > 4) throw new BadRequestException('最多上传 4 张图片')
        files.push(block.fileId)
        return { type: 'image', fileId: block.fileId, alt: block.alt || '' }
      }
      if (block.type === 'code') {
        if (typeof block.code !== 'string' || !block.code.trim()) throw new BadRequestException('代码块不能为空')
        return { type: 'code', language: block.language || 'text', code: block.code }
      }
      if (block.type === 'list') {
        if (!Array.isArray(block.items) || !block.items.length || block.items.some((item) => typeof item !== 'string' || !item.trim())) throw new BadRequestException('列表不能为空')
        return { type: 'list', ordered: block.ordered === true, items: block.items.map((item) => item.trim()) }
      }
      if (typeof block.text !== 'string' || !block.text.trim()) throw new BadRequestException('正文块不能为空')
      if (block.type === 'rich_text') {
        // 图片只通过已有 image/FileRecord 链路授权；不接受 HTML 内嵌媒体、样式或事件。
        const text = sanitizeHtml(block.text, {
          allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'span'],
          allowedAttributes: { a: ['href', 'title'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
          allowedSchemes: ['http', 'https'], allowProtocolRelative: false,
        })
        if (!sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).trim()) throw new BadRequestException('图文正文不能为空')
        return { type: 'rich_text', text }
      }
      if (block.type === 'heading') return { type: 'heading', text: block.text.trim(), level: Math.min(6, Math.max(1, block.level || 2)) }
      return { type: block.type, text: block.text.trim() }
    })
    if (files.length) {
      const count = await this.prisma.fileRecord.count({ where: { quarantinedAt: null, id: { in: [...new Set(files)] }, uploadedBy: userId, mimeType: { in: ['image/png', 'image/jpeg', 'image/webp'] }, size: { lte: 5 * 1024 * 1024 }, extension: { in: ['.png', '.jpg', '.jpeg', '.webp'] } } })
      if (count !== new Set(files).size) throw new BadRequestException('图片必须由本人上传且为不超过 5MB 的 PNG、JPEG 或 WebP')
    }
    const plainText = clean.map((block) => block.type === 'code' ? block.code : block.type === 'image' ? block.alt || '' : block.type === 'list' ? block.items.join('\n') : block.type === 'rich_text' ? sanitizeHtml(block.text, { allowedTags: [], allowedAttributes: {} }) : block.text).join('\n')
    if ((!draft && plainText.length < 1) || plainText.length > 20000) throw new BadRequestException('正文需要 1～20000 字')
    return { clean, plainText }
  }
  async save(userId: string, input: PostDto, id?: string, audit?: { actorId: string; action: string; reason: string }, key?: string, ip?: string) {
    if (input.status === 'published') await this.visibility.assertOperation(userId, 'post')
    const viewer = await this.visibility.viewer(userId)
    const current = id ? await this.prisma.communityPost.findUnique({ where: { id }, include: { contribution: true } }) : null
    if (id && (!current || current.authorId !== userId || current.deletedAt)) throw new ForbiddenException('只有作者可以编辑自己的内容')
    if (current && input.expectedRevision === undefined) throw new BadRequestException('编辑动态必须提供 expectedRevision')
    if (current && !['draft', 'published', 'pending_review'].includes(current.status)) throw new ForbiddenException('当前状态的内容暂不可编辑')
    if (input.visibility === 'school' && !viewer.schoolId) throw new BadRequestException('未认证学校，不能发布同校内容')
    if (input.portalConsent && audit && audit.actorId !== userId) throw new ForbiddenException('只有作者本人可以授权匿名门户展示')
    const coverFileId = input.coverFileId === undefined ? current?.coverFileId || null : input.coverFileId
    if (coverFileId && !await this.prisma.fileRecord.count({ where: { quarantinedAt: null, id: coverFileId, uploadedBy: userId, mimeType: { in: ['image/png', 'image/jpeg', 'image/webp'] }, extension: { in: ['.png', '.jpg', '.jpeg', '.webp'] }, size: { gt: 0, lte: 5 * 1024 * 1024 } } })) throw new BadRequestException('封面必须由本人上传且为不超过 5MB 的 PNG、JPEG 或 WebP')
    const contribution: ResourceContributionInput | undefined = input.contribution || (current?.contribution ? {
      kind: current.contribution.kind,
      categoryId: current.contribution.categoryId || undefined,
      tags: current.contribution.tags,
      teachingReuseConsent: current.contribution.teachingReuseConsent,
      sourceName: current.contribution.sourceName || undefined,
      sourceUrl: current.contribution.sourceUrl || undefined,
      videoAssetId: current.contribution.videoAssetId || undefined,
      attachmentFileId: current.contribution.attachmentFileId || undefined,
      coverFileId: current.contribution.coverFileId || undefined,
    } : undefined)
    if (input.status === 'published' && (['question', 'project'].includes(input.type) || contribution) && !input.title?.trim()) throw new BadRequestException(contribution ? '资源投稿需要标题' : '问答和项目需要标题')
    const { clean, plainText } = await this.blocks(userId, input.contentBlocks, input.status === 'draft' || !!contribution && contribution.kind !== 'article')
    const references = await this.refs.resolveMany(input.bindings, userId, true)
    if (!contribution && input.status === 'published' && input.type === 'lab_result' && !input.bindings.some((ref) => ref.type === 'lab_run')) throw new BadRequestException('实训成果需要关联本人已提交的实训记录')
    if (!contribution && input.status === 'published' && input.type === 'project') {
      const labIds = input.bindings.filter((ref) => ref.type === 'lab').map((ref) => references.get(`lab:${ref.id}`)!.id)
      if (!await this.prisma.lab.count({ where: { id: { in: labIds }, labType: 'project' } })) throw new BadRequestException('创客项目需要关联现有综合项目实训')
    }
    if (!contribution && input.status === 'published' && input.type === 'frontier_discussion' && !input.bindings.some((ref) => ref.type === 'article')) throw new BadRequestException('前沿讨论需要关联文章')
    if (!!input.sourceType !== !!input.sourceId) throw new BadRequestException('分享来源类型与标识必须同时提供')
    if (input.sourceType === 'note' && !await this.prisma.learningNote.findFirst({ where: { id: input.sourceId, userId } })) throw new ForbiddenException('笔记只能由本人主动分享')
    if (input.sourceType === 'lab_run' && !input.bindings.some((ref) => ref.type === 'lab_run' && ref.id === input.sourceId)) throw new BadRequestException('实训来源与关联记录不一致')
    if (['challenge', 'article'].includes(input.sourceType || '') && !input.bindings.some((ref) => ref.type === input.sourceType && ref.id === input.sourceId)) throw new BadRequestException('分享来源与关联内容不一致')
    const topics = await this.prisma.communityTopic.findMany({ where: { id: { in: input.topicIds }, status: 'active' } })
    if (topics.length !== input.topicIds.length) throw new BadRequestException('话题已关闭或不存在')
    let normalizedContribution: ResourceContributionInput | undefined
    if (contribution) {
      const tags = contribution.tags.map((tag) => tag.trim().replace(/\s+/g, ' ')).filter(Boolean)
        .filter((tag, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index)
      normalizedContribution = {
        kind: contribution.kind,
        categoryId: contribution.categoryId,
        tags,
        teachingReuseConsent: contribution.teachingReuseConsent,
        coverFileId: contribution.coverFileId,
        ...(contribution.kind === 'video' ? { videoAssetId: contribution.videoAssetId } : {}),
        ...(contribution.kind === 'document' ? { attachmentFileId: contribution.attachmentFileId } : {}),
        ...(contribution.kind === 'article' ? { sourceName: contribution.sourceName, sourceUrl: contribution.sourceUrl } : {}),
      }
      if (contribution.categoryId && !await this.prisma.resourceCategory.count({ where: { id: contribution.categoryId, active: true } })) throw new BadRequestException('资源分类不存在或已停用')
      if (contribution.videoAssetId) {
        const video = await this.prisma.videoAsset.findFirst({ where: { sourceFile: { quarantinedAt: null }, id: contribution.videoAssetId, uploaderId: userId } })
        if (!video) throw new ForbiddenException('视频必须由本人上传')
        if (input.status === 'published' && video.status !== 'ready') throw new BadRequestException(video.status === 'failed' ? '视频处理失败，请重试后发布' : '视频尚未处理完成')
      }
      if (input.status === 'published' && contribution.kind === 'video' && !contribution.videoAssetId) throw new BadRequestException('视频投稿需要已上传的视频')
      if (input.status === 'published' && contribution.kind === 'document' && !contribution.attachmentFileId) throw new BadRequestException('资料投稿需要附件')
      const fileIds = [contribution.attachmentFileId, contribution.coverFileId].filter((value): value is string => !!value)
      if (fileIds.length) {
        const files = await this.prisma.fileRecord.findMany({ where: { quarantinedAt: null, id: { in: [...new Set(fileIds)] }, uploadedBy: userId }, select: { id: true, mimeType: true, size: true } })
        if (files.length !== new Set(fileIds).size) throw new ForbiddenException('封面和附件必须由本人上传')
        const cover = files.find((file) => file.id === contribution.coverFileId)
        if (cover && (!['image/png', 'image/jpeg', 'image/webp'].includes(cover.mimeType) || cover.size > 5 * 1024 * 1024)) throw new BadRequestException('投稿封面仅支持不超过 5MB 的 PNG、JPEG 或 WebP')
        const attachment = files.find((file) => file.id === contribution.attachmentFileId)
        const attachmentMaxBytes = Math.max(1, Math.min(500, Number(process.env.RESOURCE_ATTACHMENT_MAX_MB || 100))) * 1024 * 1024
        if (attachment && (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/x-zip-compressed', 'text/plain'].includes(attachment.mimeType) || attachment.size > attachmentMaxBytes)) throw new BadRequestException('资料附件的类型或大小不符合要求')
      }
    }
    const quotedPostId = input.quotedPostId === undefined ? current?.quotedPostId || null : input.quotedPostId
    if (quotedPostId && input.status === 'published' && !clean.some((block) => block.type !== 'image' && (block.type === 'code' ? block.code.trim() : block.type === 'list' ? block.items.join('').trim() : sanitizeHtml(block.text, { allowedTags: [], allowedAttributes: {} }).trim()))) throw new BadRequestException('请写下自己的观点后再引用发布')
    const contentHash = createHash('sha256').update(`${input.title || ''}\n${plainText}\n${JSON.stringify(normalizedContribution || null)}${coverFileId || ''}${quotedPostId || ''}`.replace(/\s+/g, '').toLowerCase()).digest('hex')
    const post = await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const scope = audit?.action === 'official_publish' ? `post:${userId}:new` : `post:${id || 'new'}`
      const request = await idempotency(tx, audit?.actorId || userId, scope, key, input)
      if (request.resourceId) return tx.communityPost.findUniqueOrThrow({ where: { id: request.resourceId } })
      const fileIds = clean.flatMap((block) => block.type === 'image' ? [block.fileId] : [])
      if (fileIds.length && await tx.fileRecord.count({ where: { quarantinedAt: null, id: { in: fileIds }, uploadedBy: userId } }) !== new Set(fileIds).size) throw new BadRequestException('图片已失效，请重新上传')
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`community-write:${userId}`},0))::text`
      const latest = id ? await tx.communityPost.findUnique({ where: { id } }) : null
      if (input.status === 'published' || latest?.status === 'published') await this.visibility.assertOperation(userId, 'post', tx)
      if (id && (!latest || latest.deletedAt || latest.authorId !== userId || !['draft', 'published', 'pending_review'].includes(latest.status))) throw new ConflictException('动态状态已变化，请重新读取')
      if (latest && latest.revision !== input.expectedRevision) throw new ConflictException('已有较新的服务端版本，请保留当前输入并重新读取')
      if (input.status === 'published' && await tx.communityPost.count({ where: { authorId: userId, contentHash, id: { not: id }, status: { in: ['published', 'limited'] } } })) throw new ConflictException('相同内容已发布，请编辑原动态')
      const detection = input.status === 'published' ? await this.detection.check(tx, postDetectionInput(input.title, plainText, clean, normalizedContribution, latest?.labels)) : null
      const status = detection?.action === 'review' ? 'pending_review' as const : input.status
      const publishing = status === 'published' && latest?.status !== 'published'
      if (input.status === 'published' && latest?.status !== 'published') await this.visibility.consumeQuota(tx, userId, 'post', ip)
      await this.relations.quote(tx, userId, quotedPostId, latest, input.status === 'published')
      const oldTopicIds = current ? (await tx.communityPostTopic.findMany({ where: { postId: current.id } })).map((row) => row.topicId) : []
      const data = { quotedPostId, authorId: userId, postType: input.type, status, visibility: input.visibility, portalConsent: input.portalConsent === true && input.visibility === 'public', schoolId: viewer.schoolId, title: input.title?.trim() || null, body: plainText, plainText, contentBlocks: json(clean), coverFileId, contentHash, sourceType: input.sourceType || null, sourceId: input.sourceId || null, publishedAt: status === 'published' ? current?.publishedAt || new Date() : null, ...(id ? { editedAt: new Date() } : {}) }
      if (latest) await postRevision(tx, latest.id, userId, 'user', '编辑前版本')
      const saved = id ? await tx.communityPost.update({ where: { id, revision: latest!.revision }, data: { ...data, revision: { increment: 1 } } }) : await tx.communityPost.create({ data })
      if (detection) await this.detection.record(tx, { type: 'post', id: saved.id, revision: saved.revision, authorId: userId, submittedById: audit?.actorId || userId }, detection)
      else await tx.contentReview.updateMany({ where: { targetType: 'post', targetId: saved.id, status: 'pending' }, data: { status: 'superseded' } })
      if ((current?.portalConsent || false) !== saved.portalConsent) await actionEvent(tx, audit?.actorId || userId, 'portal_consent_changed', 'post', saved.id, { allowed: saved.portalConsent, revision: saved.revision }, audit ? 'admin-web' : 'student-web')
      if (normalizedContribution) {
        await tx.resourceContribution.upsert({
          where: { postId: saved.id },
          create: {
            postId: saved.id,
            kind: normalizedContribution.kind,
            categoryId: normalizedContribution.categoryId || null,
            videoAssetId: normalizedContribution.videoAssetId || null,
            attachmentFileId: normalizedContribution.attachmentFileId || null,
            coverFileId: normalizedContribution.coverFileId || null,
            tags: normalizedContribution.tags,
            teachingReuseConsent: normalizedContribution.teachingReuseConsent,
            sourceName: normalizedContribution.sourceName || null,
            sourceUrl: normalizedContribution.sourceUrl || null,
          },
          update: {
            kind: normalizedContribution.kind,
            categoryId: normalizedContribution.categoryId || null,
            videoAssetId: normalizedContribution.videoAssetId || null,
            attachmentFileId: normalizedContribution.attachmentFileId || null,
            coverFileId: normalizedContribution.coverFileId || null,
            tags: normalizedContribution.tags,
            teachingReuseConsent: normalizedContribution.teachingReuseConsent,
            sourceName: normalizedContribution.sourceName || null,
            sourceUrl: normalizedContribution.sourceUrl || null,
            revision: { increment: 1 },
          },
        })
      }
      await tx.communityPostBinding.deleteMany({ where: { postId: saved.id } })
      await tx.communityPostBinding.createMany({ data: input.bindings.map((ref, sortOrder) => ({ postId: saved.id, targetType: ref.type, targetId: references.get(`${ref.type}:${ref.id}`)!.id, titleSnapshot: references.get(`${ref.type}:${ref.id}`)!.title, sortOrder })), skipDuplicates: true })
      const resolved = await this.relations.resolve(tx, saved, input.topicIds, input.inlineReferences, (latest?.inlineReferences || []) as unknown as CommunityInlineReference[])
      await this.relations.notify(tx, saved, resolved.refs, latest?.status === 'published' ? (latest.inlineReferences || []) as unknown as CommunityInlineReference[] : [])
      if (input.type === 'question') await tx.communityQuestionState.upsert({ where: { postId: saved.id }, create: { postId: saved.id }, update: {} })
      else await tx.communityQuestionState.deleteMany({ where: { postId: saved.id } })
      await tx.communityProfile.upsert({ where: { userId }, create: { userId }, update: {} })
      await tx.communityProfile.update({ where: { userId }, data: { postCount: await tx.communityPost.count({ where: { authorId: userId, status: 'published', deletedAt: null } }) } })
      const topicIds = [...new Set([...resolved.topicIds, ...oldTopicIds])]
      for (const topicId of topicIds) await tx.communityTopic.update({ where: { id: topicId }, data: { postCount: await tx.communityPostTopic.count({ where: { topicId, post: { status: 'published', deletedAt: null } } }) } })
      if (publishing) await this.signals.record(userId, 'community_post_publish', 'post', saved.id, { postType: input.type, topicIds: resolved.topicIds, bindingKeys: input.bindings.map((ref) => `${ref.type}:${references.get(`${ref.type}:${ref.id}`)!.id}`) }, tx)
      else await actionEvent(tx, audit?.actorId || userId, input.status === 'draft' ? 'post_draft_saved' : 'post_edited', 'post', saved.id, {}, audit ? 'admin-web' : 'student-web')
      await postRevision(tx, saved.id, audit?.actorId || userId, audit ? 'admin' : 'user', audit?.reason || '')
      if (audit) await tx.communityModerationAction.create({ data: { ...audit, targetType: 'post', targetId: saved.id } })
      await request.complete(saved.id)
      return saved
    })
    return this.detail(userId, post.id)
  }
  async remove(userId: string, id: string) {
    await this.visibility.viewer(userId)
    const post = await this.prisma.communityPost.findUnique({ where: { id } })
    if (!post || post.authorId !== userId) throw new ForbiddenException('只有作者可以删除自己的动态')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${id} FOR UPDATE`
      await postRevision(tx, id, userId)
      const changed = await tx.communityPost.updateMany({ where: { id, authorId: userId, deletedAt: null }, data: { deletedAt: new Date(), status: 'removed', revision: { increment: 1 } } })
      if (changed.count) { await postRevision(tx, id, userId); await actionEvent(tx, userId, 'post_deleted', 'post', id) }
      await tx.communityProfile.updateMany({ where: { userId }, data: { postCount: await tx.communityPost.count({ where: { authorId: userId, status: 'published', deletedAt: null } }) } })
      for (const { topicId } of await tx.communityPostTopic.findMany({ where: { postId: id } })) await tx.communityTopic.update({ where: { id: topicId }, data: { postCount: await tx.communityPostTopic.count({ where: { topicId, post: { status: 'published', deletedAt: null } } }) } })
    })
    return { deleted: true }
  }
  async unpublish(userId: string, id: string) {
    await this.visibility.viewer(userId)
    const post = await this.prisma.communityPost.findUnique({ where: { id } })
    if (!post || post.authorId !== userId) throw new ForbiddenException('只有作者可以下架自己的动态')
    if (post.status !== 'published' || post.deletedAt) throw new BadRequestException('只有已发布动态可以下架')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${id} FOR UPDATE`
      await postRevision(tx, id, userId)
      const changed = await tx.communityPost.updateMany({ where: { id, authorId: userId, status: 'published', deletedAt: null }, data: { status: 'draft', publishedAt: null, revision: { increment: 1 } } })
      if (!changed.count) throw new ConflictException('动态状态已变化，请刷新')
      await tx.communityProfile.updateMany({ where: { pinnedPostId: id }, data: { pinnedPostId: null, revision: { increment: 1 } } })
      await tx.communityProfile.updateMany({ where: { userId }, data: { postCount: await tx.communityPost.count({ where: { authorId: userId, status: 'published', deletedAt: null } }) } })
      for (const { topicId } of await tx.communityPostTopic.findMany({ where: { postId: id } })) await tx.communityTopic.update({ where: { id: topicId }, data: { postCount: await tx.communityPostTopic.count({ where: { topicId, post: { status: 'published', deletedAt: null } } }) } })
      await postRevision(tx, id, userId)
      await actionEvent(tx, userId, 'post_unpublished', 'post', id)
    })
    return { unpublished: true }
  }
  async mapMany(userId: string, rows: HydratedPost[]): Promise<CommunityPostDetailDto[]> {
    const ids = rows.map((row) => row.id)
    const commentWhere = { postId: { in: ids }, deletedAt: null, status: 'published' as const, ...visibleComment() }
    const [reactions, bookmarks, follows, topicFollows, teachers, commentCounts, acceptedComments] = await Promise.all([
      this.prisma.communityPostReaction.findMany({ where: { userId, postId: { in: ids } } }),
      this.prisma.communityBookmark.findMany({ where: { userId, postId: { in: ids } } }),
      this.prisma.communityUserFollow.findMany({ where: { followerId: userId, followeeId: { in: rows.map((row) => row.authorId) } } }),
      this.prisma.communityTopicFollow.findMany({ where: { userId, topicId: { in: rows.flatMap((row) => row.topics.map((entry) => entry.topicId)) } } }),
      this.prisma.communityComment.groupBy({ by: ['postId'], where: { ...commentWhere, author: { ...availableAccount(), communityProfile: { verifiedType: { in: ['teacher', 'mentor'] } }, userRoles: { some: { role: { code: { in: ['teacher', 'mentor'] } } } } } } }),
      this.prisma.communityComment.groupBy({ by: ['postId'], where: commentWhere, _count: { _all: true } }),
      this.prisma.communityComment.findMany({ where: { ...commentWhere, id: { in: rows.flatMap((row) => row.question?.acceptedCommentId ? [row.question.acceptedCommentId] : []) } }, select: { id: true } }),
    ])
    const references = await this.refs.resolveMany(rows.flatMap((row) => row.bindings.map((ref) => ({ type: ref.targetType as CommunityBindingInput['type'], id: ref.targetId }))), userId)
    // 他人的 LabRun 永远不进入普通 DTO，最多展示它关联的公开实训。
    const privateRuns = rows.filter((row) => row.authorId !== userId).flatMap((row) => row.bindings.filter((ref) => ref.targetType === 'lab_run').map((ref) => ref.targetId))
    const runs = privateRuns.length ? await this.prisma.labRun.findMany({ where: { id: { in: privateRuns }, status: 'submitted' }, select: { id: true, labId: true } }) : []
    const publicLabs = await this.refs.resolveMany(runs.map((run) => ({ type: 'lab', id: run.labId })), userId)
    const runRefs = new Map(runs.map((run) => [run.id, publicLabs.get(`lab:${run.labId}`)]))
    const [inline, quotes] = await Promise.all([this.relations.links(userId, rows.map((row) => row.inlineReferences)), this.relations.quotes(userId, rows)])
    return rows.map((row) => ({
      inlineReferences: inline.get(JSON.stringify(row.inlineReferences)) || [], manualTopicIds: row.topics.filter((ref) => ref.manual).map((ref) => ref.topicId),
      quotedPostId: row.quotedPostId, quotedPost: row.quotedPostId ? quotes.previews.get(row.quotedPostId) || { id: row.quotedPostId, available: false } : null,
      id: row.id, revision: row.revision, type: row.postType, status: row.status, visibility: row.visibility, portalConsent: row.portalConsent, title: row.title,
      mediaCount: (row.contentBlocks as CommunityContentBlock[]).filter((block) => block.type === 'image').length + (row.coverFileId ? 1 : 0),
      body: row.body, bodyPreview: row.plainText.slice(0, 320), contentBlocks: row.contentBlocks as CommunityContentBlock[], coverFileId: row.coverFileId,
      author: authorDto(row.author),
      bindings: [...new Map(row.bindings.map((ref) => {
        if (ref.targetType === 'lab_run' && row.authorId !== userId) return runRefs.get(ref.targetId)
        return references.get(`${ref.targetType}:${ref.targetId}`) || { type: ref.targetType as CommunityBindingInput['type'], id: ref.targetId, title: '关联内容已下架', route: '', status: 'unavailable' }
      }).filter((ref): ref is NonNullable<typeof ref> => !!ref).map((ref) => [`${ref.type}:${ref.id}`, ref])).values()],
      topics: row.topics.filter((ref) => ref.topic.status === 'active').map(({ topic }): CommunityTopicDto => ({ ...topic, following: topicFollows.some((follow) => follow.topicId === topic.id) })),
      stats: { likes: row.likeCount, useful: row.usefulCount, comments: commentCounts.find((count) => count.postId === row.id)?._count._all || 0, bookmarks: row.bookmarkCount, views: row.impressionCount, quotes: quotes.counts.get(row.id) || 0 },
      viewerState: { liked: reactions.some((r) => r.postId === row.id && r.reactionType === 'like'), markedUseful: reactions.some((r) => r.postId === row.id && r.reactionType === 'useful'), bookmarked: bookmarks.some((b) => b.postId === row.id), followingAuthor: follows.some((f) => f.followeeId === row.authorId) },
      recommendationReasons: [], labels: row.status === 'limited' ? [...row.labels, '内容正在人工复核'] : row.labels,
      question: row.question ? { status: row.question.status === 'solved' && !acceptedComments.some((comment) => comment.id === row.question!.acceptedCommentId) ? 'open' : row.question.status as 'open' | 'solved' | 'closed', acceptedCommentId: acceptedComments.some((comment) => comment.id === row.question!.acceptedCommentId) ? row.question.acceptedCommentId : null, teacherAnswered: teachers.some((c) => c.postId === row.id) } : null,
      publishedAt: (row.publishedAt || row.createdAt).toISOString(), editedAt: row.editedAt?.toISOString() || null,
      contribution: row.contribution ? this.contribution(row.contribution) : null,
    }))
  }

  private contribution(row: HydratedPost['contribution']): ResourceContributionDto | null {
    if (!row) return null
    return {
      postId: row.postId,
      kind: row.kind,
      categoryId: row.categoryId || undefined,
      tags: row.tags,
      teachingReuseConsent: row.teachingReuseConsent,
      sourceName: row.sourceName || undefined,
      sourceUrl: row.sourceUrl || undefined,
      videoAssetId: row.videoAssetId || undefined,
      attachmentFileId: row.attachmentFileId || undefined,
      coverFileId: row.coverFileId || undefined,
      category: row.category ? { id: row.category.id, code: row.category.code, name: row.category.name, description: row.category.description, icon: row.category.icon, sortOrder: row.category.sortOrder } : null,
      video: row.videoAsset ? {
        id: row.videoAsset.id,
        status: row.videoAsset.status,
        originalName: row.videoAsset.originalName,
        originalMimeType: row.videoAsset.originalMimeType,
        durationSeconds: row.videoAsset.durationSeconds,
        width: row.videoAsset.width,
        height: row.videoAsset.height,
        rotation: row.videoAsset.rotation,
        attempts: row.videoAsset.attempts,
        lastError: row.videoAsset.lastError,
        posterUrl: null,
        createdAt: row.videoAsset.createdAt.toISOString(),
        updatedAt: row.videoAsset.updatedAt.toISOString(),
      } : null,
      attachment: row.attachmentFile ? { id: row.attachmentFile.id, name: row.attachmentFile.originalName, size: row.attachmentFile.size, mimeType: row.attachmentFile.mimeType } : null,
      coverUrl: null,
      featured: row.featured,
      liveReplay: row.liveReplay,
      revision: row.revision,
    }
  }
  async detail(userId: string, id: string, ownDrafts = true) {
    const row = await this.prisma.communityPost.findFirst({ where: { AND: [await this.visibility.where(userId, ownDrafts), { id }] }, include: postInclude })
    if (!row) throw new NotFoundException('内容不存在')
    const result = (await this.mapMany(userId, [row]))[0]!
    if (row.authorId === userId) result.detection = await this.detection.result('post', id, row.revision)
    return result
  }
  async list(userId: string, query: CommunityQueryDto, extra: Prisma.CommunityPostWhereInput = {}, ownDrafts = false): Promise<CommunityPostSummaryDto[]> {
    const bindings = query.bindingId ? await this.refs.resolveMany(['theme', 'course', 'lesson', 'lab', 'resource', 'article', 'challenge'].map((type) => ({ type: type as CommunityBindingInput['type'], id: query.bindingId! })), userId) : new Map()
    const bindingIds = query.bindingId ? [...new Set([query.bindingId, ...[...bindings.values()].map((ref) => ref.id)])] : []
    const rows = await this.prisma.communityPost.findMany({
      where: { AND: [await this.visibility.where(userId, ownDrafts), extra, {
        ...(query.keyword ? { OR: [{ title: { contains: query.keyword, mode: 'insensitive' } }, { plainText: { contains: query.keyword, mode: 'insensitive' } }] } : {}),
        ...(query.bindingId ? { bindings: { some: { targetId: { in: bindingIds } } } } : {}),
      }] },
      include: postInclude, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 100,
    })
    return this.mapMany(userId, rows)
  }
}
