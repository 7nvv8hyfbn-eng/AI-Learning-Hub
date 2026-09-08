import 'reflect-metadata'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:net'
import { randomBytes, createHash, createHmac } from 'node:crypto'
import { NestFactory, Reflector } from '@nestjs/core'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import cookieParser from 'cookie-parser'
import { AppModule } from '../src/app.module'
import { ApiExceptionFilter } from '../src/common/api-exception.filter'
import { ApiResponseInterceptor } from '../src/common/api-response.interceptor'
import { OperationLogInterceptor } from '../src/common/operation-log.interceptor'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuthGuard } from '../src/modules/auth/auth.guard'
import { encryptIdentity, identityFingerprint } from '../src/modules/users/identity-data'
import type { AuthSessionDto, CampusIdentityVerificationDto, CommunityDraftDto, CommunityEligibilityDto, CommunityEligibilityPolicyDto, CommunityOperationRestrictionDto, CommunitySearchResultDto, LearningCollectionDto } from '@ai-learning-hub/contracts'
if (!process.env.DATABASE_URL?.includes('127.0.0.1:55439/community_')) throw new Error('只允许隔离本地社区数据库')
const db = new PrismaClient(), prefix = `r2-${Date.now()}`, password = `Verify7${randomBytes(16).toString('hex')}`, messages: string[] = []
const settings = {
  mode: 'open', emailVerification: false, agreementVersion: '2026-08-30', passwordMinLength: 8, schoolRequired: false,
  registrationRateWindowMinutes: 15, registrationMaxAttemptsPerIp: 10, registrationMaxAttemptsPerIdentifier: 2, registrationMaxSuccessPerIp: 5,
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const idNumberFor = (name: string) => {
  const base = `11010519900101${String(parseInt(sha(name).slice(0, 3), 16) % 1000).padStart(3, '0')}`
  return `${base}${'10X98765432'[[7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2].reduce((sum, weight, index) => sum + Number(base[index]) * weight, 0) % 11]}`
}
const identityKey = Buffer.alloc(32, 9)
let app: INestApplication, smtp: Server, base: string, admin: string, actor: AuthSessionDto
const body = (name: string) => ({ username: `u${sha(`${prefix}-${name}`).slice(0, 20)}`, displayName: '新学习者', email: `${prefix}-${name}@example.invalid`, password, agreementVersion: settings.agreementVersion })
async function request<T = any>(path: string, token?: string, method = 'GET', input?: unknown, headers = {}) {
  // 既有业务用例按新编辑契约携带当前版本；并发/缺失版本用例在 persistence.e2e 中直接发原始请求。
  if (input && typeof input === 'object') {
    let revision: number | undefined
    const postId = path.match(/^\/community\/(?:posts|drafts)\/([^/]+)$/)?.[1]
    if (method === 'PATCH' && postId) revision = (await db.communityPost.findUnique({ where: { id: postId } }))?.revision
    if (method === 'PATCH' && path === '/admin/registration/settings') revision = (await db.systemSetting.findUnique({ where: { key: 'registration' } }))?.revision
    if (path === '/community/onboarding' && token) {
      const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).id
      revision = (await db.user.findUnique({ where: { id: userId } }))?.revision
      input = { ...input, expectedProfileRevision: (await db.communityProfile.findUnique({ where: { userId } }))?.revision || 1 }
    }
    const userId = path.match(/^\/admin\/users\/([^/]+)\/status$/)?.[1]
    if (userId) { revision = (await db.user.findUnique({ where: { id: userId } }))?.revision; input = { ...(input as object), reason: '隔离回归验证账号禁用' } }
    if (revision) input = { ...(input as object), expectedRevision: revision }
  }
  const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(input ? { body: JSON.stringify(input) } : {}) })
  const payload = await response.json()
  return { status: response.status, data: payload.data as T, message: payload.message as string, errorCode: payload.errorCode as string | undefined, availableAt: payload.availableAt as string | undefined, retryAfter: response.headers.get('retry-after'), cookie: response.headers.getSetCookie() }
}
async function register(name: string, extra = {}) { return request<AuthSessionDto>('/auth/register', undefined, 'POST', { ...body(name), ...extra }) }
async function approve(userId: string, name: string) {
  const idNumber = idNumberFor(`${prefix}-${name}`), studentNo = `E2E${sha(`${prefix}-${name}`).slice(0, 12).toUpperCase()}`
  await db.campusIdentityVerification.upsert({
    where: { userId },
    create: {
      userId,
      realNameEncrypted: encryptIdentity('测试同学', identityKey, 'real-name'),
      idNumberEncrypted: encryptIdentity(idNumber, identityKey, 'id-number'),
      idNumberFingerprint: identityFingerprint(idNumber, identityKey),
      idNumberLast4: idNumber.slice(-4), className: '隔离测试班', studentNo, status: 'approved', submittedAt: new Date(), reviewedAt: new Date(), reviewReason: '隔离 E2E 前置条件',
    },
    update: { status: 'approved', reviewedAt: new Date(), reviewReason: '隔离 E2E 前置条件' },
  })
  await db.user.update({ where: { id: userId }, data: { studentNo } })
}
async function mailToken(start: number) {
  await vi.waitFor(() => expect(messages.length).toBeGreaterThan(start), { timeout: 3000 })
  const text = messages.at(-1)!.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  const token = text.match(/#token=([A-Za-z0-9_-]{40,128})/)?.[1]
  expect(token).toBeTruthy()
  return token!
}
beforeAll(async () => {
  smtp = createServer((socket) => {
    socket.write('220 localhost test SMTP\r\n')
    let buffer = '', data = false, content = ''
    socket.on('data', (bytes) => {
      buffer += bytes.toString()
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n'), line = buffer.slice(0, index + 1); buffer = buffer.slice(index + 1)
        if (data) { if (line.trim() === '.') { messages.push(content); content = ''; data = false; socket.write('250 queued\r\n') } else content += line; continue }
        if (/^(EHLO|HELO)/.test(line)) socket.write('250-localhost\r\n250 OK\r\n')
        else if (/^DATA/.test(line)) { data = true; socket.write('354 end with dot\r\n') }
        else if (/^QUIT/.test(line)) socket.end('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve))
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String((smtp.address() as { port: number }).port), SMTP_FROM: 'test@example.invalid', SMTP_ALLOW_INSECURE: 'true', FRONTEND_URL: 'http://127.0.0.1:5188', REGISTRATION_INVITE_HASHES: sha('local-test-invite'), IDENTITY_DATA_KEY: identityKey.toString('hex') })
  app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1'); app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(app.get(OperationLogInterceptor), new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1`
  admin = (await request<AuthSessionDto>('/auth/login', undefined, 'POST', { identifier: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD })).data.accessToken
  actor = (await register('actor')).data
  await approve(actor.user.id, 'actor')
}, 30000)
beforeEach(async () => {
  vi.restoreAllMocks()
  await db.registrationThrottle.deleteMany({})
  await db.systemSetting.deleteMany({ where: { key: 'community_eligibility_policy' } })
  await db.systemSetting.upsert({ where: { key: 'registration' }, create: { key: 'registration', value: settings }, update: { value: settings } })
})
afterAll(async () => { await app?.close(); await new Promise<void>((resolve) => smtp?.close(() => resolve())); await db.$disconnect() })
describe('COMM-002 注册、导航配套与社区补全真实回归', () => {
  it('注册规范化邮箱，同事务创建学生/资料/协议/活动/会话', async () => {
    const result = await register('normal', { email: `  ${prefix.toUpperCase()}-NORMAL@EXAMPLE.INVALID  ` })
    expect(result.status).toBe(201)
    expect(result.data.user).toMatchObject({ email: `${prefix}-normal@example.invalid`, roles: ['student'], onboardingCompleted: false, avatarUrl: null })
    expect(result.data.user.username).toBe(body('normal').username)
    expect(result.cookie.some((cookie) => cookie.startsWith('refresh_token=') && cookie.includes('HttpOnly'))).toBe(true)
    const user = await db.user.findUniqueOrThrow({ where: { id: result.data.user.id }, include: { communityProfile: true, activities: true, refreshTokens: true } })
    expect(user.passwordHash).not.toBe(password); expect(user.agreementAcceptedAt).toBeTruthy()
    expect(user.communityProfile).toBeTruthy(); expect(user.activities[0].eventType).toBe('student_register'); expect(user.refreshTokens).toHaveLength(1)
    expect(JSON.stringify(result.data.user)).not.toContain('passwordHash')
  })
  it('并发同邮箱只创建一个完整账号', async () => {
    const results = await Promise.all([register('race'), register('race')])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await db.user.count({ where: { email: body('race').email } })).toBe(1)
  })
  it('账号大小写不敏感唯一且不会自动改名', async () => {
    const first = await register('case-one')
    const duplicate = await register('case-two', { username: first.data.user.username.toUpperCase() })
    expect(first.status).toBe(201)
    expect(duplicate.status).toBe(409)
    expect(await db.user.count({ where: { username: { equals: first.data.user.username, mode: 'insensitive' } } })).toBe(1)
  })
  it('用户名和邮箱均可登录同一账号', async () => {
    const account = (await register('dual-login')).data
    for (const identifier of [account.user.username.toUpperCase(), account.user.email.toUpperCase()]) {
      const login = await request<AuthSessionDto>('/auth/login', undefined, 'POST', { identifier, password })
      expect(login.status).toBe(201)
      expect(login.data.user.id).toBe(account.user.id)
    }
  })
  it('服务器拒绝密码规则、协议版本、注入角色与超过72 UTF8字节', async () => {
    for (const [name, extra] of [['short', { password: 'Abc1234' }], ['letters', { password: 'abcdefgh' }], ['agreement', { agreementVersion: 'old' }], ['role', { roles: ['admin'] }], ['bytes', { password: `${'中'.repeat(24)}A1` }], ['long', { password: `${'A'.repeat(72)}1` }]] as const) expect((await register(name, extra)).status).toBe(400)
    expect((await register('boundary', { password: `${'A'.repeat(71)}1` })).status).toBe(201)
  })
  it('会话创建失败回滚账号、资料和事件', async () => {
    const prisma = app.get(PrismaService)
    const original = prisma.$transaction.bind(prisma)
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(((callback: any, options: any) => original(async (tx: any) => { tx.refreshToken.create = () => { throw new Error('injected session write') }; return callback(tx) }, options)) as any)
    expect((await register('rollback')).status).toBe(500)
    expect(await db.user.count({ where: { email: body('rollback').email } })).toBe(0)
  })
  it('后置操作日志失败不把已提交注册伪装成失败', async () => {
    vi.spyOn(app.get(PrismaService).operationLog, 'create').mockRejectedValueOnce(new Error('injected audit failure'))
    const response = await register('audit')
    expect(response.status).toBe(201)
    expect(await db.user.count({ where: { id: response.data.user.id } })).toBe(1)
  })
  it('open/invite/closed配置真实生效且普通用户不能配置', async () => {
    expect((await request('/admin/registration/settings', actor.accessToken, 'PATCH', settings)).status).toBe(403)
    expect((await request('/admin/registration/settings', admin, 'PATCH', { ...settings, mode: 'closed' })).status).toBe(200)
    expect((await register('closed')).message).toContain('注册已关闭')
    await request('/admin/registration/settings', admin, 'PATCH', { ...settings, mode: 'invite' })
    expect((await register('noinvite')).status).toBe(400)
    expect((await register('invite', { inviteCode: 'local-test-invite' })).status).toBe(201)
    const config = await request('/auth/registration-config')
    expect(JSON.stringify(config)).not.toContain('local-test-invite'); expect(JSON.stringify(config)).not.toContain(sha('local-test-invite'))
  })
  it('邮箱与IP原子限流，直连伪造转发头不能绕过', async () => {
    for (let n = 0; n < 2; n++) await register('rate', { agreementVersion: 'old' })
    expect((await register('rate')).status).toBe(429)
    await db.registrationThrottle.deleteMany({})
    for (let n = 0; n < 10; n++) await request('/auth/register', undefined, 'POST', { ...body(`ip${n}`), agreementVersion: 'old' }, { 'x-forwarded-for': `198.51.100.${n}`, 'x-real-ip': `198.51.100.${n}` })
    expect((await register('ip11')).status).toBe(429)
  })
  it('通用设置不能绕过专用注册校验，公开配置只含白名单字段', async () => {
    expect((await request('/admin/settings', admin, 'PATCH', { key: 'registration', value: { mode: 'invite', passwordMinLength: 1 } })).status).toBe(400)
    const version = Number((await db.systemSetting.findUnique({ where: { key: 'settings_version' } }))?.value || 0)
    expect((await request('/admin/settings/batch', admin, 'PATCH', { version: version + 1, items: [{ key: 'registration', value: { injected: 'not-public' } }] })).status).toBe(400)
    await db.systemSetting.update({ where: { key: 'registration' }, data: { value: { ...settings, injected: 'not-public', SMTP_PASSWORD: 'not-a-secret-test-marker' } } })
    const response = await request('/auth/registration-config')
    expect(Object.keys(response.data).sort()).toEqual([...Object.keys(settings), 'mailAvailable', 'inviteAvailable', 'revision'].sort())
    expect(JSON.stringify(response)).not.toContain('not-public')
  })
  it('真实发布并发限流为5次，草稿不计数且不能通过草稿发布绕过', async () => {
    const user = (await register('publish-rate')).data
    await approve(user.user.id, 'publish-rate')
    const input = { type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'draft' }
    const draft = await request<{ id: string }>('/community/drafts', user.accessToken, 'POST', input)
    expect(draft.status).toBe(201)
    expect(await db.activityEvent.count({ where: { userId: user.user.id, eventType: 'community_post_publish' } })).toBe(0)
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => request('/community/posts', user.accessToken, 'POST', { ...input, status: 'published', contentBlocks: [{ type: 'paragraph', text: `独立并发发布${i}` }] })))
    expect(responses.map((row) => row.status).sort()).toEqual([201, 201, 201, 201, 201, 429])
    expect(responses.find((row) => row.status === 429)).toMatchObject({ errorCode: 'COMMUNITY_RATE_LIMITED', availableAt: expect.any(String), retryAfter: expect.stringMatching(/^\d+$/) })
    expect(await db.communityPost.count({ where: { authorId: user.user.id, status: 'published' } })).toBe(5)
    expect(await db.activityEvent.count({ where: { userId: user.user.id, eventType: 'community_post_publish' } })).toBe(5)
    expect((await request(`/community/posts/${draft.data.id}`, user.accessToken, 'PATCH', { ...input, status: 'published', contentBlocks: [{ type: 'paragraph', text: '不能借草稿绕过发布门禁' }] })).status).toBe(429)
    expect((await request('/community/drafts', user.accessToken, 'POST', input)).status).toBe(201)
  })
  it('未实名直调公开写接口返回分操作原因，但草稿保存和读取继续可用', async () => {
    expect((await request('/community/eligibility')).status).toBe(401)
    const account = (await register('direct-eligibility')).data
    const eligibility = await request<CommunityEligibilityDto>('/community/eligibility', account.accessToken)
    expect(eligibility.data).toMatchObject({ canRead: true, canPost: false, canComment: false, canUpload: false })
    expect(eligibility.data.operations).toMatchObject({ read: { allowed: true }, post: { allowed: false }, comment: { allowed: false }, upload: { allowed: false } })
    expect(eligibility.data.operations.post).toMatchObject({ reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED', nextAction: { route: '/community/verification' } })
    const draftInput = { type: 'general', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'draft' }
    expect((await request('/community/drafts', account.accessToken, 'POST', draftInput)).status).toBe(201)
    const target = await request<{ id: string }>('/community/posts', actor.accessToken, 'POST', { ...draftInput, status: 'published', contentBlocks: [{ type: 'paragraph', text: `直连接口资格目标${prefix}` }] })
    const deniedPost = await request('/community/posts', account.accessToken, 'POST', { ...draftInput, status: 'published', contentBlocks: [{ type: 'paragraph', text: '未实名不能直接发布' }] })
    const deniedComment = await request(`/community/posts/${target.data.id}/comments`, account.accessToken, 'POST', { contentBlocks: [{ type: 'paragraph', text: '未实名不能直接评论' }] })
    const deniedUpload = await request('/community/media', account.accessToken, 'POST', {})
    for (const response of [deniedPost, deniedComment, deniedUpload]) expect(response).toMatchObject({ status: 403, errorCode: 'COMMUNITY_VERIFICATION_REQUIRED' })
  })
  it('资源投稿沿用发布资格，原创内容不要求预建课程、文章或实训', async () => {
    const account = (await register('resource-contribution')).data
    await approve(account.user.id, 'resource-contribution')
    const response = await request<{ bindings: unknown[]; contribution: { kind: string } }>('/community/posts', account.accessToken, 'POST', {
      type: 'frontier_discussion', title: `原创图文资源${prefix}`, contentBlocks: [{ type: 'paragraph', text: '整理可复现的学习步骤与适用边界。' }], bindings: [], topicIds: [], visibility: 'public', status: 'published',
      contribution: { kind: 'article', tags: ['原创实践'], teachingReuseConsent: true },
    })
    expect(response.status).toBe(201)
    expect(response.data).toMatchObject({ bindings: [], contribution: { kind: 'article' } })
  })
  it('上传配额在文件拦截前生效，同一幂等键重试不重复计数', async () => {
    const account = (await register('upload-preflight')).data
    await approve(account.user.id, 'upload-preflight')
    const current = await request<CommunityEligibilityPolicyDto>('/admin/community/eligibility-policy', admin)
    expect((await request('/admin/community/eligibility-policy', admin, 'PATCH', { expectedRevision: current.data.revision, operation: 'upload', limit: 1, windowSeconds: 60, reason: '隔离回归上传前置配额' })).status).toBe(200)
    const headers = { 'idempotency-key': `upload-${sha(prefix).slice(0, 20)}` }
    expect((await request('/community/media', account.accessToken, 'POST', {}, headers)).status).toBe(400)
    expect((await request('/community/media', account.accessToken, 'POST', {}, headers)).status).toBe(400)
    expect(await request('/community/media', account.accessToken, 'POST', {}, { 'idempotency-key': `upload-next-${sha(prefix).slice(0, 20)}` })).toMatchObject({ status: 429, errorCode: 'COMMUNITY_RATE_LIMITED', retryAfter: expect.stringMatching(/^\d+$/) })
  })
  it('临时限制只命中指定操作，服务端时间到期后自动恢复且全过程可审计', async () => {
    const account = (await register('temporary-restriction')).data
    await approve(account.user.id, 'temporary-restriction')
    const target = await request<{ id: string }>('/community/posts', actor.accessToken, 'POST', { type: 'general', contentBlocks: [{ type: 'paragraph', text: `临时限制评论目标${prefix}` }], bindings: [], topicIds: [], visibility: 'public', status: 'published' })
    const created = await request<CommunityOperationRestrictionDto>('/admin/community/restrictions', admin, 'POST', { userId: account.user.id, operations: ['post'], startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 60_000).toISOString(), reason: '隔离回归临时限制' })
    expect(created.status).toBe(201)
    expect((await request<CommunityEligibilityDto>('/community/eligibility', account.accessToken)).data.operations.post).toMatchObject({ reasonCode: 'COMMUNITY_OPERATION_RESTRICTED', availableAt: created.data.endsAt })
    const post = { type: 'general', contentBlocks: [{ type: 'paragraph', text: '受限期间发布' }], bindings: [], topicIds: [], visibility: 'public', status: 'published' }
    expect((await request('/community/posts', account.accessToken, 'POST', post)).status).toBe(403)
    expect((await request(`/community/posts/${target.data.id}/comments`, account.accessToken, 'POST', { contentBlocks: [{ type: 'paragraph', text: '发帖限制不应影响评论' }] })).status).toBe(201)
    await db.communityOperationRestriction.update({ where: { id: created.data.id }, data: { endsAt: new Date(Date.now() - 1_000) } })
    expect((await request<CommunityEligibilityDto>('/community/eligibility', account.accessToken)).data.operations.post.allowed).toBe(true)
    expect((await request('/community/posts', account.accessToken, 'POST', post)).status).toBe(201)
    const profileRestriction = await request<CommunityOperationRestrictionDto>('/admin/community/restrictions', admin, 'POST', { userId: account.user.id, operations: ['profile'], endsAt: new Date(Date.now() + 60_000).toISOString(), reason: '隔离回归公开资料限制' })
    const profile = await request<{ revision: number; displayName: string }>('/me', account.accessToken)
    expect(await request('/me', account.accessToken, 'PATCH', { expectedRevision: profile.data.revision, displayName: `${profile.data.displayName}甲` })).toMatchObject({ status: 403, errorCode: 'COMMUNITY_OPERATION_RESTRICTED' })
    await db.communityOperationRestriction.update({ where: { id: profileRestriction.data.id }, data: { startsAt: new Date(Date.now() - 2_000), endsAt: new Date(Date.now() - 1_000) } })
    expect((await request('/me', account.accessToken, 'PATCH', { expectedRevision: profile.data.revision, displayName: `${profile.data.displayName}乙` })).status).toBe(200)
    expect(await db.communityModerationAction.count({ where: { targetType: 'community_restriction', targetId: created.data.id, action: 'create' } })).toBe(1)
  })
  it('账号限流不误伤共享出口中的其他账号，同幂等键并发重试只发布一次', async () => {
    const first = (await register('shared-egress-a')).data, second = (await register('shared-egress-b')).data
    await approve(first.user.id, 'shared-egress-a'); await approve(second.user.id, 'shared-egress-b')
    const current = await request<CommunityEligibilityPolicyDto>('/admin/community/eligibility-policy', admin)
    expect((await request('/admin/community/eligibility-policy', admin, 'PATCH', { expectedRevision: current.data.revision, operation: 'post', limit: 1, windowSeconds: 60, reason: '隔离回归账号阈值' })).status).toBe(200)
    const input = (text: string) => ({ type: 'general', contentBlocks: [{ type: 'paragraph', text }], bindings: [], topicIds: [], visibility: 'public', status: 'published' })
    expect((await request('/community/posts', first.accessToken, 'POST', input('共享出口账号一'))).status).toBe(201)
    expect((await request('/community/posts', second.accessToken, 'POST', input('共享出口账号二'))).status).toBe(201)
    const limited = await request('/community/posts', first.accessToken, 'POST', input('账号一再次发布'))
    expect(limited).toMatchObject({ status: 429, errorCode: 'COMMUNITY_RATE_LIMITED', retryAfter: expect.stringMatching(/^\d+$/) })

    await db.registrationThrottle.deleteMany({})
    const retryAccount = (await register('idempotent-publish')).data
    await approve(retryAccount.user.id, 'idempotent-publish')
    const retryInput = input(`并发幂等发布${prefix}`), headers = { 'idempotency-key': `post-${sha(prefix).slice(0, 20)}` }
    const concurrent = await Promise.all([request<{ id: string }>('/community/posts', retryAccount.accessToken, 'POST', retryInput, headers), request<{ id: string }>('/community/posts', retryAccount.accessToken, 'POST', retryInput, headers)])
    expect(concurrent.map((row) => row.status)).toEqual([201, 201])
    expect(new Set(concurrent.map((row) => row.data.id))).toHaveLength(1)
    expect((await request<{ id: string }>('/community/posts', retryAccount.accessToken, 'POST', retryInput, headers)).data.id).toBe(concurrent[0].data.id)
    expect(await db.activityEvent.count({ where: { userId: retryAccount.user.id, eventType: 'community_post_publish', targetId: concurrent[0].data.id } })).toBe(1)
  })
  it('后台代发按实际作者隔离幂等键，重试不重复发布', async () => {
    const first = (await register('official-idempotency-a')).data, second = (await register('official-idempotency-b')).data
    const role = await db.role.findUniqueOrThrow({ where: { code: 'community_official' } })
    await db.communityProfile.updateMany({ where: { userId: { in: [first.user.id, second.user.id] } }, data: { verifiedType: 'official' } })
    await db.userRole.createMany({ data: [first.user.id, second.user.id].map((userId) => ({ userId, roleId: role.id })), skipDuplicates: true })
    const input = { type: 'general', title: '', contentBlocks: [{ type: 'paragraph', text: `后台代发幂等隔离${prefix}` }], bindings: [], topicIds: [], visibility: 'public', status: 'published', reason: '隔离回归后台代发' }
    const headers = { 'idempotency-key': `official-${sha(prefix).slice(0, 20)}` }
    const firstPost = await request<{ id: string; author: { id: string } }>(`/admin/community/official/${first.user.id}/posts`, admin, 'POST', input, headers)
    const secondPost = await request<{ id: string; author: { id: string } }>(`/admin/community/official/${second.user.id}/posts`, admin, 'POST', input, headers)
    const retry = await request<{ id: string }>(`/admin/community/official/${first.user.id}/posts`, admin, 'POST', input, headers)
    expect([firstPost.status, secondPost.status, retry.status]).toEqual([201, 201, 201])
    expect(firstPost.data).toMatchObject({ author: { id: first.user.id } })
    expect(secondPost.data).toMatchObject({ author: { id: second.user.id } })
    expect(secondPost.data.id).not.toBe(firstPost.data.id)
    expect(retry.data.id).toBe(firstPost.data.id)
    expect(await db.communityPost.count({ where: { id: { in: [firstPost.data.id, secondPost.data.id] } } })).toBe(2)
  })
  it('公开合集走独立资格且同一幂等键并发只创建一次', async () => {
    const account = (await register('collection-idempotency')).data
    const input = { name: `公开合集${prefix}`, description: '隔离回归', learningGoal: '验证公开合集资格与幂等', visibility: 'community' }
    expect((await request('/resource-hub/collections', account.accessToken, 'POST', input)).status).toBe(403)
    await approve(account.user.id, 'collection-idempotency')
    const headers = { 'idempotency-key': `collection-${sha(prefix).slice(0, 20)}` }
    const rows = await Promise.all([request<LearningCollectionDto>('/resource-hub/collections', account.accessToken, 'POST', input, headers), request<LearningCollectionDto>('/resource-hub/collections', account.accessToken, 'POST', input, headers)])
    expect(rows.map((row) => row.status)).toEqual([201, 201])
    expect(new Set(rows.map((row) => row.data.id))).toHaveLength(1)
    expect(await db.learningCollection.count({ where: { ownerId: account.user.id, name: input.name } })).toBe(1)
  })
  it('显式受信代理区分客户端，默认不信任任意转发链', async () => {
    const express = app.getHttpAdapter().getInstance()
    express.set('trust proxy', ['loopback'])
    try {
      await request('/auth/register', undefined, 'POST', { ...body('proxy1'), agreementVersion: 'old' }, { 'x-forwarded-for': '198.51.100.1' })
      await request('/auth/register', undefined, 'POST', { ...body('proxy2'), agreementVersion: 'old' }, { 'x-forwarded-for': '198.51.100.2' })
      const secret = process.env.JWT_SECRET!
      const hmac = (value: string) => createHmac('sha256', secret).update(value).digest('hex')
      expect(await db.registrationThrottle.count({ where: { identityKey: { in: [hmac('register:attempt:ip:198.51.100.1'), hmac('register:attempt:ip:198.51.100.2')] } } })).toBe(2)
    } finally { express.set('trust proxy', false) }
  })
  it('找回通用文案、SMTP真实协议、数据库只存令牌哈希', async () => {
    const start = messages.length
    const existing = await request('/auth/password/forgot', undefined, 'POST', { email: actor.user.email })
    const missing = await request('/auth/password/forgot', undefined, 'POST', { email: body('absent').email })
    expect(existing.status).toBe(201); expect(existing.data).toEqual(missing.data)
    const token = await mailToken(start), row = await db.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: sha(token) } })
    expect(JSON.stringify(row)).not.toContain(token)
    expect((await request('/auth/password/reset', undefined, 'POST', { token, password: `${password}2` })).status).toBe(201)
    expect((await request('/auth/password/reset', undefined, 'POST', { token, password })).status).toBe(400)
    expect(await db.refreshToken.count({ where: { userId: actor.user.id, revokedAt: null } })).toBe(0)
    expect((await request('/me', actor.accessToken)).status).toBe(401)
  })
  it('过期和并发重置令牌拒绝复用', async () => {
    const token = randomBytes(48).toString('base64url')
    await db.passwordResetToken.create({ data: { userId: actor.user.id, tokenHash: sha(token), expiresAt: new Date(Date.now() - 1000) } })
    expect((await request('/auth/password/reset', undefined, 'POST', { token, password })).status).toBe(400)
    await db.passwordResetToken.update({ where: { tokenHash: sha(token) }, data: { expiresAt: new Date(Date.now() + 60000) } })
    const results = await Promise.all([1, 2].map(() => request('/auth/password/reset', undefined, 'POST', { token, password })))
    expect(results.map((r) => r.status).sort()).toEqual([201, 400])
    expect((await request('/me', actor.accessToken)).status).toBe(401)
    const renewed = await request<AuthSessionDto>('/auth/login', undefined, 'POST', { identifier: actor.user.email, password })
    expect(renewed.status).toBe(201)
    actor = renewed.data
  })
  it('邮箱验证不阻断社区读取，实名通过前始终只读', async () => {
    await request('/admin/registration/settings', admin, 'PATCH', { ...settings, emailVerification: true })
    const start = messages.length, account = await register('verified')
    expect(account.status).toBe(201); expect(account.data.user.emailVerificationRequired).toBe(true)
    expect((await request('/community/feed', account.data.accessToken)).status).toBe(200)
    const post = { type: 'general', contentBlocks: [{ type: 'paragraph', text: '实名门禁验证' }], bindings: [], topicIds: [], visibility: 'public', status: 'published' }
    expect((await request('/community/posts', account.data.accessToken, 'POST', post)).status).toBe(403)
    const token = await mailToken(start)
    expect(await db.emailVerificationToken.count({ where: { tokenHash: sha(token) } })).toBe(1)
    expect((await request('/auth/email/verify', undefined, 'POST', { token })).status).toBe(201)
    expect((await request('/auth/email/verify', undefined, 'POST', { token })).status).toBe(400)
    expect((await request('/community/feed', account.data.accessToken)).status).toBe(200)
    expect((await request('/community/posts', account.data.accessToken, 'POST', post)).status).toBe(403)
    await approve(account.data.user.id, 'verified')
    expect((await request('/community/posts', account.data.accessToken, 'POST', post)).status).toBe(201)
  })
  it('实名批准和撤销对当前会话的社区写权限立即生效', async () => {
    const account = (await register('identity-flow')).data
    const post = { type: 'general', contentBlocks: [{ type: 'paragraph', text: '同一会话权限验证' }], bindings: [], topicIds: [], visibility: 'public', status: 'published' }
    expect(await request<CampusIdentityVerificationDto>('/community/verification', account.accessToken)).toMatchObject({ status: 200, data: { status: 'unsubmitted' } })
    expect((await request('/community/feed', account.accessToken)).status).toBe(200)
    expect((await request('/community/posts', account.accessToken, 'POST', post)).status).toBe(403)
    const pending = await request<CampusIdentityVerificationDto>('/community/verification', account.accessToken, 'PUT', { realName: '测试同学', idNumber: '11010519491231002X', className: '隔离测试班', studentNo: `FLOW${sha(prefix).slice(0, 12).toUpperCase()}` })
    expect(pending.data.status).toBe('pending')
    expect((await request('/community/posts', account.accessToken, 'POST', post)).status).toBe(403)
    const detail = await request<CampusIdentityVerificationDto & { idNumber: string }>(`/admin/users/${account.user.id}/verification`, admin)
    expect(detail.data.idNumber).toBe('11010519491231002X')
    expect((await request(`/admin/users/${account.user.id}/verification/approve`, admin, 'POST', { expectedRevision: pending.data.revision, reason: '人工核验资料一致' })).status).toBe(201)
    expect((await request('/community/posts', account.accessToken, 'POST', post)).status).toBe(201)
    const approved = await request<CampusIdentityVerificationDto>(`/community/verification`, account.accessToken)
    expect((await request(`/admin/users/${account.user.id}/verification/revoke`, admin, 'POST', { expectedRevision: approved.data.revision, reason: '测试撤销后即时收权' })).status).toBe(201)
    expect((await request('/community/posts', account.accessToken, 'POST', post)).status).toBe(403)
  })
  it('注册后引导复用主题和话题，公开用户名查询不回退ID', async () => {
    const account = (await register('onboard')).data
    await approve(account.user.id, 'onboard')
    const themes = await db.theme.findMany({ where: { status: 'published', deletedAt: null }, take: 3 })
    const school = await db.school.findFirstOrThrow()
    const response = await request('/community/onboarding', account.accessToken, 'POST', { schoolId: school.id, major: '人工智能', grade: '大一', headline: '学习新方向', themeIds: themes.map((t) => t.id) })
    expect(response.status).toBe(201); expect(response.data).toMatchObject({ school: school.name, major: '人工智能', onboardingCompleted: true })
    expect(await db.communityTopicFollow.count({ where: { userId: account.user.id } })).toBe(3)
    expect((await request(`/community/users/by-username/${account.user.username}`, account.accessToken)).status).toBe(200)
    expect((await request(`/community/users/by-username/${account.user.id}`, account.accessToken)).status).toBe(404)
    expect((await request('/community/profile/username', account.accessToken, 'PATCH', { username: `test_${Date.now()}` })).status).toBe(200)
    expect((await request('/community/profile/username', account.accessToken, 'PATCH', { username: 'another_username' })).status).toBe(400)
  })
  it('草稿不强制完整发布字段，所有权隔离，转正式发布后不在草稿箱', async () => {
    const input = { type: 'question', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'draft' }
    const draft = await request('/community/drafts', actor.accessToken, 'POST', input)
    expect(draft.status).toBe(201)
    expect((await request('/community/drafts', actor.accessToken)).data.some((row: CommunityDraftDto) => row.id === draft.data.id)).toBe(true)
    expect((await request(`/community/drafts/${draft.data.id}`, admin, 'PATCH', input)).status).toBe(400)
    expect((await request(`/community/drafts/${draft.data.id}`, admin, 'DELETE')).status).toBe(400)
    expect((await request(`/community/posts/${draft.data.id}`, actor.accessToken, 'PATCH', { ...input, title: '草稿转问题', contentBlocks: [{ type: 'paragraph', text: `发布${prefix}` }], status: 'published' })).status).toBe(200)
    expect((await request('/community/drafts', actor.accessToken)).data.some((row: CommunityDraftDto) => row.id === draft.data.id)).toBe(false)
  })
  it('普通交流无需标题，草稿搜索隔离，七类搜索与游标匹配', async () => {
    const input = { type: 'general', contentBlocks: [{ type: 'paragraph', text: `搜索学习${prefix}` }], bindings: [], topicIds: [], visibility: 'public', status: 'published' }
    expect((await request('/community/posts', actor.accessToken, 'POST', input)).status).toBe(201)
    const draft = await request('/community/drafts', actor.accessToken, 'POST', { ...input, contentBlocks: [{ type: 'paragraph', text: `私人搜索${prefix}` }], status: 'draft' })
    const all = await request<CommunitySearchResultDto>(`/community/search?q=${encodeURIComponent('学习')}&type=all`, actor.accessToken)
    expect(all.status).toBe(200); expect(Object.keys(all.data).sort()).toEqual(['articles', 'courses', 'labs', 'nextCursor', 'posts', 'resources', 'topics', 'users'].sort())
    for (const [kind, model] of [['courses', db.course], ['labs', db.lab], ['resources', db.resource], ['articles', db.article]] as const) {
      const row = await (model as typeof db.course).findFirstOrThrow({ where: { status: 'published', deletedAt: null }, include: { publishedVersion: true } })
      const title = (row.publishedVersion!.snapshot as { title: string }).title
      const found = await request<CommunitySearchResultDto>(`/community/search?q=${encodeURIComponent(title.toLowerCase())}&type=${kind}`, actor.accessToken)
      expect(found.status).toBe(200); expect(found.data[kind].some((item) => item.id === row.slug)).toBe(true)
    }
    const topic = await db.communityTopic.findFirstOrThrow({ where: { status: 'active' } })
    expect((await request<CommunitySearchResultDto>(`/community/search?q=${encodeURIComponent(topic.name)}&type=topics`, actor.accessToken)).data.topics.some((row) => row.id === topic.id)).toBe(true)
    expect((await request<CommunitySearchResultDto>(`/community/search?q=${encodeURIComponent(actor.user.username)}&type=users`, actor.accessToken)).data.users.some((row) => row.id === actor.user.id)).toBe(true)
    const privateSearch = await request<CommunitySearchResultDto>(`/community/search?q=${encodeURIComponent(prefix)}&type=posts`, actor.accessToken)
    expect(privateSearch.data.posts.some((post) => post.id === draft.data.id)).toBe(false)
    expect(privateSearch.data.posts.length).toBeGreaterThan(0)
    const first = await request<CommunitySearchResultDto>('/community/search?q=user_&type=users&limit=1', actor.accessToken)
    expect(first.data.nextCursor).toBeTruthy()
    const second = await request<CommunitySearchResultDto>(`/community/search?q=user_&type=users&limit=1&cursor=${first.data.nextCursor}`, actor.accessToken)
    expect(second.data.users[0].id).not.toBe(first.data.users[0].id)
    expect((await request(`/community/search?q=other&type=users&cursor=${first.data.nextCursor}`, actor.accessToken)).status).toBe(400)
  })
  it('四类搜索转化只接受真实公开学习关联', async () => {
    for (const [type, model] of [['course', db.course], ['lab', db.lab], ['resource', db.resource], ['article', db.article]] as const) {
      const item = await (model as typeof db.course).findFirstOrThrow({ where: { status: 'published', deletedAt: null } })
      expect((await request('/community/signals', actor.accessToken, 'POST', { eventType: `community_search_to_${type}`, targetType: type, targetId: item.slug })).status).toBe(201)
    }
    expect((await request('/community/signals', actor.accessToken, 'POST', { eventType: 'community_search_to_course', targetType: 'post', targetId: 'invalid' })).status).toBe(400)
  })
  it('账号查询有来源等字段，禁用撤销旧会话且管理员受保护', async () => {
    const account = (await register('disable')).data
    const users = await request(`/admin/users?keyword=${account.user.username}`, admin)
    expect(users.data.items[0]).toMatchObject({ registrationSource: 'email', username: account.user.username, communityPostCount: 0 })
    expect((await request(`/admin/users/${account.user.id}/status`, admin, 'PATCH', { status: 'disabled' })).status).toBe(200)
    expect((await request('/me', account.accessToken)).status).toBe(401)
    const disabledLogin = await request('/auth/login', undefined, 'POST', { identifier: account.user.email, password })
    expect(disabledLogin.status).toBe(401); expect(disabledLogin.message).toBe('账号或密码错误')
    const wrongPassword = await request('/auth/login', undefined, 'POST', { identifier: account.user.email, password: `${password}-wrong` })
    expect(wrongPassword.status).toBe(401); expect(wrongPassword.message).toBe('账号或密码错误')
    expect(await db.loginLog.count({ where: { userId: account.user.id, result: 'failed' } })).toBe(2)
    expect(await db.refreshToken.count({ where: { userId: account.user.id, revokedAt: null } })).toBe(0)
    const adminUser = await db.user.findUniqueOrThrow({ where: { email: process.env.SEED_ADMIN_EMAIL } })
    expect((await request(`/admin/users/${adminUser.id}/reset-onboarding`, admin, 'POST')).status).toBe(400)
    expect((await request(`/admin/users/${account.user.id}/reset-onboarding`, actor.accessToken, 'POST')).status).toBe(403)
  })
  it('数据库临时故障保持5xx，不伪装成401', async () => {
    vi.spyOn(app.get(PrismaService).user, 'findUnique').mockRejectedValueOnce(new Error('database unavailable'))
    expect((await request('/me', actor.accessToken)).status).toBe(500)
    expect(app.get(AuthGuard)).toBeTruthy()
  })
  it('不记住登录使用会话Cookie，刷新也不延长为持久Cookie', async () => {
    const account = await register('remember')
    const login = await request('/auth/login', undefined, 'POST', { identifier: account.data.user.email, password, remember: false })
    const cookie = login.cookie.map((value) => value.split(';')[0]).join('; ')
    expect(login.cookie.find((value) => value.startsWith('refresh_token='))).not.toContain('Max-Age')
    const refreshed = await request('/auth/refresh', undefined, 'POST', {}, { cookie })
    expect(refreshed.status).toBe(201)
    expect(refreshed.cookie.find((value) => value.startsWith('refresh_token='))).not.toContain('Max-Age')
  })
})
