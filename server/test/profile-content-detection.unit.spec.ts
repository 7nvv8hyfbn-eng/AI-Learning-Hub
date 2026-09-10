import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { CommunityContextService } from '../src/modules/community/context.service'
import { ContentDetectionService } from '../src/modules/community/content-detection.service'

function setup() {
  const user = { id: 'synthetic-owner', username: 'student_example', displayName: '原公开昵称', revision: 4, usernameChangedAt: null }
  const profile = { userId: user.id, revision: 3, bio: '原公开简介', headline: '', location: '', websiteUrl: '', expertiseTopics: [], avatarFileId: null, bannerFileId: null }
  const tx = {
    $queryRaw: vi.fn(),
    user: { findUniqueOrThrow: vi.fn(async () => user), updateMany: vi.fn(async () => { user.revision++; return { count: 1 } }), update: vi.fn() },
    communityProfile: { upsert: vi.fn(async () => profile), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() },
    communityPost: { count: vi.fn(async () => 1) },
    systemSetting: { findUnique: vi.fn(async () => null), createMany: vi.fn() },
    contentReview: { findFirst: vi.fn(async () => ({ status: 'pending', payload: { changes: { bio: '合成反诈案例：先交保证金再返佣' } } })), updateMany: vi.fn(), create: vi.fn() },
    activityEvent: { create: vi.fn() },
  }
  const prisma = { ...tx, $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx) }
  const detection = new ContentDetectionService(prisma as never, { send: vi.fn() } as never, { record: vi.fn() } as never, {} as never)
  const storage = { upload: vi.fn(async () => ({ id: 'synthetic-image' })) }
  const context = new CommunityContextService(prisma as never, { assertOperation: vi.fn(), viewer: vi.fn() } as never, {} as never, {} as never, {} as never, {} as never, storage as never, detection)
  vi.spyOn(context as unknown as { profileUpdateResult(): Promise<object> }, 'profileUpdateResult').mockResolvedValue({})
  vi.spyOn(context, 'profile').mockResolvedValue({} as never)
  return { context, detection, tx, user, profile }
}

describe('资料图片与置顶不遗留失效的文字复核', () => {
  it.each(['avatar', 'banner'] as const)('移除%s后重新检测待审文字并绑定当前账号与资料修订', async (kind) => {
    const { context, tx, user, profile } = setup()
    await context.removeProfileImage(user.id, kind, { expectedUserRevision: 4, expectedProfileRevision: 3 })
    expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentRevision: 4, status: 'pending', payload: expect.objectContaining({ userRevision: 5, changes: { bio: '合成反诈案例：先交保证金再返佣' } }) }) }))
    expect(profile.bio).toBe('原公开简介')
    expect(tx.communityProfile.updateMany).toHaveBeenCalledWith({ where: { userId: user.id, revision: 3 }, data: { revision: { increment: 1 } } })
    expect(tx.communityProfile.update).toHaveBeenCalledWith({ where: { userId: user.id }, data: { [kind === 'avatar' ? 'avatarFileId' : 'bannerFileId']: null } })
    expect(tx.contentReview.updateMany).toHaveBeenCalledWith({ where: { targetType: 'profile', targetId: user.id, status: 'pending' }, data: { status: 'superseded' } })
  })

  it('置顶不复用旧复核版本，文字仍暂存且不冒充已公开', async () => {
    const { context, tx, user } = setup()
    await context.pinPost(user.id, 'synthetic-post', 3)
    expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentRevision: 4, status: 'pending', payload: expect.objectContaining({ userRevision: 4 }) }) }))
    expect(tx.communityProfile.update).toHaveBeenCalledWith({ where: { userId: user.id }, data: { pinnedPostId: 'synthetic-post' } })
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it('上传头像复用同一文字检测入口，不使待审简介失去当前修订', async () => {
    const { context, tx, user } = setup()
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer()
    await context.uploadProfileImage(user.id, 'avatar', { buffer, size: buffer.length, mimetype: 'image/png' } as Express.Multer.File, { expectedUserRevision: 4, expectedProfileRevision: 3 })
    expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentRevision: 4, status: 'pending', payload: expect.objectContaining({ userRevision: 5 }) }) }))
    expect(tx.communityProfile.update).toHaveBeenCalledWith({ where: { userId: user.id }, data: { avatarFileId: 'synthetic-image' } })
  })

  it('规则拒绝时不写入置顶值，不返回伪造成功', async () => {
    const { context, detection, tx, user } = setup()
    vi.spyOn(detection, 'check').mockRejectedValue(new Error('内容未发布，请修改待审文字'))
    await expect(context.pinPost(user.id, 'synthetic-post', 3)).rejects.toThrow('内容未发布')
    expect(tx.communityProfile.update).not.toHaveBeenCalled()
    expect(tx.contentReview.create).not.toHaveBeenCalled()
  })
})
