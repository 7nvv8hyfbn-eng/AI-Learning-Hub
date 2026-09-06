import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CommunityPostService, postInclude } from './post.service'
import { AdminCommunityQuery } from './admin-query.dto'
import { dateRange } from '../users/users.service'
import { authorDto, authorInclude } from './community.mapper'
import { CommunityVisibilityPolicyService } from './visibility.service'

export const curatedDraftWhere: Prisma.CommunityPostWhereInput = {
  id: { startsWith: 'community-lcz-' },
  status: 'draft',
  publishedAt: null,
  deletedAt: null,
  visibility: 'public',
  author: {
    status: 'active',
    communityProfile: { is: { verifiedType: 'official' } },
    userRoles: { some: { role: { code: 'community_official' } } },
  },
}

@Injectable()
export class CommunityAdminService {
  constructor(private readonly prisma: PrismaService, private readonly posts: CommunityPostService, private readonly visibility: CommunityVisibilityPolicyService) {}
  private paging(q: AdminCommunityQuery) { return { skip: (q.page - 1) * q.pageSize, take: q.pageSize } }
  private result<T>(q: AdminCommunityQuery, items: T[], total: number) { return { items, total, page: q.page, pageSize: q.pageSize } }
  async postWhere(q: AdminCommunityQuery): Promise<Prisma.CommunityPostWhereInput> {
    if (q.status && !['draft', 'published', 'limited', 'hidden', 'removed'].includes(q.status)) throw new BadRequestException('动态状态无效')
    const scope = q.status === 'draft'
      ? curatedDraftWhere
      : q.status
        ? this.visibility.adminWhere()
        : { OR: [this.visibility.adminWhere(), curatedDraftWhere] }
    return {
      AND: [scope, ...(q.status && q.status !== 'draft' ? [{ status: q.status as 'published' | 'limited' | 'hidden' | 'removed' }] : []), ...(q.hasMedia === undefined ? [] : [q.hasMedia ? { contentBlocks: { array_contains: [{ type: 'image' }] } } : { NOT: { contentBlocks: { array_contains: [{ type: 'image' }] } } }])],
      ...((q.postType || q.type && q.type !== 'all') ? { postType: q.postType || q.type as 'question' } : {}),
      ...(q.keyword ? { OR: [{ title: { contains: q.keyword, mode: 'insensitive' } }, { plainText: { contains: q.keyword, mode: 'insensitive' } }] } : {}),
      ...(q.authorId ? { authorId: q.authorId } : {}), ...(q.schoolId ? { schoolId: q.schoolId } : {}),
      ...(q.visibility ? { visibility: q.visibility } : {}), ...(q.topicId ? { topics: { some: { topicId: q.topicId } } } : {}),
      ...(q.reported === undefined ? {} : { reports: q.reported ? { some: {} } : { none: {} } }),
      createdAt: dateRange(q.createdFrom, q.createdTo),
    }
  }
  async list(userId: string, q: AdminCommunityQuery) {
    const where = await this.postWhere(q)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.communityPost.findMany({ where, include: { ...postInclude, _count: { select: { reports: true } } }, orderBy: [{ [q.sortBy]: q.sortOrder }, { id: q.sortOrder }], ...this.paging(q) }),
      this.prisma.communityPost.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    const mapped = await this.posts.mapMany(userId, rows)
    if (rows.some((row) => ['draft', 'hidden', 'removed'].includes(row.status))) await this.visibility.auditAdminRead(userId, 'post', 'page')
    return this.result(q, mapped.map((post, index) => ({ ...post, reportCount: rows[index]._count.reports })), total)
  }
  async comments(actorId: string, q: AdminCommunityQuery) {
    const where: Prisma.CommunityCommentWhereInput = {
      post: await this.postWhere({ ...q, keyword: undefined, status: undefined, authorId: undefined, createdFrom: undefined, createdTo: undefined }),
      ...(q.keyword ? { body: { contains: q.keyword, mode: 'insensitive' } } : {}),
      ...(q.authorId ? { authorId: q.authorId } : {}), ...(q.postId ? { postId: q.postId } : {}),
      ...(q.status ? { status: q.status } : {}), createdAt: dateRange(q.createdFrom, q.createdTo),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.communityComment.findMany({ where, select: { id: true, postId: true, body: true, status: true, createdAt: true, revision: true, post: { select: { status: true } }, author: { select: { id: true, displayName: true } } }, orderBy: [{ createdAt: q.sortOrder }, { id: q.sortOrder }], ...this.paging(q) }),
      this.prisma.communityComment.count({ where }),
    ])
    if (items.some((item) => item.status !== 'published' || ['hidden', 'removed'].includes(item.post.status))) await this.visibility.auditAdminRead(actorId, 'comment', 'page')
    return this.result(q, items.map(({ post, ...comment }) => { void post; return comment }), total)
  }
  async topics(q: AdminCommunityQuery) {
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.keyword ? { name: { contains: q.keyword, mode: 'insensitive' as const } } : {}) }
    const [items, total] = await this.prisma.$transaction([this.prisma.communityTopic.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], ...this.paging(q) }), this.prisma.communityTopic.count({ where })])
    return this.result(q, items.map((row) => ({ ...row, following: false })), total)
  }
  async reports(q: AdminCommunityQuery) {
    const where: Prisma.CommunityReportWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.keyword ? { reason: { contains: q.keyword, mode: 'insensitive' } } : {}), createdAt: dateRange(q.createdFrom, q.createdTo), OR: [{ post: this.visibility.adminWhere() }, { comment: { post: this.visibility.adminWhere() } }] }
    const [items, total] = await this.prisma.$transaction([this.prisma.communityReport.findMany({ where, select: { id: true, postId: true, commentId: true, reason: true, description: true, status: true, createdAt: true }, orderBy: [{ createdAt: q.sortOrder }, { id: q.sortOrder }], ...this.paging(q) }), this.prisma.communityReport.count({ where })])
    return this.result(q, items, total)
  }
  async users(q: AdminCommunityQuery) {
    if (q.status && !['active', 'disabled', 'locked'].includes(q.status)) throw new BadRequestException('用户状态无效')
    const where: Prisma.UserWhereInput = { ...(q.keyword ? { OR: [{ displayName: { contains: q.keyword, mode: 'insensitive' } }, { username: { contains: q.keyword, mode: 'insensitive' } }] } : {}), ...(q.schoolId ? { schoolId: q.schoolId } : {}), ...(q.status ? { status: q.status as 'active' | 'disabled' | 'locked' } : {}), createdAt: dateRange(q.createdFrom, q.createdTo) }
    const [items, total] = await this.prisma.$transaction([this.prisma.user.findMany({ where, include: authorInclude, orderBy: [{ createdAt: q.sortOrder }, { id: q.sortOrder }], ...this.paging(q) }), this.prisma.user.count({ where })])
    return this.result(q, items.map((r) => ({ ...authorDto(r), revision: r.communityProfile?.revision || 1, expertiseTopics: r.communityProfile?.expertiseTopics || [] })), total)
  }
}
