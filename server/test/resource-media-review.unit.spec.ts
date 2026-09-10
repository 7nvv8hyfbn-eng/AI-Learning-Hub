import { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'
import { ResourceHubService } from '../src/modules/resources/resource-hub.service'

function fixture() {
  const state = { status: 'published', owner: false, submitted: true, active: true, permissions: [] as string[] }
  const publicScope = { status: 'published' }
  const ownerScope = { OR: [publicScope, { authorId: 'synthetic-viewer', status: { in: ['draft', 'pending_review'] } }] }
  const adminScope = { status: { not: 'draft' }, publishedAt: { not: null } }
  const visibility = {
    assertMediaEligibility: vi.fn(async () => { if (!state.active) throw new Error('账号不可用') }),
    viewer: vi.fn(async () => { if (!state.active) throw new Error('账号不可用') }),
    where: vi.fn(async (_user: string, own = false) => { await visibility.viewer(); return own ? ownerScope : publicScope }),
    adminWhere: vi.fn(async () => adminScope), auditAdminRead: vi.fn(),
  }
  const prisma = {
    refreshToken: { findUnique: vi.fn(async () => ({ userId: 'synthetic-viewer', client: state.permissions.length ? 'admin' : 'student', mfaVerified: true, expiresAt: new Date(Date.now() + 3600000), user: { id: 'synthetic-viewer', status: 'active', receivedModeration: [], sessionVersion: 0, mfaEnabledAt: new Date(), userRoles: [] } })) },
    communityPost: { findFirst: vi.fn(async () => state.status === 'published' || state.owner && ['draft', 'pending_review'].includes(state.status) ? { authorId: 'synthetic-owner' } : null), count: vi.fn(async ({ where }: { where: { AND: object[] } }) => {
      const scope = where.AND[1]
      if (scope === adminScope) return Number(state.submitted && state.status !== 'draft')
      return Number(state.status === 'published' || scope === ownerScope && state.owner && ['draft', 'pending_review'].includes(state.status))
    }) },
    user: { count: vi.fn(async ({ where }: { where: { AND: Array<{ userRoles: { some: { role: { permissions: { some: { permission: { code: string } } } } } } }> } }) => Number(where.AND.every((entry) => state.permissions.includes(entry.userRoles.some.role.permissions.some.permission.code)))) },
    resourceContribution: { count: vi.fn(async () => Number(state.status === 'published')) },
    fileRecord: { count: vi.fn(async () => Number(state.owner)) },
    videoAsset: { findFirst: vi.fn(async ({ where }: { where: { contribution?: unknown } }) => !where.contribution || state.status === 'published' ? { id: 'synthetic-video', playableFileId: 'synthetic-file', durationSeconds: 60, contribution: { postId: 'synthetic-post' } } : null) },
    resourceWatchProgress: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(),
  }
  const storage = { open: vi.fn(async () => ({ mimeType: 'application/octet-stream' })) }
  const fileAccess = { assert: vi.fn(async () => {
    await visibility.assertMediaEligibility()
    if (state.status === 'published' || state.owner && ['draft', 'pending_review'].includes(state.status)) return
    if (state.status !== 'draft' && state.submitted && ['resource.read', 'community.moderate'].every((permission) => state.permissions.includes(permission))) { await visibility.auditAdminRead('synthetic-viewer', 'resource_media', 'synthetic-file'); return }
    throw new Error('媒体不可见')
  }) }
  const service = new ResourceHubService(prisma as never, new ConfigService({ JWT_SECRET: 'synthetic-media-review-test-secret' }), {} as never, visibility as never, {} as never, {} as never, {} as never, storage as never, {} as never, {} as never, fileAccess as never, { user: { id: 'synthetic-viewer', sessionId: 'synthetic-session', sessionVersion: 0 }, ip: '127.0.0.1' } as never)
  const token = (purpose: string, target: string) => (service as unknown as { sign(p: string, id: string, user: string, expires: number): string }).sign(purpose, target, 'synthetic-viewer', Math.floor(Date.now() / 1000) + 60)
  return { state, prisma, service, visibility, storage, token }
}

describe('资源待复核媒体隔离', () => {
  it.each(['media', 'attachment', 'play'] as const)('%s旧令牌随投稿待审撤回，作者与双权限审核员可预览', async (purpose) => {
    const f = fixture(), target = purpose === 'play' ? 'synthetic-video' : 'synthetic-file'
    const token = f.token(purpose, target)
    const read = () => purpose === 'play' ? f.service.playbackFile(target, token) : purpose === 'media' ? f.service.mediaFile(target, token) : f.service.attachmentFile(target, token)
    await expect(read()).resolves.toBeDefined()
    f.state.status = 'pending_review'
    f.storage.open.mockClear()
    await expect(read()).rejects.toThrow()
    expect(f.storage.open).not.toHaveBeenCalled()
    f.state.owner = true
    await expect(read()).resolves.toBeDefined()
    f.state.owner = false
    for (const permission of ['resource.read', 'community.moderate']) {
      f.state.permissions = [permission]
      await expect(read()).rejects.toThrow()
    }
    f.state.permissions = ['resource.read', 'community.moderate']
    await expect(read()).resolves.toBeDefined()
    expect(f.visibility.auditAdminRead).toHaveBeenCalledWith('synthetic-viewer', 'resource_media', target)
    f.state.status = 'draft'; f.state.submitted = false
    await expect(read()).rejects.toThrow()
    f.state.owner = true; f.state.active = false
    await expect(read()).rejects.toThrow('账号不可用')
  })

  it('待审预览不能写入学习进度或制造有效观看事件', async () => {
    const f = fixture()
    f.state.status = 'pending_review'; f.state.owner = true
    await expect(f.service.playback('synthetic-viewer', 'synthetic-video')).resolves.toMatchObject({ assetId: 'synthetic-video' })
    await expect(f.service.progress('synthetic-viewer', 'synthetic-video', { positionSeconds: 50, watchedSeconds: 50, completed: false, eventKey: 'synthetic-event' })).rejects.toThrow()
    expect(f.prisma.$transaction).not.toHaveBeenCalled()
  })
})
