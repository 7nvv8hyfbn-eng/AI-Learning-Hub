import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ConfigService } from '@nestjs/config'
import { ForbiddenException } from '@nestjs/common'
import { hash } from 'bcryptjs'
import { describe, expect, it, vi } from 'vitest'
import { AuthService } from '../src/modules/auth/auth.service'
import { RegistrationService } from '../src/modules/auth/registration.service'
import { normalizeUsername, USERNAME_PATTERN } from '../src/modules/auth/username'
import { PERMISSIONS_KEY } from '../src/modules/auth/permissions.decorator'
import { CommunityVisibilityPolicyService } from '../src/modules/community/visibility.service'
import { UsersController } from '../src/modules/users/users.controller'
import { UsersService } from '../src/modules/users/users.service'
import { decryptIdentity, encryptIdentity, identityFingerprint, maskIdNumber, maskRealName, normalizeIdNumber, parseIdentityDataKey } from '../src/modules/users/identity-data'

const identityKey = Buffer.alloc(32, 7)

describe('校园实名、账号和社区写权限', () => {
  it('用户名规范唯一且保留旧邮箱与新用户名两种登录查询', async () => {
    expect(normalizeUsername(' Student_2026 ')).toBe('student_2026')
    expect(USERNAME_PATTERN.test('2026_student')).toBe(true)
    for (const value of ['_student', 'student_', 'student__one', 'abc', 'a'.repeat(25)]) expect(() => normalizeUsername(value)).toThrow()
    expect(() => normalizeUsername('admin')).toThrow('不可使用')

    const passwordHash = await hash('ValidPass8', 4)
    const user = {
      id: 'u1', email: 'student@example.invalid', username: 'student_2026', displayName: '测试同学', passwordHash, status: 'active', revision: 1, sessionVersion: 0,
      schoolId: null, departmentId: null, grade: '', major: '', onboardingCompletedAt: null, emailVerifiedAt: null, profile: {}, school: null,
      receivedModeration: [], communityRestrictions: [], moderatorGrants: [], communityProfile: { revision: 1, avatarFileId: null }, identityVerification: { status: 'approved' },
      userRoles: [{ role: { code: 'student', permissions: [], _count: { permissions: 0 } } }],
    }
    const tx: any = {
      systemSetting: { findUnique: vi.fn(async () => null) },
      $queryRaw: vi.fn().mockResolvedValue([{ attempts: 1 }]),
      loginThrottle: { findUnique: vi.fn().mockResolvedValue(null), deleteMany: vi.fn() }, loginLog: { create: vi.fn() },
      user: { findFirst: vi.fn().mockResolvedValue(user), findUniqueOrThrow: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue(user) },
      activityEvent: { create: vi.fn() }, refreshToken: { updateMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'session-1', mfaVerified: false }) }, communityModerationAction: { findFirst: vi.fn(async () => null) },
    }
    const prisma: any = { ...tx, $transaction: vi.fn(async (callback) => callback(tx)) }
    const service = new AuthService(prisma, { signAsync: vi.fn().mockResolvedValue('access') } as never, new ConfigService({ JWT_SECRET: 'test-secret' }), {} as never)
    for (const identifier of ['STUDENT_2026', 'STUDENT@EXAMPLE.INVALID']) {
      const result = await service.login(identifier, 'ValidPass8', `client-${identifier}`, '127.0.0.1')
      if ('mfaRequired' in result) throw new Error('学生登录不应要求 MFA')
      expect(result.user).toMatchObject({ username: 'student_2026', identityVerificationStatus: 'approved', communityWriteEnabled: true })
    }
    expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ username: { equals: 'student_2026', mode: 'insensitive' } })
    expect(prisma.user.findFirst.mock.calls[1][0].where).toEqual({ email: { equals: 'student@example.invalid', mode: 'insensitive' } })
  })

  it('注册 IP、用户名、邮箱分别使用 HMAC 原子计数，并发成功数不能越过上限', async () => {
    const counters = new Map<string, number>()
    const prisma: any = { $queryRaw: vi.fn(async (_sql: unknown, key: string) => {
      const attempts = (counters.get(key) || 0) + 1
      counters.set(key, attempts)
      return [{ attempts, expires_at: new Date(Date.now() + 60_000) }]
    }) }
    const service = new RegistrationService(prisma, new ConfigService({ JWT_SECRET: 'rate-secret' }), {} as never, {} as never)
    const settings = { mode: 'open', emailVerification: false, agreementVersion: 'v1', passwordMinLength: 8, schoolRequired: false, registrationRateWindowMinutes: 1, registrationMaxAttemptsPerIp: 10, registrationMaxAttemptsPerIdentifier: 2, registrationMaxSuccessPerIp: 5 } as const
    const registrationAttempt = (service as any).registrationAttempt.bind(service)
    await registrationAttempt(settings, 'same_user', 'first@example.invalid', '10.0.0.1')
    await registrationAttempt(settings, 'same_user', 'second@example.invalid', '10.0.0.1')
    await expect(registrationAttempt(settings, 'same_user', 'third@example.invalid', '10.0.0.1')).rejects.toMatchObject({ status: 429 })
    expect([...counters.keys()].every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true)
    expect(JSON.stringify([...counters.keys()])).not.toContain('same_user')
    const consume = (service as any).consumeRegistrationLimit.bind(service)
    const concurrent = await Promise.allSettled(Array.from({ length: 6 }, () => consume(prisma, 'register:success:ip', '10.0.0.2', 5, 1)))
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('实名字段按用途加密和指纹化，脱敏结果不泄露原文', () => {
    const idNumber = normalizeIdNumber('11010519491231002x')
    const encryptedName = encryptIdentity('测试同学', identityKey, 'real-name')
    const encryptedId = encryptIdentity(idNumber, identityKey, 'id-number')
    expect(decryptIdentity(encryptedName, identityKey, 'real-name')).toBe('测试同学')
    expect(decryptIdentity(encryptedId, identityKey, 'id-number')).toBe(idNumber)
    expect(() => decryptIdentity(encryptedName, identityKey, 'id-number')).toThrow()
    expect(identityFingerprint(idNumber, identityKey)).toMatch(/^[a-f0-9]{64}$/)
    expect(maskRealName('测试同学')).toBe('测***')
    expect(maskIdNumber(idNumber)).toBe('1101**********002X')
    expect(() => parseIdentityDataKey('short')).toThrow('32字节')
  })

  it('社区读取不依赖实名，所有普通写入按数据库实时 approved 状态判断', async () => {
    let approved = false
    const prisma: any = {
      $queryRaw: vi.fn().mockResolvedValue([{ now: new Date() }]),
      user: { findUnique: vi.fn(async () => ({ id: 'u1', status: 'active', profile: {}, agreementVersion: null, emailVerifiedAt: null, communityProfile: null, school: null, userRoles: [], identityVerification: { status: approved ? 'approved' : 'unsubmitted' } })) },
      systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
      communityOperationRestriction: { findMany: vi.fn().mockResolvedValue([]) },
      communityFeedback: { findMany: vi.fn().mockResolvedValue([]) },
    }
    const service = new CommunityVisibilityPolicyService(prisma)
    await expect(service.viewer('u1')).resolves.toMatchObject({ id: 'u1' })
    const where = await service.where('u1')
    expect(JSON.stringify(where)).not.toContain('identityVerification')
    await expect(service.assertOperation('u1', 'post')).rejects.toSatisfy((error: ForbiddenException) => error.getResponse().toString().includes('COMMUNITY_VERIFICATION_REQUIRED') || JSON.stringify(error.getResponse()).includes('COMMUNITY_VERIFICATION_REQUIRED'))
    approved = true
    await expect(service.assertOperation('u1', 'post')).resolves.toBeUndefined()
    approved = false
    await expect(service.assertOperation('u1', 'post')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('敏感实名详情只有独立权限端点读取，读取审计不含姓名或身份证号', async () => {
    const encryptedName = encryptIdentity('测试同学', identityKey, 'real-name'), idNumber = '11010519491231002X'
    const row = { id: 'iv1', userId: 'u1', realNameEncrypted: encryptedName, idNumberEncrypted: encryptIdentity(idNumber, identityKey, 'id-number'), status: 'pending', submittedAt: new Date('2026-09-01T00:00:00Z'), reviewedAt: null, reviewReason: null, className: '演示一班', studentNo: 'DEMO01', revision: 1, reviewedBy: null }
    const prisma: any = { campusIdentityVerification: { findUnique: vi.fn().mockResolvedValue(row), count: vi.fn().mockResolvedValue(0) }, auditLog: { create: vi.fn() } }
    const service = new UsersService(prisma, {} as never, new ConfigService({ IDENTITY_DATA_KEY: identityKey.toString('hex') }), {} as never)
    const detail = await service.identityDetail('reviewer', 'u1')
    expect(detail).toMatchObject({ realName: '测试同学', idNumber, maskedRealName: '测***', studentNo: 'DEMO01' })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: { actorId: 'reviewer', action: 'identity_sensitive_read', targetType: 'identity_verification', targetId: 'iv1' } })
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(idNumber)
    expect(Reflect.getMetadata(PERMISSIONS_KEY, UsersController.prototype.verification)).toEqual(['user.read', 'user.identity.read'])
    expect(Reflect.getMetadata(PERMISSIONS_KEY, UsersController.prototype.approve)).toEqual(['user.read', 'user.identity.review'])
  })

  it('实名提交、驳回重交、批准和撤销只修改唯一状态真相', async () => {
    let row: any = null
    const campusIdentityVerification = {
      findUnique: vi.fn(async () => row), count: vi.fn().mockResolvedValue(0),
      create: vi.fn(async ({ data }) => { row = { id: 'iv-flow', revision: 1, reviewedBy: null, ...data }; return row }),
      update: vi.fn(async ({ data }) => {
        const revision = data.revision?.increment ? row.revision + data.revision.increment : row.revision
        row = { ...row, ...data, revision }
        return row
      }),
    }
    const tx: any = {
      systemSetting: { findUnique: vi.fn(async () => null) },
      $queryRaw: vi.fn(), campusIdentityVerification,
      user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }), update: vi.fn() },
      school: { count: vi.fn().mockResolvedValue(0) },
      activityEvent: { create: vi.fn() }, auditLog: { create: vi.fn() },
    }
    const prisma: any = { ...tx, $transaction: vi.fn(async (callback) => callback(tx)) }
    const service = new UsersService(prisma, {} as never, new ConfigService({ IDENTITY_DATA_KEY: identityKey.toString('hex') }), {} as never)
    const input = { realName: '测试同学', idNumber: '11010519491231002X', className: '演示一班', studentNo: ' demo01 ' }
    expect(await service.submitVerification('u1', input as never)).toMatchObject({ status: 'pending', studentNo: 'DEMO01', maskedRealName: '测***' })
    await expect(service.submitVerification('u1', { ...input, expectedRevision: 1 } as never)).rejects.toThrow('审核中')
    row = { ...row, status: 'rejected', reviewReason: '资料需核对', reviewedAt: new Date(), revision: 2 }
    expect(await service.submitVerification('u1', { ...input, expectedRevision: 2 } as never)).toMatchObject({ status: 'pending', revision: 3 })
    const actor = { id: 'reviewer', roles: ['admin'], permissions: ['user.identity.review'] } as any
    await service.reviewIdentity(actor, 'u1', 'approve', { expectedRevision: 3, reason: '人工核验信息一致' } as never)
    expect(row.status).toBe('approved')
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { studentNo: 'DEMO01' } })
    await service.reviewIdentity(actor, 'u1', 'revoke', { expectedRevision: 4, reason: '资料变化需要重新核验' } as never)
    expect(row.status).toBe('revoked')
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain(input.idNumber)
  })

  it('服务层在数据库唯一索引前明确拒绝有效身份证和学号冲突', async () => {
    const input = { realName: '测试同学', idNumber: '11010519491231002X', className: '演示一班', studentNo: 'DEMO01' }
    const conflict = async (counts: number[]) => {
      const tx: any = {
        $queryRaw: vi.fn(), user: { findUnique: vi.fn().mockResolvedValue({ status: 'active' }) }, activityEvent: { create: vi.fn() },
        campusIdentityVerification: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockImplementation(async () => counts.shift() || 0), create: vi.fn() },
      }
      const prisma: any = { ...tx, $transaction: vi.fn(async (callback) => callback(tx)) }
      return new UsersService(prisma, {} as never, new ConfigService({ IDENTITY_DATA_KEY: identityKey.toString('hex') }), {} as never).submitVerification('u1', input as never)
    }
    await expect(conflict([1])).rejects.toThrow('身份资料已用于其他账号')
    await expect(conflict([0, 1])).rejects.toThrow('学号已用于其他账号')
  })

  it('普通用户管理查询既不返回也不能用学号探测，实名权限才开放该字段', () => {
    const service = new UsersService({} as never, {} as never, new ConfigService(), {} as never)
    expect(JSON.stringify(service.where({ keyword: 'DEMO01' } as never))).not.toContain('studentNo')
    expect(JSON.stringify(service.where({ keyword: 'DEMO01' } as never, true))).toContain('studentNo')
  })

  it('数据库迁移以大小写无关账号和有效实名部分唯一索引兜底', () => {
    const sql = readFileSync(resolve(__dirname, '../prisma/migrations/20260906190000_campus_identity_verification/migration.sql'), 'utf8')
    const existing = readFileSync(resolve(__dirname, '../prisma/migrations/20260901010000_persistence_productization/migration.sql'), 'utf8')
    expect(existing).toContain('CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username))')
    expect(sql).not.toContain('CREATE UNIQUE INDEX "users_username_lower_key"')
    expect(sql).toContain('campus_identity_verifications_active_id_number_key')
    expect(sql).toContain('campus_identity_verifications_active_student_no_key')
    expect(sql.match(/WHERE "status" IN \('pending', 'approved'\)/g)).toHaveLength(2)
    expect(sql).not.toMatch(/DELETE FROM|UPDATE\s+"users"\s+SET\s+"username"/i)
  })
})
