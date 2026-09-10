import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
import type { ModeratorScope } from '@ai-learning-hub/contracts'

const database = new URL(process.env.DATABASE_URL || 'file:///missing')
if (process.env.FRONT_MODERATOR_ISOLATED !== 'true' || database.hostname !== '127.0.0.1' || database.port !== '55439' || database.pathname !== '/frontend_moderators') throw new Error('仅允许飞牛专属 frontend_moderators 隔离数据库')
const runtime = createRequire(process.cwd() + '/test/frontend-moderators.e2e.spec.ts')
const { AppModule } = runtime('../dist/app.module.js')
const { browserBoundary } = runtime('../dist/common/deployment-security.js')
const { appValidationPipe } = runtime('../dist/common/validation.pipe.js')
const { ApiExceptionFilter } = runtime('../dist/common/api-exception.filter.js')
const { ApiResponseInterceptor } = runtime('../dist/common/api-response.interceptor.js')
const { OperationLogInterceptor } = runtime('../dist/common/operation-log.interceptor.js')
const { bootstrapDatabase } = runtime('../dist/modules/persistence/bootstrap.js')
const { encryptIdentity } = runtime('../dist/modules/users/identity-data.js')
const { CommunityNotificationService } = runtime('../dist/modules/community/notification.service.js')
const { runMediaCommand } = runtime('../dist/modules/resources/video-processing.service.js')
const db = new PrismaClient(), password = 'Moderator8!' + randomBytes(16).toString('hex')
const origin = 'http://127.0.0.1:8088', adminOrigin = 'http://127.0.0.1:8089'
type Actor = { id: string; username: string; token: string; cookie: string }
let app: INestApplication, base: string, storage: string, passwordHash: string
let student: Actor, community: Actor, tutorials: Actor, both: Actor, admin: Actor, reader: Actor
async function request(path: string, actor?: Actor, method = 'GET', input?: unknown, key?: string, cookie?: string) {
  const response = await fetch(base + path, { method, headers: {
    ...(input instanceof FormData ? {} : { 'content-type': 'application/json' }),
    origin: path.startsWith('/admin') ? adminOrigin : origin,
    ...(actor ? { authorization: 'Bearer ' + actor.token } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(cookie ? { cookie } : {}),
  }, ...(input === undefined ? {} : { body: input instanceof FormData ? input : JSON.stringify(input) }) })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, data: payload.data, message: payload.message, errorCode: payload.errorCode, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') }
}
async function account(role = 'student', approved = true): Promise<Actor> {
  const id = randomUUID().replaceAll('-', ''), key = Buffer.from(process.env.IDENTITY_DATA_KEY!, 'hex')
  const user = await db.user.create({ data: { username: 'mod_' + id.slice(0, 16), displayName: '隔离版主验收' + id.slice(0, 5), email: id + '@example.invalid', passwordHash, userType: role === 'student' ? 'student' : 'admin', emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), communityProfile: { create: {} }, userRoles: { create: { role: { connect: { code: role } } } }, ...(approved ? { identityVerification: { create: { status: 'approved', realNameEncrypted: encryptIdentity('测试同学', key, 'real-name'), idNumberEncrypted: encryptIdentity('11010519491231002X', key, 'id-number'), idNumberFingerprint: id, idNumberLast4: '002X', className: '隔离验收班', studentNo: id } } } : {}) } })
  let result = await request(role === 'student' ? '/auth/login' : '/admin-auth/login', undefined, 'POST', { identifier: user.username, password })
  expect(result.status, result.message).toBe(201)
  if (role !== 'student') {
    expect(result.data.mfaRequired).toBe(true)
    const hint = await request('/admin-auth/mfa-hint', undefined, 'POST', { challenge: result.data.challenge })
    result = await request('/admin-auth/mfa', undefined, 'POST', { challenge: result.data.challenge, code: hint.data.code })
    expect(result.status, result.message).toBe(201)
  }
  return { id: user.id, username: user.username, token: result.data.accessToken, cookie: result.cookie }
}
async function configure(actor: Actor, scopes: ModeratorScope[], flags: { canDelete?: boolean; canMute?: boolean; canBan?: boolean; enabled?: boolean } = {}) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } })
  const input = { expectedRevision: user.revision, scopes, canDelete: true, canMute: true, canBan: false, enabled: true, reason: '隔离验收配置前台管理权限', ...flags }
  const result = await request(`/admin/users/${actor.id}/moderator-grants`, admin, 'PUT', input, randomUUID())
  expect(result.status, result.message).toBe(200)
  return input
}
async function post(actor = student, tutorial = false, extra: Record<string, unknown> = {}) {
  const key = randomUUID()
  return db.communityPost.create({ data: { authorId: actor.id, postType: 'note', title: '版主管理验收' + key, body: '合成学习说明', plainText: '合成学习说明', contentBlocks: [{ type: 'paragraph', text: '合成学习说明' }], contentHash: key, status: 'published', visibility: 'public', publishedAt: new Date(), ...(tutorial ? { contribution: { create: { kind: 'article', teachingReuseConsent: false } } } : {}), ...extra } })
}
const decision = (actor: Actor, type: string, id: string, extra: Record<string, unknown> = {}, key = randomUUID()) => request(`/community/moderation/targets/${type}/${id}/decision`, actor, 'POST', { expectedRevision: 1, action: 'takedown', reason: '违反社区规则的具体事实说明', ...extra }, key)
const future = (hours = 1) => new Date(Date.now() + hours * 3600000).toISOString()
async function upload(path: string, actor: Actor, bytes: Uint8Array, mime: string, filename: string) {
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename)
  const result = await request(path, actor, 'POST', form, randomUUID()); expect(result.status, result.message).toBe(201); return result.data.id as string
}
async function mediaStatus(path: string, actor?: Actor, range?: string) {
  const response = await fetch(new URL(path, base), { headers: { ...(actor ? { authorization: 'Bearer ' + actor.token } : {}), ...(range ? { range } : {}) } }); await response.arrayBuffer(); return response.status
}
beforeAll(async () => {
  if (await db.user.count()) throw new Error('只允许专属空库，禁止使用现行业务库')
  storage = await mkdtemp(join(tmpdir(), 'frontend-moderators-'))
  Object.assign(process.env, { DEPLOYMENT_PROFILE: 'experience', LOAD_DEMO_DATA: 'false', COOKIE_SECURE: 'false', FRONTEND_URL: origin, ADMIN_WEB_URL: adminOrigin, CORS_ORIGINS: origin + ',' + adminOrigin, ADMIN_NETWORK_CIDRS: '127.0.0.1/32,::1/128', TRUSTED_PROXY_CIDRS: '', EXTERNAL_PROXY_CIDRS: '', JWT_SECRET: randomBytes(48).toString('hex'), MFA_DATA_KEY: randomBytes(32).toString('hex'), IDENTITY_DATA_KEY: randomBytes(32).toString('hex'), VIDEO_PLAYBACK_SECRET: randomBytes(48).toString('hex'), STORAGE_DRIVER: 'local', STORAGE_LOCAL_PATH: storage, SEED_ADMIN_EMAIL: 'moderator-bootstrap@example.invalid', SEED_ADMIN_PASSWORD: password })
  await bootstrapDatabase(db); passwordHash = await hash(password, 4)
  await db.role.create({ data: { code: 'moderator_grant_reader', name: '只读测试管理员', permissions: { create: { permission: { connect: { code: 'user.read' } } } } } })
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
  app.use(cookieParser()); app.use(browserBoundary(app.get(ConfigService))); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(appValidationPipe)
  app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(app.get(OperationLogInterceptor), new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1'); base = await app.getUrl() + '/api/v1'
  admin = await account('super_admin'); reader = await account('moderator_grant_reader')
  ;[student, community, tutorials, both] = await Promise.all(Array.from({ length: 4 }, () => account()))
  await configure(community, ['community']); await configure(tutorials, ['tutorials']); await configure(both, ['community', 'tutorials'], { canBan: true })
}, 60000)
afterAll(async () => { vi.restoreAllMocks(); await app?.close(); await db.$disconnect(); if (storage) await rm(storage, { recursive: true, force: true }) })

describe('前台版主真实授权、处罚及展示联动', () => {
  it('删除身份标签撤销对应角色，保留普通角色、实名、版主权限及其他标签', async () => {
    for (const verifiedType of ['official', 'teacher', 'mentor']) {
      const actor = await account(), path = `/admin/users/${actor.id}/badges`
      await configure(actor, ['community'])
      let profile = await db.communityProfile.findUniqueOrThrow({ where: { userId: actor.id } })
      const verify = (type: string, revision: number) => request(`/admin/community/official/${actor.id}`, admin, 'PATCH', { verifiedType: type, expectedRevision: revision, expertiseTopics: ['RAG'], reason: '隔离验证身份标签删除联动' })
      expect((await verify(verifiedType, profile.revision)).status).toBe(200)
      const settings = (await request(path, admin)).data
      expect((await request(path, admin, 'PUT', { expectedRevision: settings.revision, hiddenAutomaticBadges: [verifiedType], customBadges: [{ label: '热心同学', tone: 'green' }], reason: '先隐藏身份标签再删除' })).status).toBe(200)
      profile = await db.communityProfile.findUniqueOrThrow({ where: { userId: actor.id } })
      expect((await verify('none', profile.revision - 1)).status).toBe(409)
      expect((await request(`/admin/community/official/${actor.id}`, reader, 'PATCH', { verifiedType: 'none', expectedRevision: profile.revision, expertiseTopics: [], reason: '只读管理员不能删除身份' })).status).toBe(403)
      expect((await verify('none', profile.revision)).status).toBe(200)
      const me = (await request('/me', actor)).data
      expect(me.roles).toContain('student'); expect(me.roles).not.toContain(verifiedType === 'official' ? 'community_official' : verifiedType)
      expect(me.badges.map((badge: { code: string }) => badge.code)).toEqual(['moderator', 'custom:热心同学'])
      expect((await db.campusIdentityVerification.findUniqueOrThrow({ where: { userId: actor.id } })).status).toBe('approved')
      expect((await request(path, admin)).data.hiddenAutomaticBadges).toEqual([])
      expect(await db.auditLog.count({ where: { targetId: actor.id, action: 'community_identity_updated' } })).toBe(2)
      profile = await db.communityProfile.findUniqueOrThrow({ where: { userId: actor.id } })
      expect((await verify(verifiedType, profile.revision)).status).toBe(200)
      expect((await request('/me', actor)).data.badges[0].code).toBe(verifiedType)
    }
  })
  it('删除已隐藏版主标签撤销全部范围，旧会话立即失去管理能力', async () => {
    const actor = await account(), target = await post(), path = `/admin/users/${actor.id}/badges`
    await configure(actor, ['community', 'tutorials'])
    const settings = (await request(path, admin)).data
    expect((await request(path, admin, 'PUT', { expectedRevision: settings.revision, hiddenAutomaticBadges: ['moderator'], customBadges: [], reason: '先隐藏版主标签再撤销权限' })).status).toBe(200)
    await configure(actor, [], { enabled: false })
    const next = (await request(path, admin)).data
    expect(next.hiddenAutomaticBadges).toEqual([]); expect(next.badges).toEqual([])
    expect(next.revision).toBeGreaterThan(settings.revision + 1)
    expect((await decision(actor, 'post', target.id)).status).toBe(403)
    expect(await db.frontendModeratorGrant.count({ where: { userId: actor.id, enabled: true } })).toBe(0)
    await configure(actor, ['community'])
    expect((await request('/me', actor)).data.badges[0].code).toBe('moderator')
  })

  it('后台专门权限配置并审计，学生登录与后台MFA边界不变', async () => {
    const detail = await request(`/admin/users/${community.id}`, admin)
    expect(detail.status).toBe(200); expect(detail.data.moderatorGrants[0]).toMatchObject({ scope: 'community', actions: ['takedown', 'mute'], enabled: true, grantedById: admin.id })
    const me = await request('/me', community)
    expect(me.data.permissions).toEqual([]); expect(me.data.roles).toEqual(['student']); expect(me.data.moderatorCapabilities[0].scope).toBe('community')
    const login = await request('/auth/login', undefined, 'POST', { identifier: community.username, password }, undefined, community.cookie)
    expect(login.data.accessToken).toBeTruthy(); community.token = login.data.accessToken; community.cookie = login.cookie
    const input = { expectedRevision: detail.data.user.revision, scopes: ['community'], enabled: true, canDelete: true, canMute: true, canBan: true, reason: '没有专门授权权限' }
    for (const actor of [student, reader]) expect((await request(`/admin/users/${community.id}/moderator-grants`, actor, 'PUT', input, randomUUID())).status).toBe(403)
    expect(await db.auditLog.count({ where: { action: 'frontend_moderator_grants_updated', targetId: community.id } })).toBe(1)
    expect((await request('/admin-auth/login', undefined, 'POST', { identifier: community.username, password })).status).toBe(403)
  })
  it('撤销后旧Token和旧幂等请求立即拒绝，不需要重新登录', async () => {
    const row = await post(), key = randomUUID()
    expect((await decision(community, 'post', row.id, {}, key)).status).toBe(201)
    await configure(community, [], { enabled: false })
    expect((await decision(community, 'post', row.id, {}, key)).status).toBe(403)
    expect((await request('/me', community)).status).toBe(200)
    await configure(community, ['community'])
    expect((await decision(community, 'post', (await post()).id)).status).toBe(201)
  })
  it('授权变更检查版本，重复提交只写一次授权和审计', async () => {
    const actor = await account(), key = randomUUID()
    const input = { expectedRevision: 1, scopes: ['community'], enabled: true, canDelete: true, canMute: false, canBan: false, reason: '核对重复授权不会增加审计' }
    const path = `/admin/users/${actor.id}/moderator-grants`
    const results = await Promise.all([request(path, admin, 'PUT', input, key), request(path, admin, 'PUT', input, key)])
    expect(results.map(value => value.status)).toEqual([200, 200])
    expect(await db.auditLog.count({ where: { action: 'frontend_moderator_grants_updated', targetId: actor.id } })).toBe(1)
    expect((await request(path, admin, 'PUT', { ...input, enabled: false }, randomUUID())).status).toBe(409)
    expect((await request('/me', actor)).data.moderatorCapabilities).toEqual([{ scope: 'community', actions: ['takedown'] }])
  })
  it('普通学生直调403，拒绝后台账号、越范围别名和伪造scope/作者', async () => {
    const plain = await post(), tutorial = await post(student, true)
    expect((await decision(student, 'post', plain.id)).status).toBe(403)
    expect((await decision(admin, 'post', plain.id)).status).toBe(403)
    for (const type of ['post', 'resource']) expect((await decision(community, type, tutorial.id)).status).toBe(403)
    expect((await decision(tutorials, 'post', plain.id)).status).toBe(403)
    expect((await decision(both, 'post', tutorial.id, { scope: 'community', authorId: both.id })).status).toBe(400)
    expect((await request(`/community/moderation/targets/post/${tutorial.id}`, tutorials)).data.scope).toBe('tutorials')
    expect((await decision(tutorials, 'post', tutorial.id)).status).toBe(201)
  })
  it('即使授予账号级禁言封禁动作，仍不能从另一板块及其评论发起处罚', async () => {
    await configure(community, ['community'], { canBan: true })
    const row = await post(student, true)
    const comment = await db.communityComment.create({ data: { postId: row.id, authorId: student.id, body: '教程评论', contentBlocks: [], status: 'published' } })
    for (const action of ['mute', 'ban']) for (const [type, id] of [['post', row.id], ['resource', row.id], ['comment', comment.id]]) expect((await decision(community, type!, id!, { action, expiresAt: future() })).status).toBe(403)
    expect(await db.communityModerationAction.count({ where: { targetId: { in: [row.id, comment.id] } } })).toBe(0)
    await configure(community, ['community'])
  })
  it('评论跟随父内容归属，删除评论不下架父作品', async () => {
    for (const tutorial of [false, true]) {
      const row = await post(student, tutorial)
      const comment = await db.communityComment.create({ data: { postId: row.id, authorId: student.id, body: '合成评论', contentBlocks: [{ type: 'paragraph', text: '合成评论' }], status: 'published' } })
      const allowed = tutorial ? tutorials : community, denied = tutorial ? community : tutorials
      expect((await decision(denied, 'comment', comment.id)).status).toBe(403)
      expect((await decision(allowed, 'comment', comment.id)).status).toBe(201)
      expect((await request(`/community/posts/${row.id}`, student)).status).toBe(200)
      const action = await db.communityModerationAction.findFirstOrThrow({ where: { commentId: comment.id } }); expect(action.postId).toBeNull()
      const comments = await request(`/community/posts/${row.id}/comments`, both); expect(JSON.stringify(comments.data)).not.toContain('合成评论')
    }
  })
  it('动作白名单、必填理由、明确期限及禁止永久封禁', async () => {
    const row = await post()
    for (const action of ['reject', 'warn', 'restrict', 'restore', 'role']) expect((await decision(both, 'post', row.id, { action })).status).toBe(400)
    for (const extra of [{ reason: ' ' }, { expectedRevision: 0 }, { action: 'ban' }, { action: 'mute' }, { action: 'ban', expiresAt: 'invalid' }, { action: 'mute', expiresAt: new Date(0).toISOString() }, { action: 'ban', expiresAt: future(9000) }]) expect((await decision(both, 'post', row.id, extra)).status).toBe(400)
    expect((await decision(community, 'post', row.id, { action: 'ban', expiresAt: future() })).status).toBe(403)
    expect((await decision(both, 'profile', student.id)).status).toBe(403)
    expect((await request(`/community/moderation/targets/post/${row.id}/decision`, both, 'POST', { expectedRevision: 1, action: 'takedown', reason: '没有幂等键不能处置' })).status).toBe(400)
  })
  it('禁止处理自己和所有具备后台能力的管理账号', async () => {
    expect((await decision(both, 'post', (await post(both)).id)).status).toBe(403)
    for (const actor of [admin, reader]) {
      const row = await post(actor)
      for (const action of ['takedown', 'mute', 'ban']) expect((await decision(both, 'post', row.id, { action, ...(action === 'takedown' ? {} : { expiresAt: future() }) })).status).toBe(403)
    }
  })
  it('授权不替代实名认证，私人草稿/待审内容/实名资料不向版主泄露', async () => {
    const unverified = await account('student', false); await configure(unverified, ['community'])
    expect((await decision(unverified, 'post', (await post()).id)).errorCode).toBe('COMMUNITY_VERIFICATION_REQUIRED')
    for (const status of ['draft', 'pending_review']) {
      const row = await post(student, true, { status, publishedAt: null, title: '私人标题不得泄露', plainText: 'PRIVATE_TEXT' })
      const preview = await request(`/community/moderation/targets/post/${row.id}`, both)
      expect(preview.status).toBe(404); expect(JSON.stringify(preview)).not.toContain('PRIVATE_TEXT'); expect(JSON.stringify(preview)).not.toContain('私人标题')
      expect((await decision(both, 'post', row.id)).status).toBe(404)
    }
    for (const path of [`/admin/users/${student.id}/verification`, `/admin/users/${student.id}`, '/admin/settings']) expect((await request(path, both)).status).toBe(403)
  })
  it('并发重试只有一条处置、审计和限制，版本不符不能处罚新内容', async () => {
    const row = await post(), key = randomUUID()
    expect((await decision(both, 'post', row.id, { expectedRevision: 2 })).status).toBe(409)
    const results = await Promise.all([decision(both, 'post', row.id, {}, key), decision(both, 'post', row.id, {}, key)])
    expect(results.map(result => result.status)).toEqual([201, 201]); expect(results[0].data.actionId).toBe(results[1].data.actionId)
    expect(await db.communityModerationAction.count({ where: { targetId: row.id } })).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'governance_sanction_applied', targetId: results[0].data.actionId } })).toBe(1)
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'governance_sanction_applied', targetId: results[0].data.actionId } })
    expect(audit.details).toMatchObject({ source: 'student', scope: 'community', targetId: row.id, subjectId: student.id, result: 'applied' })
  })
  it('通知失败时处罚与审计整体回滚，相同幂等键可重试', async () => {
    const row = await post(), key = randomUUID()
    vi.spyOn(app.get(CommunityNotificationService), 'governance').mockRejectedValueOnce(new Error('合成通知故障'))
    expect((await decision(both, 'post', row.id, {}, key)).status).toBe(500)
    expect(await db.communityModerationAction.count({ where: { targetId: row.id } })).toBe(0)
    expect((await decision(both, 'post', row.id, {}, key)).status).toBe(201)
  })
  it('禁言限制帖子、评论、教程和旧内容修改，保留阅读学习申诉且到期恢复', async () => {
    const author = await account(), row = await post(author), resource = await post(author, true)
    const comment = await db.communityComment.create({ data: { postId: row.id, authorId: author.id, body: '旧评论', contentBlocks: [], status: 'published' } })
    const result = await decision(both, 'post', row.id, { action: 'mute', expiresAt: future() }); expect(result.status).toBe(201)
    const input = { type: 'general', title: '不能绕过禁言', contentBlocks: [{ type: 'paragraph', text: '尝试发布' }], bindings: [], topicIds: [], status: 'published', visibility: 'public' }
    expect((await request('/community/posts', author, 'POST', input)).status).toBe(403)
    for (const id of [row.id, resource.id]) for (const status of ['published', 'draft']) expect((await request(`/community/posts/${id}`, author, 'PATCH', { ...input, expectedRevision: 1, status })).status).toBe(403)
    expect((await request(`/community/comments/${comment.id}`, author, 'PATCH', { expectedRevision: 1, contentBlocks: [{ type: 'paragraph', text: '旧评论修改绕行' }] })).status).toBe(403)
    expect((await request(`/community/posts/${row.id}/comments`, author, 'POST', { contentBlocks: [{ type: 'paragraph', text: '新增评论绕行' }] })).status).toBe(403)
    expect((await request(`/resource-hub/contributions/${resource.id}`, author)).status).toBe(200)
    const mine = await request('/community/governance/mine', author); expect(mine.data.actions.some((action: { id: string }) => action.id === result.data.actionId)).toBe(true)
    expect((await request('/community/governance/appeals', author, 'POST', { actionId: result.data.actionId, reason: '测试用户提供新的证据请求复核禁言决定', evidence: [] })).status).toBe(201)
    await db.communityModerationAction.update({ where: { id: result.data.actionId }, data: { expiresAt: new Date(0) } }); await db.communityOperationRestriction.updateMany({ where: { moderationActionId: result.data.actionId }, data: { startsAt: new Date(-3600000), endsAt: new Date(0) } })
    expect((await request('/community/eligibility', author)).data.canPost).toBe(true)
  })
  it('封禁立即撤销会话并返回真实原因，撤销一项不覆盖其他处罚', async () => {
    const author = await account(), row = await post(author)
    const muted = await decision(both, 'post', row.id, { action: 'mute', expiresAt: future(24) })
    const banned = await decision(both, 'post', row.id, { action: 'ban', expiresAt: future(1) }); expect(banned.status).toBe(201)
    const access = await request('/me', author); expect(access.status).toBe(401); expect(access.errorCode).toBe('ACCOUNT_BANNED'); expect(access.message).toContain('违反社区规则')
    expect((await request('/auth/refresh', author, 'POST', undefined, undefined, author.cookie)).errorCode).toBe('ACCOUNT_BANNED')
    expect(await db.refreshToken.count({ where: { userId: author.id, revokedAt: null } })).toBe(0)
    expect((await request('/auth/login', undefined, 'POST', { identifier: author.username, password })).status).toBe(401)
    const recovery = await request('/community/recovery/session', undefined, 'POST', { identifier: author.username, password }); expect(recovery.status).toBe(201)
    expect((await request('/community/recovery/mine', { ...author, token: recovery.data.token })).status).toBe(200)
    expect((await request(`/admin/community/governance/actions/${banned.data.actionId}/revoke`, both, 'POST', { expectedRevision: 1, reason: '前台不能撤销处罚' })).status).toBe(403)
    expect((await request(`/admin/community/governance/actions/${banned.data.actionId}/revoke`, admin, 'POST', { expectedRevision: 1, reason: '后台复核撤销此项封禁' })).status).toBe(201)
    const relogin = await request('/auth/login', undefined, 'POST', { identifier: author.username, password }); expect(relogin.status).toBe(201)
    expect((await request('/community/eligibility', { ...author, token: relogin.data.accessToken })).data.canPost).toBe(false)
    expect((await db.communityModerationAction.findUniqueOrThrow({ where: { id: muted.data.actionId } })).revokedAt).toBeNull()
  })
  it('教程下架联动信息流、教程、搜索、主页、合集、相关推荐与历史附件图片', async () => {
    const author = await account(), cover = await upload('/community/media', author, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer(), 'image/png', 'moderator.png')
    const attachment = await upload('/resource-hub/uploads/document', author, new TextEncoder().encode('版主隔离验收附件'), 'text/plain', 'moderator.txt')
    const row = await post(author, true), related = await post(author, true)
    await db.resourceContribution.update({ where: { postId: row.id }, data: { kind: 'document', coverFileId: cover, attachmentFileId: attachment } })
    const collection = await db.learningCollection.create({ data: { ownerId: author.id, name: '版主验收合集', visibility: 'community', items: { create: { contributionPostId: row.id, sortOrder: 0 } } } })
    const before = (await request(`/resource-hub/contributions/${row.id}`, student)).data.contribution
    for (const url of [before.coverUrl, before.attachment.downloadUrl]) expect(await mediaStatus(url)).toBe(200)
    expect((await decision(tutorials, 'resource', row.id)).status).toBe(201)
    for (const path of [`/community/posts/${row.id}`, `/resource-hub/contributions/${row.id}`]) expect((await request(path, student)).status).toBe(404)
    for (const path of ['/community/feed?mode=for_you&type=all', '/community/posts', '/resource-hub/items', `/community/users/${author.id}/posts`, `/resource-hub/creators/${author.id}`, `/resource-hub/collections/${collection.id}`, `/resource-hub/contributions/${related.id}`, '/community/search?type=posts&q=' + encodeURIComponent(row.title!)]) {
      const result = await request(path, student); expect(result.status, path + ': ' + result.message).toBe(200); expect(JSON.stringify(result.data), path).not.toContain(row.title)
    }
    for (const url of [before.coverUrl, before.attachment.downloadUrl]) expect(await mediaStatus(url)).toBe(404)
    expect(await db.fileRecord.count({ where: { id: { in: [cover, attachment] } } })).toBe(2)
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: row.id } })).deletedAt).toBeNull()
    const publicItems = await request('/resource-hub/public/items')
    expect(publicItems.status).toBe(200); expect(JSON.stringify(publicItems.data)).not.toContain(row.title)
  })
  it('临时封禁到期可重新登录，但被撤销的旧会话不复活', async () => {
    const author = await account(), row = await post(author)
    const banned = await decision(both, 'post', row.id, { action: 'ban', expiresAt: future() })
    expect(banned.status).toBe(201)
    await db.communityModerationAction.update({ where: { id: banned.data.actionId }, data: { expiresAt: new Date(0) } })
    expect((await request('/me', author)).status).toBe(401)
    const login = await request('/auth/login', undefined, 'POST', { identifier: author.username, password })
    expect(login.status).toBe(201)
    expect((await request('/community/eligibility', { ...author, token: login.data.accessToken })).data.canPost).toBe(true)
  })
  it('共享文件保留，另一可见内容仍可读取', async () => {
    const author = await account(), fileId = await upload('/community/media', author, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer(), 'image/png', 'shared.png')
    const one = await post(author, true), two = await post(author, true)
    await db.resourceContribution.updateMany({ where: { postId: { in: [one.id, two.id] } }, data: { coverFileId: fileId } })
    expect((await decision(tutorials, 'post', one.id)).status).toBe(201)
    const visible = await request(`/resource-hub/contributions/${two.id}`, student); expect(visible.status).toBe(200)
    expect(await mediaStatus(visible.data.contribution.coverUrl)).toBe(200)
    expect(await db.fileRecord.count({ where: { id: fileId } })).toBe(1)
  })
  it('真实视频转码后，前台下架立即阻断播放入口及旧Range地址', async () => {
    const author = await account(), file = join(storage, 'moderator-video.mp4')
    await runMediaCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=32x32:r=10', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file])
    const assetId = await upload('/resource-hub/uploads/video', author, await readFile(file), 'video/mp4', 'moderator-video.mp4')
    let video = await request(`/resource-hub/videos/${assetId}`, author); const deadline = Date.now() + 20000
    while (video.data.status !== 'ready' && video.data.status !== 'failed' && Date.now() < deadline) { await delay(100); video = await request(`/resource-hub/videos/${assetId}`, author) }
    expect(video.data.status).toBe('ready')
    const row = await post(author, true); await db.resourceContribution.update({ where: { postId: row.id }, data: { kind: 'video', videoAssetId: assetId } })
    const playback = await request(`/resource-hub/videos/${assetId}/playback`, student); expect(playback.status).toBe(200)
    const url = playback.data.sources[0].src; expect(await mediaStatus(url, undefined, 'bytes=0-15')).toBe(206)
    expect((await decision(tutorials, 'resource', row.id)).status).toBe(201)
    expect((await request(`/resource-hub/videos/${assetId}/playback`, student)).status).toBe(404); expect(await mediaStatus(url, undefined, 'bytes=0-15')).toBe(404)
  }, 30000)
})
