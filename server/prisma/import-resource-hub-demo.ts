import { CommunityPostStatus, CommunityPostType, CommunityVisibility, Prisma, PrismaClient } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { demoResourceHubCategories, demoResourceHubContributions } from '@ai-learning-hub/demo-fixtures'
import { createHash } from 'node:crypto'
import { access, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { StorageService, StoredFile } from '../src/modules/storage/storage.types'

const prisma = new PrismaClient()
const loadRuntime = createRequire(__filename)
const { createStorageAdapter } = loadRuntime('../dist/modules/storage/storage.module') as typeof import('../src/modules/storage/storage.module')
const storage = createStorageAdapter(prisma as unknown as PrismaService, new ConfigService())

async function assetRoot() {
  const candidates = [
    process.env.RESOURCE_HUB_DEMO_ASSET_ROOT,
    path.resolve(process.cwd(), '../frontend/public/demo/resource-hub'),
    path.resolve(process.cwd(), '../demo/resource-hub'),
  ].filter((value): value is string => !!value)
  for (const candidate of candidates) {
    try { await access(path.join(candidate, 'covers')); return candidate } catch { /* 继续尝试受控路径。 */ }
  }
  throw new Error('找不到资源中心演示素材；请设置 RESOURCE_HUB_DEMO_ASSET_ROOT')
}

async function upload(storageService: StorageService, root: string, relativePath: string, uploadedBy: string, visibility: 'public' | 'private', mimeType: string) {
  const source = path.join(root, relativePath)
  const size = (await stat(source)).size
  return storageService.uploadPath({ path: source, originalname: path.basename(source), mimetype: mimeType, size }, { uploadedBy, visibility, maxBytes: 1024 * 1024 * 1024 })
}

async function cleanupFiles(files: StoredFile[]) {
  for (const file of files) await storage.delete(file.id).catch(() => undefined)
}

async function importPost(root: string, row: typeof demoResourceHubContributions[number], authors: Map<string, { id: string; schoolId: string | null }>) {
  if (await prisma.communityPost.count({ where: { id: row.id } })) return false
  const author = authors.get(row.author)
  if (!author) throw new Error(`演示作者不存在：${row.author}`)
  const files: StoredFile[] = []
  try {
    const cover = await upload(storage, root, `covers/${row.coverSlug}.jpg`, author.id, 'public', 'image/jpeg')
    files.push(cover)
    const video = row.videoUrl ? await upload(storage, root, `videos/${row.coverSlug}.mp4`, author.id, 'private', 'video/mp4') : null
    if (video) files.push(video)
    const attachment = row.attachmentUrl ? await upload(storage, root, `attachments/${row.coverSlug}.txt`, author.id, 'private', 'text/plain') : null
    if (attachment) files.push(attachment)
    const banner = row.bannerUrl ? await upload(storage, root, `banners/${path.basename(row.bannerUrl)}`, author.id, 'public', 'image/jpeg') : null
    if (banner) files.push(banner)
    const contentBlocks = [
      { type: 'paragraph', text: `${row.summary}\n\n本条为资源中心功能验收使用的固定演示内容。` },
      ...(banner ? [{ type: 'image', fileId: banner.id, alt: '资源中心 Banner' }] : []),
    ] as Prisma.InputJsonValue
    const publishedAt = new Date(row.publishedAt)
    const videoAssetId = video ? `video-${row.id}` : null
    const imported = await prisma.$transaction(async (tx) => {
      if (await tx.communityPost.count({ where: { id: row.id } })) return false
      if (video && videoAssetId) await tx.videoAsset.create({
        data: {
          id: videoAssetId,
          uploaderId: author.id,
          sourceFileId: video.id,
          playableFileId: video.id,
          posterFileId: cover.id,
          status: 'ready',
          originalName: video.originalName,
          originalMimeType: video.mimeType,
          durationSeconds: 8,
          width: 1280,
          height: 720,
          rotation: 0,
          videoCodec: 'h264',
          audioCodec: 'aac',
          attempts: 1,
          startedAt: publishedAt,
          finishedAt: publishedAt,
        },
      })
      await tx.communityPost.create({
        data: {
          id: row.id,
          authorId: author.id,
          postType: row.kind === 'video' ? CommunityPostType.lab_result : row.kind === 'article' ? CommunityPostType.frontier_discussion : CommunityPostType.note,
          status: CommunityPostStatus.published,
          visibility: CommunityVisibility.public,
          schoolId: author.schoolId,
          title: row.title,
          body: row.summary,
          plainText: row.summary,
          contentBlocks,
          contentHash: createHash('sha256').update(`resource-demo\n${row.id}\n${row.title}`).digest('hex'),
          labels: ['资源中心演示', ...(row.kind === 'video' ? ['演示片段'] : [])],
          publishedAt,
          createdAt: publishedAt,
          impressionCount: row.views,
          likeCount: row.likes,
          commentCount: row.comments,
          bookmarkCount: row.bookmarks,
          contribution: {
            create: {
              kind: row.kind,
              categoryId: `resource-category-${row.categoryCode}`,
              videoAssetId,
              attachmentFileId: attachment?.id || null,
              coverFileId: cover.id,
              tags: row.tags,
              teachingReuseConsent: true,
              featured: !!row.featured,
              liveReplay: !!row.liveReplay,
            },
          },
        },
      })
      if (row.comments) {
        const commenter = authors.get(row.author === 'student' ? 'campus-guide-1' : 'student')!
        await tx.communityComment.create({
          data: {
            id: `comment-${row.id}`,
            postId: row.id,
            authorId: commenter.id,
            body: '这个演示条目的步骤和边界很清楚，适合继续补充实践记录。',
            contentBlocks: [{ type: 'paragraph', text: '这个演示条目的步骤和边界很清楚，适合继续补充实践记录。' }],
            createdAt: new Date(publishedAt.getTime() + 10 * 60 * 1000),
          },
        })
      }
      return true
    })
    if (!imported) await cleanupFiles(files)
    return imported
  } catch (error) {
    await cleanupFiles(files)
    throw error
  }
}

async function run() {
  if (process.env.LOAD_DEMO_DATA !== 'true') throw new Error('资源中心演示数据仅允许在 LOAD_DEMO_DATA=true 时显式处理')
  if (process.argv.includes('--delete')) {
    if (process.env.RESOURCE_HUB_DEMO_CONFIRM !== 'SOFT_DELETE_RESOURCE_DEMO') throw new Error('清理须设置 RESOURCE_HUB_DEMO_CONFIRM=SOFT_DELETE_RESOURCE_DEMO')
    const result = await prisma.communityPost.updateMany({
      where: { id: { in: demoResourceHubContributions.map((row) => row.id) }, labels: { has: '资源中心演示' }, deletedAt: null },
      data: { status: CommunityPostStatus.removed, deletedAt: new Date(), revision: { increment: 1 } },
    })
    console.log(JSON.stringify({ mode: 'soft-delete', removed: result.count }))
    return
  }
  const root = await assetRoot()
  for (const category of demoResourceHubCategories) await prisma.resourceCategory.upsert({
    where: { code: category.code },
    update: {},
    create: { ...category },
  })
  const users = await prisma.user.findMany({ where: { username: { in: ['student', 'campus-guide-1'] }, status: 'active' }, select: { id: true, username: true, schoolId: true } })
  const authors = new Map(users.map((user) => [user.username!, { id: user.id, schoolId: user.schoolId }]))
  if (authors.size !== 2) throw new Error('请先初始化 student 与 campus-guide-1 演示账号')
  let imported = 0
  for (const row of demoResourceHubContributions) if (await importPost(root, row, authors)) imported++
  const student = authors.get('student')!
  if (!await prisma.learningCollection.count({ where: { id: 'resource-demo-collection-agent' } })) {
    await prisma.learningCollection.create({
      data: {
        id: 'resource-demo-collection-agent',
        ownerId: student.id,
        name: 'Agent 入门播放列表',
        description: '从工具调用到多智能体协作',
        learningGoal: '按顺序完成四个 Agent 实践',
        visibility: 'community',
        items: {
          create: ['resource-demo-first-agent', 'resource-demo-function', 'resource-demo-memory', 'resource-demo-multi-agent'].map((contributionPostId, sortOrder) => ({ contributionPostId, sortOrder })),
        },
      },
    })
  }
  if (!await prisma.systemSetting.count({ where: { key: 'resource_hub_config' } })) await prisma.systemSetting.create({
    data: {
      key: 'resource_hub_config',
      value: {
        bannerPostIds: demoResourceHubContributions.filter((row) => row.banner).map((row) => row.id),
        sectionCategoryCodes: ['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'],
      },
    },
  })
  for (const user of authors.values()) await prisma.communityProfile.updateMany({
    where: { userId: user.id },
    data: { postCount: await prisma.communityPost.count({ where: { authorId: user.id, status: 'published', deletedAt: null } }) },
  })
  console.log(JSON.stringify({ mode: 'import', imported, skipped: demoResourceHubContributions.length - imported, assets: { covers: 24, banners: 3, videos: 16, attachments: 3 } }))
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '资源中心演示数据处理失败')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
