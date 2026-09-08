import 'reflect-metadata'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { NestFactory, Reflector } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import sharp from 'sharp'
import { contentDetectionFields, type ContentDetectionPolicy, type ContentDetectionRule } from '@ai-learning-hub/contracts'

// 仅在飞牛专属空库运行；不允许把测试指向现行业务库或扩大现有E2E范围。
const database = new URL(process.env.DATABASE_URL || 'file:///missing')
if (database.hostname !== '127.0.0.1' || database.port !== '55439' || database.pathname !== '/community_content_detection') throw new Error('只允许专属隔离内容检测数据库')
const runtime = createRequire(`${process.cwd()}/test/content-detection.e2e.spec.ts`)
const { AppModule } = runtime('../dist/app.module.js')
const { ApiExceptionFilter } = runtime('../dist/common/api-exception.filter.js')
const { ApiResponseInterceptor } = runtime('../dist/common/api-response.interceptor.js')
const { OperationLogInterceptor } = runtime('../dist/common/operation-log.interceptor.js')
const { appValidationPipe } = runtime('../dist/common/validation.pipe.js')
const { PersistenceService } = runtime('../dist/modules/persistence/persistence.service.js')
const { bootstrapDatabase } = runtime('../dist/modules/persistence/bootstrap.js')
const { encryptIdentity } = runtime('../dist/modules/users/identity-data.js')
const { runMediaCommand } = runtime('../dist/modules/resources/video-processing.service.js')
const db = new PrismaClient(), password = `Synthetic7${randomBytes(16).toString('hex')}`, identityKey = randomBytes(32)
const rules: ContentDetectionRule[] = [
  { id: 'synthetic-warn', content: '合成提示', method: 'literal', fields: [...contentDetectionFields], category: 'school', action: 'warn', enabled: true, explanation: '合成提示，请确认上下文。' },
  { id: 'synthetic-review', content: '合成待审', method: 'literal', fields: [...contentDetectionFields], category: 'school', action: 'review', enabled: true, explanation: '合成待审样本，需要人工复核。' },
  { id: 'synthetic-reject', content: '合成拒绝', method: 'literal', fields: [...contentDetectionFields], category: 'school', action: 'reject', enabled: true, explanation: '合成拒绝样本，请修改。' },
]
let app: INestApplication, base: string, admin: string, student: { id: string; token: string }, viewer: { id: string; token: string }, passwordHash: string
async function request(path: string, token?: string, method = 'GET', input?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) })
  return { status: response.status, ...await response.json() }
}
const postInput = (text: string, extra = {}) => ({ type: 'general', title: '合成课程讨论', contentBlocks: [{ type: 'paragraph', text }], bindings: [], topicIds: [], visibility: 'public', status: 'published', ...extra })
async function account() {
  const key = randomUUID(), role = await db.role.findUniqueOrThrow({ where: { code: 'student' } })
  const user = await db.user.create({ data: {
    username: `synthetic_${key.replaceAll('-', '').slice(0, 16)}`, email: `${key}@example.invalid`, displayName: '合成学习者', passwordHash,
    communityProfile: { create: {} }, userRoles: { create: { roleId: role.id } },
    identityVerification: { create: { realNameEncrypted: encryptIdentity('合成测试', identityKey, 'real-name'), idNumberEncrypted: encryptIdentity('000000000000000000', identityKey, 'id-number'), idNumberFingerprint: key, idNumberLast4: '0000', className: '合成测试班', studentNo: key, status: 'approved' } },
  } })
  const login = await request('/auth/login', undefined, 'POST', { identifier: user.email, password })
  expect(login.status).toBe(201)
  return { id: user.id, token: login.data.accessToken as string }
}
async function review(type: string, id: string) {
  return db.contentReview.findFirstOrThrow({ where: { targetType: type, targetId: id, status: 'pending' }, orderBy: { contentRevision: 'desc' } })
}
async function decide(row: Awaited<ReturnType<typeof review>>, action: 'approve' | 'reject' = 'approve') {
  return request(`/admin/community/content-reviews/${row.id}/decision`, admin, 'POST', { expectedRevision: row.contentRevision, ruleVersion: row.ruleVersion, action, reason: '已核对合成教学样本，仅适用本修订。' })
}
async function upload(path: string, bytes: Uint8Array, mime: string, name: string) {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${student.token}` }, body: form })
  expect(response.status).toBe(201)
  return (await response.json()).data.id as string
}
async function mediaStatus(path: string, token?: string) {
  const response = await fetch(`${new URL(base).origin}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  await response.arrayBuffer()
  return response.status
}
beforeAll(async () => {
  if (await db.user.count()) throw new Error('测试要求空库，禁止覆盖现有账号')
  Object.assign(process.env, { SEED_ADMIN_EMAIL: 'synthetic-admin@example.invalid', SEED_ADMIN_PASSWORD: password, IDENTITY_DATA_KEY: identityKey.toString('hex') })
  await bootstrapDatabase(db)
  passwordHash = await hash(password, 10)
  app = await NestFactory.create(AppModule, { logger: false })
  await app.get<InstanceType<typeof PersistenceService>>(PersistenceService).preflight()
  app.setGlobalPrefix('api/v1'); app.use(cookieParser())
  app.useGlobalPipes(appValidationPipe)
  app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(app.get(OperationLogInterceptor), new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1`
  const login = await request('/auth/login', undefined, 'POST', { identifier: process.env.SEED_ADMIN_EMAIL, password })
  expect(login.status).toBe(201); admin = login.data.accessToken
  const configured = await request('/admin/community/content-policy', admin, 'PATCH', { expectedVersion: 1, rules, reason: '隔离库合成规则验证' })
  expect(configured.status).toBe(200)
  viewer = await account()
}, 30000)
beforeEach(async () => { student = await account() })
afterAll(async () => { await app?.close(); await db.$disconnect() })

describe('内容检测增量真实HTTP与数据库验收', () => {
  it('资源富文本真实发布：文件落库、格式净化、幂等、待审隔离与拒绝保留', async () => {
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ff552d' } }).png().toBuffer()
    const fileId = await upload('/community/media', image, 'image/png', 'synthetic-rich.png')
    const input = postInput('unused', {
      title: '合成图文课程实践', type: 'frontier_discussion',
      contribution: { kind: 'article', tags: ['课堂实践'], teachingReuseConsent: false },
      contentBlocks: [{ type: 'rich_text', text: '<h2>学习背景</h2><p onclick="alert(1)"><strong>实践结论</strong></p>' }, { type: 'image', fileId, alt: '合成实验截图' }, { type: 'rich_text', text: '<p>图片后的说明</p>' }],
    })
    const key = randomUUID()
    const send = async () => {
      const response = await fetch(`${base}/community/posts`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${student.token}`, 'idempotency-key': key }, body: JSON.stringify(input) })
      expect(response.status).toBe(201)
      return (await response.json()).data
    }
    const created = await send()
    expect((await send()).id).toBe(created.id)
    expect(created.contentBlocks[0].text).toBe('<h2>学习背景</h2><p><strong>实践结论</strong></p>')
    const persisted = await db.communityPost.findUniqueOrThrow({ where: { id: created.id }, include: { contribution: true } })
    expect(persisted.contribution?.kind).toBe('article')
    expect(persisted.contentBlocks).toEqual(created.contentBlocks)
    expect(JSON.stringify(persisted.contentBlocks)).not.toContain('blob:')
    expect(await db.fileRecord.findUnique({ where: { id: fileId } })).toMatchObject({ uploadedBy: student.id, mimeType: 'image/png' })
    const imageUrl = await request(`/community/media/${fileId}/url`, viewer.token)
    expect(imageUrl.status).toBe(200)
    expect(await mediaStatus(imageUrl.data.url, viewer.token)).toBe(200)
    expect((await request(`/community/posts/${created.id}`, viewer.token)).data.contentBlocks).toEqual(created.contentBlocks)
    const pending = await request(`/community/posts/${created.id}`, student.token, 'PATCH', { ...input, expectedRevision: created.revision, contentBlocks: [{ type: 'rich_text', text: '<p>合成<strong>待审</strong>：请复核</p>' }, input.contentBlocks[1]] })
    expect(pending.data.status).toBe('pending_review')
    expect((await request(`/community/posts/${created.id}`, viewer.token)).status).toBe(404)
    expect((await decide(await review('post', created.id))).status).toBe(201)
    const approved = await request(`/community/posts/${created.id}`, student.token)
    const rejected = await request(`/community/posts/${created.id}`, student.token, 'PATCH', { ...input, expectedRevision: approved.data.revision, contentBlocks: [{ type: 'rich_text', text: '<p>合成<strong>拒绝</strong></p>' }] })
    expect(rejected.status).toBe(400)
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: created.id } })).revision).toBe(approved.data.revision)
    const foreign = await request('/community/posts', viewer.token, 'POST', input)
    expect(foreign.status).toBe(400)
  })
  it('allow/warn/reject保留原文，拒绝编辑回滚原投稿和复核记录', async () => {
    const created = await request('/community/posts', student.token, 'POST', postInput('LLM、RAG 与 Transformer 正常教程'))
    expect(created.status).toBe(201); expect(created.data.detection.action).toBe('allow')
    const warned = await request(`/community/posts/${created.data.id}`, student.token, 'PATCH', postInput('合成提示：引用课堂案例', { expectedRevision: created.data.revision }))
    expect(warned.status).toBe(200); expect(warned.data.detection.action).toBe('warn')
    const count = await db.contentReview.count({ where: { targetId: created.data.id } })
    const rejected = await request(`/community/posts/${created.data.id}`, student.token, 'PATCH', postInput('合成拒绝：输入仍留在客户端', { expectedRevision: warned.data.revision }))
    expect(rejected.status).toBe(400); expect(rejected.errorCode).toBe('CONTENT_REJECTED')
    expect(await db.communityPost.findUnique({ where: { id: created.data.id } })).toMatchObject({ status: 'published', revision: warned.data.revision, plainText: '合成提示：引用课堂案例' })
    expect(await db.contentReview.count({ where: { targetId: created.data.id } })).toBe(count)
  })

  it('待审整条退出公开读取，旧修订不可审批，并发复核只成功一次', async () => {
    const created = await request('/community/posts', student.token, 'POST', postInput('已发布的合成课堂案例'))
    const pending = await request(`/community/posts/${created.data.id}`, student.token, 'PATCH', postInput('合成待审：第一修订', { expectedRevision: created.data.revision }))
    expect(pending.status).toBe(200); expect(pending.data.status).toBe('pending_review')
    const old = await review('post', created.data.id)
    expect((await request(`/community/posts/${created.data.id}`, viewer.token)).status).toBe(404)
    expect((await request(`/community/posts/${created.data.id}`, student.token)).status).toBe(200)
    for (const path of ['/community/posts', `/community/users/${student.id}/posts`, '/community/search?type=posts&q=合成待审']) {
      const result = await request(path, viewer.token)
      expect(result.status).toBe(200); expect(JSON.stringify(result.data)).not.toContain(created.data.id)
    }
    const revised = await request(`/community/posts/${created.data.id}`, student.token, 'PATCH', postInput('合成待审：第二修订', { expectedRevision: pending.data.revision }))
    expect(revised.status).toBe(200); expect((await decide(old)).status).toBe(409)
    const current = await review('post', created.data.id)
    const results = await Promise.all([decide(current), decide(current)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect((await request(`/community/posts/${created.data.id}`, viewer.token)).status).toBe(200)
    expect(await db.communityModerationAction.count({ where: { targetId: created.data.id, action: 'content_review_approved' } })).toBe(1)
    expect(await db.userNotification.count({ where: { recipientId: student.id, entityType: 'content_review', entityId: current.id } })).toBe(1)
    const notices = await request('/community/notifications', student.token)
    expect(JSON.stringify(notices.data)).toContain('已通过复核')
    expect(JSON.stringify((await request('/community/notifications', viewer.token)).data)).not.toContain(current.id)
  })

  it('待审评论不公开且不计数，通过后才通知与计数', async () => {
    const post = await request('/community/posts', viewer.token, 'POST', postInput('评论用的合成公开教程'))
    const saved = await request(`/community/posts/${post.data.id}/comments`, student.token, 'POST', { contentBlocks: [{ type: 'paragraph', text: '合成待审：课堂评论' }] })
    expect(saved.status).toBe(201); expect(saved.data.status).toBe('pending_review')
    expect(JSON.stringify((await request(`/community/posts/${post.data.id}/comments`, viewer.token)).data)).not.toContain(saved.data.id)
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.data.id } })).commentCount).toBe(0)
    expect((await decide(await review('comment', saved.data.id))).status).toBe(201)
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: post.data.id } })).commentCount).toBe(1)
    expect(JSON.stringify((await request(`/community/posts/${post.data.id}/comments`, viewer.token)).data)).toContain(saved.data.id)
  })

  it('恢复入口增量：帖子和评论隐藏后重检，不能通过恢复绕过修订复核', async () => {
    const parent = await request('/community/posts', student.token, 'POST', postInput('合成普通教程'))
    expect(parent.status).toBe(201)
    const post = await request('/community/posts', student.token, 'POST', postInput('合成待审恢复案例'))
    const comment = await request(`/community/posts/${parent.data.id}/comments`, student.token, 'POST', { contentBlocks: [{ type: 'paragraph', text: '合成待审恢复案例' }] })
    expect(post.status).toBe(201); expect(comment.status).toBe(201)
    for (const [target, id] of [['post', post.data.id], ['comment', comment.data.id]] as const) {
      const old = await review(target, id)
      const path = `/admin/community/${target}/${id}/moderate`
      expect((await request(path, admin, 'POST', { action: 'hide', reason: '旧入口不能绕过治理依据' })).status).toBe(400)
      // 模拟升级前已经隐藏的历史行；新增下架已由治理E2E验证。
      if (target === 'post') await db.communityPost.update({ where: { id }, data: { status: 'hidden', revision: { increment: 1 } } })
      else await db.communityComment.update({ where: { id }, data: { status: 'hidden', revision: { increment: 1 } } })
      const restored = await request(path, admin, 'POST', { action: 'restore', reason: '重检合成待审案例' })
      expect(restored.status).toBe(201)
      expect(restored.data.detection.action).toBe('review')
      const latest = await review(target, id)
      expect(latest.contentRevision).toBe(old.contentRevision + 2)
      expect((await decide(old)).status).toBe(409)
      expect((await request(path, admin, 'POST', { action: 'restore', reason: '尝试重复直接恢复' })).status).toBe(409)
      if (target === 'post') expect((await request(`/community/posts/${id}`, viewer.token)).status).toBe(404)
      else {
        expect(JSON.stringify((await request(`/community/posts/${parent.data.id}/comments`, viewer.token)).data)).not.toContain(id)
        expect((await db.communityPost.findUniqueOrThrow({ where: { id: parent.data.id } })).commentCount).toBe(0)
      }
      expect((await decide(latest)).status).toBe(201)
    }
  })

  it('公开资料保留旧值，合集待审不公开，驳回不伪装发布成功', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: student.id }, include: { communityProfile: true } })
    const saved = await request('/community/profile', student.token, 'PATCH', { expectedUserRevision: user.revision, expectedProfileRevision: user.communityProfile!.revision, displayName: '合成待审', bio: '合成个人简介', headline: '', location: '', websiteUrl: '', expertiseTopics: [], allowAchievementDrafts: true })
    expect(saved.status).toBe(200)
    expect((await db.user.findUniqueOrThrow({ where: { id: student.id } })).displayName).toBe('合成学习者')
    expect(JSON.stringify((await request(`/community/users/${student.id}`, viewer.token)).data)).not.toContain('合成待审')
    expect((await decide(await review('profile', student.id))).status).toBe(201)
    expect((await db.user.findUniqueOrThrow({ where: { id: student.id } })).displayName).toBe('合成待审')
    const collection = await request('/resource-hub/collections', student.token, 'POST', { name: '合成待审合集', description: '合成说明', visibility: 'community', learningGoal: '' })
    expect(collection.status).toBe(201); expect(collection.data.contentStatus).toBe('pending_review')
    expect((await request(`/resource-hub/collections/${collection.data.id}`, viewer.token)).status).toBe(404)
    expect((await decide(await review('collection', collection.data.id), 'reject')).status).toBe(201)
    expect((await db.learningCollection.findUniqueOrThrow({ where: { id: collection.data.id } })).contentStatus).toBe('pending_review')
    expect(JSON.stringify((await request('/community/notifications', student.token)).data)).toContain('尚未公开')
  })

  it('资料入口增量：首次引导保留待审昵称，缺失必填文本拒绝且旧复核不能放行', async () => {
    const original = await db.user.findUniqueOrThrow({ where: { id: student.id } })
    const saved = await request('/me', student.token, 'PATCH', { expectedRevision: original.revision, displayName: '合成待审昵称' })
    expect(saved.status).toBe(200)
    expect(saved.data.contentDetection.action).toBe('review')
    const old = await review('profile', student.id)
    const current = await db.user.findUniqueOrThrow({ where: { id: student.id }, include: { communityProfile: true } })
    expect((await request('/me', student.token, 'PATCH', { expectedRevision: current.revision })).status).toBe(400)
    expect((await db.user.findUniqueOrThrow({ where: { id: student.id } })).revision).toBe(current.revision)
    expect((await review('profile', student.id)).id).toBe(old.id)
    const themes = await Promise.all([1, 2, 3].map((index) => db.theme.create({ data: { slug: `synthetic-onboarding-${index}-${randomUUID()}`, title: `合成学习方向${index}`, summary: '合成引导测试数据', status: 'published' } })))
    const onboarding = await request('/community/onboarding', student.token, 'POST', { expectedRevision: current.revision, expectedProfileRevision: current.communityProfile!.revision, major: '合成专业', grade: '合成年级', headline: '学习 AI Agent', themeIds: themes.map((theme) => theme.id) })
    expect(onboarding.status).toBe(201)
    const latest = await review('profile', student.id)
    expect(latest.contentRevision).toBe(old.contentRevision + 1)
    expect(latest.payload).toMatchObject({ changes: { displayName: '合成待审昵称', headline: '学习 AI Agent' }, userRevision: current.revision + 1 })
    expect(JSON.stringify((await request(`/community/users/${student.id}`, viewer.token)).data)).not.toContain('合成待审昵称')
    expect((await decide(old)).status).toBe(409)
    expect((await decide(latest)).status).toBe(201)
    expect((await db.user.findUniqueOrThrow({ where: { id: student.id } })).displayName).toBe('合成待审昵称')
  })

  it('规则版本变更拦截旧审核，回退新建版本且普通学生不能配置或试跑', async () => {
    const saved = await request('/community/posts', student.token, 'POST', postInput('合成待审：规则版本案例'))
    expect(saved.status).toBe(201)
    const old = await review('post', saved.data.id)
    const current: ContentDetectionPolicy = (await request('/admin/community/content-policy', admin)).data
    expect((await request('/admin/community/content-policy', student.token, 'PATCH', { expectedVersion: current.version, rules: [], reason: '无权限合成测试' })).status).toBe(403)
    expect((await request('/admin/community/content-policy/trial', student.token, 'POST', { fields: { postBody: '合成待审' } })).status).toBe(403)
    const trial = await request('/admin/community/content-policy/trial', admin, 'POST', { fields: { postBody: '合成待\u200b审' } })
    expect(trial.data).toMatchObject({ action: 'review', mediaReview: 'not_performed', saved: false })
    const changed = await request('/admin/community/content-policy', admin, 'PATCH', { expectedVersion: current.version, rules, reason: '合成规则版本更新' })
    expect(changed.status).toBe(200); expect((await decide(old)).status).toBe(409)
    const rollback = await request('/admin/community/content-policy', admin, 'PATCH', { expectedVersion: changed.data.version, rollbackVersion: current.version, reason: '合成规则回退验证' })
    expect(rollback.status).toBe(200); expect(rollback.data.version).toBe(current.version + 2)
    expect(rollback.data.rules).toEqual(current.rules)
    const history = (await request('/admin/community/content-policy/history', admin)).data as ContentDetectionPolicy[]
    expect(history.find((entry) => entry.version === current.version)?.rules).toEqual(current.rules)
  })

  it('资源媒体增量：后台编辑标签触发待审，旧图片附件地址撤回，作者和审核员仍可预览', async () => {
    const cover = await upload('/community/media', await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer(), 'image/png', 'synthetic.png')
    const attachment = await upload('/resource-hub/uploads/document', new TextEncoder().encode('合成课程附件，不包含个人资料。'), 'text/plain', 'synthetic.txt')
    const contribution = { kind: 'document', tags: ['合成教程'], teachingReuseConsent: false, attachmentFileId: attachment, coverFileId: cover }
    const input = postInput('合成资源正文', { contribution, contentBlocks: [{ type: 'paragraph', text: '合成资源正文' }, { type: 'image', fileId: cover, alt: '合成白色测试图片' }] })
    const created = await request('/community/posts', student.token, 'POST', input)
    expect(created.status).toBe(201)
    const old = (await request(`/resource-hub/contributions/${created.data.id}`, viewer.token)).data.contribution
    const direct = (await request(`/community/media/${cover}/url`, viewer.token)).data.url
    expect(await mediaStatus(old.coverUrl)).toBe(200)
    expect(await mediaStatus(old.attachment.downloadUrl)).toBe(200)
    expect(await mediaStatus(direct, viewer.token)).toBe(200)
    const edited = await request(`/admin/community/posts/${created.data.id}`, admin, 'PATCH', { ...input, expectedRevision: created.data.revision, contribution: { ...contribution, tags: ['合成待审'] }, reason: '后台代编辑合成标签' })
    expect(edited.status).toBe(200); expect(edited.data.detection.action).toBe('review')
    expect(edited.data.detection.hits.some((hit: { field: string }) => hit.field === 'resourceTags')).toBe(true)
    expect(await mediaStatus(old.coverUrl)).toBe(404)
    expect(await mediaStatus(old.attachment.downloadUrl)).toBe(404)
    expect(await mediaStatus(direct, viewer.token)).toBe(404)
    const own = (await request(`/resource-hub/contributions/${created.data.id}`, student.token)).data.contribution
    expect(await mediaStatus(own.coverUrl)).toBe(200)
    expect(await mediaStatus(own.attachment.downloadUrl)).toBe(200)
    const items = await request('/admin/resource-hub/items', admin)
    expect(items.status).toBe(200)
    const adminItem = items.data.find((item: { postId: string }) => item.postId === created.data.id)
    expect(await mediaStatus(adminItem.coverUrl)).toBe(200)
    expect(await db.auditLog.count({ where: { action: 'restricted_content_read', targetType: 'resource_media', targetId: cover } })).toBeGreaterThan(0)
    const draft = await request('/community/posts', student.token, 'POST', { ...input, status: 'draft' })
    expect(draft.status).toBe(201)
    expect(JSON.stringify((await request('/admin/resource-hub/items', admin)).data)).not.toContain(draft.data.id)
    const category = await request('/admin/resource-hub/categories', admin, 'POST', { code: `synthetic-${randomUUID().slice(0, 8)}`, name: '合成测试分类', description: '', icon: 'resource', active: true, sortOrder: 0 })
    expect(category.status).toBe(201)
    const attributes = { categoryId: category.data.id, featured: false, liveReplay: false, reason: '合成属性调整' }
    const draftBefore = await db.resourceContribution.findUniqueOrThrow({ where: { postId: draft.data.id } })
    expect((await request(`/admin/resource-hub/items/${draft.data.id}`, admin, 'PATCH', attributes)).status).toBe(404)
    expect(await db.resourceContribution.findUniqueOrThrow({ where: { postId: draft.data.id } })).toEqual(draftBefore)
    expect((await request(`/admin/resource-hub/items/${created.data.id}`, admin, 'PATCH', attributes)).status).toBe(200)
    expect((await decide(await review('post', created.data.id))).status).toBe(201)
    expect(await mediaStatus(old.attachment.downloadUrl)).toBe(200)
  })

  it('视频增量：真实上传处理与范围播放，待审撤回旧播放地址且预览不记进度', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aihub-content-video-'))
    let assetId: string
    try {
      const path = join(directory, 'synthetic.mp4')
      await runMediaCommand(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=32x32:r=10', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path])
      assetId = await upload('/resource-hub/uploads/video', await readFile(path), 'video/mp4', 'synthetic.mp4')
    } finally { await rm(directory, { recursive: true, force: true }) }
    // 上传接口自动启动正式处理器；只轮询这一已创建任务，不重试上传或手工伪造ready。
    const deadline = Date.now() + 20000
    let video = await request(`/resource-hub/videos/${assetId}`, student.token)
    while (video.status === 200 && !['ready', 'failed'].includes(video.data.status) && Date.now() < deadline) {
      await delay(100)
      video = await request(`/resource-hub/videos/${assetId}`, student.token)
    }
    expect(video.status).toBe(200); expect(video.data).toMatchObject({ status: 'ready', durationSeconds: 1 })
    const contribution = { kind: 'video', tags: ['合成教程'], teachingReuseConsent: false, videoAssetId: assetId }
    const input = postInput('合成视频课程', { contribution })
    const created = await request('/community/posts', student.token, 'POST', input)
    expect(created.status).toBe(201)
    const playback = await request(`/resource-hub/videos/${assetId}/playback`, viewer.token)
    expect(playback.status).toBe(200)
    const old = playback.data.sources[0].src
    const range = await fetch(new URL(old, base), { headers: { range: 'bytes=0-15' } })
    expect(range.status).toBe(206); expect((await range.arrayBuffer()).byteLength).toBe(16)
    expect(range.headers.get('cache-control')).toBe('private, no-store')
    const pending = await request(`/community/posts/${created.data.id}`, student.token, 'PATCH', { ...input, expectedRevision: created.data.revision, contribution: { ...contribution, tags: ['合成待审'] } })
    expect(pending.status).toBe(200); expect(pending.data.status).toBe('pending_review')
    expect(await mediaStatus(old)).toBe(404)
    expect((await request(`/resource-hub/videos/${assetId}/playback`, viewer.token)).status).toBe(404)
    const own = await request(`/resource-hub/videos/${assetId}/playback`, student.token)
    expect(own.status).toBe(200); expect(await mediaStatus(own.data.sources[0].src)).toBe(200)
    const preview = await request(`/resource-hub/videos/${assetId}/playback`, admin)
    expect(preview.status).toBe(200); expect(await mediaStatus(preview.data.sources[0].src)).toBe(200)
    expect((await request(`/resource-hub/videos/${assetId}/progress`, student.token, 'PUT', { positionSeconds: 1, watchedSeconds: 1, completed: true, eventKey: randomUUID() })).status).toBe(404)
    expect((await decide(await review('post', created.data.id))).status).toBe(201)
    expect(await mediaStatus(old)).toBe(200)
  })

  it('传统资源增量：真实发布快照待审隔离，通过后才公开且不泄露后续草稿', async () => {
    const slug = `synthetic-${randomUUID()}`
    const created = await request('/admin/resources', admin, 'POST', { slug, title: '合成待审资源', summary: '合成课程说明', category: '合成分类', format: 'txt', visibility: 'public', tags: ['合成标签'] })
    expect(created.status).toBe(201)
    const resourceId = created.data.databaseId
    expect(resourceId).toBeTruthy()
    const pending = await request(`/admin/resources/${resourceId}/publish`, admin, 'POST')
    expect(pending.status).toBe(201); expect(pending.data.status).toBe('reviewing')
    expect((await request(`/resources/${slug}`)).status).toBe(404)
    expect(JSON.stringify((await request('/resources')).data)).not.toContain(slug)
    expect((await decide(await review('resource', resourceId))).status).toBe(201)
    expect((await request(`/resources/${slug}`)).data.title).toBe('合成待审资源')
    const changed = await request(`/admin/resources/${resourceId}`, admin, 'PATCH', { title: '合成拒绝草稿', summary: '合成拒绝说明' })
    expect(changed.status).toBe(200)
    expect((await request(`/resources/${slug}`)).data.title).toBe('合成待审资源')
    expect((await request(`/admin/resources/${resourceId}/publish`, admin, 'POST')).status).toBe(400)
    expect((await request(`/resources/${slug}`)).data.title).toBe('合成待审资源')
  })
})
