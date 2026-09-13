import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { checkMedia, contentRoot, digest, readBundle, sha } from '../src/modules/project-content/bundle'
import { authorDto, type CommunityAuthor } from '../src/modules/community/community.mapper'
import { legacyCourseReason, type ExistingCurriculum } from '../src/modules/project-content/legacy-course'

describe('正式项目内容边界', () => {
  it('三类内容及媒体完整且无账号字段', async () => {
    const { bundle } = await readBundle()
    expect((await checkMedia(bundle)).size).toBe(138)
    expect(bundle.tutorials.filter(t => t.video).every(t => t.durationSeconds === 8)).toBe(true)
    expect(JSON.stringify(bundle)).not.toMatch(/accounts\.invalid|demo\.invalid|campus-guide-|20260001|造梦少年/)
  })
  it('摘要不依赖对象字段顺序，数组顺序保持业务含义', () => {
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }))
    expect(digest([1, 2])).not.toBe(digest([2, 1]))
    expect(digest(undefined)).toBe(digest(null))
  })
  it('隐藏内部关联账号全部公开身份字段', () => {
    const user = { id: 'private-admin', username: 'private-name', displayName: '内部管理员', email: 'private@example.invalid' } as CommunityAuthor
    expect(authorDto(user, undefined, 'project_content')).toEqual({ kind: 'platform', id: 'platform-content', username: '', displayName: '平台内容', avatar: null, school: null, major: null, verifiedType: 'none', badges: [] })
  })
  it('旧版完整课程可接管，但正文和图片修改受到保护', async () => {
    const { bundle } = await readBundle(), definition = bundle.courses[0]!
    const assets = Object.entries(bundle.media).map(([assetKey, media]) => ({ id: assetKey, assetKey, source: 'image2_seed', revision: 1, status: 'active', deletedAt: null, file: { checksum: media.sha256, quarantinedAt: null } }))
    const version = { id: 'published', versionNo: 2, snapshot: { curriculumVersion: 'xiaoxue-v2', data: {} }, chapters: definition.chapters.map((ch, ci) => ({ title: ch.title, sortOrder: ci + 1, lessons: ch.lessons.map((l, li) => ({ ...l, sortOrder: li + 1, blocks: l.blocks.map((b, bi) => ({ ...b, sortOrder: bi + 1 })) })) })) }
    const course = { slug: definition.slug, title: definition.title, summary: definition.summary, dataOrigin: 'demo_seed', version: 2, status: 'published', deletedAt: null, publishedVersionId: 'published', currentDraftVersionId: 'published', payload: {}, coverAssetId: definition.cover, versions: [{ id: 'old', versionNo: 1 }, version] } as unknown as ExistingCurriculum
    const tx = { mediaAsset: { findMany: async () => assets } } as never
    expect(await legacyCourseReason(tx, course, definition, bundle.media)).toBeNull()
    version.chapters[0]!.lessons[0]!.summary = '现场修改'
    expect(await legacyCourseReason(tx, course, definition, bundle.media)).toContain('已修改')
    version.chapters[0]!.lessons[0]!.summary = definition.chapters[0]!.lessons[0]!.summary
    assets.find(a => a.assetKey === definition.cover)!.revision = 2
    expect(await legacyCourseReason(tx, course, definition, bundle.media)).toContain('封面已修改')
  })
  it('摘要错误及混入账号数据会在数据库写入前失败', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'project-content-'))
    try {
      const raw = await readFile(path.join(contentRoot, 'content.json'), 'utf8')
      await writeFile(path.join(root, 'content.json'), raw)
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ release: 1, sha256: 'invalid' }))
      await expect(readBundle(root)).rejects.toThrow('摘要')
      const unsafe = JSON.stringify({ ...JSON.parse(raw), users: [{ email: 'unsafe@example.invalid' }] })
      await writeFile(path.join(root, 'content.json'), unsafe)
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ release: 1, sha256: sha(unsafe) }))
      await expect(readBundle(root)).rejects.toThrow('非白名单')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
