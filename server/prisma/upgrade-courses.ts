import { PrismaClient } from '@prisma/client'
import { demoCourses, curriculumVersion } from '@ai-learning-hub/demo-fixtures'
import { catalogAssets } from '@ai-learning-hub/catalog-assets'
import { ConfigService } from '@nestjs/config'
import { createRequire } from 'node:module'
import type { PrismaService } from '../src/prisma/prisma.service'
import { createCurriculumVersion, curriculumInclude, curriculumUpgradeReason } from './course-curriculum'

/** 默认仅盘点；部署、启动和 Seed 均不调用此升级入口。 */
export async function upgradeCourses(prisma: PrismaClient, apply = false) {
  const courses = await prisma.course.findMany({ where: { slug: { in: demoCourses.map((course) => course.slug) } }, include: curriculumInclude })
  const report = demoCourses.map((fixture) => {
    const course = courses.find((item) => item.slug === fixture.slug) || null
    const reason = curriculumUpgradeReason(course, fixture)
    return { slug: fixture.slug, courseId: course?.id || null, status: reason ? 'skipped' : 'eligible', reason }
  })
  if (!apply || !report.some((entry) => entry.status === 'eligible')) return { mode: apply ? 'apply' : 'dry-run', curriculumVersion, report }
  const admin = await prisma.user.findFirst({ where: { status: 'active', userRoles: { some: { role: { code: { in: ['admin', 'super_admin'] } } } } }, orderBy: { createdAt: 'asc' } })
  if (!admin) throw new Error('需要现有有效管理员作为升级审计操作人')
  const loadRuntime = createRequire(__filename)
  const { importCatalogAssets } = loadRuntime('../dist/modules/media/import-catalog') as typeof import('../src/modules/media/import-catalog')
  const { createStorageAdapter } = loadRuntime('../dist/modules/storage/storage.module') as typeof import('../src/modules/storage/storage.module')
  const { lockFileReferences } = loadRuntime('../dist/common/persistence') as typeof import('../src/common/persistence')
  const slugs = new Set(report.filter((entry) => entry.status === 'eligible').map((entry) => entry.slug))
  const assetKeys = new Set(catalogAssets.filter((asset) => asset.contentType === 'course' && slugs.has(asset.contentSlug || '')).map((asset) => asset.assetKey))
  const imported = await importCatalogAssets(prisma, createStorageAdapter(prisma as PrismaService, new ConfigService()), admin.id, undefined, assetKeys)
  for (const entry of report.filter((item) => item.status === 'eligible')) {
    await prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const fixture = demoCourses.find((item) => item.slug === entry.slug)!
      const course = await tx.course.findUnique({ where: { slug: entry.slug }, include: curriculumInclude })
      // 与后台写入共用锁，再次核对，避免盘点后发生的编辑被覆盖。
      const reason = curriculumUpgradeReason(course, fixture)
      if (reason || !course) { entry.status = 'skipped'; entry.reason = reason; return }
      const version = await createCurriculumVersion(tx, course, fixture, imported.assetIds, 2)
      await tx.auditLog.create({ data: { actorId: admin.id, action: 'course_demo_curriculum_upgrade', targetType: 'course', targetId: course.id,
        details: { curriculumVersion, previousVersionId: course.publishedVersionId, nextVersionId: version.id, retainedHistory: true } } })
      entry.status = 'upgraded'
    }, { timeout: 60000 })
  }
  return { mode: 'apply', curriculumVersion, media: { created: imported.created, updated: imported.updated }, report }
}

if (require.main === module) {
  const prisma = new PrismaClient()
  upgradeCourses(prisma, process.argv.includes('--apply'))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : '课程升级失败'); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
