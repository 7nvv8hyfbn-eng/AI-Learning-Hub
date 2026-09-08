import { visibleComment, visibleProfile } from '../community/governance-policy'
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CommunityVisibilityPolicyService } from '../community/visibility.service'

@Injectable()
export class FileAccessService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: CommunityVisibilityPolicyService) {}
  async assert(userId: string, id: string) {
    await this.visibility.assertMediaEligibility(userId)
    const file = await this.prisma.fileRecord.findUnique({ where: { id } })
    if (!file || file.quarantinedAt) throw new NotFoundException('文件不存在')
    await this.visibility.assertMediaEligibility(file.uploadedBy)
    const mediaWhere = { OR: [{ coverFileId: id }, { contribution: { is: { OR: [{ coverFileId: id }, { attachmentFileId: id }, { videoAsset: { is: { OR: [{ sourceFileId: id }, { playableFileId: id }, { posterFileId: id }] } } }] } } }, { contentBlocks: { array_contains: [{ type: 'image', fileId: id }] } }] }
    const boundPost = await this.prisma.communityPost.count({ where: mediaWhere })
    const boundComment = await this.prisma.communityComment.count({ where: { contentBlocks: { array_contains: [{ type: 'image', fileId: id }] } } })
    const boundProfile = await this.prisma.communityProfile.count({ where: { OR: [{ avatarFileId: id }, { bannerFileId: id }] } })
    if (file.uploadedBy === userId && !boundPost && !boundComment && !boundProfile) return file
    const reviewer = await this.prisma.userRole.count({ where: { userId, role: { permissions: { some: { permission: { code: 'community.read' } } } } } })
    if (reviewer && (await this.prisma.communityPost.count({ where: { AND: [await this.visibility.adminWhere(), { OR: [{ coverFileId: id }, { contribution: { coverFileId: id } }, { contentBlocks: { array_contains: [{ type: 'image', fileId: id }] } }] }] } }) || await this.prisma.communityComment.count({ where: { post: await this.visibility.adminWhere(), contentBlocks: { array_contains: [{ type: 'image', fileId: id }] } } }))) {
      await this.visibility.auditAdminRead(userId, 'file', id)
      return file
    }
    const resourceEditor = await this.prisma.userRole.count({ where: { userId, role: { permissions: { some: { permission: { code: 'resource.write' } } } } } })
    if (resourceEditor && await this.prisma.resource.count({ where: { fileId: id } })) { await this.visibility.auditAdminRead(userId, 'resource_file', id); return file }
    const [resource, post, comment, profile] = await Promise.all([
      // 学习者只能读取发布快照附件；缺失旧字段也不能回读未发布的当前列。
      this.prisma.resource.count({ where: { status: 'published', deletedAt: null, publishedVersion: { is: { AND: [
        { snapshot: { path: ['fileId'], equals: id } },
        { snapshot: { path: ['visibility'], equals: 'public' } },
      ] } } } }),
      this.prisma.communityPost.count({ where: { AND: [await this.visibility.where(userId, true), mediaWhere] } }),
      this.prisma.communityComment.count({ where: { deletedAt: null, status: 'published', ...visibleComment(), authorId: { notIn: (await this.visibility.authorExclusions(userId)).authors }, contentBlocks: { array_contains: [{ type: 'image', fileId: id }] }, post: await this.visibility.where(userId) } }),
      this.prisma.communityProfile.count({ where: { user: visibleProfile(), OR: [{ avatarFileId: id }, { bannerFileId: id }] } }),
    ])
    if (!resource && !post && !comment && !profile) throw new NotFoundException('文件不存在或无权访问')
    return file
  }
}
