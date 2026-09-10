import { loadBadgeContext, type BadgeContext } from '../../modules/community/user-badges'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { CommunityBindingInput, HomepageResolvedItemDto, LandingPublicAuthor, LearningContentReferenceDto, LearningContentType } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { authorDto, authorInclude } from '../../modules/community/community.mapper'
import { MediaResolverService } from '../../modules/media/media-resolver.service'
import { visibleComment, visibleProfile, visiblePublicPost } from '../../modules/community/governance-policy'

const types: LearningContentType[] = ['theme', 'course', 'lesson', 'lab', 'resource', 'article', 'challenge', 'lab_run']
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

@Injectable()
export class ContentReferenceService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaResolverService) {}

  /** 门户仅投影当前公开对象；不返回草稿、正文块、媒体令牌或账号内部字段。 */
  async resolvePublicCommunity(type: string, id: string): Promise<HomepageResolvedItemDto | null> {
    if (type === 'community_post') {
      const row = await this.prisma.communityPost.findFirst({ where: { id, ...visiblePublicPost(), portalConsent: true }, include: { author: { include: authorInclude } } })
      if (!row) return null
      const author = this.publicAuthor(row.author, await loadBadgeContext(this.prisma))
      const commentCount = await this.prisma.communityComment.count({ where: { postId: row.id, status: 'published', deletedAt: null, ...visibleComment() } })
      return { targetType: type, slug: row.id, title: row.title || row.plainText.slice(0, 60), summary: row.plainText.slice(0, 160), data: { route: `/community/post/${row.id}`, postType: row.postType, author, publishedAt: row.publishedAt?.toISOString(), commentCount, likeCount: row.likeCount, bookmarkCount: row.bookmarkCount } }
    }
    if (type === 'community_topic') {
      const row = await this.prisma.communityTopic.findFirst({ where: { OR: [{ id }, { slug: id }], status: 'active' } })
      if (!row) return null
      const postCount = await this.prisma.communityPostTopic.count({ where: { topicId: row.id, post: { ...visiblePublicPost(), portalConsent: true } } })
      return { targetType: type, slug: row.slug, title: row.name, summary: row.description, data: { id: row.id, route: `/community/topic/${row.slug}`, postCount, followerCount: row.followerCount, recommended: row.recommended } }
    }
    if (type === 'community_user') {
      const user = await this.prisma.user.findFirst({ where: { OR: [{ id }, { username: id }], ...visibleProfile(), communityProfile: { isNot: null }, communityPosts: { some: { ...visiblePublicPost(), portalConsent: true } } }, include: authorInclude })
      if (!user) return null
      const author = this.publicAuthor(user, await loadBadgeContext(this.prisma))
      // 公开创作者必须有公开作品；后台身份本身不构成允许展示。
      if (user.userRoles.some((item) => ['admin', 'super_admin'].includes(item.role.code)) && author.verifiedType === 'none') return null
      return { targetType: type, slug: user.username, title: user.displayName, summary: author.headline, data: { ...author, route: `/community/user/${user.username}` } }
    }
    return null
  }

  private publicAuthor(user: Parameters<typeof authorDto>[0], context: BadgeContext): LandingPublicAuthor {
    const author = authorDto(user, context)
    return { id: author.id, username: author.username, displayName: author.displayName, verifiedType: author.verifiedType, badges: author.badges, headline: author.username ? user.communityProfile?.headline.slice(0, 100) || user.communityProfile?.bio.slice(0, 100) || '' : '', followerCount: author.username ? user.communityProfile?.followerCount || 0 : 0 }
  }

  /** 每个类型一次查询；标题与摘要只来自已发布快照，绝不解析草稿 payload。 */
  async resolveMany(inputs: CommunityBindingInput[], viewerId: string, strict = false) {
    const result = new Map<string, LearningContentReferenceDto>()
    for (const type of types) {
      const ids = [...new Set(inputs.filter((item) => item.type === type).map((item) => item.id))]
      if (!ids.length) continue
      if (type === 'lesson') {
        const rows = await this.prisma.courseLesson.findMany({
          where: { id: { in: ids }, chapter: { version: { course: { status: 'published', deletedAt: null } } } },
          include: { chapter: { include: { version: { include: { course: true } } } } },
        })
        for (const row of rows) {
          const course = row.chapter.version.course
          if (course.publishedVersionId !== row.chapter.courseVersionId) continue
          result.set(`${type}:${row.id}`, { type, id: row.id, title: row.title, summary: row.summary, route: `/courses/${course.slug}?lesson=${row.id}`, status: 'published' })
        }
        continue
      }
      if (type === 'lab_run') {
        const rows = await this.prisma.labRun.findMany({ where: { id: { in: ids }, userId: viewerId, status: 'submitted', lab: { status: 'published', deletedAt: null } }, include: { lab: { include: { publishedVersion: true } } } })
        for (const row of rows) {
          const snapshot = object(row.lab.publishedVersion?.snapshot)
          result.set(`${type}:${row.id}`, { type, id: row.id, title: `${String(snapshot.title || row.lab.title)} · 已提交成果`, route: `/labs/${row.lab.slug}`, status: 'submitted' })
        }
        continue
      }
      const where = { OR: [{ id: { in: ids } }, { slug: { in: ids } }], status: 'published' as const, deletedAt: null }
      const include = { publishedVersion: true }
      const rows = type === 'theme' ? await this.prisma.theme.findMany({ where, include })
        : type === 'course' ? await this.prisma.course.findMany({ where, include })
          : type === 'lab' ? await this.prisma.lab.findMany({ where, include })
            : type === 'resource' ? await this.prisma.resource.findMany({ where: { ...where, publishedVersion: { is: { snapshot: { path: ['visibility'], equals: 'public' } } } }, include })
              : type === 'article' ? await this.prisma.article.findMany({ where, include })
                : await this.prisma.challenge.findMany({ where, include })
      const covers = await this.media.prepare(rows, true)
      for (const row of rows) {
        if (!row.publishedVersion) continue
        const snapshot = object(row.publishedVersion.snapshot)
        const title = String(snapshot.title ?? (type === 'resource' ? '' : row.title)), summary = String(snapshot.summary ?? (type === 'resource' ? '' : row.summary))
        const data = await this.media.data(type, { ...row, title, summary }, object(snapshot.data || snapshot.payload), true, covers)
        const routes = { theme: `/topics?theme=${row.slug}`, course: `/courses/${row.slug}`, lab: `/labs/${row.slug}`, resource: `/resources?resource=${row.slug}`, article: `/frontier?article=${row.slug}`, challenge: `/assessments?challenge=${row.slug}` }
        const ref: LearningContentReferenceDto = { type, id: row.id, slug: row.slug, title, summary, route: routes[type], status: 'published', ...(typeof data.cover === 'string' ? { cover: data.cover } : {}), ...(typeof data.category === 'string' ? { category: data.category } : {}) }
        result.set(`${type}:${row.id}`, ref)
        result.set(`${type}:${row.slug}`, ref)
      }
    }
    if (strict && inputs.some((item) => !result.has(`${item.type}:${item.id}`))) throw new BadRequestException('关联内容不存在、未发布或无权查看；实训成果仅可关联本人已提交的记录')
    return result
  }
}
