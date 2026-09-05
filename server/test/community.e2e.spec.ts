import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NestFactory, Reflector } from '@nestjs/core'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import type { CommunityPostDetailDto, CommunityPostInput, CommunityFeedDto, CommunityProfileUpdateDto } from '@ai-learning-hub/contracts'
import { AppModule } from '../src/app.module'
import { ApiExceptionFilter } from '../src/common/api-exception.filter'
import { ApiResponseInterceptor } from '../src/common/api-response.interceptor'
import { LearningFeedPipeline } from '../src/modules/feed/feed.service'
import { SignalsService } from '../src/modules/signals/signals.service'
import { ContentReferenceService } from '../src/common/content-reference/content-reference.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { communityModerationPayload } from '../../admin-web/src/services/community-payload'
import sharp from 'sharp'

if (!process.env.DATABASE_URL?.includes('127.0.0.1:55439/community_')) throw new Error('社区 E2E 只允许隔离本地验收数据库')
const password = process.env.SEED_STUDENT_PASSWORD!
if (!password) throw new Error('测试密码只能通过运行时环境变量提供')
const db = new PrismaClient(), prefix = `comm-e2e-${Date.now()}`
let app: INestApplication, base: string, admin: string, a: string, b: string, c: string, noSchool: string
let aId: string, bId: string, cId: string, noSchoolId: string, schoolId: string, topicA: string, topicB: string, question: string, root: string, secondRoot: string, reply: string
const input = (suffix: string, extra: Partial<CommunityPostInput> = {}): CommunityPostInput => ({ type: 'question', title: `学习问题 ${suffix}`, contentBlocks: [{ type: 'paragraph', text: `我正在验证学习方法与隐私边界 ${prefix} ${suffix}` }], bindings: [], topicIds: [], visibility: 'public', status: 'published', ...extra })
async function request<T = any>(path: string, token?: string, method = 'GET', body?: unknown) {
  // 旧业务断言保留；模拟读取后编辑。显式冲突与缺版本测试另用原始 HTTP。
  if (method === 'PATCH' && body && typeof body === 'object' && !(body instanceof FormData)) {
    const id = path.match(/^\/(?:admin\/)?community\/posts\/([^/]+)$/)?.[1]
    if (id) body = { ...body, expectedRevision: (await db.communityPost.findUnique({ where: { id } }))?.revision || 1 }
    if (path === '/community/profile' && token) {
      const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).id
      const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { communityProfile: true } })
      body = {
        displayName: user.displayName,
        bio: user.communityProfile?.bio || '',
        headline: user.communityProfile?.headline || '',
        location: user.communityProfile?.location || '',
        websiteUrl: user.communityProfile?.websiteUrl || '',
        expertiseTopics: user.communityProfile?.expertiseTopics || [],
        allowAchievementDrafts: user.communityProfile?.allowAchievementDrafts || false,
        expectedUserRevision: user.revision,
        expectedProfileRevision: user.communityProfile?.revision || 1,
        ...(body as object),
      }
    }
    const official = path.match(/^\/admin\/community\/official\/([^/]+)$/)?.[1]
    if (official) body = { ...(body as object), expectedRevision: (await db.communityProfile.findUnique({ where: { userId: official } }))?.revision || 1 }
  }
  const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
  const payload = await response.json().catch(() => null)
  return { status: response.status, data: payload?.data as T, message: payload?.message }
}
async function fixture(authorId: string, suffix: string, extra: Record<string, unknown> = {}) {
  return db.communityPost.create({ data: { authorId, postType: 'note', status: 'published', visibility: 'public', title: suffix, body: `真实隔离数据库测试 ${suffix}`, plainText: `真实隔离数据库测试 ${suffix}`, contentBlocks: [{ type: 'paragraph', text: suffix }], contentHash: `${prefix}-${suffix}`, publishedAt: new Date(), ...extra } })
}
beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1')
  base = `${await app.getUrl()}/api/v1`
  const school = await db.school.create({ data: { code: `${prefix}-school`, name: '隔离测试学校' } }); schoolId = school.id
  const other = await db.school.create({ data: { code: `${prefix}-other`, name: '另一测试学校' } })
  const role = await db.role.findUniqueOrThrow({ where: { code: 'student' } })
  const create = async (suffix: string, schoolId: string | null) => {
    const user = await db.user.create({ data: { username: `${prefix}-${suffix}`, displayName: `学习者 ${suffix}`, email: `${prefix}-${suffix}@example.invalid`, passwordHash: await hash(password, 4), schoolId, userRoles: { create: { roleId: role.id } }, communityProfile: { create: {} } } })
    const result = await request<{ accessToken: string }>('/auth/login', undefined, 'POST', { email: user.email, password })
    expect(result.status).toBe(201)
    return { id: user.id, token: result.data.accessToken }
  }
  const actors = await Promise.all([create('a', school.id), create('b', school.id), create('c', other.id), create('none', null)])
  ;[{ id: aId, token: a }, { id: bId, token: b }, { id: cId, token: c }, { id: noSchoolId, token: noSchool }] = actors
  admin = (await request<{ accessToken: string }>('/auth/login', undefined, 'POST', { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD })).data.accessToken
  topicA = (await db.communityTopic.create({ data: { slug: `${prefix}-a`, name: '学习方法甲' } })).id
  topicB = (await db.communityTopic.create({ data: { slug: `${prefix}-b`, name: '学习方法乙' } })).id
}, 30000)
afterAll(async () => { await app?.close(); await db.$disconnect() })

describe('COMM-001 真实 HTTP / PostgreSQL 安全与业务闭环', () => {
  it('认证关闭访问，学生不能进入运营', async () => {
    expect((await request('/community/feed')).status).toBe(401)
    expect((await request('/admin/community/posts', a)).status).toBe(403)
    expect((await request('/admin/community/policy', a, 'PATCH', { parameter: 'qualityWeight', value: 20, reason: '越权配置测试' })).status).toBe(403)
  })
  it('发布结构化问题，拒绝伪造身份和不合法来源', async () => {
    expect((await request('/community/posts', a, 'POST', { ...input('伪造'), verifiedType: 'teacher' })).status).toBe(400)
    expect((await request('/community/posts', a, 'POST', input('伪造学校', { visibility: 'school', ...({ schoolId: 'forged' } as any) }))).status).toBe(400)
    expect((await request('/community/posts', a, 'POST', input('无来源标识', { sourceType: 'note' }))).status).toBe(400)
    const result = await request<CommunityPostDetailDto>('/community/posts', a, 'POST', input('正常发布', { topicIds: [topicA], contentBlocks: [{ type: 'paragraph', text: '讨论代码作为纯文本的展示边界，不允许执行。' }, { type: 'code', language: 'js', code: '<script>window.pwned=true</script>' }] }))
    expect(result.status).toBe(201); question = result.data.id
    expect(result.data.author.verifiedType).toBe('none')
    expect(result.data.contentBlocks[1]).toMatchObject({ type: 'code', code: '<script>window.pwned=true</script>' })
  })
  it('非作者不能改删，普通 DTO 不包含内部或身份信息', async () => {
    expect((await request(`/community/posts/${question}`, b, 'PATCH', input('盗改'))).status).toBe(403)
    expect((await request(`/community/posts/${question}`, b, 'DELETE')).status).toBe(403)
    const response = await request(`/community/posts/${question}`, b)
    expect(response.status).toBe(200)
    const result = response.data
    expect(result.id).toBe(question)
    for (const key of ['passwordHash', 'email', 'phone', 'studentNo', 'score', 'dimensions', 'reporterId', 'sourceId']) expect(JSON.stringify(result)).not.toContain(`"${key}":`)
  })
  it('同校隔离同时覆盖详情、列表、搜索、书签和信息流', async () => {
    const post = await fixture(aId, 'school', { visibility: 'school', schoolId })
    expect((await request(`/community/posts/${post.id}`, b)).status).toBe(200)
    expect((await request(`/community/posts/${post.id}`, c)).status).toBe(404)
    expect((await request(`/community/posts/${post.id}`, noSchool)).status).toBe(404)
    expect((await request(`/community/posts/${post.id}/bookmark`, c, 'PUT')).status).toBe(404)
    for (const route of ['/community/posts?keyword=school', `/community/users/${aId}/posts`, '/community/bookmarks', '/community/feed?mode=latest']) expect(JSON.stringify((await request(route, c)).data)).not.toContain(post.id)
    expect((await request('/community/posts', noSchool, 'POST', input('学校缺失', { visibility: 'school' }))).status).toBe(400)
  })
  it('草稿仅作者可见，公开用户列表不泄漏草稿', async () => {
    const draft = await fixture(aId, 'private-draft', { status: 'draft', publishedAt: null })
    expect((await request(`/community/posts/${draft.id}`, a)).status).toBe(200)
    expect((await request(`/community/posts/${draft.id}`, b)).status).toBe(404)
    expect(JSON.stringify((await request(`/community/users/${aId}/posts`, b)).data)).not.toContain(draft.id)
    expect(JSON.stringify((await request('/admin/community/posts', admin)).data)).not.toContain(draft.id)
    expect((await request(`/admin/community/posts/${draft.id}`, admin)).status).toBe(400)
    expect((await request(`/admin/community/post/${draft.id}/moderate`, admin, 'POST', { action: 'restore', reason: '不能代发私人草稿' })).status).toBe(400)
  })
  it('点赞/有用/收藏重复并发幂等且数据库计数一致', async () => {
    const post = await fixture(aId, 'concurrent')
    for (const [path, column] of [['reactions/like', 'likeCount'], ['reactions/useful', 'usefulCount'], ['bookmark', 'bookmarkCount']]) {
      const added = await Promise.all(Array.from({ length: 8 }, () => request(`/community/posts/${post.id}/${path}`, b, 'PUT')))
      expect(added.every((r) => r.status === 200)).toBe(true)
      expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.id } }))[column as 'likeCount']).toBe(1)
      const removed = await Promise.all(Array.from({ length: 8 }, () => request(`/community/posts/${post.id}/${path}`, b, 'DELETE')))
      expect(removed.every((r) => r.status === 200)).toBe(true)
      expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.id } }))[column as 'likeCount']).toBe(0)
    }
  })
  it('关注用户与话题并发幂等，并能读取关注的人', async () => {
    await Promise.all(Array.from({ length: 6 }, () => request(`/community/users/${aId}/follow`, b, 'PUT')))
    await Promise.all(Array.from({ length: 6 }, () => request(`/community/topics/${topicA}/follow`, b, 'PUT')))
    expect(await db.communityUserFollow.count({ where: { followerId: bId, followeeId: aId } })).toBe(1)
    expect((await db.communityProfile.findUniqueOrThrow({ where: { userId: bId } })).followingCount).toBe(1)
    expect((await db.communityTopic.findUniqueOrThrow({ where: { id: topicA } })).followerCount).toBe(1)
    expect((await request<{ items: Array<{ id: string }> }>(`/community/users/${bId}/following`, b)).data.items.some((user) => user.id === aId)).toBe(true)
  })
  it('父A、父B、回A按父级分组，作者采纳以及拒绝第三级回复', async () => {
    const result = await request(`/community/posts/${question}/comments`, b, 'POST', { contentBlocks: [{ type: 'paragraph', text: '建议把代码当作只读文本并检查转义结果。' }] })
    expect(result.status).toBe(201); root = result.data.id
    const second = await request(`/community/posts/${question}/comments`, c, 'POST', { contentBlocks: [{ type: 'paragraph', text: '这是独立的第二个父评论，不应接收第一组回复。' }] })
    expect(second.status).toBe(201); secondRoot = second.data.id
    const child = await request(`/community/posts/${question}/comments`, a, 'POST', { parentId: root, contentBlocks: [{ type: 'paragraph', text: '谢谢，我会补充可复现的验证步骤。' }] }); reply = child.data.id
    expect(child.status).toBe(201)
    expect((await request<any[]>(`/community/posts/${question}/comments`, a)).data.map((row) => row.id)).toEqual([root, reply, secondRoot])
    expect((await request(`/community/posts/${question}/comments`, a, 'POST', { parentId: reply, contentBlocks: [{ type: 'paragraph', text: '这里不允许第三级回复。' }] })).status).toBe(400)
    expect((await request(`/community/questions/${question}/accept/${root}`, c, 'POST')).status).toBe(403)
    expect((await request(`/community/questions/${question}/accept/${root}`, a, 'POST')).data.question.status).toBe('solved')
  })
  it('删除父评论保留子回复占位并撤销采纳', async () => {
    expect((await request(`/community/comments/${root}`, b, 'DELETE')).status).toBe(200)
    const rows = (await request<any[]>(`/community/posts/${question}/comments`, a)).data
    expect(rows.map((row) => row.id)).toEqual([root, reply, secondRoot])
    expect(rows.find((r) => r.id === root)).toMatchObject({ deleted: true, body: '该评论已删除或不可见' })
    expect(rows.find((r) => r.id === reply)).toMatchObject({ deleted: false, parentId: root })
    expect((await request(`/community/posts/${question}`, a)).data.question.status).toBe('open')
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: question } })).commentCount).toBe(2)
  })
  it('编辑换话题、草稿切换和删除均重算原话题计数', async () => {
    expect((await request(`/community/posts/${question}`, a, 'PATCH', input('换话题', { topicIds: [topicB] }))).status).toBe(200)
    expect((await db.communityTopic.findUniqueOrThrow({ where: { id: topicA } })).postCount).toBe(0)
    expect((await db.communityTopic.findUniqueOrThrow({ where: { id: topicB } })).postCount).toBe(1)
    await request(`/community/posts/${question}`, a, 'PATCH', input('转草稿', { topicIds: [topicB], status: 'draft' }))
    expect((await db.communityTopic.findUniqueOrThrow({ where: { id: topicB } })).postCount).toBe(0)
    await request(`/community/posts/${question}`, a, 'PATCH', input('重新发布', { topicIds: [topicB] }))
    await request(`/community/posts/${question}`, a, 'DELETE')
    expect((await db.communityTopic.findUniqueOrThrow({ where: { id: topicB } })).postCount).toBe(0)
  })
  it('隐藏与不感兴趣在所有读取路径立即生效', async () => {
    const hidden = await fixture(cId, 'hide'), unwanted = await fixture(cId, 'not-interested', { postType: 'project' })
    await request(`/community/posts/${hidden.id}/hide`, b, 'POST')
    await request(`/community/posts/${unwanted.id}/not-interested`, b, 'POST')
    for (const id of [hidden.id, unwanted.id]) expect((await request(`/community/posts/${id}`, b)).status).toBe(404)
    expect((await request('/community/posts', b)).data.some((p: any) => p.type === 'project')).toBe(false)
  })
  it('静音单向、屏蔽双向且不能从评论侧门互动', async () => {
    const post = await fixture(cId, 'mute-target')
    const visiblePost = await fixture(aId, 'visible-discussion')
    const comment = await db.communityComment.create({ data: { postId: visiblePost.id, authorId: cId, body: '静音作者的讨论内容', contentBlocks: [{ type: 'paragraph', text: '静音作者的讨论内容' }] } })
    await request(`/community/users/${cId}/mute`, b, 'POST')
    expect((await request(`/community/posts/${post.id}`, b)).status).toBe(404)
    expect((await request(`/community/comments/${comment.id}/like`, b, 'PUT')).status).toBe(404)
    expect((await request(`/community/comments/${comment.id}/report`, b, 'POST', { reason: '侧门举报尝试' })).status).toBe(404)
    expect((await request(`/community/posts/${visiblePost.id}/comments`, b, 'POST', { parentId: comment.id, contentBlocks: [{ type: 'paragraph', text: '侧门回复尝试不能通过。' }] })).status).toBe(404)
    expect((await request<any[]>(`/community/posts/${visiblePost.id}/comments`, b)).data.find((item) => item.id === comment.id)).toMatchObject({ deleted: true, contentBlocks: [] })
    expect((await request(`/community/users/${bId}`, c)).status).toBe(200)
    await request(`/community/users/${noSchoolId}/block`, a, 'POST')
    expect((await request(`/community/users/${aId}`, noSchool)).status).toBe(404)
    expect((await request(`/community/users/${noSchoolId}`, a)).data).toMatchObject({ blocked: true, postCount: 0 })
    expect((await request(`/community/users/${noSchoolId}/block`, a, 'DELETE')).status).toBe(200)
    expect((await request(`/community/users/${noSchoolId}`, a)).data.blocked).toBe(false)
  })
  it('个人主页动态、回复、媒体、赞过、置顶和关注分页使用真实可见数据', async () => {
    const own = await fixture(aId, 'profile-public')
    const media = await fixture(aId, 'profile-media', { contentBlocks: [{ type: 'image', fileId: `${prefix}-missing-image`, alt: '资料页媒体测试' }] })
    const draft = await fixture(aId, 'profile-draft', { status: 'draft', publishedAt: null })
    const replied = await fixture(bId, 'profile-replied')
    const comment = await request(`/community/posts/${replied.id}/comments`, a, 'POST', { contentBlocks: [{ type: 'paragraph', text: '这是用户本人发布的可见回复。' }] })
    await request(`/community/posts/${replied.id}/reactions/like`, a, 'PUT')
    const profile = (await request(`/community/users/${aId}`, a)).data
    const pinned = await request(`/community/posts/${own.id}/pin`, a, 'PUT', { expectedProfileRevision: profile.revision })
    expect(pinned.data.pinnedPost.id).toBe(own.id)

    const posts = (await request<{ posts: CommunityPostDetailDto[] }>(`/community/users/${aId}/timeline?tab=posts`, b)).data.posts
    expect(posts.map((row) => row.id)).toContain(media.id)
    expect(posts.map((row) => row.id)).not.toContain(own.id)
    expect(posts.map((row) => row.id)).not.toContain(draft.id)
    const replies = (await request<{ replies: Array<{ id: string; postId: string }> }>(`/community/users/${aId}/timeline?tab=replies`, b)).data.replies
    expect(replies).toContainEqual(expect.objectContaining({ id: comment.data.id, postId: replied.id }))
    const mediaRows = (await request<{ posts: CommunityPostDetailDto[] }>(`/community/users/${aId}/timeline?tab=media`, b)).data.posts
    expect(mediaRows.map((row) => row.id)).toContain(media.id)
    expect((await request<{ posts: CommunityPostDetailDto[] }>(`/community/users/${aId}/timeline?tab=liked`, a)).data.posts.map((row) => row.id)).toContain(replied.id)
    expect((await request(`/community/users/${aId}/timeline?tab=liked`, b)).status).toBe(403)

    await db.communityPost.update({ where: { id: own.id }, data: { status: 'hidden' } })
    expect((await request(`/community/users/${aId}`, a)).data.pinnedPost).toBeNull()
    await db.communityUserFollow.createMany({ data: [{ followerId: aId, followeeId: bId }, { followerId: aId, followeeId: cId }], skipDuplicates: true })
    const first = await request<{ items: Array<{ id: string }>; nextCursor: string | null }>(`/community/users/${aId}/following?limit=1`, a)
    expect(first.data.items).toHaveLength(1)
    expect(first.data.nextCursor).toBeTruthy()
    const second = await request<{ items: Array<{ id: string }> }>(`/community/users/${aId}/following?limit=1&cursor=${encodeURIComponent(first.data.nextCursor!)}`, a)
    expect(second.data.items).toHaveLength(1)
  })
  it('举报幂等、作者无法读取举报者、普通学生不能处理举报', async () => {
    const post = await fixture(bId, 'report-target')
    await request(`/community/posts/${post.id}/report`, a, 'POST', { reason: '内容缺少来源', description: '请补充学习资料出处。' })
    await request(`/community/posts/${post.id}/report`, a, 'POST', { reason: '重复请求', description: '' })
    expect(await db.communityReport.count({ where: { reporterId: aId, postId: post.id } })).toBe(1)
    expect(JSON.stringify((await request(`/community/posts/${post.id}`, b)).data)).not.toContain(aId)
    const report = await db.communityReport.findFirstOrThrow({ where: { postId: post.id } })
    expect((await request(`/admin/community/reports/${report.id}/handle`, b, 'POST', { action: 'hide', reason: '越权处理测试' })).status).toBe(403)
    const adminRows = (await request<{ items: any[] }>(`/admin/community/reports?keyword=${encodeURIComponent(report.reason)}`, admin)).data
    const adminReport = adminRows.items.find((r) => r.id === report.id)
    expect(adminReport).toBeDefined()
    expect(adminReport).not.toHaveProperty('reporterId')
    const moderationPath = `/admin/community/post/${post.id}/moderate`
    for (const action of ['limit', 'restore', 'label', 'hide', 'remove', 'restore'] as const) {
      const payload = communityModerationPayload({ action, reason: '使用真实后台表单请求验证处理闭环', label: action === 'label' ? '  来源已核实  ' : '' })
      if (action === 'label') expect(payload.label).toBe('来源已核实')
      else expect(payload).not.toHaveProperty('label')
      expect((await request(moderationPath, admin, 'POST', payload)).status).toBe(201)
    }
    expect(() => communityModerationPayload({ action: 'label', reason: '不允许空说明标签', label: '   ' })).toThrow('有效的说明标签')
    expect((await request(moderationPath, admin, 'POST', { action: 'label', reason: '不允许省略说明标签' })).status).toBe(400)
    expect((await request(moderationPath, admin, 'POST', { action: 'label', reason: '不允许空白说明标签', label: '   ' })).status).toBe(400)
    const comment = await db.communityComment.create({ data: { postId: post.id, authorId: bId, body: '后台评论处理检查', contentBlocks: [{ type: 'paragraph', text: '后台评论处理检查' }] } })
    expect((await request(`/admin/community/comment/${comment.id}/moderate`, admin, 'POST', communityModerationPayload({ action: 'hide', reason: '评论管理使用默认空标签表单', label: '' }))).status).toBe(201)
    expect((await request(`/admin/community/reports/${report.id}/handle`, admin, 'POST', communityModerationPayload({ action: 'hide', reason: '审核确认缺少来源', label: '' }))).status).toBe(201)
    expect((await request(`/community/posts/${post.id}`, b)).status).toBe(404)
    expect((await request('/admin/community/posts?type=all&keyword=', admin)).status).toBe(200)
    expect((await request('/admin/community/topics', admin, 'POST', { slug: `${prefix}-empty-optional`, name: '空选填字段校验', description: '', accent: 'purple', themeId: '', status: 'active', recommended: false, sortOrder: 0, reason: '验证话题选填字段可以留空' })).status).toBe(201)
  })
  it('官方发布需要独立权限、认证账号和审计理由', async () => {
    expect((await request(`/admin/community/official/${aId}`, admin, 'PATCH', { verifiedType: 'none', expertiseTopics: [], reason: '验证认证表单可留空专业话题' })).status).toBe(200)
    const official = await db.user.findUniqueOrThrow({ where: { username: 'campus-guide-1' } })
    expect((await request(`/admin/community/official/${official.id}/posts`, a, 'POST', { ...input('越权官方'), reason: '测试身份权限' })).status).toBe(403)
    expect((await request(`/admin/community/official/${aId}/posts`, admin, 'POST', { ...input('非认证账号'), reason: '测试身份权限' })).status).toBe(400)
    const result = await request(`/admin/community/official/${official.id}/posts`, admin, 'POST', { ...input('官方学习指导', { type: 'general' }), reason: '发布学习安全指导' })
    expect(result.status).toBe(201); expect(result.data.author.verifiedType).toBe('official')
    expect(await db.communityModerationAction.count({ where: { targetId: result.data.id, action: 'official_publish' } })).toBe(1)
  })
  it('安全策略参数白名单拒绝任意 JSON 和无理由配置', async () => {
    expect((await request('/admin/community/policy', admin, 'PATCH', { parameter: 'sql', value: 10, reason: '任意参数测试' })).status).toBe(400)
    expect((await request('/admin/community/policy', admin, 'PATCH', { parameter: 'qualityWeight', value: 50, reason: '超过范围测试' })).status).toBe(400)
    expect((await request('/admin/community/policy', admin, 'PATCH', { parameter: 'qualityWeight', value: 20 })).status).toBe(400)
    expect((await request('/admin/community/policy', admin, 'PATCH', { parameter: 'qualityWeight', value: 20, reason: '    ' })).status).toBe(400)
  })
  it('游标绑定用户/模式/类型，重复读取稳定且下一页不重复', async () => {
    const first = await request<CommunityFeedDto>('/community/feed?mode=latest&limit=5', a)
    expect(first.status).toBe(200); expect(first.data.nextCursor).toBeTruthy()
    const path = `/community/feed?mode=latest&limit=5&cursor=${encodeURIComponent(first.data.nextCursor!)}`
    const second = (await request<CommunityFeedDto>(path, a)).data
    expect((await request<CommunityFeedDto>(path, a)).data.items).toEqual(second.items)
    expect(first.data.items.some((p) => second.items.some((q) => p.id === q.id))).toBe(false)
    expect((await request(path, b)).status).toBe(400)
    expect((await request(path.replace('mode=latest', 'mode=for_you'), a)).status).toBe(400)
    expect((await request(`${path}&type=note`, a)).status).toBe(400)
    expect((await request('/community/feed?cursor=forged', a)).status).toBe(400)
  })
  it('八类候选有界，故障降级仍严格执行同校/屏蔽门禁', async () => {
    const pipeline = app.get(LearningFeedPipeline)
    const policy = await pipeline.policy()
    expect(Object.keys(policy.candidateLimits)).toHaveLength(8)
    expect(Object.values(policy.candidateLimits).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(300)
    const normal = await request<CommunityFeedDto>('/community/feed?mode=for_you&limit=30', a)
    expect(normal.status).toBe(200); expect(normal.data.degraded).toBe(false)
    expect(normal.data.items.length).toBeGreaterThan(5)
    expect(new Set(normal.data.items.map((unit) => unit.id)).size).toBe(normal.data.items.length)
    const filtered = await request<CommunityFeedDto>('/community/feed?mode=for_you&type=question&limit=20', a)
    expect(filtered.status).toBe(200); expect(filtered.data.degraded).toBe(false)
    const filteredPosts = filtered.data.items.filter((unit) => unit.type === 'post')
    expect(filteredPosts.length).toBeGreaterThan(3); expect(filteredPosts.every((unit) => unit.post.type === 'question')).toBe(true)
    const spy = vi.spyOn(pipeline, 'rank').mockRejectedValueOnce(new Error('受控推荐故障注入'))
    const response = await request<CommunityFeedDto>('/community/feed?limit=30', noSchool)
    spy.mockRestore()
    expect(response.status).toBe(200); expect(response.data.degraded).toBe(true)
    for (const unit of response.data.items) if (unit.type === 'post') { expect(unit.post.visibility).toBe('public'); expect(unit.post.author.id).not.toBe(aId) }
  })
  it('过期游标拒绝；会话内已隐藏内容不会再次曝光', async () => {
    const first = (await request<CommunityFeedDto>('/community/feed?mode=latest&limit=1', c)).data
    await db.communityFeedSession.update({ where: { id: first.requestId }, data: { expiresAt: new Date(0) } })
    expect((await request(`/community/feed?mode=latest&cursor=${first.nextCursor}`, c)).status).toBe(400)
    const next = (await request<CommunityFeedDto>('/community/feed?mode=latest&limit=1', c)).data
    const path = `/community/feed?mode=latest&limit=1&cursor=${next.nextCursor}`
    const second = (await request<CommunityFeedDto>(path, c)).data
    const post = second.items.find((unit) => unit.type === 'post')!
    await request(`/community/posts/${post.id}/hide`, c, 'POST')
    expect((await request<CommunityFeedDto>(path, c)).data.items.some((unit) => unit.id === post.id)).toBe(false)
  })
  it('曝光幂等、停留封顶、信号快照可以完整重建', async () => {
    const feed = (await request<CommunityFeedDto>('/community/feed?mode=latest&limit=10', a)).data
    const post = feed.items.find((item) => item.type === 'post')!
    const payload = { items: [{ requestId: feed.requestId, postId: post.id }] }
    await request('/community/feed/impressions', a, 'POST', payload); await request('/community/feed/impressions', a, 'POST', payload)
    expect(await db.activityEvent.count({ where: { userId: aId, requestId: feed.requestId, targetId: post.id, eventType: 'community_feed_impression' } })).toBe(1)
    expect((await request('/community/feed/dwell', a, 'POST', { items: [{ ...payload.items[0], dwellMs: 120001 }] })).status).toBe(400)
    const signals = app.get(SignalsService), before = await signals.snapshot(aId, true)
    await db.userFeedSignalSnapshot.delete({ where: { userId: aId } })
    const after = await signals.snapshot(aId, true)
    expect(after.topicAffinity).toEqual(before.topicAffinity); expect(after.eventCount).toBe(before.eventCount)
    await signals.record(aId, 'community_useful_add', 'post', post.id, { topicIds: [topicA], bindingKeys: ['course:incremental-check'] })
    const incremental = await signals.snapshot(aId), rebuilt = await signals.snapshot(aId, true)
    expect(incremental.version).toBe(2)
    expect(incremental.eventCount).toBe(after.eventCount + 1)
    expect(incremental.topicAffinity).toEqual(rebuilt.topicAffinity)
    expect(incremental.learningContentAffinity).toEqual(rebuilt.learningContentAffinity)
  })
  it('学习关联使用发布快照，其他人的私有实训记录不可绑定或泄漏', async () => {
    const post = (await request<CommunityPostDetailDto>('/community/posts/community-lab_result-1', c)).data
    expect(post.bindings.every((binding) => binding.type !== 'lab_run')).toBe(true)
    expect(JSON.stringify(post)).not.toContain('community-run-1')
    expect(post.bindings.filter((binding) => binding.type === 'lab')).toHaveLength(1)
    expect(new Set(post.bindings.map((binding) => `${binding.type}:${binding.id}`)).size).toBe(post.bindings.length)
    const student = (await request<{ accessToken: string }>('/auth/login', undefined, 'POST', { email: process.env.SEED_STUDENT_EMAIL, password })).data.accessToken
    const sameSchool = await request<CommunityPostDetailDto>('/community/posts/community-lab_result-14', student)
    expect(sameSchool.status).toBe(200)
    expect(sameSchool.data.bindings.filter((binding) => binding.type === 'lab')).toHaveLength(1)
    expect(sameSchool.data.bindings.every((binding) => binding.type !== 'lab_run')).toBe(true)
    expect(new Set(sameSchool.data.bindings.map((binding) => `${binding.type}:${binding.id}`)).size).toBe(sameSchool.data.bindings.length)
    const ownPost = (await request<CommunityPostDetailDto>('/community/posts/community-lab_result-1', student)).data
    expect(ownPost.bindings.some((binding) => binding.type === 'lab_run')).toBe(true)
    const runOnly = await request<CommunityPostDetailDto>('/community/posts', student, 'POST', input('仅绑定本人实训记录', { type: 'lab_result', bindings: [{ type: 'lab_run', id: 'community-run-1' }] }))
    expect(runOnly.status, runOnly.message).toBe(201)
    const publicPost = (await request<CommunityPostDetailDto>(`/community/posts/${runOnly.data.id}`, c)).data
    expect(publicPost.bindings).toHaveLength(1); expect(publicPost.bindings[0].type).toBe('lab')
    expect(JSON.stringify(publicPost)).not.toContain('community-run-1')
    const binding = { type: publicPost.bindings[0].type, id: publicPost.bindings[0].id }
    expect((await request('/community/signals', c, 'POST', { eventType: 'community_to_lab', targetType: 'post', targetId: publicPost.id, binding })).status).toBe(201)
    const signal = await db.activityEvent.findFirstOrThrow({ where: { userId: cId, targetId: publicPost.id, eventType: 'community_to_lab' } })
    expect(signal.payload).toMatchObject({ bindingKeys: [`lab:${binding.id}`] })
    expect(JSON.stringify(signal.payload)).not.toContain('community-run-1')
    expect((await request('/community/signals', c, 'POST', { eventType: 'community_to_lab', targetType: 'post', targetId: publicPost.id, binding: { type: 'lab_run', id: 'community-run-1' } })).status).toBe(400)
    expect((await request('/community/signals', c, 'POST', { eventType: 'community_to_lab', targetType: 'post', targetId: publicPost.id, binding: { type: 'lab', id: 'unrelated-lab' } })).status).toBe(400)
    expect((await request('/community/posts', c, 'POST', input('窃取成果', { type: 'lab_result', bindings: [{ type: 'lab_run', id: 'community-run-1' }] }))).status).toBe(400)
    expect((await request('/community/bindings/context?type=lab_run&id=community-run-1', c)).status).toBe(400)
    const suggested = await request('/community/bindings/context?type=course&id=llm-zero', a)
    expect(suggested.status).toBe(200); expect(suggested.data.binding.title).toBeTruthy(); expect(suggested.data.topicIds.length).toBeGreaterThan(0)
    const course = await db.course.findFirstOrThrow({ where: { status: 'published' }, include: { publishedVersion: true } })
    const originalTitle = course.title
    await db.course.update({ where: { id: course.id }, data: { title: '未发布草稿秘密标题' } })
    const refs = await app.get(ContentReferenceService).resolveMany([{ type: 'course', id: course.id }], aId)
    expect(refs.get(`course:${course.id}`)?.title).not.toBe('未发布草稿秘密标题')
    await db.course.update({ where: { id: course.id }, data: { title: originalTitle } })
  })
  it('列表由1条扩为20条时真实Prisma批量读取次数不增长，重复关联仍执行隐私过滤', async () => {
    const marker = `${prefix}-batch-hydrate`, prisma = app.get(PrismaService)
    const course = await db.course.findFirstOrThrow({ where: { status: 'published', deletedAt: null, publishedVersionId: { not: null } } })
    const resource = await db.resource.findFirstOrThrow({ where: { status: 'published', visibility: 'public', deletedAt: null, publishedVersionId: { not: null } } })
    const secret = `${marker}-private-title`
    const privateResource = await db.resource.create({ data: { slug: `${marker}-private`, title: secret, summary: secret, category: '隔离测试', format: 'pdf', visibility: 'private', status: 'published', versions: { create: { versionNo: 1, snapshot: { title: secret, summary: secret } } } }, include: { versions: true } })
    await db.resource.update({ where: { id: privateResource.id }, data: { publishedVersionId: privateResource.versions[0].id } })
    const form = new FormData(), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
    form.append('file', new Blob([png], { type: 'image/png' }), 'batch-pixel.png')
    const upload = await request('/community/media', a, 'POST', form)
    expect(upload.status).toBe(201)
    const bindings = [{ targetType: 'course', targetId: course.id }, { targetType: 'resource', targetId: resource.id }, { targetType: 'resource', targetId: privateResource.id }, { targetType: 'resource', targetId: `${marker}-missing` }, { targetType: 'lab_run', targetId: 'community-run-1' }]
    const create = (index: number) => fixture(aId, `${marker}-${index}`, {
      contentBlocks: [{ type: 'paragraph', text: marker }, { type: 'image', fileId: upload.data.id, alt: '共享测试图片' }],
      bindings: { create: bindings.map((ref, sortOrder) => ({ ...ref, sortOrder, titleSnapshot: secret })) },
    })
    const first = await create(0)
    const invisible = await Promise.all([
      fixture(aId, `${marker}-draft`, { status: 'draft', publishedAt: null }),
      fixture(aId, `${marker}-school`, { visibility: 'school', schoolId }),
      fixture(aId, `${marker}-hidden`, { status: 'hidden' }),
    ])
    // 只观察真实委托调用，不替换返回值；夹具写入走独立db连接，不混入计数。
    const spies = [
      vi.spyOn(prisma.communityPost, 'findMany'), vi.spyOn(prisma.user, 'findUnique'),
      vi.spyOn(prisma.communityFeedback, 'findMany'), vi.spyOn(prisma.communityPostReaction, 'findMany'),
      vi.spyOn(prisma.communityBookmark, 'findMany'), vi.spyOn(prisma.communityUserFollow, 'findMany'),
      vi.spyOn(prisma.communityTopicFollow, 'findMany'), vi.spyOn(prisma.communityComment, 'findMany'),
      vi.spyOn(prisma.course, 'findMany'), vi.spyOn(prisma.resource, 'findMany'),
      vi.spyOn(prisma.labRun, 'findMany'), vi.spyOn(prisma.lab, 'findMany'),
    ]
    try {
      const single = await request<CommunityPostDetailDto[]>(`/community/posts?keyword=${marker}`, c)
      expect(single.status).toBe(200); expect(single.data.map((row) => row.id)).toEqual([first.id])
      const singleCounts = spies.map((spy) => spy.mock.calls.length)
      expect(singleCounts.every((count) => count > 0)).toBe(true)
      const added = await Promise.all(Array.from({ length: 19 }, (_, index) => create(index + 1)))
      spies.forEach((spy) => spy.mockClear())
      const batch = await request<CommunityPostDetailDto[]>(`/community/posts?keyword=${marker}`, c)
      expect(batch.status).toBe(200); expect(batch.data).toHaveLength(20)
      expect(batch.data.map((row) => row.id).sort()).toEqual([first, ...added].map((row) => row.id).sort())
      expect(spies.map((spy) => spy.mock.calls.length)).toEqual(singleCounts)
      for (const row of batch.data) {
        expect(row.author.id).toBe(aId); expect(row.mediaCount).toBe(1)
        expect(row.contentBlocks).toContainEqual({ type: 'image', fileId: upload.data.id, alt: '共享测试图片' })
        expect(row.bindings).toContainEqual(expect.objectContaining({ type: 'course', id: course.id, status: 'published' }))
        expect(row.bindings).toContainEqual(expect.objectContaining({ type: 'resource', id: resource.id, status: 'published' }))
        for (const id of [privateResource.id, `${marker}-missing`]) expect(row.bindings).toContainEqual({ type: 'resource', id, title: '关联内容已下架', route: '', status: 'unavailable' })
        expect(row.bindings.filter((ref) => ref.type === 'lab')).toHaveLength(1)
        expect(row.bindings.some((ref) => ref.type === 'lab_run')).toBe(false)
      }
      const serialized = JSON.stringify(batch.data)
      expect(serialized).not.toContain(secret); expect(serialized).not.toContain('community-run-1')
      for (const row of invisible) expect(serialized).not.toContain(row.id)
    } finally { spies.forEach((spy) => spy.mockRestore()) }
  })
  it('关联点击到真实课时学习形成转化信号', async () => {
    const course = await db.course.findUniqueOrThrow({ where: { slug: 'llm-zero' } })
    const lesson = await db.courseLesson.findFirstOrThrow({ where: { chapter: { courseVersionId: course.publishedVersionId! } } })
    const post = await fixture(aId, 'learning-conversion')
    await db.communityPostBinding.create({ data: { postId: post.id, targetType: 'course', targetId: course.id, titleSnapshot: course.title } })
    expect((await request('/community/signals', a, 'POST', { eventType: 'community_to_course', targetType: 'post', targetId: post.id, binding: { type: 'course', id: course.id } })).status).toBe(201)
    expect((await request(`/lessons/${lesson.id}/progress`, a, 'PUT', { completed: false, positionSeconds: 15 })).status).toBe(200)
    expect(await db.activityEvent.count({ where: { userId: aId, eventType: 'community_course_started', targetId: post.id } })).toBe(1)
    await db.communityPostBinding.create({ data: { postId: post.id, targetType: 'lesson', targetId: lesson.id, titleSnapshot: lesson.title } })
    expect((await request('/community/signals', a, 'POST', { eventType: 'community_to_course', targetType: 'post', targetId: post.id, binding: { type: 'lesson', id: lesson.id } })).status).toBe(201)
    const event = await db.activityEvent.findFirstOrThrow({ where: { userId: aId, targetId: post.id, eventType: 'community_to_course' }, orderBy: { occurredAt: 'desc' } })
    expect(event.payload).toMatchObject({ bindingKeys: [`lesson:${lesson.id}`, `course:${course.id}`] })
  })
  it('通知只归属接收者，多演员并发合并不重复并支持全部已读', async () => {
    const post = await fixture(aId, 'notification-concurrency', { commentCount: 6 })
    const commentIds = Array.from({ length: 6 }, (_, i) => `${prefix}-notification-comment-${i}`)
    await db.communityComment.createMany({ data: commentIds.map((id) => ({ id, postId: post.id, authorId: aId, body: '验证通知并发去重', contentBlocks: [{ type: 'paragraph', text: '验证通知并发去重' }] })) })
    expect((await request(`/community/posts/${post.id}/reactions/like`, b, 'PUT')).status).toBe(200)
    const results = await Promise.all(commentIds.flatMap((id) => [b, c].map((actor) => request(`/community/comments/${id}/like`, actor, 'PUT'))))
    expect(results.every((result) => result.status === 200)).toBe(true)
    const merged = await db.userNotification.findMany({ where: { recipientId: aId, entityId: post.id, notificationType: 'like' } })
    expect(merged).toHaveLength(1)
    expect(merged[0].actorIds.sort()).toEqual([bId, cId].sort())
    expect((await request<any[]>('/community/notifications', a)).data.find((row) => row.id === merged[0].id).count).toBe(2)
    const notification = await db.userNotification.findFirstOrThrow({ where: { recipientId: aId } })
    expect((await request(`/community/notifications/${notification.id}/read`, c, 'POST')).status).toBe(404)
    expect((await request('/community/notifications/read-all', a, 'POST')).status).toBe(201)
    expect((await request('/community/notifications/unread-count', a)).data.count).toBe(0)
  })
  it('图片校验扩展名/MIME/签名，跨学校无法直链读图', async () => {
    const invalid = new FormData(); invalid.append('file', new Blob(['not-an-image'], { type: 'image/png' }), 'invalid.png')
    expect((await request('/community/media', a, 'POST', invalid)).status).toBe(400)
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'pixel.png')
    const upload = await request('/community/media', a, 'POST', form); expect(upload.status).toBe(201)
    const post = await fixture(aId, 'image-school', { visibility: 'school', schoolId, contentBlocks: [{ type: 'image', fileId: upload.data.id, alt: '学习图' }] })
    expect((await request(`/community/media/${upload.data.id}/url`, b)).status).toBe(200)
    expect((await request(`/community/media/${upload.data.id}/url`, c)).status).toBe(404)
    expect((await request(`/files/${upload.data.id}/download`, c)).status).toBe(404)
    const ownDownload = await fetch(`${base}/files/${upload.data.id}/download`, { headers: { authorization: `Bearer ${b}` } })
    expect(ownDownload.status).toBe(200); expect((await ownDownload.arrayBuffer()).byteLength).toBe(bytes.length)
    const resource = await db.resource.create({ data: { slug: `${prefix}-public-file`, title: '公开学习图', summary: '共享存储公开资源回归', category: '学习资料', format: 'PNG', fileId: upload.data.id, status: 'published', visibility: 'public' } })
    // 仅有行状态不能授予附件权限；真实发布必须建立含附件和可见性的发布快照。
    expect((await fetch(`${base}/files/${upload.data.id}/download`, { headers: { authorization: `Bearer ${c}` } })).status).toBe(404)
    expect((await request(`/admin/resources/${resource.id}/publish`, admin, 'POST')).status).toBe(201)
    const published = await db.resource.findUniqueOrThrow({ where: { id: resource.id }, include: { publishedVersion: true } })
    expect(published.publishedVersion?.snapshot).toMatchObject({ fileId: upload.data.id, visibility: 'public' })
    const publicDownload = await fetch(`${base}/files/${upload.data.id}/download`, { headers: { authorization: `Bearer ${c}` } })
    expect(publicDownload.status).toBe(200)
    expect(Buffer.from(await publicDownload.arrayBuffer())).toEqual(bytes)
    expect((await request(`/community/posts/${post.id}`, b)).status).toBe(200)
  })
  it('资料头像和封面裁切为WebP，可替换移除且孤立文件不能经资料地址读取', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
    const upload = async (kind: 'avatar' | 'banner', expectedUserRevision: number, expectedProfileRevision: number) => {
      const form = new FormData()
      form.append('file', new Blob([png], { type: 'image/png' }), `${kind}.png`)
      form.append('expectedUserRevision', String(expectedUserRevision))
      form.append('expectedProfileRevision', String(expectedProfileRevision))
      return request<CommunityProfileUpdateDto>(`/community/profile/${kind}`, a, 'POST', form)
    }
    const current = (await request(`/community/users/${aId}`, a)).data
    const first = await upload('avatar', current.userRevision, current.revision)
    expect(first.status).toBe(201)
    const firstUrl = first.data.user.avatarUrl!
    const firstFile = firstUrl.split('/').at(-1)!
    const firstResponse = await fetch(`${base}${firstUrl.replace('/api/v1', '')}`)
    expect(firstResponse.status).toBe(200)
    const avatarMetadata = await sharp(Buffer.from(await firstResponse.arrayBuffer())).metadata()
    expect(avatarMetadata).toMatchObject({ format: 'webp', width: 512, height: 512 })
    expect(avatarMetadata.exif).toBeUndefined()

    const replacement = await upload('avatar', first.data.profile.userRevision, first.data.profile.revision)
    expect(replacement.status).toBe(201)
    expect(replacement.data.user.avatarUrl).not.toBe(firstUrl)
    expect((await fetch(`${base}/files/profile/${firstFile}`)).status).toBe(404)

    const banner = await upload('banner', replacement.data.profile.userRevision, replacement.data.profile.revision)
    expect(banner.status).toBe(201)
    const bannerResponse = await fetch(`${base}${banner.data.profile.bannerUrl!.replace('/api/v1', '')}`)
    const bannerMetadata = await sharp(Buffer.from(await bannerResponse.arrayBuffer())).metadata()
    expect(bannerMetadata).toMatchObject({ format: 'webp', width: 1500, height: 500 })
    expect(bannerMetadata.exif).toBeUndefined()

    const removedAvatar = await request<CommunityProfileUpdateDto>('/community/profile/avatar', a, 'DELETE', { expectedUserRevision: banner.data.profile.userRevision, expectedProfileRevision: banner.data.profile.revision })
    expect(removedAvatar.data.user.avatarUrl).toBeNull()
    const removedBanner = await request<CommunityProfileUpdateDto>('/community/profile/banner', a, 'DELETE', { expectedUserRevision: removedAvatar.data.profile.userRevision, expectedProfileRevision: removedAvatar.data.profile.revision })
    expect(removedBanner.data.profile.bannerUrl).toBeNull()

    const privateForm = new FormData()
    privateForm.append('file', new Blob([png], { type: 'image/png' }), 'private.png')
    const privateFile = await request('/community/media', a, 'POST', privateForm)
    expect((await fetch(`${base}/files/profile/${privateFile.data.id}`)).status).toBe(404)
  })
  it('成果草稿默认关闭，开启后幂等生成且不包含成绩日志', async () => {
    const signals = app.get(SignalsService), lab = await db.lab.findFirstOrThrow({ where: { status: 'published' } })
    await db.$transaction((tx) => signals.achievementDraft(tx, aId, 'lab', lab.id, 'event-1'))
    expect(await db.communityPost.count({ where: { authorId: aId, postType: 'achievement' } })).toBe(0)
    await request('/community/profile', a, 'PATCH', { bio: '', headline: '', expertiseTopics: [], allowAchievementDrafts: true })
    for (let i = 0; i < 2; i++) await db.$transaction((tx) => signals.achievementDraft(tx, aId, 'lab', lab.id, 'event-1'))
    const rows = await db.communityPost.findMany({ where: { authorId: aId, postType: 'achievement' } })
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('draft')
    expect((await request(`/community/posts/${rows[0].id}`, b)).status).toBe(404)
    expect(rows[0].contentBlocks).not.toHaveProperty('score')
  })
  it('身份认证不能自改，禁用账号和撤销权限立即使旧令牌失效', async () => {
    expect((await request('/community/profile', c, 'PATCH', { bio: '', headline: '', expertiseTopics: [], allowAchievementDrafts: false, verifiedType: 'official' })).status).toBe(400)
    const role = await db.role.findUniqueOrThrow({ where: { code: 'community_moderator' } })
    await db.userRole.create({ data: { userId: cId, roleId: role.id } })
    expect((await request('/admin/community/posts', c)).status).toBe(200)
    await db.userRole.delete({ where: { userId_roleId: { userId: cId, roleId: role.id } } })
    expect((await request('/admin/community/posts', c)).status).toBe(403)
    await db.user.update({ where: { id: cId }, data: { status: 'disabled' } })
    expect((await request('/community/feed', c)).status).toBe(401)
    await db.user.update({ where: { id: cId }, data: { status: 'active' } })
  })
})
