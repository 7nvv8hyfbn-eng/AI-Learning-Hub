import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NestFactory, Reflector } from '@nestjs/core'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { AppModule } from '../src/app.module'
import { ApiExceptionFilter } from '../src/common/api-exception.filter'
import { ApiResponseInterceptor } from '../src/common/api-response.interceptor'
import { PrismaService } from '../src/prisma/prisma.service'
import { bootstrapDatabase } from '../src/modules/persistence/bootstrap'
import { STORAGE_SERVICE, StorageService } from '../src/modules/storage/storage.types'
import { AuthService } from '../src/modules/auth/auth.service'
import { UsersService } from '../src/modules/users/users.service'
import { idempotency, lockFileReferences } from '../src/common/persistence'
import type { AuthSessionDto, CommunityPostDetailDto } from '@ai-learning-hub/contracts'

if (!process.env.DATABASE_URL?.includes('127.0.0.1:55439/community_')) throw new Error('持久化 E2E 只允许隔离社区数据库')
const db = new PrismaClient(), prefix = `persist-${Date.now()}`, password = `Check8${randomBytes(16).toString('hex')}`
const checksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let app: INestApplication, base: string, admin: AuthSessionDto, actor: AuthSessionDto, other: AuthSessionDto
const registration = (suffix: string) => ({ displayName: `持久化${suffix}`, email: `${prefix}-${suffix}@example.invalid`, password, agreementVersion: '2026-08-30' })
async function request<T = any>(path: string, token?: string, method = 'GET', input?: unknown, key?: string) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...(input instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    ...(input === undefined ? {} : { body: input instanceof FormData ? input : JSON.stringify(input) }),
  })
  const payload = await response.json()
  return { status: response.status, data: payload.data as T, message: payload.message as string }
}
const postInput = (text: string, status = 'published') => ({ type: 'general', title: '', contentBlocks: [{ type: 'paragraph', text }], bindings: [], topicIds: [], visibility: 'public', status })
async function restrictedActor(suffix: string, codes: string[]): Promise<AuthSessionDto> {
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } })
  expect(permissions.map((row) => row.code).sort()).toEqual([...codes].sort())
  const role = await db.role.create({ data: { code: `${prefix}-${suffix}`, name: `隔离权限${suffix}`, permissions: { create: permissions.map((row) => ({ permissionId: row.id })) } } })
  const user = await db.user.create({ data: { username: `${prefix}-${suffix}`, displayName: `隔离账号${suffix}`, email: `${prefix}-${suffix}@example.invalid`, passwordHash: await hash(password, 4), communityProfile: { create: {} }, userRoles: { create: { roleId: role.id } } } })
  const session = await request<AuthSessionDto>('/auth/login', undefined, 'POST', { email: user.email, password })
  expect(session.status).toBe(201)
  expect([...session.data.user.permissions].sort()).toEqual([...codes].sort())
  return session.data
}
async function startApplication() {
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1'); app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1`
}
beforeAll(async () => {
  await startApplication()
  await db.systemSetting.update({ where: { key: 'registration' }, data: { value: { mode: 'open', emailVerification: false, agreementVersion: '2026-08-30', passwordMinLength: 8, schoolRequired: false } } })
  await db.registrationThrottle.deleteMany({})
  admin = (await request<AuthSessionDto>('/auth/login', undefined, 'POST', { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD })).data
  actor = (await request<AuthSessionDto>('/auth/register', undefined, 'POST', registration('actor'))).data
  other = (await request<AuthSessionDto>('/auth/register', undefined, 'POST', registration('other'))).data
  expect(admin.accessToken && actor.accessToken && other.accessToken).toBeTruthy()
}, 30000)
afterAll(async () => { await app?.close(); await db.$disconnect() })

describe('PERSIST-001 真实 PostgreSQL 持久化与账号产品化', () => {
  it('原生咨询锁返回值可被Prisma解码，跨事务争锁超时且提交后释放', async () => {
    await db.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const request = await idempotency(tx, prefix, 'sql-compatibility', randomUUID(), { verified: true })
      await request.complete('sql-compatibility')
      await expect(db.$transaction(async (otherTx) => {
        await otherTx.$executeRaw`SET LOCAL lock_timeout = '80ms'`
        await lockFileReferences(otherTx)
      })).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } })
    })
    await expect(db.$transaction((tx) => lockFileReferences(tx))).resolves.toBeUndefined()
  })
  it('登录失败原生计数维护updated_at与五次短暂锁定，不返回数据库500', async () => {
    const auth = app.get(AuthService), clientKey = randomUUID(), identityKey = createHash('sha256').update(clientKey).digest('hex')
    const started = new Date()
    for (let n = 0; n < 5; n++) await expect(auth.login(`${prefix}-absent@example.invalid`, password, clientKey, 'isolated')).rejects.toMatchObject({ status: 401 })
    const stored = await db.loginThrottle.findUniqueOrThrow({ where: { identityKey } })
    expect(stored.failures).toBe(5)
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(started.getTime())
    expect(stored.blockedUntil!.getTime()).toBeGreaterThan(Date.now())
    await expect(auth.login(`${prefix}-absent@example.invalid`, password, clientKey, 'isolated')).rejects.toMatchObject({ status: 429 })
  })
  it('注册幂等同键只创建一份业务事实，敏感输入不落无密钥摘要', async () => {
    const input = registration('retry'), key = randomUUID()
    const results = await Promise.all([request<AuthSessionDto>('/auth/register', undefined, 'POST', input, key), request<AuthSessionDto>('/auth/register', undefined, 'POST', input, key)])
    expect(results.map((r) => r.status)).toEqual([201, 201]); expect(results[0].data.user.id).toBe(results[1].data.user.id)
    const id = results[0].data.user.id
    expect(await db.user.count({ where: { email: input.email } })).toBe(1)
    expect(await db.communityProfile.count({ where: { userId: id } })).toBe(1)
    expect(await db.activityEvent.count({ where: { userId: id, actionType: 'user_registered' } })).toBe(1)
    const record = await db.requestIdempotency.findFirstOrThrow({ where: { idempotencyKey: key } })
    const unkeyed = checksum(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))
    expect(record.requestHash === unkeyed).toBe(false)
    expect(JSON.stringify(record).includes(password)).toBe(false)
    expect((await request('/auth/register', undefined, 'POST', { ...input, password: `${password}A` }, key)).status).toBe(409)
    await db.user.update({ where: { id }, data: { passwordHash: await hash(`${password}New`, 4), sessionVersion: { increment: 1 } } })
    const sessions = await db.refreshToken.count({ where: { userId: id } })
    expect((await request('/auth/register', undefined, 'POST', input, key)).status).toBe(409)
    expect(await db.refreshToken.count({ where: { userId: id } })).toBe(sessions)
  })
  it('大小写唯一索引阻止第二个邮箱或用户名账号，不覆盖已有数据', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.user.id } })
    await expect(db.user.create({ data: { username: `${prefix}-collision`, displayName: '冲突账号', email: user.email.toUpperCase() } })).rejects.toMatchObject({ code: 'P2002' })
    await expect(db.user.create({ data: { username: user.username.toUpperCase(), displayName: '冲突账号', email: `${prefix}-different@example.invalid` } })).rejects.toMatchObject({ code: 'P2002' })
    expect(await db.user.count({ where: { id: user.id } })).toBe(1)
  })
  it('资料双修订原子更新，并在退出重登和服务重启后保持', async () => {
    const school = await db.school.create({ data: { code: prefix, name: '持久化隔离学校' } })
    const dept = await db.department.create({ data: { schoolId: school.id, name: '人工智能院系', code: prefix } })
    const themes = await db.theme.findMany({ where: { status: 'published', deletedAt: null }, take: 3 })
    const input = { expectedRevision: actor.user.revision, expectedProfileRevision: actor.user.profileRevision, schoolId: school.id, departmentId: dept.id, major: '人工智能', grade: '大二', headline: '真实资料持久化', themeIds: themes.map((t) => t.id) }
    expect((await request('/community/onboarding', actor.accessToken, 'POST', { ...input, themeIds: ['missing'] })).status).toBe(400)
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.user.id } })).onboardingCompletedAt).toBeNull()
    const saved = await request('/community/onboarding', actor.accessToken, 'POST', input)
    expect(saved.status).toBe(201); expect(saved.data).toMatchObject({ major: '人工智能', grade: '大二', schoolId: school.id, departmentId: dept.id, onboardingCompleted: true })
    expect((await request('/me', actor.accessToken)).data).toMatchObject({ major: '人工智能', grade: '大二' })
    expect((await request('/community/onboarding', actor.accessToken, 'POST', input)).status).toBe(409)
    const profile = (await request(`/community/users/${actor.user.id}`, actor.accessToken)).data
    const fields = { displayName: profile.displayName, bio: '本人简介', headline: '独立浏览器读取', location: '', websiteUrl: '', expertiseTopics: [], allowAchievementDrafts: false, expectedUserRevision: profile.userRevision, expectedProfileRevision: profile.revision }
    const updated = await request('/community/profile', actor.accessToken, 'PATCH', fields)
    expect(updated.status).toBe(200)
    const revisions = { user: updated.data.profile.userRevision, profile: updated.data.profile.revision }
    const stored = await db.user.findUniqueOrThrow({ where: { id: actor.user.id }, include: { communityProfile: true } })
    expect((await request('/community/profile', actor.accessToken, 'PATCH', { ...fields, displayName: '不应部分保存一', expectedUserRevision: revisions.user, expectedProfileRevision: profile.revision })).status).toBe(409)
    expect((await request('/community/profile', actor.accessToken, 'PATCH', { ...fields, displayName: '不应部分保存二', expectedUserRevision: profile.userRevision, expectedProfileRevision: revisions.profile })).status).toBe(409)
    const afterConflicts = await db.user.findUniqueOrThrow({ where: { id: actor.user.id }, include: { communityProfile: true } })
    expect(checksum(afterConflicts)).toBe(checksum(stored))
    const authoredPost = await request('/community/posts', actor.accessToken, 'POST', postInput('资料名称联动'))
    const authoredComment = await request(`/community/posts/${authoredPost.data.id}/comments`, actor.accessToken, 'POST', { contentBlocks: [{ type: 'paragraph', text: '旧评论读取新名称' }] })
    expect(authoredPost.status).toBe(201); expect(authoredComment.status).toBe(201)
    const persistedName = '重启后仍保留的显示名称'
    const persisted = await request('/community/profile', actor.accessToken, 'PATCH', { ...fields, displayName: persistedName, expectedUserRevision: revisions.user, expectedProfileRevision: revisions.profile })
    expect(persisted.status).toBe(200)
    await app.close()
    await startApplication()
    actor = (await request<AuthSessionDto>('/auth/login', undefined, 'POST', { email: actor.user.email, password })).data
    expect(actor.user.displayName).toBe(persistedName)
    expect((await request(`/community/users/${actor.user.id}`, actor.accessToken)).data).toMatchObject({ displayName: persistedName, bio: '本人简介', headline: '独立浏览器读取' })
    expect((await request(`/community/posts/${authoredPost.data.id}`, other.accessToken)).data.author.displayName).toBe(persistedName)
    expect((await request(`/community/posts/${authoredPost.data.id}/comments`, other.accessToken)).data[0].author.displayName).toBe(persistedName)
  })
  it('服务端草稿两会话更新CAS，拒绝缺少版本且保存不可变历史', async () => {
    const created = await request<CommunityPostDetailDto>('/community/drafts', actor.accessToken, 'POST', postInput('草稿版本一', 'draft'), randomUUID())
    expect(created.status).toBe(201)
    const id = created.data.id, input = { ...postInput('草稿版本二', 'draft'), expectedRevision: created.data.revision }
    const responses = await Promise.all([request(`/community/drafts/${id}`, actor.accessToken, 'PATCH', input, randomUUID()), request(`/community/drafts/${id}`, actor.accessToken, 'PATCH', { ...input, title: '竞争版本' }, randomUUID())])
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect((await request(`/community/drafts/${id}`, actor.accessToken, 'PATCH', postInput('缺修订号', 'draft'))).status).toBe(400)
    const saved = (await request(`/community/posts/${id}`, actor.accessToken)).data
    expect(saved.revision).toBe(2)
    const history = await db.communityPostRevision.findMany({ where: { postId: id }, orderBy: { revisionNo: 'asc' } })
    expect(history.map((r) => r.revisionNo)).toEqual([1, 2]); expect(history[0].contentBlocksSnapshot).toEqual(postInput('草稿版本一').contentBlocks)
    expect((await request(`/community/posts/${id}`, other.accessToken)).status).toBe(404)
    expect((await request(`/admin/community/posts/${id}`, admin.accessToken)).status).toBe(400)
    expect(JSON.stringify((await request('/admin/community/posts', admin.accessToken)).data).includes(id)).toBe(false)
    expect((await request(`/community/posts/${id}`, actor.accessToken, 'PATCH', { ...postInput('已发布的原草稿'), expectedRevision: saved.revision })).status).toBe(200)
    const staleDraft = await request(`/community/drafts/${id}`, actor.accessToken, 'PATCH', { ...postInput('另一个会话的旧稿输入', 'draft'), expectedRevision: saved.revision })
    expect(staleDraft).toMatchObject({ status: 400, message: '草稿不存在或无权操作' })
    expect((await db.communityPost.findUniqueOrThrow({ where: { id } }))).toMatchObject({ status: 'published', revision: saved.revision + 1, plainText: '已发布的原草稿' })
  })
  it('帖子/评论/互动重试各只记一次事实，编辑保留修订与计数', async () => {
    const key = randomUUID(), input = postInput('并发公开发布')
    const rows = await Promise.all([request('/community/posts', actor.accessToken, 'POST', input, key), request('/community/posts', actor.accessToken, 'POST', input, key)])
    expect(rows.map((r) => r.status)).toEqual([201, 201]); expect(rows[0].data.id).toBe(rows[1].data.id)
    const post = rows[0].data
    expect(await db.activityEvent.count({ where: { targetId: post.id, actionType: 'post_published' } })).toBe(1)
    const commentKey = randomUUID(), commentInput = { contentBlocks: [{ type: 'paragraph', text: '幂等评论' }] }
    const comments = await Promise.all([request(`/community/posts/${post.id}/comments`, other.accessToken, 'POST', commentInput, commentKey), request(`/community/posts/${post.id}/comments`, other.accessToken, 'POST', commentInput, commentKey)])
    expect(comments.map((r) => r.status)).toEqual([201, 201]); expect(comments[0].data.id).toBe(comments[1].data.id)
    expect(await db.communityComment.count({ where: { postId: post.id } })).toBe(1)
    expect(await db.activityEvent.count({ where: { entityId: comments[0].data.id, actionType: 'comment_created' } })).toBe(1)
    const liked = await Promise.all([request(`/community/posts/${post.id}/reactions/like`, other.accessToken, 'PUT'), request(`/community/posts/${post.id}/reactions/like`, other.accessToken, 'PUT')])
    expect(liked.map((r) => r.data)).toEqual([expect.objectContaining({ active: true, stats: expect.objectContaining({ likes: 1, comments: 1 }) }), expect.objectContaining({ active: true, stats: expect.objectContaining({ likes: 1, comments: 1 }) })])
    expect(await db.activityEvent.count({ where: { userId: other.user.id, targetId: post.id, actionType: 'post_liked' } })).toBe(1)
    const edited = await request(`/community/posts/${post.id}`, actor.accessToken, 'PATCH', { ...input, title: '修改标题', expectedRevision: post.revision })
    expect(edited.status).toBe(200); expect(edited.data.revision).toBe(2)
    expect((await request(`/community/posts/${post.id}`, actor.accessToken, 'PATCH', { ...input, expectedRevision: post.revision })).status).toBe(409)
    const detail = (await request(`/admin/community/posts/${post.id}`, admin.accessToken)).data
    expect(detail.revisions).toHaveLength(2); expect(detail.actions.length).toBeGreaterThan(0)
  })
  it('多写中途事件失败回滚帖子、历史、幂等记录和计数', async () => {
    const prisma = app.get(PrismaService), original = prisma.$transaction.bind(prisma), key = randomUUID()
    const before = await db.communityPost.count({ where: { authorId: actor.user.id } })
    let injected = false
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(((callback: any, options: any) => original(async (tx: any) => {
      const create = tx.activityEvent.create
      tx.activityEvent.create = () => { injected = true; throw new Error('injected persistence event failure') }
      try { return await callback(tx) } finally { tx.activityEvent.create = create }
    }, options)) as any)
    expect((await request('/community/posts', actor.accessToken, 'POST', postInput('必须全部回滚'), key)).status).toBe(500)
    vi.restoreAllMocks()
    expect(injected).toBe(true)
    expect(await db.communityPost.count({ where: { authorId: actor.user.id } })).toBe(before)
    expect(await db.requestIdempotency.count({ where: { idempotencyKey: key } })).toBe(0)
  })
  it('编辑、作者删除和管理员隐藏并发不死锁，历史与关系计数一致', async () => {
    const initial = await request<CommunityPostDetailDto>('/community/posts', actor.accessToken, 'POST', postInput('隔离并发状态变更'))
    expect(initial.status).toBe(201)
    const id = initial.data.id
    const rows = await Promise.all([
      request(`/community/posts/${id}`, actor.accessToken, 'PATCH', { ...postInput('隔离并发编辑'), expectedRevision: initial.data.revision }),
      request(`/community/posts/${id}`, actor.accessToken, 'DELETE'),
      request(`/admin/community/post/${id}/moderate`, admin.accessToken, 'POST', { action: 'hide', reason: '隔离并发审核回归' }),
    ])
    expect([200, 403, 404, 409]).toContain(rows[0].status)
    expect(rows[1].status).toBe(200); expect(rows[2].status).toBe(201)
    const current = await db.communityPost.findUniqueOrThrow({ where: { id } })
    expect(['hidden', 'removed']).toContain(current.status)
    const revisions = await db.communityPostRevision.findMany({ where: { postId: id }, orderBy: { revisionNo: 'asc' } })
    expect(revisions.map((r) => r.revisionNo)).toEqual(Array.from({ length: current.revision }, (_, i) => i + 1))
    expect((await db.communityProfile.findUniqueOrThrow({ where: { userId: actor.user.id } })).postCount).toBe(await db.communityPost.count({ where: { authorId: actor.user.id, status: 'published', deletedAt: null } }))
  })
  it('用户与社区后台返回真实分页总量，学生不可越权与导出', async () => {
    const users = await request('/admin/users?page=1&pageSize=1', admin.accessToken)
    expect(users.data.items).toHaveLength(1); expect(users.data.total).toBeGreaterThan(1)
    expect((await request('/admin/users?page=2&pageSize=1', admin.accessToken)).data.items[0].id).not.toBe(users.data.items[0].id)
    for (const path of ['/admin/users', '/admin/users/export', '/admin/persistence']) expect((await request(path, actor.accessToken)).status).toBe(403)
    for (const type of ['posts', 'comments', 'topics', 'reports', 'users']) {
      const page = await request(`/admin/community/${type}?page=1&pageSize=1`, admin.accessToken)
      expect(page.status).toBe(200); expect(page.data).toMatchObject({ page: 1, pageSize: 1 }); expect(page.data.items.length).toBeLessThanOrEqual(1); expect(Number.isInteger(page.data.total)).toBe(true)
    }
    const detail = await request(`/admin/users/${actor.user.id}`, admin.accessToken)
    expect(detail.data.security.passwordSet).toBe(true)
    expect(JSON.stringify(detail.data)).not.toMatch(/passwordHash|refreshToken|tokenHash/)
    expect((await request(`/admin/users/${admin.user.id}/status`, admin.accessToken, 'PATCH', { status: 'disabled', reason: '不能禁用当前自己', expectedRevision: admin.user.revision })).status).toBe(400)
  })
  it('用户读取、编辑、会话撤销与导出权限相互独立，导出逐次审计且不泄露凭证', async () => {
    const reader = await restrictedActor('rbac-reader', ['user.read']), writer = await restrictedActor('rbac-writer', ['user.write'])
    const revoker = await restrictedActor('rbac-revoker', ['user.session.revoke']), exporter = await restrictedActor('rbac-exporter', ['user.export'])
    const target = await restrictedActor('rbac-target', []), path = `/admin/users/${target.user.id}`
    const edit = { displayName: '权限隔离更新', major: '计算机', grade: '大一', expectedRevision: target.user.revision, reason: '隔离测试资料修正' }
    expect((await request(`/admin/users?keyword=${target.user.email}`, reader.accessToken)).data.items.map((row: { id: string }) => row.id)).toEqual([target.user.id])
    expect((await request(path, reader.accessToken)).data.user.id).toBe(target.user.id)
    const before = await db.user.findUniqueOrThrow({ where: { id: target.user.id } })
    for (const token of [reader.accessToken, revoker.accessToken, exporter.accessToken]) {
      expect((await request(path, token, 'PATCH', edit)).status).toBe(403)
      expect((await request(`${path}/status`, token, 'PATCH', { status: 'locked', expectedRevision: target.user.revision, reason: '禁止跨权限修改状态' })).status).toBe(403)
      expect((await request(`${path}/reset-onboarding`, token, 'POST', { reason: '禁止跨权限重置引导' })).status).toBe(403)
    }
    for (const token of [writer.accessToken, revoker.accessToken, exporter.accessToken]) {
      expect((await request('/admin/users', token)).status).toBe(403)
      expect((await request(path, token)).status).toBe(403)
    }
    for (const token of [reader.accessToken, writer.accessToken, exporter.accessToken]) expect((await request(`${path}/revoke-sessions`, token, 'POST', { reason: '禁止跨权限撤销会话' })).status).toBe(403)
    for (const token of [reader.accessToken, writer.accessToken, revoker.accessToken]) expect((await request('/admin/users/export', token)).status).toBe(403)
    expect(checksum(await db.user.findUniqueOrThrow({ where: { id: target.user.id } }))).toBe(checksum(before))
    expect(await db.auditLog.count({ where: { targetType: 'user', targetId: target.user.id } })).toBe(0)
    expect((await request(path, writer.accessToken, 'PATCH', edit)).data.user.displayName).toBe(edit.displayName)
    expect((await request(`${path}/revoke-sessions`, revoker.accessToken, 'POST', { reason: '隔离测试专用撤销权限' })).status).toBe(201)
    expect((await request('/me', target.accessToken)).status).toBe(401)
    const exported = await request(`/admin/users/export?keyword=${target.user.email}&page=1&pageSize=1`, exporter.accessToken)
    expect(exported.status).toBe(200); expect(exported.data).toMatchObject({ page: 1, pageSize: 1, total: 1 })
    expect(exported.data.items.map((row: { id: string }) => row.id)).toEqual([target.user.id])
    expect(JSON.stringify(exported.data)).not.toMatch(/passwordHash|refreshToken|tokenHash|sessionVersion|ipHash/)
    expect(JSON.stringify(exported.data).includes(password)).toBe(false)
    const audits = await db.auditLog.findMany({ where: { actorId: exporter.user.id, action: 'user_export' } })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ targetType: 'user', targetId: 'page', details: { page: 1, pageSize: 1, count: 1 } })
    expect(Object.keys(audits[0].details as object).sort()).toEqual(['count', 'page', 'pageSize'])
  })
  it('敏感账号操作拒绝缺失和空白原因，合法操作仅写一条审计及行为事实', async () => {
    const writer = await restrictedActor('reason-writer', ['user.write']), revoker = await restrictedActor('reason-revoker', ['user.session.revoke'])
    const target = await restrictedActor('reason-target', [])
    await db.user.update({ where: { id: target.user.id }, data: { onboardingCompletedAt: new Date() } })
    for (const operation of [
      { suffix: 'reset-onboarding', action: 'reset_onboarding', method: 'POST', actor: writer },
      { suffix: 'revoke-sessions', action: 'revoke_sessions', method: 'POST', actor: revoker },
      { suffix: 'status', action: 'user_locked', method: 'PATCH', actor: writer },
    ]) {
      const before = await db.user.findUniqueOrThrow({ where: { id: target.user.id } })
      const body = operation.suffix === 'status' ? { status: 'locked', expectedRevision: before.revision } : {}
      const path = `/admin/users/${target.user.id}/${operation.suffix}`
      for (const invalid of [body, { ...body, reason: '    ' }]) expect((await request(path, operation.actor.accessToken, operation.method, invalid)).status).toBe(400)
      expect(checksum(await db.user.findUniqueOrThrow({ where: { id: target.user.id } }))).toBe(checksum(before))
      const auditWhere = { actorId: operation.actor.user.id, action: operation.action, targetType: 'user', targetId: target.user.id }
      const eventWhere = { userId: operation.actor.user.id, actionType: operation.action, entityType: 'user', entityId: target.user.id }
      expect(await db.auditLog.count({ where: auditWhere })).toBe(0)
      expect(await db.activityEvent.count({ where: eventWhere })).toBe(0)
      const reason = `隔离验收${operation.suffix}操作原因`
      expect((await request(path, operation.actor.accessToken, operation.method, { ...body, reason })).status).toBe(operation.method === 'PATCH' ? 200 : 201)
      const audits = await db.auditLog.findMany({ where: auditWhere }), events = await db.activityEvent.findMany({ where: eventWhere })
      expect(audits).toHaveLength(1); expect(audits[0].details).toEqual({ reason })
      expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ source: 'admin-web', payload: { reason } })
      expect((await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).revision).toBe(before.revision + 1)
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: target.user.id } }))).toMatchObject({ status: 'locked', onboardingCompletedAt: null })
    expect(await db.refreshToken.count({ where: { userId: target.user.id, revokedAt: null } })).toBe(0)
  })
  it('用户五类详情对应同一真实账号，学习数据独立鉴权且不混入他人记录', async () => {
    const reader = await restrictedActor('detail-reader', ['user.read']), growthReader = await restrictedActor('detail-growth', ['growth.read'])
    const target = await restrictedActor('detail-target', []), time = new Date('2026-08-01T01:02:03.000Z')
    const privateMarker = `${prefix}-private-detail`
    await db.user.update({ where: { id: target.user.id }, data: { major: '人工智能', grade: '大二', studentNo: `${prefix}-student-no`, agreementVersion: 'detail-fixture-v1', agreementAcceptedAt: time, emailVerifiedAt: time, profile: { internalSecret: privateMarker }, communityProfile: { update: { headline: '真实社区签名', bio: '真实社区简介', expertiseTopics: ['机器学习'] } } } })
    const post = await db.communityPost.create({ data: { authorId: target.user.id, postType: 'note', status: 'published', visibility: 'public', title: '详情公开作品', body: '正文', plainText: '正文', contentBlocks: [], contentHash: randomUUID(), publishedAt: time } })
    const draft = await db.communityPost.create({ data: { authorId: target.user.id, postType: 'note', status: 'draft', body: privateMarker, plainText: privateMarker, contentBlocks: [], contentHash: randomUUID() } })
    await db.communityComment.create({ data: { postId: post.id, authorId: target.user.id, body: '详情评论', contentBlocks: [] } })
    await db.communityReport.create({ data: { reporterId: target.user.id, postId: post.id, targetKey: `post:${post.id}`, reason: '隔离详情测试' } })
    const activity = await db.activityEvent.create({ data: { userId: target.user.id, eventType: 'community_post_publish', actionType: 'post_published', targetType: 'post', targetId: post.id, source: 'student-web' } })
    const hiddenActivity = await db.activityEvent.create({ data: { userId: target.user.id, eventType: 'post_draft_saved', targetType: 'post', targetId: draft.id, payload: { privateMarker } } })
    const audit = await db.auditLog.create({ data: { actorId: admin.user.id, action: 'profile_updated', targetType: 'user', targetId: target.user.id, details: { reason: '已核实资料修正', internalSecret: privateMarker } } })
    const course = await db.course.findFirstOrThrow({ where: { status: 'published', deletedAt: null } })
    const favorite = await db.favorite.create({ data: { userId: target.user.id, targetType: 'course', targetId: course.id } })
    const foreignFavorite = await db.favorite.create({ data: { userId: growthReader.user.id, targetType: 'course', targetId: course.id } })
    await db.growthPoint.createMany({ data: [{ userId: target.user.id, eventType: 'detail_fixture', points: 37 }, { userId: growthReader.user.id, eventType: 'detail_fixture', points: 999 }] })
    const detail = await request(`/admin/users/${target.user.id}`, reader.accessToken)
    expect(detail.status).toBe(200); expect(Object.keys(detail.data).sort()).toEqual(['activities', 'audits', 'community', 'security', 'user'])
    expect(detail.data.user).toMatchObject({ id: target.user.id, email: target.user.email, major: '人工智能', grade: '大二', studentNo: `${prefix}-student-no`, emailVerified: true, communityPostCount: 1 })
    expect(detail.data.security).toEqual({ agreementVersion: 'detail-fixture-v1', agreementAcceptedAt: time.toISOString(), emailVerifiedAt: time.toISOString(), passwordSet: true, activeSessions: 1, lastLoginResult: 'success', identities: [] })
    expect(detail.data.community).toMatchObject({ headline: '真实社区签名', bio: '真实社区简介', expertiseTopics: ['机器学习'], postCount: 1, commentCount: 1, reportCount: 1 })
    expect(detail.data.activities).toContainEqual(expect.objectContaining({ id: activity.id, actorId: target.user.id, eventType: 'post_published', entityType: 'post', entityId: post.id, source: 'student-web' }))
    expect(detail.data.activities.every((row: { actorId: string; id: string }) => row.actorId === target.user.id && row.id !== hiddenActivity.id)).toBe(true)
    expect(detail.data.audits).toEqual([{ id: audit.id, action: 'profile_updated', reason: '已核实资料修正', createdAt: audit.createdAt.toISOString() }])
    expect(JSON.stringify(detail.data)).not.toMatch(/passwordHash|refreshToken|tokenHash|internalSecret/)
    expect(JSON.stringify(detail.data).includes(privateMarker)).toBe(false)
    expect((await request(`/admin/users/${target.user.id}/growth`, reader.accessToken)).status).toBe(403)
    expect((await request(`/admin/users/${target.user.id}`, growthReader.accessToken)).status).toBe(403)
    const growth = await request(`/admin/users/${target.user.id}/growth`, growthReader.accessToken)
    expect(growth.status).toBe(200); expect(growth.data.user.id).toBe(target.user.id); expect(growth.data.points).toBe(37)
    expect(growth.data.favorites).toEqual([expect.objectContaining({ id: favorite.id, userId: target.user.id, targetType: 'course', targetId: course.id })])
    expect(JSON.stringify(growth.data).includes(foreignFavorite.id)).toBe(false)
    for (const key of ['progress', 'runs', 'attempts', 'plans', 'achievements', 'certificates', 'knowledgeStats', 'wrongQuestions']) expect(growth.data[key]).toEqual([])
  })
  it('超过200条的用户和帖子精确分页，末页可达且筛选排序无重复', async () => {
    const marker = `${prefix}-page`
    await db.user.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ username: `${marker}-${String(i).padStart(3, '0')}`, displayName: `${marker}-${i}`, email: `${marker}-${i}@example.invalid`, createdAt: new Date(1600000000000 + i * 1000) })) })
    await db.communityPost.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ authorId: actor.user.id, title: `${marker}-${i}`, postType: 'note', status: 'published', visibility: 'public', body: marker, plainText: marker, contentBlocks: [{ type: 'paragraph', text: marker }], contentHash: `${marker}-${i}`, publishedAt: new Date(1600000000000 + i * 1000), createdAt: new Date(1600000000000 + i * 1000) })) })
    for (const path of ['/admin/users', '/admin/community/posts']) {
      const ids: string[] = []
      for (let page = 1; page <= 3; page++) {
        const result = await request(`${path}?keyword=${marker}&page=${page}&pageSize=100&sortBy=createdAt&sortOrder=asc`, admin.accessToken)
        expect(result.status).toBe(200); expect(result.data.total).toBe(205)
        expect(result.data.items).toHaveLength(page === 3 ? 5 : 100)
        ids.push(...result.data.items.map((row: { id: string }) => row.id))
      }
      expect(new Set(ids).size).toBe(205)
      const reversed = await request(`${path}?keyword=${marker}&page=1&pageSize=1&sortBy=createdAt&sortOrder=desc`, admin.accessToken)
      expect(reversed.data.items[0].id).toBe(ids.at(-1))
      expect((await request(`${path}?keyword=${marker}-204&pageSize=100`, admin.accessToken)).data.total).toBe(1)
    }
  })
  it('父帖隐藏时已发布评论仍属于受限读取并形成审计', async () => {
    const post = await db.communityPost.create({ data: { authorId: actor.user.id, postType: 'general', status: 'hidden', visibility: 'public', title: '隐藏父帖', body: '限制正文', plainText: '限制正文', contentBlocks: [], contentHash: randomUUID(), publishedAt: new Date() } })
    await db.communityComment.create({ data: { postId: post.id, authorId: actor.user.id, body: '受限评论', contentBlocks: [{ type: 'paragraph', text: '受限评论' }] } })
    const before = await db.auditLog.count({ where: { actorId: admin.user.id, action: 'restricted_content_read', targetType: 'comment' } })
    expect((await request(`/admin/community/comments?postId=${post.id}`, admin.accessToken)).data.items).toHaveLength(1)
    expect(await db.auditLog.count({ where: { actorId: admin.user.id, action: 'restricted_content_read', targetType: 'comment' } })).toBe(before + 1)
  })
  it('强制退出和锁定使旧 access/refresh 会话即时失效，旧版本不能覆盖账号状态', async () => {
    const revoke = await request(`/admin/users/${other.user.id}/revoke-sessions`, admin.accessToken, 'POST', { reason: '隔离验收会话失效' })
    expect(revoke.status).toBe(201); expect((await request('/me', other.accessToken)).status).toBe(401)
    other = (await request<AuthSessionDto>('/auth/login', undefined, 'POST', { email: other.user.email, password })).data
    const input = { status: 'locked', reason: '隔离验收锁定账号', expectedRevision: other.user.revision }
    expect((await request(`/admin/users/${other.user.id}/status`, admin.accessToken, 'PATCH', input)).status).toBe(200)
    expect((await request(`/admin/users/${other.user.id}/status`, admin.accessToken, 'PATCH', { ...input, status: 'active' })).status).toBe(409)
    expect((await request('/me', other.accessToken)).status).toBe(401)
    expect(await db.refreshToken.count({ where: { userId: other.user.id, revokedAt: null } })).toBe(0)
  })
  it('锁前已读取旧凭证的 login/refresh 不能越过已提交的密码变更或撤销', async () => {
    const fresh = (await request<AuthSessionDto>('/auth/register', undefined, 'POST', registration('session-race'))).data
    const prisma = app.get(PrismaService), auth = app.get(AuthService), users = app.get(UsersService)
    const pauseTransaction = () => {
      let enter!: () => void, resume!: () => void
      const entered = new Promise<void>((r) => { enter = r }), continued = new Promise<void>((r) => { resume = r })
      const original = prisma.$transaction.bind(prisma)
      vi.spyOn(prisma, '$transaction').mockImplementationOnce(((callback: any, options: any) => { enter(); return continued.then(() => original(callback, options)) }) as any)
      return { entered, resume }
    }
    const loginGate = pauseTransaction()
    const loggingIn = auth.login(fresh.user.email, password, randomUUID(), 'isolated').then(() => 'created', () => 'denied')
    await loginGate.entered
    await db.user.update({ where: { id: fresh.user.id }, data: { passwordHash: await hash(`${password}New`, 4), sessionVersion: { increment: 1 } } })
    loginGate.resume()
    expect(await loggingIn).toBe('denied'); vi.restoreAllMocks()
    const session = await auth.login(fresh.user.email, `${password}New`, randomUUID(), 'isolated')
    const refreshGate = pauseTransaction()
    const refreshing = auth.refresh(session.refreshToken).then(() => 'created', () => 'denied')
    await refreshGate.entered
    await users.action(admin.user, fresh.user.id, 'revoke_sessions', '隔离屏障验证会话撤销')
    refreshGate.resume()
    expect(await refreshing).toBe('denied'); vi.restoreAllMocks()
    expect(await db.refreshToken.count({ where: { userId: fresh.user.id, revokedAt: null } })).toBe(0)
  })
  it('历史 JSON 引用保护文件，未引用对象可删除且非法 MIME 被拒绝', async () => {
    const storage = app.get<StorageService>(STORAGE_SERVICE)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
    const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png')
    const upload = await request('/community/media', actor.accessToken, 'POST', form)
    expect(upload.status).toBe(201)
    const id = upload.data.id
    const draft = await request('/community/drafts', actor.accessToken, 'POST', { ...postInput('文件历史', 'draft'), contentBlocks: [{ type: 'image', fileId: id, alt: '引用图片' }] })
    expect(draft.status).toBe(201)
    expect((await request(`/community/drafts/${draft.data.id}`, actor.accessToken, 'PATCH', { ...postInput('已移除图片', 'draft'), expectedRevision: draft.data.revision })).status).toBe(200)
    await expect(storage.delete(id)).rejects.toThrow()
    expect(await storage.exists(id)).toBe(true)
    expect((await request(`/community/drafts/${draft.data.id}`, actor.accessToken, 'DELETE')).status).toBe(200)
    expect((await request(`/admin/community/posts/${draft.data.id}`, admin.accessToken)).status).toBe(400)
    expect((await request(`/admin/community/post/${draft.data.id}/moderate`, admin.accessToken, 'POST', { action: 'restore', reason: '不得恢复从未发布的私密草稿' })).status).toBe(400)
    expect((await request(`/admin/files/${id}/url`, admin.accessToken)).status).toBe(404)
    expect((await request(`/admin/community/media/${id}`, admin.accessToken)).status).toBe(400)
    expect(JSON.stringify((await request('/admin/community/posts', admin.accessToken)).data).includes(draft.data.id)).toBe(false)
    const spare = await storage.upload({ originalname: 'unused.txt', mimetype: 'text/plain', size: 4, buffer: Buffer.from('safe') }, { uploadedBy: actor.user.id, visibility: 'private' })
    await storage.delete(spare.id); expect(await db.fileRecord.count({ where: { id: spare.id } })).toBe(0)
    await expect(storage.upload({ originalname: 'fake.png', mimetype: 'image/png', size: 4, buffer: Buffer.from('fake') }, { uploadedBy: actor.user.id, visibility: 'private' })).rejects.toThrow()
  })
  it('数据状态与维护真实可重复，bootstrap不覆盖已有用户与业务配置', async () => {
    const status = await request('/admin/persistence', admin.accessToken)
    expect(status.status).toBe(200); expect(status.data.database.ready).toBe(true); expect(status.data.storage.writable).toBe(true)
    const snapshot = async () => checksum({ users: await db.user.findMany({ orderBy: { id: 'asc' } }), settings: await db.systemSetting.findMany({ orderBy: { key: 'asc' } }), posts: await db.communityPost.findMany({ orderBy: { id: 'asc' } }) })
    const before = await snapshot()
    await bootstrapDatabase(db); await bootstrapDatabase(db)
    expect(await snapshot()).toBe(before)
    for (let i = 0; i < 2; i++) expect((await request('/admin/persistence/recount', admin.accessToken, 'POST', { reason: '隔离验收关系计数重算' })).status).toBe(201)
    expect((await request('/admin/persistence/recount', actor.accessToken, 'POST', { reason: '禁止越权维护操作' })).status).toBe(403)
  })
  it('完整持久化状态仅公开白名单字段，查看与维护权限分离且维护原因必填', async () => {
    const reader = await restrictedActor('status-reader', ['settings.read']), manager = await restrictedActor('status-manager', ['platform.manage'])
    const status = await request('/admin/persistence', reader.accessToken)
    expect(status.status).toBe(200); expect(Object.keys(status.data).sort()).toEqual(['counts', 'database', 'lastWriteAt', 'storage'])
    expect(Object.keys(status.data.database).sort()).toEqual(['connected', 'migrations', 'ready', 'type'])
    expect(status.data.database).toMatchObject({ connected: true, ready: true, type: 'PostgreSQL' })
    expect(status.data.database.migrations.length).toBeGreaterThan(0)
    for (const migration of status.data.database.migrations) {
      expect(Object.keys(migration).sort()).toEqual(['finishedAt', 'name'])
      expect(migration.name).toMatch(/^\d{14}_[a-z0-9_]+$/); expect(Number.isNaN(Date.parse(migration.finishedAt))).toBe(false)
    }
    expect(Object.keys(status.data.storage).sort()).toEqual(['driver', 'writable'])
    expect(status.data.storage).toEqual({ driver: process.env.STORAGE_DRIVER || 'local', writable: true })
    expect(status.data.counts).toEqual({
      users: await db.user.count(), posts: await db.communityPost.count({ where: { status: 'published', deletedAt: null } }),
      drafts: await db.communityPost.count({ where: { status: 'draft', deletedAt: null } }), comments: await db.communityComment.count({ where: { status: 'published', deletedAt: null } }),
      files: await db.fileRecord.count(), pendingReports: await db.communityReport.count({ where: { status: { in: ['pending', 'reviewing'] } } }),
    })
    expect(Number.isNaN(Date.parse(status.data.lastWriteAt))).toBe(false)
    expect(JSON.stringify(status.data)).not.toMatch(/DATABASE_URL|JWT|SMTP|password|token|secret|postgresql:\/\/|\/vol\d\/|\/Volumes\/|uploads\/|objectKey|endpoint/i)
    expect((await request('/admin/persistence', manager.accessToken)).status).toBe(403)
    expect((await request('/admin/persistence/recount', reader.accessToken, 'POST', { reason: '查看权限不得维护' })).status).toBe(403)
    const auditWhere = { actorId: manager.user.id, action: 'persistence_recount' }
    for (const body of [{}, { reason: '    ' }]) expect((await request('/admin/persistence/recount', manager.accessToken, 'POST', body)).status).toBe(400)
    expect(await db.auditLog.count({ where: auditWhere })).toBe(0)
    const reason = '隔离测试维护专用权限'
    expect((await request('/admin/persistence/recount', manager.accessToken, 'POST', { reason })).data).toEqual({ completed: true })
    const audits = await db.auditLog.findMany({ where: auditWhere })
    expect(audits).toHaveLength(1); expect(audits[0]).toMatchObject({ targetType: 'maintenance', targetId: 'recount', details: { reason } })
  })
  it('单项设置更新使旧批量版本失效，管理员社区资料更新使旧用户编辑失效', async () => {
    const rows = (await request('/admin/settings', admin.accessToken)).data as Array<{ key: string; value: unknown; revision: number }>
    const version = Number(rows.find((r) => r.key === 'settings_version')?.value || 0), name = rows.find((r) => r.key === 'platform_name')!
    expect((await request('/admin/settings', admin.accessToken, 'PATCH', { key: name.key, value: name.value, expectedRevision: name.revision })).status).toBe(200)
    expect((await request('/admin/settings/batch', admin.accessToken, 'PATCH', { version: version + 1, items: [{ key: name.key, value: '过期批量值' }] })).status).toBe(409)
    const profile = (await request(`/community/users/${actor.user.id}`, actor.accessToken)).data
    expect((await request(`/admin/community/official/${actor.user.id}`, admin.accessToken, 'PATCH', { verifiedType: 'none', expertiseTopics: ['有效方向'], reason: '隔离测试资料修订', expectedRevision: profile.revision })).status).toBe(200)
    expect((await request('/community/profile', actor.accessToken, 'PATCH', { displayName: profile.displayName, bio: '', headline: '', location: '', websiteUrl: '', expertiseTopics: [], allowAchievementDrafts: false, expectedUserRevision: profile.userRevision, expectedProfileRevision: profile.revision })).status).toBe(409)
  })
})
