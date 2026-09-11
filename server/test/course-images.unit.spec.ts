import { describe, expect, it, vi } from 'vitest'
import { bindCourseImage, freezeCourseImages } from '../src/modules/courses/course-images'
import { MediaService } from '../src/modules/media/media.service'

const oldImage = { assetId: 'image1', fileId: 'file-old', alt: '原图说明', caption: '原图注', width: 1200, height: 900, aspectRatio: '4:3' }
const file = (id: string) => ({ id, visibility: 'public', quarantinedAt: null, mimeType: 'image/webp' })
const asset = { id: 'image1', status: 'active', width: 1500, height: 1000, altText: '素材当前说明', focalX: .5, focalY: .5, file: file('file-new') }
const database = () => ({
  mediaAsset: { findFirst: vi.fn(async () => asset) },
  fileRecord: { findUnique: vi.fn(async () => file('file-old')) },
})

describe('课程图片的固定文件引用', () => {
  it('修改说明保留旧文件与尺寸；主动重选素材使用当前文件', async () => {
    const tx = database()
    const edited = await bindCourseImage(tx as never, { ...oldImage, caption: '修订说明' }, oldImage)
    expect(edited).toEqual({ ...oldImage, caption: '修订说明' })
    const replaced = await bindCourseImage(tx as never, { assetId: 'image1', alt: '新图说明' }, oldImage)
    expect(replaced).toMatchObject({ fileId: 'file-new', width: 1500, height: 1000, aspectRatio: '3:2' })
    expect(oldImage.fileId).toBe('file-old')
  })
  it('不能借合法素材ID读取客户端指定的其他文件，且拒绝私有或隔离图片', async () => {
    const tx = database()
    expect(await bindCourseImage(tx as never, { assetId: 'image1', fileId: 'foreign-file', alt: '说明' })).toMatchObject({ fileId: 'file-new' })
    expect(tx.fileRecord.findUnique).not.toHaveBeenCalled()
    tx.mediaAsset.findFirst.mockResolvedValue({ ...asset, file: { ...asset.file, visibility: 'private' } })
    await expect(bindCourseImage(tx as never, { assetId: 'image1', alt: '说明' })).rejects.toMatchObject({ status: 400 })
    tx.mediaAsset.findFirst.mockResolvedValue({ ...asset, file: { ...asset.file, quarantinedAt: new Date() } } as never)
    await expect(bindCourseImage(tx as never, { assetId: 'image1', alt: '说明' })).rejects.toMatchObject({ status: 400 })
  })
  it('已归档素材保留合法历史引用，但不能新增绑定', async () => {
    const tx = database()
    tx.mediaAsset.findFirst.mockResolvedValue({ ...asset, status: 'archived' })
    expect(await bindCourseImage(tx as never, oldImage, oldImage)).toMatchObject({ fileId: 'file-old' })
    await expect(bindCourseImage(tx as never, { assetId: 'image1', alt: '说明' })).rejects.toMatchObject({ status: 400 })
  })
  it('发布只固化指定草稿，快照同时记录封面和正文文件', async () => {
    const tx = { ...database(),
      courseVersion: { findUniqueOrThrow: vi.fn(async () => ({ snapshot: { title: '课程', data: { coverImage: oldImage } } })), update: vi.fn() },
      lessonBlock: { findMany: vi.fn(async () => [{ id: 'draft-block', content: oldImage }]), update: vi.fn() },
    }
    await freezeCourseImages(tx as never, 'draft-v2', 'image1')
    expect(tx.lessonBlock.update).toHaveBeenCalledWith({ where: { id: 'draft-block' }, data: { content: oldImage } })
    expect(tx.courseVersion.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'draft-v2' }, data: { snapshot: expect.objectContaining({ mediaFiles: [{ assetId: 'image1', fileId: 'file-old' }, { assetId: 'image1', fileId: 'file-old' }] }) } }))
  })
  it('匿名固定URL只允许发布快照声明的素材文件组合，草稿文件仍不可读', async () => {
    const db = { courseVersion: { count: vi.fn(async () => 0) }, fileRecord: { findFirst: vi.fn(async () => file('file-old')) }, mediaAsset: { count: vi.fn(async () => 1) }, lessonBlock: { count: vi.fn(async () => 1) } }
    const service = new MediaService(db as never, {} as never, {} as never)
    await expect(service.pinnedFile('image1', 'file-draft', true)).rejects.toMatchObject({ status: 404 })
    expect(db.fileRecord.findFirst).not.toHaveBeenCalled()
    expect(db.mediaAsset.count).not.toHaveBeenCalled()
    db.courseVersion.count.mockResolvedValue(1)
    expect(await service.pinnedFile('image1', 'file-old', true)).toMatchObject({ id: 'file-old' })
    expect(db.courseVersion.count).toHaveBeenLastCalledWith({ where: { snapshot: { path: ['mediaFiles'], array_contains: [{ assetId: 'image1', fileId: 'file-old' }] }, course: { status: 'published', deletedAt: null } } })
  })
})
