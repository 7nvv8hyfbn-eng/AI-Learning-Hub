import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { LessonImageContent } from '@ai-learning-hub/contracts'
import { mediaObject } from '../media/media-resolver.service'

/** 文件由服务端绑定；客户端不能借素材 ID 指向任意文件。 */
export async function bindCourseImage(tx: Prisma.TransactionClient, input: Record<string, unknown>, previous?: Record<string, unknown>, kind: 'illustration' | 'cover' = 'illustration'): Promise<LessonImageContent> {
  if (typeof input.assetId !== 'string' || !input.assetId || input.assetId.length > 80) throw new BadRequestException('请选择课程图片素材')
  const asset = await tx.mediaAsset.findFirst({ where: { id: input.assetId, kind, deletedAt: null }, include: { file: true } })
  if (!asset) throw new BadRequestException('课程图片素材不存在或用途不匹配')
  const keepFile = previous?.assetId === asset.id && typeof previous.fileId === 'string' && input.fileId === previous.fileId
  if (!keepFile && asset.status !== 'active') throw new BadRequestException('请选择可用的课程图片素材')
  const file = keepFile ? await tx.fileRecord.findUnique({ where: { id: previous.fileId as string } }) : asset.file
  if (!file || file.visibility !== 'public' || file.quarantinedAt || !file.mimeType.startsWith('image/')) throw new BadRequestException('图片文件不可用于课程')
  const alt = typeof input.alt === 'string' ? input.alt.trim() : kind === 'cover' ? asset.altText : ''
  const caption = typeof input.caption === 'string' ? input.caption.trim() : ''
  if (!alt || alt.length > 240 || caption.length > 600) throw new BadRequestException('图片说明需为1至240字，图注不超过600字')
  const width = keepFile ? Number(previous.width) : asset.width, height = keepFile ? Number(previous.height) : asset.height
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new BadRequestException('图片尺寸无效，请重新选择素材')
  const divisor = (a: number, b: number): number => b ? divisor(b, a % b) : a
  const gcd = divisor(width, height)
  return { assetId: asset.id, fileId: file.id, alt, caption, width, height, aspectRatio: `${width / gcd}:${height / gcd}`,
    ...(kind === 'cover' ? { focalPoint: keepFile ? previous.focalPoint || { x: asset.focalX, y: asset.focalY } : { x: asset.focalX, y: asset.focalY } } : {}),
  }
}

/** 仅在显式发布或初始化时固定引用；旧版本与旧文件不修改。 */
export async function freezeCourseImages(tx: Prisma.TransactionClient, versionId: string, coverAssetId?: string | null) {
  const version = await tx.courseVersion.findUniqueOrThrow({ where: { id: versionId } })
  const snapshot = mediaObject(version.snapshot), data = mediaObject(snapshot.data)
  const mediaFiles: Array<{ assetId: string; fileId: string }> = []
  const blocks = await tx.lessonBlock.findMany({ where: { blockType: 'image', lesson: { chapter: { courseVersionId: versionId } } } })
  for (const block of blocks) {
    const value = mediaObject(block.content)
    const image = await bindCourseImage(tx, value, value)
    await tx.lessonBlock.update({ where: { id: block.id }, data: { content: image as Prisma.InputJsonObject } })
    mediaFiles.push({ assetId: image.assetId, fileId: image.fileId })
  }
  if (coverAssetId) {
    const previous = mediaObject(data.coverImage)
    const cover = await bindCourseImage(tx, previous.assetId === coverAssetId ? previous : { assetId: coverAssetId }, previous, 'cover')
    data.coverImage = cover
    mediaFiles.push({ assetId: cover.assetId, fileId: cover.fileId })
  } else delete data.coverImage
  await tx.courseVersion.update({ where: { id: versionId }, data: { snapshot: {
    ...snapshot, data, mediaFiles, publishedAt: new Date().toISOString(),
  } as Prisma.InputJsonObject } })
}

export function courseImageUrl(image: Record<string, unknown>, admin = false) {
  if (typeof image.assetId !== 'string' || typeof image.fileId !== 'string') return ''
  const asset = encodeURIComponent(image.assetId), file = encodeURIComponent(image.fileId)
  return admin ? `/api/v1/admin/media-assets/${asset}/preview?fileId=${file}` : `/api/v1/public/media/${asset}/files/${file}`
}
