import { visibleProfile } from './governance-policy'
import { BadRequestException, Injectable } from '@nestjs/common'
import type { CatalogContentType, CommunitySearchResultDto } from '@ai-learning-hub/contracts'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CommunityPostService, postInclude } from './post.service'
import { CommunityContextService } from './context.service'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { ContentSupportService, type ContentRecord } from '../../common/content/content-support.service'
import { authorDto, authorInclude } from './community.mapper'
import type { SearchDto } from './community.dto'
@Injectable()
export class CommunitySearchService {
  constructor(private readonly prisma: PrismaService, private readonly posts: CommunityPostService, private readonly context: CommunityContextService, private readonly visibility: CommunityVisibilityPolicyService, private readonly support: ContentSupportService) {}
  async search(userId: string, query: SearchDto): Promise<CommunitySearchResultDto> {
    await this.visibility.viewer(userId)
    const q = query.q.trim(), result: CommunitySearchResultDto = { posts: [], users: [], topics: [], courses: [], labs: [], resources: [], articles: [], nextCursor: null }
    if (!q) return result
    let after = ''
    if (query.cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()) as { q: string; type: string; after: string }
        if (parsed.q !== q || parsed.type !== query.type || typeof parsed.after !== 'string') throw new Error()
        after = parsed.after
      } catch { throw new BadRequestException('搜索游标无效') }
    }
    const take = query.type === 'all' ? 3 : query.limit, selected = (type: string) => query.type === 'all' || query.type === type
    const text = { contains: q, mode: 'insensitive' as const }, id = after ? { gt: after } : undefined
    let next = ''
    const page = <T extends { id: string }>(rows: T[]) => { if (query.type !== 'all' && rows.length > take) next = rows[take - 1].id; return rows.slice(0, take) }
    if (selected('posts')) {
      const rows = await this.prisma.communityPost.findMany({ where: { AND: [await this.visibility.where(userId), { id, OR: [{ title: text }, { plainText: text }] }] }, include: postInclude, orderBy: { id: 'asc' }, take: take + 1 })
      result.posts = await this.posts.mapMany(userId, page(rows))
    }
    if (selected('users')) {
      const excluded = await this.visibility.authorExclusions(userId)
      result.users = page(await this.prisma.user.findMany({ where: { id: { ...id, notIn: excluded.authors }, ...visibleProfile(), OR: [{ username: text }, { displayName: text }] }, include: authorInclude, orderBy: { id: 'asc' }, take: take + 1 })).map(authorDto)
    }
    if (selected('topics')) result.topics = page((await this.context.topics(userId)).filter((row) => row.id > after && `${row.name} ${row.description}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.id.localeCompare(b.id)))
    // 仅检索已发布快照，避免草稿标题进入公开搜索；映射复用内容公共基础契约。
    const where = { status: 'published' as const, deletedAt: null, id, publishedVersion: { is: { OR: [{ snapshot: { path: ['title'], string_contains: q, mode: 'insensitive' as const } }, { snapshot: { path: ['summary'], string_contains: q, mode: 'insensitive' as const } }] } } }
    const [courses, labs, resources, articles] = await Promise.all([
      selected('courses') ? this.prisma.course.findMany({ where, include: { publishedVersion: true }, orderBy: { id: 'asc' }, take: take + 1 }) : [],
      selected('labs') ? this.prisma.lab.findMany({ where, include: { publishedVersion: true }, orderBy: { id: 'asc' }, take: take + 1 }) : [],
      selected('resources') ? this.prisma.resource.findMany({ where: { ...where, AND: [{ publishedVersion: { is: { snapshot: { path: ['visibility'], not: 'private' } } } }] }, include: { publishedVersion: true }, orderBy: { id: 'asc' }, take: take + 1 }) : [],
      selected('articles') ? this.prisma.article.findMany({ where, include: { publishedVersion: true }, orderBy: { id: 'asc' }, take: take + 1 }) : [],
    ])
    const rows = [...courses, ...labs, ...resources, ...articles]
    const covers = rows.length ? await this.support.media.prepare(rows, true) : undefined
    const render = async (type: CatalogContentType, row: ContentRecord & { publishedVersion: { snapshot: Prisma.JsonValue } | null }) => {
      const snapshot = this.support.data(row.publishedVersion?.snapshot)
      return this.support.render(type, { ...row, title: String(snapshot.title), summary: String(snapshot.summary || '') }, false, this.support.data((snapshot.data || snapshot.payload) as Prisma.JsonValue), covers)
    }
    result.courses = await Promise.all(page(courses).map((row) => render('course', row))) as CommunitySearchResultDto['courses']
    result.labs = await Promise.all(page(labs).map(async (row) => ({ ...await render('lab', row), labType: row.labType }))) as CommunitySearchResultDto['labs']
    result.resources = await Promise.all(page(resources).map(async (row) => {
      const snapshot = this.support.data(row.publishedVersion?.snapshot)
      return { ...await render('resource', row), category: String(snapshot.category || ''), format: String(snapshot.format || ''), visibility: String(snapshot.visibility || 'public'), downloads: row.downloadCount, views: row.viewCount }
    })) as CommunitySearchResultDto['resources']
    result.articles = await Promise.all(page(articles).map(async (row) => {
      const snapshot = this.support.data(row.publishedVersion?.snapshot)
      return { ...await render('article', row), category: String(snapshot.category || ''), views: row.viewCount, recommendations: [] }
    })) as CommunitySearchResultDto['articles']
    if (next) result.nextCursor = Buffer.from(JSON.stringify({ q, type: query.type, after: next })).toString('base64url')
    return result
  }
}
