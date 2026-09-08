import 'reflect-metadata'
import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { CommunityUploadGuard, CommunityVisibilityPolicyService } from '../src/modules/community/visibility.service'
import { MeController } from '../src/modules/auth/auth.controller'

const activeUser = (verification = 'approved', extra: Record<string, unknown> = {}) => ({
  id: 'student', status: 'active', profile: {}, agreementVersion: 'v1', emailVerifiedAt: new Date(),
  identityVerification: { status: verification }, communityProfile: { verifiedType: 'none' }, userRoles: [], ...extra,
})

function policyPrisma(user: Record<string, unknown> | null, restrictions: Record<string, unknown>[] = [], registration: unknown = { agreementVersion: 'v1' }) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ now: new Date() }]),
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    systemSetting: { findUnique: vi.fn(async ({ where }: any) => where.key === 'registration' ? { value: registration } : null) },
    communityOperationRestriction: { findMany: vi.fn().mockResolvedValue(restrictions) },
  } as any
}

describe('社区分操作资格', () => {
  it('学校变更后仍允许作者读取自己的草稿和待审投稿，公开列表不增加此例外', async () => {
    const service = new CommunityVisibilityPolicyService({} as never)
    vi.spyOn(service, 'viewer').mockResolvedValue(activeUser('approved', { schoolId: 'synthetic-new-school' }) as never)
    vi.spyOn(service, 'authorExclusions').mockResolvedValue({ authors: [], posts: [], types: [] })
    const own = await service.where('student', true), publicList = await service.where('student')
    expect(own).toMatchObject({ AND: [expect.anything(), { OR: expect.arrayContaining([{ authorId: 'student', status: { in: ['draft', 'pending_review'] } }]) }] })
    expect(JSON.stringify(publicList)).not.toContain('pending_review')
    expect(JSON.stringify(publicList)).not.toContain('draft')
    expect(publicList).toMatchObject({ AND: [expect.anything(), { OR: [{ visibility: 'public' }, { visibility: 'school', schoolId: 'synthetic-new-school' }] }] })
  })

  it('公开显示名修改复用 profile 资格，拒绝时不会进入写事务', async () => {
    const denied = new Error('资料修改受限')
    const prisma = { $transaction: vi.fn() }
    const visibility = { assertOperation: vi.fn(async () => { throw denied }) }
    const controller = new MeController(prisma as never, {} as never, visibility as never, {} as never)
    await expect(controller.update({ id: 'student' } as never, { expectedRevision: 1, displayName: '学生' })).rejects.toBe(denied)
    expect(visibility.assertOperation).toHaveBeenCalledWith('student', 'profile')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('未实名仍可读取，但发帖、评论和上传返回同一结构化引导', async () => {
    const service = new CommunityVisibilityPolicyService(policyPrisma(activeUser('unsubmitted')))
    const eligibility = await service.eligibility('student')
    expect(eligibility).toMatchObject({ canRead: true, canPost: false, canComment: false, canUpload: false })
    expect(eligibility.operations).toMatchObject({ read: { allowed: true }, post: { allowed: false }, comment: { allowed: false }, upload: { allowed: false } })
    expect(eligibility.operations.post).toMatchObject({ reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED', nextAction: { route: '/community/verification' } })
    await expect(service.assertOperation('student', 'comment')).rejects.toSatisfy((error: ForbiddenException) => JSON.stringify(error.getResponse()).includes('COMMUNITY_VERIFICATION_REQUIRED'))
  })

  it('活动限制只影响命中的功能，过期限制由查询时间即时失效', async () => {
    const databaseNow = new Date('2026-09-06T12:00:00.000Z'), future = new Date('2026-09-06T12:01:00.000Z')
    const prisma = policyPrisma(activeUser(), [{ id: 'r1', operations: ['comment'], reason: '冷静期', endsAt: future }])
    prisma.$queryRaw.mockResolvedValue([{ now: databaseNow }])
    const service = new CommunityVisibilityPolicyService(prisma)
    const restricted = await service.eligibility('student')
    expect(restricted).toMatchObject({ canRead: true, canPost: true, canComment: false, canUpload: true })
    expect(restricted.operations.post.allowed).toBe(true)
    expect(restricted.operations.comment).toMatchObject({ allowed: false, reasonCode: 'COMMUNITY_OPERATION_RESTRICTED', availableAt: future.toISOString() })
    prisma.communityOperationRestriction.findMany.mockResolvedValue([])
    const expired = await service.eligibility('student')
    expect(expired.operations.comment.allowed).toBe(true)
    expect(prisma.communityOperationRestriction.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ startsAt: { lte: databaseNow }, endsAt: { gt: databaseNow } }) }))
  })

  it('官方可信身份无需冒充校园认证，但仍受功能限制', async () => {
    const prisma = policyPrisma(activeUser('unsubmitted', { userRoles: [{ role: { code: 'community_official' } }] }), [{ id: 'r2', operations: ['post'], reason: '待复核', endsAt: new Date(Date.now() + 60_000) }])
    const eligibility = await new CommunityVisibilityPolicyService(prisma).eligibility('official')
    expect(eligibility.operations.comment.allowed).toBe(true)
    expect(eligibility.operations.post.reasonCode).toBe('COMMUNITY_OPERATION_RESTRICTED')
  })

  it('邮箱和当前协议要求优先于公开写入资格，历史无协议账号保持兼容', async () => {
    const email = await new CommunityVisibilityPolicyService(policyPrisma(activeUser('approved', { profile: { emailVerificationRequired: true }, emailVerifiedAt: null }))).eligibility('student')
    expect(email.operations.upload.reasonCode).toBe('EMAIL_VERIFICATION_REQUIRED')
    const agreement = await new CommunityVisibilityPolicyService(policyPrisma(activeUser(), [], { agreementVersion: 'v2' })).eligibility('student')
    expect(agreement.operations.post.reasonCode).toBe('AGREEMENT_UPDATE_REQUIRED')
    const legacy = await new CommunityVisibilityPolicyService(policyPrisma(activeUser('approved', { agreementVersion: null }), [], { agreementVersion: 'v2' })).eligibility('legacy')
    expect(legacy.operations.post.allowed).toBe(true)
  })

  it('集中策略只接受安全上下界内的值', async () => {
    const prisma = policyPrisma(activeUser())
    prisma.systemSetting.findUnique.mockResolvedValue({ revision: 3, value: { quotas: { post: { limit: 7, windowSeconds: 120 }, upload: { limit: 9999, windowSeconds: 1 } } } })
    const value = await new CommunityVisibilityPolicyService(prisma).policy()
    expect(value).toMatchObject({ revision: 3, quotas: { post: { limit: 7, windowSeconds: 120 }, upload: { limit: 12, windowSeconds: 300 } } })
  })
  it('上传守卫在接收文件之前执行同一上传资格判断', async () => {
    const visibility = { assertOperation: vi.fn().mockResolvedValue(undefined), reserveUploadQuota: vi.fn().mockResolvedValue(undefined) }
    const guard = new CommunityUploadGuard(visibility as never)
    const context = { switchToHttp: () => ({ getRequest: () => ({ user: { id: 'student' }, ip: '127.0.0.1', method: 'POST', originalUrl: '/api/v1/community/profile/avatar?crop=1', headers: { 'idempotency-key': 'upload-request-1' } }) }) }
    await expect(guard.canActivate(context as never)).resolves.toBe(true)
    expect(visibility.assertOperation).toHaveBeenCalledWith('student', 'profile')
    expect(visibility.reserveUploadQuota).toHaveBeenCalledWith('student', '127.0.0.1', 'upload-request-1', 'POST:/api/v1/community/profile/avatar')
    const anonymous = { switchToHttp: () => ({ getRequest: () => ({}) }) }
    await expect(guard.canActivate(anonymous as never)).resolves.toBe(false)
  })

  it('首次保存限流策略就推进版本，旧版本不能再次覆盖', async () => {
    let stored: { revision: number; value: unknown } | null = null
    const tx: any = {
      $queryRaw: vi.fn(),
      systemSetting: {
        findUnique: vi.fn(async () => stored),
        upsert: vi.fn(async ({ create, update }: any) => {
          stored = stored ? { revision: stored.revision + update.revision.increment, value: update.value } : { revision: create.revision, value: create.value }
          return stored
        }),
      },
      communityModerationAction: { create: vi.fn() },
    }
    const prisma: any = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) }
    const service = new CommunityVisibilityPolicyService(prisma)
    await expect(service.updateEligibilityPolicy('admin', { expectedRevision: 1, operation: 'post', limit: 6, windowSeconds: 60, reason: '首次调整策略' })).resolves.toMatchObject({ revision: 2 })
    await expect(service.updateEligibilityPolicy('admin', { expectedRevision: 1, operation: 'post', limit: 7, windowSeconds: 60, reason: '旧版本重复调整' })).rejects.toThrow('社区资格策略已变化')
  })
})
