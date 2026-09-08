import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NestFactory, Reflector } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import sharp from 'sharp'
import { LANDING_DEFAULT_CONFIG } from '@ai-learning-hub/contracts'

const database = new URL(process.env.DATABASE_URL || 'file:///missing')
if (database.hostname !== '127.0.0.1' || database.port !== '55439' || database.pathname !== '/community_governance') throw new Error('只允许专属隔离治理验收数据库')
const runtime = createRequire(`${process.cwd()}/test/governance.e2e.spec.ts`)
const { AppModule } = runtime('../dist/app.module.js')
const { ApiExceptionFilter } = runtime('../dist/common/api-exception.filter.js')
const { ApiResponseInterceptor } = runtime('../dist/common/api-response.interceptor.js')
const { OperationLogInterceptor } = runtime('../dist/common/operation-log.interceptor.js')
const { appValidationPipe } = runtime('../dist/common/validation.pipe.js')
const { bootstrapDatabase } = runtime('../dist/modules/persistence/bootstrap.js')
const { runMediaCommand } = runtime('../dist/modules/resources/video-processing.service.js')
const db = new PrismaClient(), password = `Synthetic-${randomBytes(18).toString('hex')}`
type Actor = { id: string; username: string; email: string; token: string }
let app: INestApplication, base: string, uploads: string, passwordHash: string
let admin: Actor, admin2: Actor, moderator: Actor, moderator2: Actor, editor: Actor, manager: Actor, owner: Actor, reporter: Actor
async function request(path: string, actor?: Actor | string, method = 'GET', body?: unknown, key?: string) {
  const token = typeof actor === 'string' ? actor : actor?.token
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
  const value = await response.json().catch(() => ({}))
  return { status: response.status, data: value.data, message: value.message }
}
async function account(role = 'student'): Promise<Actor> {
  const key = randomUUID().replaceAll('-', ''), roleRow = await db.role.findUniqueOrThrow({ where: { code: role } })
  const row = await db.user.create({ data: { username: `gov_${key}`, email: `${key}@example.invalid`, displayName: `合成用户${key.slice(0, 6)}`, passwordHash, communityProfile: { create: {} }, userRoles: { create: { roleId: roleRow.id } }, identityVerification: { create: { realNameEncrypted: 'synthetic-only', idNumberEncrypted: 'synthetic-only', idNumberFingerprint: key, idNumberLast4: '0000', className: '合成测试班', studentNo: key, status: 'approved' } } } })
  const result = await request('/auth/login', undefined, 'POST', { identifier: row.username, password })
  expect(result.status).toBe(201)
  return { id: row.id, username: row.username, email: row.email, token: result.data.accessToken }
}
async function post(actor = owner, extra: Record<string, unknown> = {}) {
  const key = randomUUID()
  return db.communityPost.create({ data: { authorId: actor.id, postType: 'note', title: `治理合成 ${key}`, body: '合成安全学习说明', plainText: '合成安全学习说明', contentBlocks: [{ type: 'paragraph', text: '合成安全学习说明' }], contentHash: key, status: 'published', visibility: 'public', publishedAt: new Date(), ...extra } })
}
async function report(type: string, id: string, actor = reporter) {
  const result = await request('/community/governance/reports', actor, 'POST', { targetType: type, targetId: id, category: 'privacy', reason: '合成隐私风险', description: '仅供隔离验收', evidence: ['https://example.invalid/private-evidence'] })
  expect(result.status).toBe(201)
  return db.communityReport.findUniqueOrThrow({ where: { id: result.data.id } })
}
async function claim(kind: string, id: string, revision: number, actor = moderator) {
  const result = await request(`/admin/community/governance/${kind}/${id}/claim`, actor, 'POST', { expectedRevision: revision })
  expect(result.status).toBe(201)
}
async function sanction(id: string, action = 'takedown', actor = moderator, extra: Record<string, unknown> = {}) {
  const row = await db.communityPost.findUniqueOrThrow({ where: { id } })
  const result = await request(`/admin/community/governance/targets/post/${id}/decision`, actor, 'POST', { expectedRevision: row.revision, action, reason: '合成治理决定，检查具体事实', ruleCode: '社区规则-测试条款', ...extra }, randomUUID())
  expect(result.status).toBe(201)
  return result.data.actionId as string
}
async function upload(path: string, actor: Actor, bytes: Uint8Array, mime: string, name: string) {
  const form = new FormData(); form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
  const result = await request(path, actor, 'POST', form); expect(result.status).toBe(201)
  return result.data.id as string
}
async function mediaStatus(path: string, actor?: Actor, range?: string) {
  const response = await fetch(new URL(path, base), { headers: { ...(actor ? { authorization: `Bearer ${actor.token}` } : {}), ...(range ? { range } : {}) } })
  await response.arrayBuffer(); return response.status
}
beforeAll(async () => {
  if (await db.user.count()) throw new Error('此测试必须使用专属空库，禁止覆盖业务数据')
  Object.assign(process.env, { SEED_ADMIN_EMAIL: 'governance-bootstrap@example.invalid', SEED_ADMIN_PASSWORD: password, IDENTITY_DATA_KEY: randomBytes(32).toString('hex') })
  await bootstrapDatabase(db)
  passwordHash = await hash(password, 4)
  uploads = await mkdtemp(join(tmpdir(), 'community-governance-'))
  process.env.STORAGE_LOCAL_PATH = uploads
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1'); app.use(cookieParser()); app.useGlobalPipes(appValidationPipe)
  app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)), app.get(OperationLogInterceptor))
  await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1`
  ;[admin, admin2, moderator, moderator2, editor, manager, owner, reporter] = await Promise.all(['super_admin', 'super_admin', 'community_moderator', 'community_moderator', 'content_editor', 'user_manager', 'student', 'student'].map(account))
}, 60000)
afterAll(async () => { await app?.close(); await db.$disconnect(); if (uploads) await rm(uploads, { recursive: true, force: true }) })

describe('举报治理真实 HTTP / PostgreSQL 闭环', () => {
  it('五类实体引用、私人内容拒绝、分类证据校验与重复举报', async () => {
    const row = await post(), resource = await post(), category = await db.resourceCategory.create({ data: { code: 'governance-test', name: '合成分类' } })
    await db.resourceContribution.create({ data: { postId: resource.id, categoryId: category.id, kind: 'document', teachingReuseConsent: false } })
    const comment = await db.communityComment.create({ data: { authorId: owner.id, postId: row.id, body: '合成评论', contentBlocks: [], status: 'published' } })
    const collection = await db.learningCollection.create({ data: { ownerId: owner.id, name: '公开合成合集', visibility: 'community' } })
    for (const [type, id] of [['post', row.id], ['comment', comment.id], ['resource', resource.id], ['collection', collection.id], ['profile', owner.id]]) {
      const first = await report(type, id); expect((await report(type, id)).id).toBe(first.id)
      expect(first.reporterId).toBe(reporter.id); expect(first.category).toBe('privacy')
    }
    const draft = await post(owner, { status: 'draft', publishedAt: null })
    expect((await request('/community/governance/reports', reporter, 'POST', { targetType: 'post', targetId: draft.id, reason: '不可举报私人草稿' })).status).toBe(404)
    await db.learningCollection.update({ where: { id: collection.id }, data: { visibility: 'private' } })
    expect((await request('/community/governance/reports', reporter, 'POST', { targetType: 'collection', targetId: collection.id, reason: '不可举报私人合集' })).status).toBe(404)
    expect((await request('/community/governance/reports', reporter, 'POST', { targetType: 'post', targetId: row.id, reason: '伪造举报', reporterId: owner.id })).status).toBe(400)
    expect((await request('/community/governance/reports', reporter, 'POST', { targetType: 'post', targetId: row.id, reason: '危险证据链接', evidence: ['javascript:alert(1)'] })).status).toBe(400)
    const legacy = await request('/admin/community/reports', moderator)
    expect(legacy.status).toBe(200); expect(legacy.data.items).toHaveLength(5)
    expect(legacy.data.items.some((r: { collectionId: string }) => r.collectionId === collection.id)).toBe(true)
    expect(legacy.data.items.some((r: { profileId: string }) => r.profileId === owner.id)).toBe(true)
    expect(JSON.stringify(legacy.data)).not.toContain('reporterId')
    expect((await request('/admin/community/reports', owner)).status).toBe(403)
  })
  it('普通用户、编辑、审核员、用户管理员和超级管理员权限隔离', async () => {
    const row = await post()
    for (const actor of [owner, editor]) expect((await request('/admin/community/governance', actor)).status).toBe(403)
    for (const path of ['/admin/users/export', `/admin/users/${owner.id}/verification`, '/admin/settings', '/admin/settings/batch']) expect((await request(path, moderator)).status).toBeGreaterThanOrEqual(400)
    expect((await request(`/admin/community/official/${owner.id}`, moderator, 'PATCH', { expectedRevision: 1, verifiedType: 'teacher', expertiseTopics: [], reason: '不能借认证提权' })).status).toBe(403)
    expect((await request(`/admin/community/governance/targets/post/${row.id}/decision`, moderator, 'POST', { expectedRevision: 1, action: 'ban', reason: '越权封禁测试', ruleCode: '测试规则', expiresAt: new Date(Date.now() + 3600000).toISOString() }, randomUUID())).status).toBe(403)
    expect((await request(`/admin/community/governance/targets/post/${row.id}/decision`, manager, 'POST', { expectedRevision: 1, action: 'ban', reason: '越权永久封禁', ruleCode: '测试规则' }, randomUUID())).status).toBe(403)
    expect((await request(`/admin/users/${owner.id}/status`, manager, 'PATCH', { expectedRevision: 1, status: 'disabled', reason: '旧账号路径不能无限期封禁' })).status).toBe(403)
    const draft = await post(owner, { status: 'draft', publishedAt: null })
    expect((await request(`/admin/community/posts/${draft.id}`, moderator)).status).toBe(400)
    expect((await request(`/admin/community/post/${row.id}/moderate`, moderator, 'POST', { action: 'hide', reason: '旧接口不能绕过治理依据' })).status).toBe(400)
  })
  it('多管理员领取和处置并发只成功一次，通知与审计同事务', async () => {
    const row = await post(), item = await report('post', row.id, await account())
    const claims = await Promise.all([moderator, moderator2].map((actor) => request(`/admin/community/governance/reports/${item.id}/claim`, actor, 'POST', { expectedRevision: 1 })))
    expect(claims.map((x) => x.status).sort()).toEqual([201, 409])
    const current = await db.communityReport.findUniqueOrThrow({ where: { id: item.id } }), actor = current.assignedToId === moderator.id ? moderator : moderator2
    const input = { expectedRevision: current.revision, action: 'takedown', reason: '核查合成风险后下架', ruleCode: '社区规则-测试' }
    const results = await Promise.all([request(`/admin/community/governance/reports/${item.id}/decision`, actor, 'POST', input), request(`/admin/community/governance/reports/${item.id}/decision`, actor, 'POST', input)])
    expect(results.map((x) => x.status).sort()).toEqual([201, 409])
    const done = await db.communityReport.findUniqueOrThrow({ where: { id: item.id } })
    expect(done.status).toBe('resolved'); expect(await db.communityModerationAction.count({ where: { postId: row.id, action: 'takedown' } })).toBe(1)
    expect(await db.userNotification.count({ where: { recipientId: owner.id, entityId: done.actionId! } })).toBe(1)
    expect(await db.userNotification.count({ where: { recipientId: item.reporterId, entityType: 'report' } })).toBe(1)
    expect(await db.auditLog.count({ where: { action: 'community_report_decided', targetId: item.id } })).toBe(1)
    const mine = await request('/community/governance/mine', owner), queue = await request('/admin/community/governance?kind=reports&status=all', moderator)
    expect(JSON.stringify(mine.data)).not.toContain(item.reporterId); expect(JSON.stringify(mine.data)).not.toContain('private-evidence')
    expect(JSON.stringify(queue.data)).not.toContain('reporterId')
    const anonymous = await request('/community/governance/mine'); expect(anonymous.status).toBe(401)
  })
  it('幂等直处置与大量举报不重复处罚、不自动封号或限流展示', async () => {
    const row = await post(), key = randomUUID(), input = { expectedRevision: 1, action: 'warn', reason: '合成规则提醒', ruleCode: '测试条款' }
    const path = `/admin/community/governance/targets/post/${row.id}/decision`
    const first = await request(path, moderator, 'POST', input, key), second = await request(path, moderator, 'POST', input, key)
    expect(first.status).toBe(201); expect(second.data.actionId).toBe(first.data.actionId)
    for (let index = 0; index < 6; index++) await report('post', row.id, await account())
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('published')
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).status).toBe('active')
    expect(await db.communityModerationAction.count({ where: { subjectId: owner.id, action: 'ban' } })).toBe(0)
    expect(await db.communityModerationAction.count({ where: { postId: row.id, action: 'warn' } })).toBe(1)
    expect((await request(path, moderator, 'POST', input, randomUUID())).status).toBe(409)
    await db.communityPost.update({ where: { id: row.id }, data: { revision: 2, title: '新的课堂修订' } })
    expect((await request(path, moderator, 'POST', { ...input, expectedRevision: 2 }, randomUUID())).status).toBe(201)
  })
  it('通知写入失败回滚处罚、举报状态和审计', async () => {
    const row = await post(), item = await report('post', row.id, await account())
    await claim('reports', item.id, 1)
    await db.$executeRawUnsafe(`CREATE FUNCTION governance_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type = 'moderation_action' THEN RAISE EXCEPTION 'synthetic notification failure'; END IF; RETURN NEW; END $$`)
    await db.$executeRawUnsafe('CREATE TRIGGER governance_fail_notification BEFORE INSERT ON user_notifications FOR EACH ROW EXECUTE FUNCTION governance_fail_notification()')
    try {
      expect((await request(`/admin/community/governance/reports/${item.id}/decision`, moderator, 'POST', { expectedRevision: 2, action: 'takedown', reason: '事务回滚合成测试', ruleCode: '测试规则' })).status).toBe(500)
      expect((await db.communityReport.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('reviewing')
      expect(await db.communityModerationAction.count({ where: { postId: row.id, action: 'takedown' } })).toBe(0)
      expect(await db.auditLog.count({ where: { targetId: item.id, action: 'community_report_decided' } })).toBe(0)
    } finally { await db.$executeRawUnsafe('DROP TRIGGER governance_fail_notification ON user_notifications'); await db.$executeRawUnsafe('DROP FUNCTION governance_fail_notification()') }
  })
  it('申诉绑定本人处罚，重复提交受限，非原处理人撤销后恢复可见性', async () => {
    const row = await post(), actionId = await sanction(row.id)
    expect((await request(`/community/posts/${row.id}`, reporter)).status).toBe(404)
    const input = { actionId, reason: '合成内容已提供完整上下文，请重新核查此处罚' }
    expect((await request('/community/governance/appeals', reporter, 'POST', input)).status).toBe(404)
    const appeal = await request('/community/governance/appeals', owner, 'POST', input); expect(appeal.status).toBe(201)
    expect((await request('/community/governance/appeals', owner, 'POST', input)).data.id).toBe(appeal.data.id)
    expect((await request('/community/governance/appeals', owner, 'POST', { ...input, reason: `${input.reason}，补充说明` })).status).toBe(409)
    await claim('appeals', appeal.data.id, 1, moderator2)
    const result = await request(`/admin/community/governance/appeals/${appeal.data.id}/decision`, moderator2, 'POST', { expectedRevision: 2, action: 'approve', reason: '已核查合成上下文，撤销本处罚' })
    expect(result.status).toBe(201); expect((await request(`/community/posts/${row.id}`, reporter)).status).toBe(200)
    expect((await db.communityModerationAction.findUniqueOrThrow({ where: { id: actionId } })).revokedAt).not.toBeNull()
    expect((await request(`/admin/community/governance/appeals/${appeal.data.id}/decision`, moderator2, 'POST', { expectedRevision: 2, action: 'approve', reason: '不能重复撤销处罚' })).status).toBe(409)
  })
  it('原处理人不能审自己的决定；驳回后新证据允许再次申诉', async () => {
    const row = await post(), actionId = await sanction(row.id, 'warn'), input = { actionId, reason: '申诉理由为合成教学引用，请核查当前处罚' }
    const first = await request('/community/governance/appeals', owner, 'POST', input)
    expect((await request(`/admin/community/governance/appeals/${first.data.id}/claim`, moderator, 'POST', { expectedRevision: 1 })).status).toBe(403)
    await claim('appeals', first.data.id, 1, moderator2)
    expect((await request(`/admin/community/governance/appeals/${first.data.id}/decision`, moderator2, 'POST', { expectedRevision: 2, action: 'reject', reason: '合成材料不足，保留本处罚' })).status).toBe(201)
    expect((await request('/community/governance/appeals', owner, 'POST', { ...input, reason: `${input.reason}，现补充新证据`, evidence: ['https://example.invalid/new'] })).status).toBe(201)
  })
  it('单项限制与临时禁言期限有效，到期即时恢复，不能修改关联处罚绕行', async () => {
    const author = await account(), row = await post(author), expiresAt = new Date(Date.now() + 3600000).toISOString()
    const actionId = await sanction(row.id, 'restrict', moderator, { operation: 'comment', expiresAt })
    let eligibility = await request('/community/eligibility', author)
    expect(eligibility.data.operations.comment.allowed).toBe(false); expect(eligibility.data.operations.post.allowed).toBe(true)
    const restriction = await db.communityOperationRestriction.findUniqueOrThrow({ where: { moderationActionId: actionId } })
    expect((await request(`/admin/community/restrictions/${restriction.id}/revoke`, editor, 'POST', { expectedRevision: 1, reason: '不能越权撤销治理处罚' })).status).toBe(403)
    await db.communityOperationRestriction.update({ where: { id: restriction.id }, data: { startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() - 1000) } })
    await db.communityModerationAction.update({ where: { id: actionId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    eligibility = await request('/community/eligibility', author); expect(eligibility.data.operations.comment.allowed).toBe(true)
    const muteId = await sanction(row.id, 'mute', moderator, { expiresAt })
    eligibility = await request('/community/eligibility', author); expect(eligibility.data.operations.comment.allowed).toBe(false); expect(eligibility.data.operations.post.allowed).toBe(false); expect(eligibility.data.operations.report.allowed).toBe(true)
    expect((await request(`/admin/community/governance/actions/${muteId}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '复核后解除临时禁言' })).status).toBe(201)
    expect((await request('/community/eligibility', author)).data.operations.post.allowed).toBe(true)
  })
  it('到期与申诉撤销不越过新内容审核、作者删除或独立处罚', async () => {
    const row = await post(), id = await sanction(row.id, 'takedown', moderator, { expiresAt: new Date(Date.now() + 3600000).toISOString() })
    await db.communityPost.update({ where: { id: row.id }, data: { status: 'pending_review', revision: 2, publishedAt: null } })
    await db.communityModerationAction.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await request(`/community/posts/${row.id}`, reporter)).status).toBe(404)
    expect((await request(`/admin/community/governance/actions/${id}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '撤销旧处罚仍须当前审核' })).status).toBe(201)
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('pending_review')
    const deleted = await post(), deletedAction = await sanction(deleted.id)
    await db.communityPost.update({ where: { id: deleted.id }, data: { status: 'removed', deletedAt: new Date(), revision: 2 } })
    expect((await request(`/admin/community/governance/actions/${deletedAction}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '只撤销处罚不恢复作者删除' })).status).toBe(201)
    expect((await request(`/community/posts/${deleted.id}`, reporter)).status).toBe(404)
  })
  it('账号封禁失效普通会话，独立恢复凭据只能读取本人和申诉', async () => {
    const author = await account(), row = await post(author), actionId = await sanction(row.id, 'ban', manager, { expiresAt: new Date(Date.now() + 3600000).toISOString() })
    expect((await request('/me', author)).status).toBe(401)
    expect((await request('/auth/login', undefined, 'POST', { identifier: author.username, password })).status).toBe(401)
    expect((await request('/community/recovery/session', undefined, 'POST', { identifier: author.username, password: 'wrong-password' })).status).toBe(401)
    const recovery = await request('/community/recovery/session', undefined, 'POST', { identifier: author.username, password }); expect(recovery.status).toBe(201)
    const recoveryToken = recovery.data.token as string
    expect((await request('/me', recoveryToken)).status).toBe(401)
    expect((await request('/admin/community/governance', recoveryToken)).status).toBe(401)
    expect((await request('/community/recovery/mine', reporter)).status).toBe(401)
    const mine = await request('/community/recovery/mine', recoveryToken); expect(mine.status).toBe(200); expect(mine.data.actions[0].id).toBe(actionId)
    const appeal = await request('/community/recovery/appeals', recoveryToken, 'POST', { actionId, reason: '账号被临时封禁，提供合成上下文申请恢复' }); expect(appeal.status).toBe(201)
    await claim('appeals', appeal.data.id, 1, admin2)
    expect((await request(`/admin/community/governance/appeals/${appeal.data.id}/decision`, admin2, 'POST', { expectedRevision: 2, action: 'approve', reason: '核查后撤销此临时账号处罚' })).status).toBe(201)
    expect((await request('/auth/login', undefined, 'POST', { identifier: author.username, password })).status).toBe(201)
    expect((await request('/me', author)).status).toBe(401) // 撤销不复活已撤销会话。
  })
  it('旧停用账号记录可申诉；重置密码不解除封禁，新状态不能被旧申诉覆盖', async () => {
    const author = await account()
    expect((await request(`/admin/users/${author.id}/status`, admin, 'PATCH', { expectedRevision: 1, status: 'disabled', reason: '合成旧账号停用路径' })).status).toBe(200)
    const action = await db.communityModerationAction.findFirstOrThrow({ where: { subjectId: author.id, action: 'ban' } })
    const recovery = await request('/community/recovery/session', undefined, 'POST', { identifier: author.username, password })
    expect((await request('/community/recovery/mine', recovery.data.token)).data.actions[0].id).toBe(action.id)
    const reset = randomBytes(48).toString('base64url')
    await db.passwordResetToken.create({ data: { userId: author.id, tokenHash: createHash('sha256').update(reset).digest('hex'), expiresAt: new Date(Date.now() + 60000) } })
    expect((await request('/auth/password/reset', undefined, 'POST', { token: reset, password })).status).toBe(201)
    expect((await db.user.findUniqueOrThrow({ where: { id: author.id } })).status).toBe('disabled')
    expect((await request('/community/recovery/mine', recovery.data.token)).status).toBe(401)
    expect((await request(`/admin/users/${author.id}/status`, admin, 'PATCH', { expectedRevision: 2, status: 'locked', reason: '新的账号管理决定应独立复核' })).status).toBe(200)
    expect((await request(`/admin/community/governance/actions/${action.id}/revoke`, admin2, 'POST', { expectedRevision: 1, reason: '旧决定不得覆盖新管理状态' })).status).toBe(409)
    expect((await db.user.findUniqueOrThrow({ where: { id: author.id } })).status).toBe('locked')
  })
  it('退回、重新领取、逾期筛选与混合事项分页没有丢失或重复', async () => {
    const row = await post(), item = await report('post', row.id, await account())
    await claim('reports', item.id, 1)
    expect((await request(`/admin/community/governance/reports/${item.id}/release`, moderator2, 'POST', { expectedRevision: 2 })).status).toBe(409)
    expect((await request(`/admin/community/governance/reports/${item.id}/release`, moderator, 'POST', { expectedRevision: 2 })).status).toBe(201)
    await claim('reports', item.id, 3, moderator2)
    await db.communityReport.update({ where: { id: item.id }, data: { dueAt: new Date(Date.now() - 1000) } })
    const overdue = await request('/admin/community/governance?kind=processing&assigned=mine&overdue=true', moderator2)
    expect(overdue.data.reports.some((r: { id: string }) => r.id === item.id)).toBe(true)
    const first = await request('/admin/community/governance?kind=processing&pageSize=1', admin)
    const ids: string[] = []
    for (let page = 1; page <= first.data.total; page++) {
      const result = await request(`/admin/community/governance?kind=processing&pageSize=1&page=${page}`, admin)
      const rows = [...result.data.reports, ...result.data.appeals, ...result.data.reviews]; expect(rows).toHaveLength(1); ids.push(rows[0].id)
    }
    expect(new Set(ids).size).toBe(first.data.total)
    expect((await request('/admin/community/governance?kind=processing&assigned=unassigned', admin)).data.total).toBe(0)
  })
  it('门户推荐、创作者和摘要同步下架，恢复不泄露已隐藏资料', async () => {
    const author = await account(), row = await post(author)
    await db.communityProfile.update({ where: { userId: author.id }, data: { headline: '需要隐藏的合成资料摘要' } })
    const publication = await db.homepagePublication.create({ data: { version: 999, snapshot: [
      { moduleKey: 'landing_featured', config: { ...LANDING_DEFAULT_CONFIG.landing_featured }, items: [{ targetType: 'community_post', targetId: row.id }] },
      { moduleKey: 'landing_community_overview', config: { ...LANDING_DEFAULT_CONFIG.landing_community_overview }, items: [{ targetType: 'community_user', targetId: author.id }] },
    ] } })
    try {
      const before = await request('/public/homepage'); expect(before.status).toBe(200); expect(JSON.stringify(before.data)).toContain(row.title)
      const actionId = await sanction(row.id)
      const hidden = await request('/public/homepage'); expect(JSON.stringify(hidden.data)).not.toContain(row.title); expect(hidden.data.community.creators).toHaveLength(0)
      expect((await request(`/admin/community/governance/actions/${actionId}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '合成门户下架后撤销' })).status).toBe(201)
      const profile = await request(`/admin/community/governance/targets/profile/${author.id}/decision`, moderator, 'POST', { expectedRevision: 1, action: 'takedown', reason: '合成资料摘要暂下架', ruleCode: '资料规则' }, randomUUID()); expect(profile.status).toBe(201)
      const masked = await request('/public/homepage'); expect(JSON.stringify(masked.data)).toContain(row.title); expect(JSON.stringify(masked.data)).not.toContain('需要隐藏的合成资料摘要'); expect(masked.data.community.creators).toHaveLength(0)
    } finally { await db.homepagePublication.delete({ where: { id: publication.id } }) }
  })
  it('评论下架同步数量、采纳状态、互动和作者资料，期限结束按当前状态恢复', async () => {
    const author = await account(), row = await post(), comment = await db.communityComment.create({ data: { authorId: author.id, postId: row.id, body: '采纳的合成课堂回答', contentBlocks: [], status: 'published' } })
    await db.communityQuestionState.create({ data: { postId: row.id, status: 'solved', acceptedCommentId: comment.id, solvedAt: new Date() } })
    const before = await request(`/community/posts/${row.id}`, reporter); expect(before.data.stats.comments).toBe(1); expect(before.data.question.status).toBe('solved')
    const result = await request(`/admin/community/governance/targets/comment/${comment.id}/decision`, moderator, 'POST', { expectedRevision: 1, action: 'takedown', expiresAt: new Date(Date.now() + 60000).toISOString(), reason: '合成评论需复核', ruleCode: '评论规范' }, randomUUID()); expect(result.status).toBe(201)
    expect((await request(`/community/posts/${row.id}/comments`, reporter)).data.some((c: { id: string }) => c.id === comment.id)).toBe(false)
    const hidden = await request(`/community/posts/${row.id}`, reporter); expect(hidden.data.stats.comments).toBe(0); expect(hidden.data.question).toMatchObject({ status: 'open', acceptedCommentId: null })
    expect((await request(`/community/comments/${comment.id}/like`, reporter, 'PUT')).status).toBe(404)
    await db.communityModerationAction.update({ where: { id: result.data.actionId }, data: { expiresAt: new Date(Date.now() - 1) } })
    expect((await request(`/community/posts/${row.id}`, reporter)).data.stats.comments).toBe(1)
    const profile = await request(`/admin/community/governance/targets/profile/${author.id}/decision`, moderator, 'POST', { expectedRevision: 1, action: 'takedown', reason: '合成账号资料需复核', ruleCode: '资料规范' }, randomUUID()); expect(profile.status).toBe(201)
    const masked = (await request(`/community/posts/${row.id}/comments`, reporter)).data.find((c: { id: string }) => c.id === comment.id)
    expect(masked.author).toMatchObject({ username: '', displayName: '账号资料暂不可见', avatar: null })
    await db.communityModerationAction.update({ where: { id: profile.data.actionId }, data: { expiresAt: new Date(Date.now() - 1) } })
    const restored = (await request(`/community/posts/${row.id}/comments`, reporter)).data.find((c: { id: string }) => c.id === comment.id)
    expect(restored.author.username).toBe(author.username)
  })
  it('旧举报必须重新核对内容版本，举报人不能读取后来改为私人草稿的内容', async () => {
    const row = await post(), item = await report('post', row.id, await account())
    await db.communityReport.update({ where: { id: item.id }, data: { contentRevision: null } }); await claim('reports', item.id, 1)
    const input = { expectedRevision: 2, action: 'warn', reason: '历史举报重新核查', ruleCode: '合成规则' }
    expect((await request(`/admin/community/governance/reports/${item.id}/decision`, moderator, 'POST', input)).status).toBe(409)
    expect((await request(`/admin/community/governance/reports/${item.id}/decision`, moderator, 'POST', { ...input, expectedContentRevision: row.revision })).status).toBe(201)
    const mineReporter = await account(), another = await report('post', row.id, mineReporter)
    await db.communityPost.update({ where: { id: row.id }, data: { status: 'draft', revision: { increment: 1 }, title: '绝不向他人显示的私人草稿标题', plainText: '绝不向他人显示的私人草稿正文' } })
    const mine = await request('/community/governance/mine', mineReporter); expect(JSON.stringify(mine.data)).not.toContain('绝不向他人显示')
    expect(mine.data.reports.find((r: { id: string }) => r.id === another.id).target.available).toBe(false)
    expect(JSON.stringify((await request(`/admin/community/governance/targets/post/${row.id}`, moderator)).data)).not.toContain('绝不向他人显示')
  })
  it('长期处理记录能分页读取，不因超过100条丢失申诉入口', async () => {
    const author = await account()
    await db.communityModerationAction.createMany({ data: Array.from({ length: 102 }, (_, index) => ({ id: `governance-page-${author.id}-${index}`, actorId: moderator.id, subjectId: author.id, targetType: 'profile', targetId: author.id, action: 'warn', reason: '合成历史提醒记录', ruleCode: '合成历史规则' })) })
    const first = await request('/community/governance/mine', author), second = await request('/community/governance/mine?page=2', author)
    expect(first.data.actions).toHaveLength(100); expect(first.data.hasMore).toBe(true)
    expect(second.data.actions).toHaveLength(2); expect(second.data.hasMore).toBe(false)
    expect(new Set([...first.data.actions, ...second.data.actions].map((a: { id: string }) => a.id)).size).toBe(102)
    expect((await request('/community/governance/mine?page=-1', author)).status).toBe(400)
  })
  it('旧功能限制入口同样产生可申诉处罚，调整保留原决定且撤销同步通知', async () => {
    const author = await account(), input = { userId: author.id, operations: ['upload', 'interaction'], endsAt: new Date(Date.now() + 60000).toISOString(), reason: '隔离测试异常操作', ruleCode: '社区规则-操作安全' }
    expect((await request('/admin/community/restrictions', moderator, 'POST', input)).status).toBe(201)
    const mine = await request('/community/governance/mine', author); expect(mine.data.actions).toHaveLength(2)
    const current = await db.communityOperationRestriction.findFirstOrThrow({ where: { userId: author.id, operations: { has: 'upload' }, revokedAt: null } })
    expect((await request(`/admin/community/restrictions/${current.id}`, moderator2, 'PATCH', { expectedRevision: 1, operations: ['comment'], endsAt: input.endsAt, reason: '核查后仅限制评论', ruleCode: '社区规则-评论规范' })).status).toBe(200)
    expect((await db.communityModerationAction.findUniqueOrThrow({ where: { id: current.moderationActionId! } })).revokedAt).not.toBeNull()
    const updated = await db.communityOperationRestriction.findFirstOrThrow({ where: { userId: author.id, operations: { has: 'comment' }, revokedAt: null } })
    expect((await request(`/admin/community/restrictions/${updated.id}/revoke`, moderator, 'POST', { expectedRevision: 1, reason: '已复核解除评论限制' })).status).toBe(201)
    expect((await db.communityModerationAction.findUniqueOrThrow({ where: { id: updated.moderationActionId! } })).revokedAt).not.toBeNull()
    expect((await request('/community/eligibility', author)).data.operations.comment.allowed).toBe(true)
  })
  it('资源下架同步退出社区、资源列表、搜索、作者页和合集，旧媒体链接失效', async () => {
    const author = await account()
    const cover = await upload('/community/media', author, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer(), 'image/png', 'governance.png')
    const attachment = await upload('/resource-hub/uploads/document', author, new TextEncoder().encode('合成资源附件'), 'text/plain', 'governance.txt')
    const created = await request('/community/posts', author, 'POST', { type: 'general', title: '治理媒体隔离样本', contentBlocks: [{ type: 'paragraph', text: '治理媒体隔离样本' }, { type: 'image', fileId: cover, alt: '合成说明' }], bindings: [], topicIds: [], visibility: 'public', status: 'published', contribution: { kind: 'document', tags: ['合成课程'], teachingReuseConsent: false, coverFileId: cover, attachmentFileId: attachment } })
    expect(created.status).toBe(201); const id = created.data.id as string
    const collection = await db.learningCollection.create({ data: { ownerId: author.id, name: '合成教学合集', visibility: 'community', items: { create: { contributionPostId: id, sortOrder: 0 } } } })
    const before = (await request(`/resource-hub/contributions/${id}`, reporter)).data.contribution
    const direct = (await request(`/community/media/${cover}/url`, reporter)).data.url as string
    for (const url of [before.coverUrl, before.attachment.downloadUrl]) expect(await mediaStatus(url)).toBe(200)
    const actionId = await sanction(id)
    for (const path of [`/community/posts/${id}`, `/resource-hub/contributions/${id}`]) expect((await request(path, reporter)).status).toBe(404)
    for (const path of ['/community/posts', '/resource-hub/items', `/community/users/${author.id}/posts`, `/resource-hub/creators/${author.id}`, `/resource-hub/collections/${collection.id}`, '/community/search?type=posts&q=治理媒体隔离样本']) {
      const result = await request(path, reporter); expect(result.status).toBe(200); expect(JSON.stringify(result.data)).not.toContain('治理媒体隔离样本')
    }
    for (const url of [before.coverUrl, before.attachment.downloadUrl]) expect(await mediaStatus(url)).toBe(404)
    expect(await mediaStatus(direct, reporter)).toBe(404)
    expect((await request('/community/governance/mine', author)).data.actions[0].target.text).toContain('治理媒体隔离样本')
    expect((await request(`/admin/community/governance/actions/${actionId}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '核查后恢复此资源作品' })).status).toBe(201)
    expect(await mediaStatus(before.coverUrl)).toBe(200); expect(await mediaStatus(direct, reporter)).toBe(200)
    expect((await request(`/resource-hub/collections/${collection.id}`, reporter)).data.items.some((r: { contribution: { postId: string } }) => r.contribution.postId === id)).toBe(true)
  })
  it('公开合集和账号资料下架生效，恢复不会公开已改为私人的合集', async () => {
    const author = await account(), collection = await db.learningCollection.create({ data: { ownerId: author.id, name: '合成合集治理', visibility: 'community' } })
    const result = await request(`/admin/community/governance/targets/collection/${collection.id}/decision`, moderator, 'POST', { expectedRevision: 1, action: 'takedown', reason: '合成公开合集风险', ruleCode: '合集规范' }, randomUUID()); expect(result.status).toBe(201)
    expect((await request(`/resource-hub/collections/${collection.id}`, reporter)).status).toBe(404)
    await db.learningCollection.update({ where: { id: collection.id }, data: { visibility: 'private', revision: { increment: 1 } } })
    expect((await request(`/admin/community/governance/actions/${result.data.actionId}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '撤销处罚但不覆盖私人状态' })).status).toBe(201)
    expect((await request(`/resource-hub/collections/${collection.id}`, reporter)).status).toBe(404)
    const avatar = await upload('/community/media', author, await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer(), 'image/png', 'avatar.png')
    await db.fileRecord.update({ where: { id: avatar }, data: { visibility: 'public' } }); await db.communityProfile.update({ where: { userId: author.id }, data: { avatarFileId: avatar } })
    expect(await mediaStatus(`/api/v1/files/profile/${avatar}`)).toBe(200)
    const profile = await request(`/admin/community/governance/targets/profile/${author.id}/decision`, moderator, 'POST', { expectedRevision: 1, action: 'takedown', reason: '合成公开资料风险', ruleCode: '资料规范' }, randomUUID()); expect(profile.status).toBe(201)
    expect((await request(`/community/users/${author.id}`, reporter)).status).toBe(404)
    expect((await request(`/community/search?type=users&q=${author.username}`, reporter)).data.users).toHaveLength(0)
    expect(await mediaStatus(`/api/v1/files/profile/${avatar}`)).toBe(404)
    await request(`/admin/community/governance/actions/${profile.data.actionId}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '核查后恢复公开资料' })
    expect(await mediaStatus(`/api/v1/files/profile/${avatar}`)).toBe(200)
  })
  it('视频下架阻断播放信息、历史地址和Range请求，解除后重新可播', async () => {
    const author = await account(), file = join(uploads, 'synthetic-video.mp4')
    await runMediaCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=32x32:r=10', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file])
    const id = await upload('/resource-hub/uploads/video', author, await readFile(file), 'video/mp4', 'synthetic-video.mp4')
    const deadline = Date.now() + 20000
    let video = await request(`/resource-hub/videos/${id}`, author)
    while (video.data.status !== 'ready' && Date.now() < deadline && video.data.status !== 'failed') { await delay(100); video = await request(`/resource-hub/videos/${id}`, author) }
    expect(video.data.status).toBe('ready')
    const published = await request('/community/posts', author, 'POST', { type: 'general', title: '合成视频治理', contentBlocks: [{ type: 'paragraph', text: '正常课程说明' }], bindings: [], topicIds: [], visibility: 'public', status: 'published', contribution: { kind: 'video', tags: [], teachingReuseConsent: false, videoAssetId: id } }); expect(published.status).toBe(201)
    const playback = await request(`/resource-hub/videos/${id}/playback`, reporter); expect(playback.status).toBe(200)
    const url = playback.data.sources[0].src as string; expect(await mediaStatus(url, undefined, 'bytes=0-15')).toBe(206)
    const actionId = await sanction(published.data.id)
    expect(await mediaStatus(url, undefined, 'bytes=0-15')).toBe(404); expect((await request(`/resource-hub/videos/${id}/playback`, reporter)).status).toBe(404)
    await request(`/admin/community/governance/actions/${actionId}/revoke`, moderator2, 'POST', { expectedRevision: 1, reason: '核查后恢复视频内容' })
    expect(await mediaStatus(url, undefined, 'bytes=0-15')).toBe(206)
  }, 30000)
  it('申诉可撤销具体内容复核，新修订与新规则均不能被旧申诉放行', async () => {
    const author = await account(), row = await post(author, { status: 'pending_review', publishedAt: null })
    const policy = await request('/admin/community/content-policy', admin)
    const review = await db.contentReview.create({ data: { targetType: 'post', targetId: row.id, authorId: author.id, submittedById: author.id, contentRevision: row.revision, ruleVersion: policy.data.version, status: 'rejected', reviewedById: moderator.id, reason: '合成待审样本', action: 'review', findings: {} } })
    const appeal = await request('/community/governance/appeals', author, 'POST', { reviewId: review.id, reason: '此修订是正常课程示例，请重新核查' }); expect(appeal.status).toBe(201)
    await claim('appeals', appeal.data.id, 1, moderator2)
    await db.communityPost.update({ where: { id: row.id }, data: { revision: { increment: 1 } } })
    expect((await request(`/admin/community/governance/appeals/${appeal.data.id}/decision`, moderator2, 'POST', { expectedRevision: 2, action: 'approve', reason: '旧修订不可放行新的内容' })).status).toBe(409)
    expect((await db.contentReview.findUniqueOrThrow({ where: { id: review.id } })).status).toBe('rejected')
    const valid = await post(author, { status: 'pending_review', publishedAt: null })
    const next = await db.contentReview.create({ data: { targetType: 'post', targetId: valid.id, authorId: author.id, submittedById: author.id, contentRevision: 1, ruleVersion: policy.data.version, status: 'rejected', reviewedById: moderator.id, reason: '合成引用需核查', action: 'review', findings: {} } })
    const validAppeal = await request('/community/governance/appeals', author, 'POST', { reviewId: next.id, reason: '提供完整合成上下文，申请撤销本修订拒绝' })
    await claim('appeals', validAppeal.data.id, 1, moderator2)
    expect((await request(`/admin/community/governance/appeals/${validAppeal.data.id}/decision`, moderator2, 'POST', { expectedRevision: 2, action: 'approve', reason: '当前修订上下文核查通过' })).status).toBe(201)
    expect((await request(`/community/posts/${valid.id}`, reporter)).status).toBe(200)
  })
})
