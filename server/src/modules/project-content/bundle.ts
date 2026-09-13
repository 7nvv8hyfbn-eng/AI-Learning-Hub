import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ServiceUnavailableException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'

export type ContentBundle = typeof import('../../../resources/project-content/content.json')
export type ContentMedia = { root: string; file: string; bytes: number; sha256: string; mime: string; width?: number; height?: number; alt?: string; kind?: string }
export const contentSource = 'project_content'
export const completionKey = 'project_content:complete'
export const contentRoot = path.resolve(__dirname, '../../../resources/project-content')
export const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const digest = (value: unknown): string => sha(JSON.stringify(normalize(value)) ?? 'null')
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]))
  return value
}
export async function readBundle(root = contentRoot) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as { release: number; sha256: string }
  const raw = await readFile(path.join(root, 'content.json'))
  const bundle = JSON.parse(raw.toString('utf8')) as ContentBundle
  if (sha(raw) !== manifest.sha256 || bundle.release !== manifest.release || !Number.isInteger(bundle.release) || bundle.release < 1) throw new Error('项目内容清单摘要或版本无效')
  const forbidden = new Set(['author', 'authorId', 'ownerId', 'uploadedBy', 'profiles', 'users', 'username', 'email', 'password', 'passwordHash', 'avatar', 'school', 'learners', 'likes', 'views', 'bookmarks', 'progress', 'rating'])
  const check = (value: unknown) => {
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (forbidden.has(key)) throw new Error('内容包含非白名单用户字段：' + key); check(child) }
  }
  check(bundle)
  if (bundle.community.length !== 100 || bundle.community.flatMap(p => p.replies).length !== 200 || bundle.courses.length !== 24 || bundle.courses.reduce((n, c) => n + c.chapters.reduce((m, ch) => m + ch.lessons.length, 0), 0) !== 144 || bundle.tutorials.length !== 24 || bundle.tutorials.filter(t => t.video).length !== 16) throw new Error('三类项目内容数量不完整')
  return { bundle, manifest }
}
/** 在任何数据库写入前检查全部文件；拒绝目录穿越与符号链接。 */
export async function checkMedia(bundle: ContentBundle, repositoryRoot = path.resolve(contentRoot, '../../..')) {
  const result = new Map<string, { asset: ContentMedia; path: string }>()
  for (const [key, asset] of Object.entries(bundle.media) as Array<[string, ContentMedia]>) {
    if (!['server/resources/community-starter', 'packages/catalog-assets', 'frontend/public/demo/resource-hub'].includes(asset.root) || !/^[a-zA-Z0-9_./-]+$/.test(asset.file) || asset.file.split('/').includes('..')) throw new Error('不允许的内容素材路径')
    const base = await realpath(path.join(repositoryRoot, asset.root)), target = path.join(base, asset.file)
    if (!(await lstat(target)).isFile() || await realpath(target) !== target) throw new Error('素材必须是普通文件：' + key)
    const bytes = await readFile(target)
    if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256) throw new Error('素材摘要不符：' + key)
    result.set(key, { asset, path: target })
  }
  return result
}
export async function assertContentReady(prisma: PrismaClient, root = contentRoot) {
  const { manifest } = await readBundle(root)
  const marker = await prisma.systemSetting.findUnique({ where: { key: completionKey } })
  const value = marker?.value as { release?: number; sha256?: string; status?: string } | undefined
  if (value?.release !== manifest.release || value.sha256 !== manifest.sha256 || value.status !== 'complete') throw new ServiceUnavailableException('当前镜像的项目内容尚未完成同步，请先运行 content:sync 和 content:verify')
}
