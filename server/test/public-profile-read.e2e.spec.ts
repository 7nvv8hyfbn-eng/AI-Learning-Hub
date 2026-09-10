import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { NestFactory, Reflector } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import sharp from 'sharp'
import { communityOperations } from '@ai-learning-hub/contracts'

const database = new URL(process.env.DATABASE_URL || 'file:///missing')
if (process.env.PUBLIC_READ_ISOLATED !== 'true' || database.hostname !== '127.0.0.1' || database.port !== '55439' || database.pathname !== '/public_profile_read_test') throw new Error('仅允许飞牛专属 public_profile_read_test 隔离空库')
const runtime = createRequire(process.cwd() + '/test/public-profile-read.e2e.spec.ts')
const { AppModule } = runtime('../dist/app.module.js')
const { browserBoundary } = runtime('../dist/common/deployment-security.js')
const { appValidationPipe } = runtime('../dist/common/validation.pipe.js')
const { ApiExceptionFilter } = runtime('../dist/common/api-exception.filter.js')
const { ApiResponseInterceptor } = runtime('../dist/common/api-response.interceptor.js')
const { OperationLogInterceptor } = runtime('../dist/common/operation-log.interceptor.js')
const { bootstrapDatabase } = runtime('../dist/modules/persistence/bootstrap.js')
const { encryptIdentity } = runtime('../dist/modules/users/identity-data.js')
const { runMediaCommand } = runtime('../dist/modules/resources/video-processing.service.js')
const db = new PrismaClient(), password = 'ReadOnly8!' + randomBytes(16).toString('hex')
const origin = 'http://127.0.0.1:8088', adminOrigin = 'http://127.0.0.1:8089'
type Actor = { id: string; username: string; token: string }
let app: INestApplication, base: string, storage: string, passwordHash: string
let a: Actor, b: Actor, admin: Actor, reader: Actor, postId: string, commentId: string, topicId: string, collectionId: string, videoId: string, videoPostId: string, image: Buffer
const input = (extra: object = {}) => ({ type: 'general', title: '只读权限验收', contentBlocks: [{ type: 'paragraph', text: '合成学习记录，用于验证正常投稿与只读边界。' }], bindings: [], topicIds: [], visibility: 'public', status: 'published', ...extra })
async function request(path: string, actor?: Actor, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, headers: { origin: path.startsWith('/admin') ? adminOrigin : origin, ...(actor ? { authorization: 'Bearer ' + actor.token } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(['GET', 'HEAD'].includes(method) ? {} : { 'idempotency-key': randomUUID() }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, data: envelope.data, errorCode: envelope.errorCode, message: envelope.message, nextAction: envelope.nextAction }
}
async function account(role = 'student', approved = false): Promise<Actor> {
  const key = Buffer.from(process.env.IDENTITY_DATA_KEY!, 'hex'), unique = randomUUID()
  const user = await db.user.create({ data: { username: 'read_' + unique.slice(0, 8), displayName: approved ? '娃娃' : '未认证同学', email: unique + '@example.invalid', passwordHash, emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), communityProfile: { create: { bio: '公开简介' } }, userRoles: { create: { role: { connect: { code: role } } } }, ...(approved ? { identityVerification: { create: { status: 'approved', realNameEncrypted: encryptIdentity('合成隐私姓名', key, 'real-name'), idNumberEncrypted: encryptIdentity('11010519491231002X', key, 'id-number'), idNumberFingerprint: unique, idNumberLast4: '002X', className: '隐私班级', studentNo: unique, reviewReason: '合成审核意见', reviewedAt: new Date() } } } : {}) } })
  let result = await request(role === 'student' ? '/auth/login' : '/admin-auth/login', undefined, 'POST', { identifier: user.username, password })
  expect(result.status, result.message).toBe(201)
  if (role !== 'student') {
    const hint = await request('/admin-auth/mfa-hint', undefined, 'POST', { challenge: result.data.challenge })
    result = await request('/admin-auth/mfa', undefined, 'POST', { challenge: result.data.challenge, code: hint.data.code })
    expect(result.status, result.message).toBe(201)
  }
  return { id: user.id, username: user.username, token: result.data.accessToken }
}
const multipart = (bytes: Uint8Array, type: string, name: string) => { const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)], { type }), name); return form }
const privateKeys = ['realName', 'maskedRealName', 'realNameEncrypted', 'idNumber', 'idNumberEncrypted', 'maskedIdNumber', 'studentNo', 'className', 'reviewReason', 'reviewedBy', 'reviewedAt', 'submittedAt', 'registrationSource', 'email', 'phone', 'identityVerification', 'CampusIdentityVerification', 'roles', 'permissions', 'passwordHash', 'loginLogs']
function publicOnly(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const key of privateKeys) expect(serialized).not.toContain(`"${key}":`)
  for (const secret of ['合成隐私姓名', '隐私班级', '合成审核意见', '11010519491231002X']) expect(serialized).not.toContain(secret)
}
beforeAll(async () => {
  if (await db.user.count()) throw new Error('禁止在现行业务库运行')
  storage = await mkdtemp(join(tmpdir(), 'public-profile-read-'))
  Object.assign(process.env, { DEPLOYMENT_PROFILE: 'experience', LOAD_DEMO_DATA: 'false', COMMUNITY_STARTER_PACK: 'none', COOKIE_SECURE: 'false', FRONTEND_URL: origin, ADMIN_WEB_URL: adminOrigin, CORS_ORIGINS: origin + ',' + adminOrigin, ADMIN_NETWORK_CIDRS: '127.0.0.1/32,::1/128', TRUSTED_PROXY_CIDRS: '', EXTERNAL_PROXY_CIDRS: '', JWT_SECRET: randomBytes(48).toString('hex'), MFA_DATA_KEY: randomBytes(32).toString('hex'), IDENTITY_DATA_KEY: randomBytes(32).toString('hex'), VIDEO_PLAYBACK_SECRET: randomBytes(48).toString('hex'), STORAGE_DRIVER: 'local', STORAGE_LOCAL_PATH: storage, SEED_ADMIN_EMAIL: 'public-read-admin@example.invalid', SEED_ADMIN_PASSWORD: password })
  await bootstrapDatabase(db); passwordHash = await hash(password, 4)
  await db.role.create({ data: { code: 'public_read_admin', name: '无实名读取权限', permissions: { create: { permission: { connect: { code: 'user.read' } } } } } })
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
  app.use(cookieParser()); app.use(browserBoundary(app.get(ConfigService))); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(appValidationPipe)
  app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(app.get(OperationLogInterceptor), new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1'); base = await app.getUrl() + '/api/v1'
  a = await account('student', true); b = await account(); admin = await account('super_admin'); reader = await account('public_read_admin')
  const post = await request('/community/posts', a, 'POST', input()); expect(post.status, post.message).toBe(201); postId = post.data.id
  const comment = await request(`/community/posts/${postId}/comments`, a, 'POST', { contentBlocks: [{ type: 'paragraph', text: '公开评论可以正常阅读。' }] }); expect(comment.status, comment.message).toBe(201); commentId = comment.data.id
  topicId = (await db.communityTopic.create({ data: { slug: 'public-read-topic', name: '只读学习话题' } })).id
  const tutorial = await request('/community/posts', a, 'POST', input({ contribution: { kind: 'article', tags: [], teachingReuseConsent: false } })); expect(tutorial.status, tutorial.message).toBe(201)
  const collection = await request('/resource-hub/collections', a, 'POST', { name: '公开学习合集', visibility: 'community', description: '合成公开内容' }); expect(collection.status, collection.message).toBe(201); collectionId = collection.data.id
  expect((await request(`/resource-hub/collections/${collectionId}/items`, a, 'POST', { postId: tutorial.data.id })).status).toBe(201)
  image = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#44aabb' } }).png().toBuffer()
  const clip = join(storage, 'synthetic.mp4')
  await runMediaCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip])
  const uploaded = await request('/resource-hub/uploads/video', a, 'POST', multipart(await readFile(clip), 'video/mp4', 'synthetic.mp4')); expect(uploaded.status, uploaded.message).toBe(201); videoId = uploaded.data.id
  for (let i = 0; i < 100; i++) { const state = (await request(`/resource-hub/videos/${videoId}`, a)).data; if (state.status === 'ready') break; expect(state.status).not.toBe('failed'); await delay(300) }
  expect((await request(`/resource-hub/videos/${videoId}`, a)).data.status).toBe('ready')
  const video = await request('/community/posts', a, 'POST', input({ contribution: { kind: 'video', videoAssetId: videoId, tags: [], teachingReuseConsent: false } })); expect(video.status, video.message).toBe(201); videoPostId = video.data.id
}, 90000)
afterAll(async () => { await app?.close(); await db.$disconnect(); if (storage) await rm(storage, { recursive: true, force: true }) })

describe('公开主页与未认证读写边界', () => {
  it('未认证登录有效，read允许而所有公开写操作受限', async () => {
    expect((await request('/me', b)).data).toMatchObject({ id: b.id, communityWriteEnabled: false, identityVerificationStatus: 'unsubmitted' })
    const result = await request('/community/eligibility', b); expect(result.status).toBe(200); expect(result.data.canRead).toBe(true)
    for (const operation of communityOperations) expect(result.data.operations[operation]).toMatchObject(operation === 'read' ? { allowed: true, reasonCode: null } : { allowed: false, reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED' })
  })
  it('所有公开浏览接口、本人学习记录与通知可读', async () => {
    const paths = ['/community/feed?mode=for_you', '/community/feed?mode=following', '/community/feed?mode=latest', '/community/context', '/community/search?q=%E5%A8%83%E5%A8%83&type=users', `/community/posts/${postId}`, `/community/posts/${postId}/comments`, '/community/topics', '/community/topics/public-read-topic', `/community/users/${a.id}/timeline?tab=posts`, `/community/users/${a.id}/timeline?tab=replies`, `/community/users/${a.id}/timeline?tab=media`, `/community/users/${a.id}/followers`, '/community/notifications', '/community/notifications/unread-count', '/resource-hub/home', '/resource-hub/items', `/resource-hub/creators/${a.id}`, `/resource-hub/contributions/${videoPostId}`, `/resource-hub/collections/${collectionId}`, '/themes', '/courses', '/labs', '/articles', '/me/courses', '/me/learning-plans', '/me/notifications']
    for (const path of paths) { const result = await request(path, b); expect(result.status, path + ': ' + result.message).toBe(200) }
  })
  it.each(['id', 'username'])('公开主页%s契约不包含任何实名、安全或联系方式字段', async kind => {
    const path = kind === 'id' ? `/community/users/${a.id}` : `/community/users/by-username/${a.username}`
    const result = await request(path, b); expect(result.status).toBe(200)
    expect(result.data).toMatchObject({ id: a.id, username: a.username, displayName: '娃娃', bio: '公开简介', isSelf: false })
    publicOnly(result.data)
    publicOnly((await request('/community/search?q=%E5%A8%83%E5%A8%83&type=users', b)).data)
  })
  it('本人认证接口不接受其他人userId，后台专门权限继续控制实名读取和审核', async () => {
    const own = await request(`/community/verification?userId=${a.id}`, b)
    expect(own.data).toMatchObject({ status: 'unsubmitted', maskedIdNumber: null, studentNo: null })
    expect((await request(`/admin/users/${a.id}/verification`, b)).status).toBe(403)
    expect((await request(`/admin/users/${a.id}/verification`, reader)).status).toBe(403)
    expect((await request(`/admin/users/${a.id}/verification`, admin)).data).toMatchObject({ realName: '合成隐私姓名', idNumber: '11010519491231002X', className: '隐私班级' })
    const ownRow = await db.campusIdentityVerification.findUniqueOrThrow({ where: { userId: a.id } })
    await db.campusIdentityVerification.update({ where: { userId: a.id }, data: { status: 'pending' } })
    expect((await request(`/admin/users/${a.id}/verification/approve`, reader, 'POST', { expectedRevision: ownRow.revision, reason: '合成资料完整可核验' })).status).toBe(403)
    expect((await request(`/admin/users/${a.id}/verification/approve`, admin, 'POST', { expectedRevision: ownRow.revision, reason: '合成资料完整可核验' })).status).toBe(201)
  })
  it('未认证视频播放、Range和个人观看进度均按read处理', async () => {
    const result = await request(`/resource-hub/videos/${videoId}/playback`, b); expect(result.status, result.message).toBe(200)
    const streamed = await fetch(new URL(result.data.sources[0].src, base), { headers: { range: 'bytes=0-99' } }); expect(streamed.status).toBe(206); expect((await streamed.arrayBuffer()).byteLength).toBe(100)
    const progress = await request(`/resource-hub/videos/${videoId}/progress`, b, 'PUT', { positionSeconds: 4, watchedSeconds: 4, completed: false, eventKey: randomUUID() }); expect(progress.status, progress.message).toBe(200)
  })
  it('未认证公开写操作全部403，拒绝前不新增帖子评论关注或文件', async () => {
    const counts = async () => [await db.communityPost.count(), await db.communityComment.count(), await db.communityUserFollow.count(), await db.communityTopicFollow.count(), await db.fileRecord.count(), await db.learningCollection.count()]
    const before = await counts()
    const profile = { expectedUserRevision: 1, expectedProfileRevision: 1, displayName: '禁止修改', bio: '', headline: '', location: '', websiteUrl: '', expertiseTopics: [], allowAchievementDrafts: false }
    const attempts: Array<[string, string, unknown?]> = [
      ['/community/posts', 'POST', input()], ['/community/posts', 'POST', input({ quotedPostId: postId })],
      [`/community/posts/${postId}/comments`, 'POST', { contentBlocks: [{ type: 'paragraph', text: '禁止发表的评论' }] }],
      [`/community/posts/${postId}/comments`, 'POST', { parentId: commentId, contentBlocks: [{ type: 'paragraph', text: '禁止发表的回复' }] }],
      [`/community/posts/${postId}/reactions/like`, 'PUT'], [`/community/posts/${postId}/bookmark`, 'PUT'], [`/community/comments/${commentId}/like`, 'PUT'],
      [`/community/users/${a.id}/follow`, 'PUT'], [`/community/topics/${topicId}/follow`, 'PUT'], [`/community/posts/${postId}/report`, 'POST', { reason: '合成举报原因' }],
      ['/community/media', 'POST', multipart(image, 'image/png', 'synthetic.png')], ['/resource-hub/uploads/video', 'POST', multipart(image, 'video/mp4', 'synthetic.mp4')], ['/resource-hub/uploads/document', 'POST', multipart(image, 'text/plain', 'synthetic.txt')],
      ['/resource-hub/collections', 'POST', { name: '禁止公开合集', visibility: 'community' }], ['/community/profile', 'PATCH', profile], [`/community/posts/${postId}/pin`, 'PUT', { expectedProfileRevision: 1 }],
    ]
    for (const [path, method, body] of attempts) { const result = await request(path, b, method, body); expect(result.status, path + ': ' + result.message).toBe(403); expect(result.errorCode, path).toBe('COMMUNITY_VERIFICATION_REQUIRED'); expect(result.nextAction).toEqual({ label: '前往认证', route: '/community/verification' }) }
    expect(await counts()).toEqual(before)
    expect((await request('/me', b)).data.id).toBe(b.id)
  })
  it('已认证发帖评论、关注、上传图片资料及视频继续正常', async () => {
    const published = await request('/community/posts', a, 'POST', input({ title: '已认证新的学习记录', contentBlocks: [{ type: 'paragraph', text: '新的合成记录，确认实名审核后仍可正常投稿。' }] }))
    expect(published.status, published.message).toBe(201)
    expect((await request(`/community/posts/${postId}/comments`, a, 'POST', { contentBlocks: [{ type: 'paragraph', text: '已认证仍可继续评论。' }] })).status).toBe(201)
    expect((await request(`/community/users/${b.id}/follow`, a, 'PUT')).status).toBe(200)
    expect((await request('/community/media', a, 'POST', multipart(image, 'image/png', 'synthetic.png'))).status).toBe(201)
    expect((await request('/resource-hub/uploads/document', a, 'POST', multipart(new TextEncoder().encode('合成教学资料'), 'text/plain', 'synthetic.txt'))).status).toBe(201)
    expect((await request(`/resource-hub/videos/${videoId}`, a)).data.status).toBe('ready')
  })
  it('账号不可用仍禁止read，已签发视频凭据不能绕过封禁', async () => {
    const playback = await request(`/resource-hub/videos/${videoId}/playback`, b)
    expect(playback.status).toBe(200)
    await db.user.update({ where: { id: b.id }, data: { status: 'disabled' } })
    expect((await request(`/community/users/${a.id}`, b)).status).toBe(401)
    const stream = await fetch(new URL(playback.data.sources[0].src, base)); await stream.arrayBuffer(); expect(stream.status).toBe(403)
  })
})
