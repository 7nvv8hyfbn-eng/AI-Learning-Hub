import { describe, expect, it, vi } from 'vitest'
import { CommunitySearchService } from '../src/modules/community/search.service'
import { ContentSupportService } from '../src/common/content/content-support.service'
import { MediaResolverService } from '../src/modules/media/media-resolver.service'
import { FileAccessService } from '../src/modules/storage/file-access.service'
import { ContentReferenceService } from '../src/common/content-reference/content-reference.service'
import { ResourceService } from '../src/modules/resources/resource.service'

describe('资源检测后的快照边界', () => {
  it.each(['allow', 'warn', 'review', 'reject'] as const)('传统资源发布 %s 检测精确草稿标题、说明和标签后才改变可见性', async (action) => {
    const snapshot = { title: '合成资源标题', summary: '合成资源说明', data: { tags: ['RAG', 'LLM'] } }
    const resource = { id: 'synthetic-resource', currentDraftVersionId: 'synthetic-draft', publishedVersionId: 'synthetic-old', version: 5 }
    const tx = {
      resource: { findUnique: vi.fn(async () => resource), update: vi.fn(async ({ data }: { data: object }) => ({ ...resource, ...data, version: 6 })) },
      resourceVersion: { findUniqueOrThrow: vi.fn(async () => ({ id: 'synthetic-draft', snapshot })) },
    }
    const prisma = { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx) }
    const support = { binding: vi.fn(), data: (value: unknown) => value || {}, audit: vi.fn(), render: vi.fn(async (_kind, row) => row) }
    const result = { action, ruleVersion: 7, hits: [], mediaReview: 'not_performed' }
    const detection = { check: vi.fn(async () => { if (action === 'reject') throw new Error('内容未发布'); return result }), record: vi.fn(), result: vi.fn(async () => result) }
    const service = new ResourceService(prisma as never, support as never, detection as never)
    if (action === 'reject') {
      await expect(service.setPublished(resource.id, true, 'synthetic-editor')).rejects.toThrow('内容未发布')
      expect(tx.resource.update).not.toHaveBeenCalled()
      expect(detection.record).not.toHaveBeenCalled()
      expect(support.audit).not.toHaveBeenCalled()
    } else {
      expect(await service.setPublished(resource.id, true, 'synthetic-editor')).toMatchObject({ status: action === 'review' ? 'reviewing' : 'published', detection: result, publishedVersionId: action === 'review' ? 'synthetic-old' : 'synthetic-draft' })
      expect(detection.record).toHaveBeenCalledWith(tx, { type: 'resource', id: resource.id, revision: 6, authorId: 'synthetic-editor', submittedById: 'synthetic-editor' }, result, { draftVersionId: 'synthetic-draft', snapshot })
    }
    expect(detection.check).toHaveBeenCalledWith(tx, { resourceTitle: snapshot.title, resourceDescription: snapshot.summary, resourceTags: 'RAG\nLLM' })
  })

  it.each(['', undefined])('关联资源空摘要 %s 不回退到未检测草稿，可见性也读取发布快照', async (summary) => {
    const resource = { id: 'synthetic-resource', slug: 'synthetic-resource', title: '未检测草稿标题', summary: '未检测草稿摘要', visibility: 'private', payload: {}, publishedVersion: { snapshot: { title: '已审核课程资源', summary, visibility: 'public', data: {} } } }
    const prisma = { resource: { findMany: vi.fn(async () => [resource]) } }
    const media = { prepare: vi.fn(async () => ({})), data: vi.fn(async () => ({})) }
    const service = new ContentReferenceService(prisma as never, media as never)
    const result = await service.resolveMany([{ type: 'resource', id: resource.id }], 'synthetic-viewer')
    expect(result.get(`resource:${resource.id}`)).toMatchObject({ title: '已审核课程资源', summary: '' })
    expect(prisma.resource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ publishedVersion: { is: { snapshot: { path: ['visibility'], equals: 'public' } } } }) }))
    expect(media.data).toHaveBeenCalledWith('resource', expect.objectContaining({ title: '已审核课程资源', summary: '' }), {}, true, {})
  })

  it('传统资源详情和列表只展示已发布文字，公开搜索不读取草稿列', async () => {
    const item = { id: 'synthetic-resource', slug: 'synthetic-resource', title: '未检测草稿', summary: '草稿机密词', status: 'published', updatedAt: new Date(0), publishedAt: new Date(0), payload: {}, publishedVersion: { snapshot: { title: '已审核资源', summary: '', data: {} } }, versions: [], file: null }
    const prisma = { resource: { findFirst: vi.fn(async () => item), findMany: vi.fn(async (_query: { where: Record<string, unknown> }) => [item]), count: vi.fn(async () => 1) }, $transaction: (ops: Promise<unknown>[]) => Promise.all(ops) }
    const media = { prepare: vi.fn(), data: vi.fn(async (_type, _row, data) => data) }
    const service = new ResourceService(prisma as never, new ContentSupportService(prisma as never, media as never), {} as never)
    expect(await service.detail(item.id, true)).toMatchObject({ title: '已审核资源', summary: '' })
    const list = await service.list({ page: 1, pageSize: 20, keyword: '课程' } as never, true)
    expect(list.items[0]).toMatchObject({ title: '已审核资源', summary: '' })
    const where = prisma.resource.findMany.mock.calls[0]![0].where
    expect(where).not.toHaveProperty('OR')
    expect(where.publishedVersion).toEqual({ is: { OR: [{ snapshot: { path: ['title'], string_contains: '课程', mode: 'insensitive' } }, { snapshot: { path: ['summary'], string_contains: '课程', mode: 'insensitive' } }] } })
  })
})

describe('公共搜索复用媒体批量解析', () => {
  it.each(['courses', 'labs', 'resources', 'articles'] as const)('%s只读发布封面，四种状态不退化为逐条查询', async (type) => {
    const data = [{ coverAssetId: 'published' }, { coverAssetId: null, cover: '/old.webp' }, { cover: '/old.webp?token=secret' }, { cover: '/valid-old.webp' }]
    const rows = data.map((value, index) => ({ id: String(index), slug: `item-${index}`, title: '草稿标题', summary: '', payload: { coverAssetId: 'draft-only' }, coverAssetId: 'draft-only', category: 'llm', labType: 'agent', status: 'published', publishedAt: new Date(0), updatedAt: new Date(0), sortOrder: 0, publishedVersion: { snapshot: { title: '发布标题', visibility: 'public', category: 'llm', [index === 3 ? 'payload' : 'data']: value } } }))
    const image = (id: string) => ({ id, altText: '封面', width: 1200, height: 675, focalX: .5, focalY: .5, file: { visibility: 'public' } })
    const prisma = {
      course: { findMany: vi.fn(async () => rows) }, lab: { findMany: vi.fn(async () => rows) },
      resource: { findMany: vi.fn(async () => rows) }, article: { findMany: vi.fn(async () => rows) },
      mediaAsset: { findMany: vi.fn(async () => [image('published')]), findFirst: vi.fn() },
      mediaDefaultRule: { findMany: vi.fn(async () => [{ contentType: 'global', categoryKey: 'generic', asset: image('fallback') }]) },
    }
    const support = new ContentSupportService(prisma as never, new MediaResolverService(prisma as never))
    const search = new CommunitySearchService(prisma as never, {} as never, {} as never, { viewer: vi.fn() } as never, support)
    const result = (await search.search('student', { q: '发布', type, limit: 20 }))[type]
    expect(result.map((item) => item.title)).toEqual(Array(4).fill('发布标题'))
    expect(result.map((item) => item.data.cover)).toEqual(['/api/v1/public/media/published', '/api/v1/public/media/fallback', '/api/v1/public/media/fallback', '/valid-old.webp'])
    expect(result[1].data.coverAssetId).toBeNull()
    expect(prisma.mediaAsset.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ['published'] } }) }))
    expect(prisma.mediaDefaultRule.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.mediaAsset.findFirst).not.toHaveBeenCalled()
    if (type === 'resources') expect(prisma.resource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: [{ publishedVersion: { is: { snapshot: { path: ['visibility'], not: 'private' } } } }] }) }))
  })
})

describe('资源下载授权只读发布快照', () => {
  const setup = (snapshot: Record<string, unknown>, owner = false, editor = false) => {
    const resource = { fileId: 'draft-B', visibility: 'public', publishedVersion: { snapshot } }
    const count = vi.fn(async ({ where }) => {
      if (where.fileId) return Number(editor && where.fileId === resource.fileId)
      const rules = where.publishedVersion.is.AND
      return Number(rules.every((rule: { snapshot: { path: string[]; equals: string } }) => snapshot[rule.snapshot.path[0]] === rule.snapshot.equals))
    })
    const prisma = { fileRecord: { findUnique: vi.fn(async ({ where }) => ({ id: where.id, uploadedBy: owner ? 'student' : 'admin' })) }, userRole: { count: vi.fn(async ({ where }) => Number(editor && where.role.permissions.some.permission.code === 'resource.write')) }, resource: { count }, communityPost: { count: vi.fn(async () => 0) }, communityComment: { count: vi.fn(async () => 0) }, communityProfile: { count: vi.fn(async () => 0) } }
    const visibility = { viewer: vi.fn(), assertMediaEligibility: vi.fn(), auditAdminRead: vi.fn(), where: vi.fn(async () => ({})), authorExclusions: vi.fn(async () => ({ authors: [] })) }
    return { access: new FileAccessService(prisma as never, visibility as never), count }
  }
  it('发布A允许、草稿B拒绝，查询不包含当前附件列', async () => {
    const { access, count } = setup({ fileId: 'published-A', visibility: 'public' })
    await expect(access.assert('student', 'published-A')).resolves.toMatchObject({ id: 'published-A' })
    await expect(access.assert('student', 'draft-B')).rejects.toThrow('无权访问')
    expect(count.mock.calls.every(([query]) => !('fileId' in query.where))).toBe(true)
  })
  it.each([{ fileId: 'published-A', visibility: 'private' }, { fileId: null, visibility: 'public' }, { visibility: 'public' }, { fileId: 'published-A' }])('私有、移除与缺字段均拒绝回读草稿 %j', async (snapshot) => {
    const { access } = setup(snapshot)
    await expect(access.assert('student', 'published-A')).rejects.toThrow()
    await expect(access.assert('student', 'draft-B')).rejects.toThrow()
  })
  it('作者和原资源编辑者的草稿权限保持不变', async () => {
    await expect(setup({}, true).access.assert('student', 'draft-B')).resolves.toMatchObject({ id: 'draft-B' })
    await expect(setup({}, false, true).access.assert('student', 'draft-B')).resolves.toMatchObject({ id: 'draft-B' })
  })
})
