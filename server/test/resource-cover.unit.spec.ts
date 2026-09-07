import { ConfigService } from '@nestjs/config'
import { describe, expect, it, vi } from 'vitest'
import { ResourceHubService } from '../src/modules/resources/resource-hub.service'
import { CommunityPostService } from '../src/modules/community/post.service'

describe('资源视频自选封面', () => {
  it('普通图文不能引用他人或不合规封面', async () => {
    const prisma = { fileRecord: { count: vi.fn(async () => 0) }, $transaction: vi.fn() }
    const service = new CommunityPostService(prisma as never, {} as never, { viewer: vi.fn(async () => ({ schoolId: null })) } as never, {} as never, {} as never, {} as never)
    await expect(service.save('owner', { type: 'general', status: 'draft', visibility: 'public', contentBlocks: [], bindings: [], topicIds: [], coverFileId: 'foreign-cover' })).rejects.toThrow('封面必须由本人上传')
    expect(prisma.fileRecord.count).toHaveBeenCalledWith({ where: { quarantinedAt: null, id: 'foreign-cover', uploadedBy: 'owner', mimeType: { in: ['image/png', 'image/jpeg', 'image/webp'] }, extension: { in: ['.png', '.jpg', '.jpeg', '.webp'] }, size: { gt: 0, lte: 5 * 1024 * 1024 } } })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each([
    { files: [], message: '必须由本人上传' },
    { files: [{ id: 'cover', mimeType: 'application/pdf', size: 10 }], message: '投稿封面仅支持' },
    { files: [{ id: 'cover', mimeType: 'image/png', size: 5 * 1024 * 1024 + 1 }], message: '投稿封面仅支持' },
  ])('封面写入拒绝非本人、错误类型或超大文件：$message', async ({ files, message }) => {
    const prisma = { communityTopic: { findMany: vi.fn(async () => []) }, fileRecord: { findMany: vi.fn(async () => files) }, $transaction: vi.fn() }
    const service = new CommunityPostService(prisma as never, { resolveMany: vi.fn(async () => new Map()) } as never, { viewer: vi.fn(async () => ({ schoolId: null })) } as never, {} as never, {} as never, {} as never)
    await expect(service.save('owner', { type: 'general', status: 'draft', visibility: 'public', contentBlocks: [], bindings: [], topicIds: [], contribution: { kind: 'article', tags: [], teachingReuseConsent: false, coverFileId: 'cover' } })).rejects.toThrow(message)
    expect(prisma.fileRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { quarantinedAt: null, id: { in: ['cover'] }, uploadedBy: 'owner' } }))
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
  it.each([
    { cover: 'custom-cover', automatic: 'automatic-frame', expected: 'custom-cover' },
    { cover: null, automatic: 'automatic-frame', expected: 'automatic-frame' },
    { cover: null, automatic: null, expected: null },
  ])('播放器与投稿封面一致：$expected', async ({ cover, automatic, expected }) => {
    const prisma = { resourceWatchProgress: { findUnique: vi.fn(async () => null) } }
    const service = new ResourceHubService(prisma as never, new ConfigService({ JWT_SECRET: 'synthetic-resource-cover-test-secret' }), {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const visibleAsset = vi.fn(async () => ({ durationSeconds: 60, posterFileId: automatic, contribution: { postId: 'post', coverFileId: cover } }))
    Object.defineProperty(service, 'visibleAsset', { value: visibleAsset })
    const playback = await service.playback('viewer', 'video')
    expect(visibleAsset).toHaveBeenCalledWith('viewer', 'video', true)
    if (expected) expect(playback.poster).toMatch(new RegExp(`/resource-hub/media/${expected}\\?token=`))
    else expect(playback.poster).toBeNull()
  })
})
