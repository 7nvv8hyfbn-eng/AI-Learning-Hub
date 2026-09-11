import { ConfigService } from '@nestjs/config'
import { Prisma, PrismaClient } from '@prisma/client'
import { catalogAssets, type CatalogAsset } from '@ai-learning-hub/catalog-assets'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createStorageAdapter } from '../storage/storage.module'
import type { StorageService } from '../storage/storage.types'
import type { PrismaService } from '../../prisma/prisma.service'
import { lockFileReferences } from '../../common/persistence'
import { inspectMediaImage } from './image-validation'
import { catalogTables } from './media-usage'
import { mediaObject, safeLegacyCover } from './media-resolver.service'
import { releaseUnboundMediaFile } from './media-gc'

const catalogRoot = path.resolve(path.dirname(require.resolve('@ai-learning-hub/catalog-assets')), '..')
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
export async function readCatalogFile(asset: CatalogAsset, root = catalogRoot) {
  if (!/^images\/[a-z]+\/[a-z0-9-]+\.webp$/.test(asset.file)) throw new Error(`素材路径不合法: ${asset.assetKey}`)
  const target = path.resolve(root, asset.file)
  const canonicalRoot = await realpath(root)
  if (!target.startsWith(`${root}${path.sep}`) || !(await lstat(target)).isFile() || await realpath(target) !== path.join(canonicalRoot, asset.file)) throw new Error(`素材必须是正式文件: ${asset.assetKey}`)
  const buffer = await readFile(target)
  const file = { originalname: path.basename(asset.file), mimetype: 'image/webp', size: buffer.length, buffer }
  const size = await inspectMediaImage(file)
  if (size.width !== asset.width || size.height !== asset.height) throw new Error(`素材尺寸与清单不符: ${asset.assetKey}`)
  return { file, checksum: hash(buffer) }
}

/** 媒体导入与业务Seed分离；所有文件预检通过后才写。现有人工元数据、归档状态和默认选择均保留。 */
export async function importCatalogAssets(prisma: PrismaClient, storage: StorageService, actorId: string, root = catalogRoot, assetKeys?: ReadonlySet<string>) {
  if (!await prisma.userRole.count({ where: { userId: actorId, role: { code: { in: ['admin', 'super_admin'] } } } })) throw new Error('素材导入须使用现有初始化管理员')
  const verified: Array<{ asset: CatalogAsset; checksum: string }> = []
  const assets = assetKeys ? catalogAssets.filter((asset) => assetKeys.has(asset.assetKey)) : catalogAssets
  if (assetKeys && assets.length !== assetKeys.size) throw new Error('指定的素材清单不完整')
  for (const asset of assets) verified.push({ asset, checksum: (await readCatalogFile(asset, root)).checksum })
  let created = 0, updated = 0
  const ids = new Map<string, string>()
  for (const { asset, checksum } of verified) {
    const existing = await prisma.mediaAsset.findUnique({ where: { assetKey: asset.assetKey }, include: { file: true } })
    if (existing && existing.source !== 'image2_seed') throw new Error(`素材key已被人工资源占用: ${asset.assetKey}`)
    if (existing?.file.checksum === checksum && await storage.exists(existing.fileId)) { ids.set(asset.assetKey, existing.id); continue }
    const { file, checksum: verifiedChecksum } = await readCatalogFile(asset, root)
    if (verifiedChecksum !== checksum) throw new Error(`素材在预检后变化: ${asset.assetKey}`)
    const stored = await storage.upload(file, { uploadedBy: actorId, visibility: 'public', catalogMedia: true })
    const result = await prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const current = await tx.mediaAsset.findUnique({ where: { assetKey: asset.assetKey } })
      const sameFile = await tx.mediaAsset.findUnique({ where: { fileId: stored.id } })
      if (sameFile && sameFile.assetKey !== asset.assetKey) throw new Error(`相同二进制属于另一assetKey，须修正唯一清单: ${asset.assetKey}`)
      if (!current) {
        created++
        return tx.mediaAsset.create({ data: { assetKey: asset.assetKey, fileId: stored.id, name: asset.name, kind: asset.kind, source: 'image2_seed', contentType: asset.contentType, categoryKey: asset.categoryKey, altText: asset.altText, width: asset.width, height: asset.height, focalX: asset.focalX, focalY: asset.focalY, createdBy: actorId } })
      }
      if (current.fileId === stored.id) return current
      // 旧二进制仍由历史审计引用保护；不因单一asset换图立即回收。
      await tx.auditLog.create({ data: { actorId, action: 'media_file_replace', targetType: 'media_asset', targetId: current.id, details: { previousFileId: current.fileId, nextFileId: stored.id } } })
      updated++
      return tx.mediaAsset.update({ where: { id: current.id }, data: { fileId: stored.id, width: asset.width, height: asset.height, revision: { increment: 1 } } })
    }, { timeout: 20000 }).catch(async (error: unknown) => {
      await releaseUnboundMediaFile(prisma, storage, stored.id).catch(() => undefined)
      throw error
    })
    ids.set(asset.assetKey, result.id)
  }
  let rulesCreated = 0
  await prisma.$transaction(async (tx) => {
    await lockFileReferences(tx)
    for (const asset of assets) for (const rule of asset.defaultFor || []) {
      const where = { contentType_categoryKey: rule }
      if (await tx.mediaDefaultRule.findUnique({ where })) continue
      const assetId = ids.get(asset.assetKey)!
      if (!await tx.mediaAsset.count({ where: { id: assetId, status: 'active', deletedAt: null } })) continue
      await tx.mediaDefaultRule.create({ data: { ...rule, assetId } })
      rulesCreated++
    }
  }, { timeout: 20000 })
  return { created, updated, rulesCreated, assetIds: Object.fromEntries(ids) }
}

/** 旧业务库只补清单允许的封面字段，不复制草稿到发布版、不创建内容、不修改有效legacy/显式null。 */
export async function bindExistingDemoMedia(prisma: PrismaClient, actorId: string) {
  let contents = 0, snapshots = 0
  await prisma.$transaction(async (tx) => {
    await lockFileReferences(tx)
    for (const [type, table, versionTable, foreignKey] of catalogTables) {
      const assets = catalogAssets.filter((asset) => asset.kind === 'cover' && asset.contentType === type && asset.contentSlug)
      for (const asset of assets) {
        const media = await tx.mediaAsset.findUnique({ where: { assetKey: asset.assetKey } })
        if (!media || media.status !== 'active' || media.deletedAt) continue
        const rows = await tx.$queryRaw<Array<{ id: string; title: string; payload: Prisma.JsonValue; cover_asset_id: string | null }>>(Prisma.sql`SELECT id,title,payload,cover_asset_id FROM ${Prisma.raw(table)} WHERE slug=${asset.contentSlug} AND deleted_at IS NULL`)
        const row = rows[0]
        if (!row || row.title !== asset.name) continue
        const data = mediaObject(row.payload)
        if (!row.cover_asset_id && !Object.hasOwn(data, 'coverAssetId') && !safeLegacyCover(data.cover)) {
          await tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(table)} SET cover_asset_id=${media.id},payload=jsonb_set(payload,'{coverAssetId}',to_jsonb(${media.id}::text)),data_origin='demo_seed' WHERE id=${row.id}`)
          contents++
        }
        const versions = await tx.$queryRaw<Array<{ id: string; snapshot: Prisma.JsonValue }>>(Prisma.sql`SELECT v.id,v.snapshot FROM ${Prisma.raw(versionTable)} v JOIN ${Prisma.raw(table)} c ON c.id=v.${Prisma.raw(foreignKey)} WHERE c.id=${row.id} AND v.id IN (c.current_draft_version_id,c.published_version_id)`)
        for (const version of versions) {
          const value = mediaObject(version.snapshot), field = value.data ? 'data' : value.payload ? 'payload' : 'data', versionData = mediaObject(value[field])
          if (Object.hasOwn(versionData, 'coverAssetId') || safeLegacyCover(versionData.cover)) continue
          // 只补当前草稿/发布快照，历史版本字节原样保留。
          const next = JSON.stringify({ ...value, [field]: { ...versionData, coverAssetId: media.id } })
          await tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw(versionTable)} SET snapshot=${next}::jsonb WHERE id=${version.id}`)
          snapshots++
        }
      }
    }
    if (contents || snapshots) await tx.auditLog.create({ data: { actorId, action: 'catalog_media_upgrade', targetType: 'media_asset', targetId: 'catalog-v1', details: { contents, snapshots } } })
  }, { timeout: 60000 })
  return { contents, snapshots }
}

export async function catalogImportMain() {
  const prisma = new PrismaClient()
  try {
    const admin = await prisma.user.findFirst({ where: { status: 'active', userRoles: { some: { role: { code: { in: ['admin', 'super_admin'] } } } } }, orderBy: { createdAt: 'asc' } })
    if (!admin) throw new Error('请先完成必要数据bootstrap')
    const storage = createStorageAdapter(prisma as PrismaService, new ConfigService())
    const imported = await importCatalogAssets(prisma, storage, admin.id)
    const bound = process.argv.includes('--bind-existing-demo') ? await bindExistingDemoMedia(prisma, admin.id) : null
    console.log(JSON.stringify({ created: imported.created, updated: imported.updated, rulesCreated: imported.rulesCreated, assets: Object.keys(imported.assetIds).length, bound }))
  } finally { await prisma.$disconnect() }
}
if (require.main === module) catalogImportMain().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '媒体导入失败'); process.exitCode = 1 })
