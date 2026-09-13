import { Prisma, PrismaClient, type CommunityPostType, type ResourceContributionKind } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import path from 'node:path'
import type { PrismaService } from '../../prisma/prisma.service'
import { createStorageAdapter } from '../storage/storage.module'
import type { StorageService } from '../storage/storage.types'
import { lockFileReferences, postRevision } from '../../common/persistence'
import { freezeCourseImages } from '../courses/course-images'
import { curriculumInclude, legacyCourseReason } from './legacy-course'
import { assertContentReady, checkMedia, completionKey, contentSource, digest, readBundle, sha,  } from './bundle'

type Tx = Prisma.TransactionClient
type Kind = 'community' | 'reply' | 'course' | 'tutorial' | 'category' | 'playlist'
type State = { recordId: string; release: number; desired: string; applied: string | null; status: 'synced' | 'protected' }
type Entry = { kind: Kind; key: string; action: 'created' | 'updated' | 'unchanged' | 'protected'; reason?: string }
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const fields = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(key => [key, row[key]]))
const postFields = ['id', 'authorId', 'revision', 'title', 'body', 'contentBlocks', 'plainText', 'status', 'visibility', 'portalConsent', 'deletedAt', 'editedAt', 'postType', 'sourceType', 'sourceId', 'labels', 'contentHash']

/** 摘要只覆盖可编辑内容；互动、个人记录和访问时间不会触发覆盖或被写回。 */
async function snapshot(tx: Tx, kind: Kind, id: string): Promise<unknown | null> {
  if (kind === 'community' || kind === 'tutorial') {
    const row = await tx.communityPost.findUnique({ where: { id }, include: { contribution: true, bindings: true, topics: true } })
    return row ? { ...fields(row, postFields), contribution: row.contribution, bindings: row.bindings, topics: row.topics } : null
  }
  if (kind === 'reply') {
    const row = await tx.communityComment.findUnique({ where: { id } })
    return row ? fields(row, ['id', 'authorId', 'postId', 'parentId', 'rootId', 'body', 'contentBlocks', 'revision', 'status', 'deletedAt', 'sourceType']) : null
  }
  if (kind === 'course') {
    const row = await tx.course.findUnique({ where: { slug: id }, include: curriculumInclude })
    return row ? { ...fields(row, ['id', 'title', 'summary', 'payload', 'version', 'dataOrigin', 'coverAssetId', 'status', 'deletedAt', 'currentDraftVersionId', 'publishedVersionId', 'themeId', 'sortOrder']), versions: row.versions, coverAsset: row.coverAsset } : null
  }
  if (kind === 'category') return tx.resourceCategory.findUnique({ where: { code: id } })
  return tx.learningCollection.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
}

export async function syncProjectContent(prisma: PrismaClient, options: { preview?: boolean; root?: string; repositoryRoot?: string; storage?: StorageService } = {}) {
  const { bundle, manifest } = await readBundle(options.root)
  const media = await checkMedia(bundle, options.repositoryRoot)
  const storage = options.storage || createStorageAdapter(prisma as PrismaService, new ConfigService())
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', completionKey)
    const old = await tx.systemSetting.findUnique({ where: { key: completionKey } })
    const previous = object(old?.value)
    if (Number(previous.release || 0) > bundle.release) throw new Error('禁止旧版本内容覆盖新版本')
    for (const [kind, version] of Object.entries(bundle.versions)) if (Number(object(previous.versions)[kind] || 0) > version) throw new Error('禁止内容分类版本降级：' + kind)
    if (previous.release === bundle.release && previous.sha256 !== manifest.sha256) throw new Error('内容已改变但版本未递增')
    const admin = await tx.user.findFirst({ where: { status: 'active', userRoles: { some: { role: { code: { in: ['admin', 'super_admin'] } } } } }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    if (!admin) throw new Error('内容同步需要目标环境已有管理员，请先 bootstrap')
    let registryChanged = false, uploadedFiles = 0, reusedFiles = 0
    const entries: Entry[] = [], files = new Map<string, string>(), assets = new Map<string, string>()
    async function file(key: string) {
      if (files.has(key)) return files.get(key)!
      const source = media.get(key)
      if (!source) throw new Error('清单素材引用不存在：' + key)
      const visibility = key.startsWith('community:') || source.asset.mime === 'video/mp4' || source.asset.mime === 'text/plain' ? 'private' : 'public'
      const originalname = path.basename(source.path)
      const existing = await tx.fileRecord.findFirst({ where: { checksum: source.asset.sha256, visibility, quarantinedAt: null }, orderBy: { createdAt: 'asc' } })
      if (existing && await storage.exists(existing.id)) { reusedFiles++; files.set(key, existing.id); return existing.id }
      const uploaded = await storage.uploadPath({ path: source.path, originalname, mimetype: source.asset.mime, size: source.asset.bytes }, { uploadedBy: admin!.id, visibility, maxBytes: 1024 * 1024 * 1024, catalogMedia: visibility === 'public' })
      if (uploaded.securityScan?.quarantined || uploaded.checksum !== source.asset.sha256) throw new Error('素材上传校验失败：' + key)
      uploadedFiles++
      files.set(key, uploaded.id)
      return uploaded.id
    }
    async function asset(key: string) {
      if (assets.has(key)) return assets.get(key)!
      const source = media.get(key)!.asset, fileId = await file(key)
      const existing = await tx.mediaAsset.findUnique({ where: { fileId } })
      if (existing) {
        if (existing.deletedAt || existing.status !== 'active') throw new Error('项目素材已被停用，请处理素材冲突：' + key)
        assets.set(key, existing.id); return existing.id
      }
      const created = await tx.mediaAsset.create({ data: { assetKey: 'project--' + source.sha256, fileId, name: source.alt || key, kind: source.kind === 'illustration' ? 'illustration' : 'cover', source: 'image2_seed', contentType: 'course', width: source.width!, height: source.height!, altText: source.alt || key, createdBy: admin!.id } })
      assets.set(key, created.id); return created.id
    }
    // 素材上传会申请存储锁，必须先完成上传，再取得引用锁并写入内容。
    if (!options.preview) for (const key of media.keys()) await file(key)
    if (!options.preview) await lockFileReferences(tx)
    // 同步期间允许读取；编辑事务等待，避免摘要检查后被并发人工写入。
    if (!options.preview) await tx.$executeRawUnsafe('LOCK TABLE community_posts, community_comments, courses, course_versions, course_chapters, course_lessons, lesson_blocks, resource_contributions, resource_categories, learning_collections, learning_collection_items IN SHARE ROW EXCLUSIVE MODE')
    async function item(kind: Kind, key: string, desired: unknown, legacy: () => Promise<string | null>, write: (present: boolean) => Promise<void>, prerequisite?: string) {
      const settingKey = 'project_content:item:' + kind + ':' + key
      const saved = await tx.systemSetting.findUnique({ where: { key: settingKey } })
      const state = saved?.value as State | undefined
      const current = await snapshot(tx, kind, key), wanted = digest({ desired, media: [...JSON.stringify(desired).matchAll(/"([^"\n]+)"/g)].map(m => m[1]!).filter(k => media.has(k)).map(k => media.get(k)!.asset.sha256) })
      if (state && state.release > bundle.release) throw new Error('条目版本高于当前发布：' + key)
      let reason = prerequisite || (state?.status === 'protected' ? '已记录人工修改或删除' : state && digest(current) !== state.applied ? (current ? '内容已人工修改或下架' : '内容已删除，不复活') : '')
      if (!state && current && !reason) reason = await legacy() || ''
      const versionKind = kind === 'course' ? 'courses' : ['community', 'reply'].includes(kind) ? 'community' : 'tutorials'
      if (state?.status === 'synced' && !reason && state.desired !== wanted && bundle.versions[versionKind] <= Number(object(previous.versions)[versionKind] || 0)) throw new Error('内容已改变但分类版本未递增：' + key)
      const action: Entry['action'] = reason ? 'protected' : state && state.desired === wanted ? 'unchanged' : current ? 'updated' : 'created'
      entries.push({ kind, key, action, ...(reason ? { reason } : {}) })
      if (options.preview) return action
      if (action === 'created' || action === 'updated') await write(!!current)
      const next: State = { recordId: key, release: bundle.release, desired: wanted, applied: reason ? state?.applied || null : digest(await snapshot(tx, kind, key)), status: reason ? 'protected' : 'synced' }
      if (digest(state) !== digest(next)) { registryChanged = true; await tx.systemSetting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: json(next) }, update: { value: json(next) } }) }
      return action
    }
    async function savePost(id: string, present: boolean, data: Prisma.CommunityPostUncheckedCreateInput) {
      if (present) await postRevision(tx, id, admin!.id, 'import', '项目内容升级前快照')
      const row = present ? await tx.communityPost.update({ where: { id }, data: { ...data, id: undefined, revision: { increment: 1 } } }) : await tx.communityPost.create({ data })
      await tx.communityPostRevision.create({ data: { postId: id, revisionNo: row.revision, editorId: admin!.id, editorType: 'import', titleSnapshot: row.title, contentBlocksSnapshot: json(row.contentBlocks), bindingsSnapshot: [], topicIdsSnapshot: [], visibilitySnapshot: row.visibility, statusSnapshot: row.status, reason: '项目内容版本 ' + bundle.release } })
    }
    for (const p of bundle.community) {
      const action = await item('community', p.id, p, async () => {
        const oldPost = await tx.communityPost.findUniqueOrThrow({ where: { id: p.id } })
        const audit = await tx.auditLog.findFirst({ where: { OR: [{ action: 'community.managed_content.import', targetId: bundle.legacyCommunityBatch }, { action: { startsWith: 'community.starter.' }, targetId: bundle.legacyCommunityBatch }] } })
        return audit && oldPost.sourceType === 'managed_community_content' && oldPost.sourceId === bundle.legacyCommunityBatch && oldPost.revision === 1 && !oldPost.deletedAt && oldPost.status === 'published' && oldPost.visibility === 'public' && oldPost.title === p.title && oldPost.body === p.body && oldPost.contentHash === sha(p.body.replace(/\s+/g, '').toLowerCase()) ? null : '无法确认旧社区内容归属或已修改'
      }, async present => {
        const blocks = [{ type: 'paragraph', text: p.body }, { type: 'image', fileId: await file(p.image), alt: p.category + '原创概念配图' }]
        await savePost(p.id, present, { id: p.id, authorId: admin.id, title: p.title, body: p.body, plainText: p.body, contentBlocks: blocks, contentHash: sha(p.body.replace(/\s+/g, '').toLowerCase()), postType: p.postType as CommunityPostType, status: 'published', visibility: 'public', portalConsent: true, sourceType: contentSource, sourceId: p.id, schoolId: null, labels: [p.category], ...(!present ? { publishedAt: new Date(), commentCount: 2 } : {}) })
        if (p.postType === 'question') await tx.communityQuestionState.upsert({ where: { postId: p.id }, create: { postId: p.id, status: 'open' }, update: {} })
      })
      for (const [index, r] of p.replies.entries()) await item('reply', r.id, r, async () => {
        const oldReply = await tx.communityComment.findUniqueOrThrow({ where: { id: r.id } })
        return oldReply.postId === p.id && oldReply.body === r.body && oldReply.revision === 1 && oldReply.status === 'published' && !oldReply.deletedAt && action !== 'protected' ? null : '旧回复已修改或归属未确认'
      }, async present => {
        const data = { authorId: admin.id, sourceType: contentSource, body: r.body, contentBlocks: [{ type: 'paragraph', text: r.body }] }
        if (present) await tx.communityComment.update({ where: { id: r.id }, data: { ...data, revision: { increment: 1 } } })
        else await tx.communityComment.create({ data: { ...data, id: r.id, postId: p.id, ...(index ? { parentId: p.replies[0]!.id, rootId: p.replies[0]!.id } : {}) } })
      }, action === 'protected' ? '所属帖子保留现场状态' : undefined)
    }
    for (const c of bundle.courses) await item('course', c.slug, c, async () => legacyCourseReason(tx, await tx.course.findUnique({ where: { slug: c.slug }, include: curriculumInclude }), c, bundle.media), async present => {
      const course = present ? await tx.course.findUniqueOrThrow({ where: { slug: c.slug } }) : await tx.course.create({ data: { slug: c.slug, title: c.title, summary: c.summary, dataOrigin: contentSource } })
      const coverAssetId = await asset(c.cover)
      const payload = { coverAssetId, category: c.category, level: c.level, hours: c.hours, durationMinutes: c.durationMinutes, mode: c.mode, icon: c.icon, coverVariant: c.coverVariant, chapters: c.chapters.length, instructor: { name: '平台内容', title: '' }, certificate: c.category + ' 学习证书', recommended: c.recommended }
      const last = await tx.courseVersion.aggregate({ where: { courseId: course.id }, _max: { versionNo: true } })
      const version = await tx.courseVersion.create({ data: { courseId: course.id, versionNo: (last._max.versionNo || 0) + 1, snapshot: json({ title: c.title, summary: c.summary, data: payload, projectContentVersion: bundle.versions.courses, sources: c.sources }) } })
      for (const [ci, chapter] of c.chapters.entries()) {
        const ch = await tx.courseChapter.create({ data: { courseVersionId: version.id, title: chapter.title, sortOrder: ci + 1 } })
        for (const [li, lesson] of chapter.lessons.entries()) {
          const le = await tx.courseLesson.create({ data: { chapterId: ch.id, title: lesson.title, summary: lesson.summary, durationMinutes: lesson.durationMinutes, lessonType: 'article', sortOrder: li + 1 } })
          for (const [bi, block] of lesson.blocks.entries()) {
            const content = { ...block.content } as Record<string, unknown>
            if (block.blockType === 'image') content.assetId = await asset(String(content.assetId))
            await tx.lessonBlock.create({ data: { lessonId: le.id, blockType: block.blockType, content: json(content), sortOrder: bi + 1 } })
          }
        }
      }
      await freezeCourseImages(tx, version.id, coverAssetId)
      await tx.course.update({ where: { id: course.id }, data: { title: c.title, summary: c.summary, dataOrigin: contentSource, payload, coverAssetId, publishedVersionId: version.id, currentDraftVersionId: version.id, status: 'published', publishedAt: new Date(), ...(present ? { version: { increment: 1 } } : {}) } })
    })
    for (const c of bundle.categories) await item('category', c.code, c, async () => {
      const row = await tx.resourceCategory.findUniqueOrThrow({ where: { code: c.code } })
      return row.active && row.id === c.id && Object.entries(c).every(([k, v]) => object(row)[k] === v) ? null : '分类已有现场修改或同名冲突'
    }, async present => { if (present) await tx.resourceCategory.update({ where: { code: c.code }, data: c }); else await tx.resourceCategory.create({ data: c }) })
    for (const t of bundle.tutorials) await item('tutorial', t.id, t, async () => {
      const oldPost = await tx.communityPost.findUniqueOrThrow({ where: { id: t.id }, include: { contribution: true } })
      const contribution = oldPost.contribution
      const blocks = [{ type: 'paragraph', text: t.summary + '\n\n本条为资源中心功能验收使用的固定演示内容。' }]
      const oldBlocks = oldPost.contentBlocks as Array<Record<string, unknown>>
      return oldPost.revision === 1 && !oldPost.deletedAt && oldPost.status === 'published' && oldPost.visibility === 'public' && oldPost.title === t.title && oldPost.body === t.summary && oldPost.contentHash === sha(`resource-demo\n${t.id}\n${t.title}`) && oldPost.labels.includes('资源中心演示') && contribution?.revision === 1 && contribution.kind === t.kind && contribution.categoryId === 'resource-category-' + t.categoryCode && digest(contribution.tags) === digest(t.tags) && digest(oldBlocks[0]) === digest(blocks[0]) && oldBlocks.length === (t.banner ? 2 : 1) ? null : '无法确认旧教程归属或已人工修改'
    }, async present => {
      const coverFileId = await file(t.cover), attachmentFileId = t.attachment ? await file(t.attachment) : null
      const videoFileId = t.video ? await file(t.video) : null
      const video = videoFileId ? await tx.videoAsset.findFirst({ where: { sourceFileId: videoFileId, playableFileId: videoFileId, status: 'ready' } }) : null
      const videoAssetId = videoFileId ? video?.id || (await tx.videoAsset.create({ data: { uploaderId: admin.id, sourceFileId: videoFileId, playableFileId: videoFileId, posterFileId: coverFileId, status: 'ready', originalName: path.basename(media.get(t.video!)!.path), originalMimeType: 'video/mp4', durationSeconds: 8, width: 1280, height: 720, videoCodec: 'h264', audioCodec: 'aac', finishedAt: new Date() } })).id : null
      const blocks = [{ type: 'paragraph', text: t.summary }, ...(t.banner ? [{ type: 'image', fileId: await file(t.banner), alt: t.title }] : [])]
      await savePost(t.id, present, { id: t.id, authorId: admin.id, title: t.title, body: t.summary, plainText: t.summary, contentBlocks: blocks, contentHash: sha(t.summary), postType: t.kind === 'video' ? 'lab_result' : t.kind === 'article' ? 'frontier_discussion' : 'note', status: 'published', visibility: 'public', portalConsent: true, sourceType: contentSource, sourceId: t.id, schoolId: null, labels: t.video ? ['8秒演示片段'] : [], ...(!present ? { publishedAt: new Date() } : {}) })
      const category = await tx.resourceCategory.findUniqueOrThrow({ where: { code: t.categoryCode } })
      const data = { kind: t.kind as ResourceContributionKind, categoryId: category.id, coverFileId, attachmentFileId, videoAssetId, tags: t.tags, teachingReuseConsent: true, featured: t.featured, liveReplay: t.liveReplay }
      await tx.resourceContribution.upsert({ where: { postId: t.id }, create: { postId: t.id, ...data }, update: { ...data, revision: { increment: 1 } } })
      // 仅接管该历史脚本的固定配套回复；普通用户评论及其互动保持不变。
      if (present) await tx.communityComment.updateMany({ where: { id: 'comment-' + t.id, postId: t.id, revision: 1, status: 'published', deletedAt: null, body: '这个演示条目的步骤和边界很清楚，适合继续补充实践记录。' }, data: { authorId: admin.id, sourceType: contentSource } })
    })
    const p = bundle.playlist
    await item('playlist', p.id, p, async () => {
      const oldList = await tx.learningCollection.findUniqueOrThrow({ where: { id: p.id }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
      return oldList.revision === 1 && oldList.name === p.name && oldList.description === p.description && oldList.learningGoal === p.learningGoal && oldList.visibility === 'community' && oldList.contentStatus === 'published' && digest(oldList.items.map(i => i.contributionPostId)) === digest(p.items) ? null : '播放列表已修改或无法确认归属'
    }, async present => {
      const data = { ownerId: admin.id, systemKind: contentSource, name: p.name, description: p.description, learningGoal: p.learningGoal, visibility: 'community' as const }
      if (present) { await tx.learningCollection.update({ where: { id: p.id }, data: { ...data, revision: { increment: 1 } } }); await tx.learningCollectionItem.deleteMany({ where: { collectionId: p.id } }) }
      else await tx.learningCollection.create({ data: { id: p.id, ...data } })
      await tx.learningCollectionItem.createMany({ data: p.items.map((contributionPostId, sortOrder) => ({ collectionId: p.id, contributionPostId, sortOrder })) })
    }, entries.some(e => e.kind === 'tutorial' && p.items.includes(e.key) && e.action === 'protected') ? '相关教程有人工冲突，保留播放列表' : undefined)
    const boundFiles = new Set<string>()
    const collectFiles = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(collectFiles); return }
      for (const [key, child] of Object.entries(object(value))) {
        if ((key === 'fileId' || key.endsWith('FileId')) && typeof child === 'string') boundFiles.add(child)
        else if (typeof child === 'object') collectFiles(child)
      }
    }
    for (const entry of entries.filter(e => e.action !== 'protected' && (!options.preview || e.action === 'unchanged'))) {
      const current = object(await snapshot(tx, entry.kind, entry.key))
      if (entry.kind === 'course') current.versions = (current.versions as Array<{ id: string }>).filter(v => v.id === current.publishedVersionId)
      collectFiles(current)
      if (entry.kind === 'tutorial') {
        const videoAssetId = object(current.contribution).videoAssetId
        if (typeof videoAssetId === 'string') collectFiles(await tx.videoAsset.findUnique({ where: { id: videoAssetId } }))
      }
    }
    for (const id of boundFiles) {
      const record = await tx.fileRecord.findUnique({ where: { id } })
      if (!record || record.quarantinedAt || !await storage.exists(id)) throw new Error('已同步内容引用的媒体缺失或不可用：' + id)
    }
    const report = { status: options.preview ? 'preview' : 'complete', release: bundle.release, sha256: manifest.sha256, versions: bundle.versions, commit: process.env.APP_COMMIT_SHA || 'local', media: { checked: media.size, valid: true, uploaded: uploadedFiles, reused: reusedFiles }, counts: Object.fromEntries(['created', 'updated', 'unchanged', 'protected'].map(action => [action, entries.filter(e => e.action === action).length])), entries }
    if (!options.preview) {
      // 完成记录在同一事务最后写入；任何失败都会回滚，上传按摘要安全复用。
      if (registryChanged || previous.release !== bundle.release || previous.sha256 !== manifest.sha256) await tx.systemSetting.upsert({ where: { key: completionKey }, create: { key: completionKey, value: json(report) }, update: { value: json(report) } })
      if (entries.some(e => ['created', 'updated'].includes(e.action))) await tx.auditLog.create({ data: { actorId: admin.id, action: 'project_content.sync', targetType: 'project_content', targetId: String(bundle.release), details: json(report) } })
    }
    return report
  }, { timeout: 600000, maxWait: 60000 })
}

export async function contentMain() {
  if (process.argv.includes('--check')) { const { bundle, manifest } = await readBundle(); const media = await checkMedia(bundle); console.log(JSON.stringify({ ...manifest, media: media.size, valid: true })); return }
  const prisma = new PrismaClient()
  try {
    if (process.argv.includes('--verify')) { await assertContentReady(prisma); const report = await syncProjectContent(prisma, { preview: true }); if (report.entries.some(e => ['created', 'updated'].includes(e.action))) throw new Error('内容同步未完成'); console.log(JSON.stringify(report)); return }
    console.log(JSON.stringify(await syncProjectContent(prisma, { preview: process.argv.includes('--preview') })))
  } finally { await prisma.$disconnect() }
}
if (require.main === module) contentMain().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '项目内容同步失败'); process.exitCode = 1 })
