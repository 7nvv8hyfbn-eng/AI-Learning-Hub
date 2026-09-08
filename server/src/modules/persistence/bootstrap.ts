import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'

export const requiredPermissions = [
  'dashboard.read', 'homepage.read', 'homepage.write', 'homepage.publish', 'platform.manage',
  'theme.read', 'theme.write', 'theme.publish', 'course.read', 'course.write', 'course.publish',
  'lab.read', 'lab.write', 'lab.publish', 'resource.read', 'resource.write', 'resource.publish',
  'article.read', 'article.write', 'article.publish', 'challenge.read', 'challenge.write', 'challenge.publish',
  'question.read', 'question.write', 'growth.read', 'growth.write', 'settings.read', 'settings.write',
  'community.read', 'community.write', 'community.moderate', 'community.topic.manage',
  'community.report.manage', 'community.official.publish', 'community.feed.manage',
  'user.read', 'user.write', 'user.session.revoke', 'user.export',
  'user.identity.read', 'user.identity.review',
  'media.read', 'media.write', 'media.delete', 'media.default.manage',
]
const roles: Record<string, string> = {
  super_admin: '超级管理员', admin: '管理员', student: '学生', operator: '运营人员',
  teacher: '教师', mentor: '导师', community_official: '社区官方', community_moderator: '社区审核员',
  content_editor: '内容编辑', question_editor: '题库编辑',
  user_manager: '用户管理员',
}
/** 仅补必要元数据；不重播示例、不覆账号、设置或人工调整过的已有授权。 */
export async function bootstrapDatabase(prisma: PrismaClient) {
  const oldRoles = new Set((await prisma.role.findMany({ select: { code: true } })).map((r) => r.code))
  const oldPermissions = new Set((await prisma.permission.findMany({ select: { code: true } })).map((p) => p.code))
  await prisma.$transaction(async (tx) => {
    for (const [code, name] of Object.entries(roles)) await tx.role.upsert({ where: { code }, update: {}, create: { code, name } })
    for (const code of requiredPermissions) await tx.permission.upsert({ where: { code }, update: {}, create: { code, name: code } })
    const allRoles = await tx.role.findMany(), allPermissions = await tx.permission.findMany()
    for (const role of allRoles) {
      const grants = ['admin', 'super_admin'].includes(role.code) ? requiredPermissions
        : role.code === 'operator' ? ['dashboard.read', 'growth.read', 'user.read', 'settings.read', 'homepage.read', 'homepage.write', 'homepage.publish']
        : role.code === 'community_moderator' ? ['community.read', 'community.write', 'community.moderate', 'community.topic.manage', 'community.report.manage']
        : role.code === 'user_manager' ? ['user.read', 'user.write', 'user.session.revoke', 'community.read', 'community.moderate', 'community.report.manage']
        : role.code === 'content_editor' ? requiredPermissions.filter((code) => /^(theme|course|lab|resource|article|challenge)\.(read|write|publish)$/.test(code))
        : []
      await tx.rolePermission.createMany({ data: allPermissions.filter((p) => grants.includes(p.code) && (!oldRoles.has(role.code) || !oldPermissions.has(p.code))).map((p) => ({ roleId: role.id, permissionId: p.id })), skipDuplicates: true })
    }
    for (const [key, value] of Object.entries({ platform_name: 'AI数智化学习平台', registration: { mode: 'open', emailVerification: false, agreementVersion: '2026-08-30', passwordMinLength: 8, schoolRequired: false, registrationRateWindowMinutes: 15, registrationMaxAttemptsPerIp: 120, registrationMaxAttemptsPerIdentifier: 8, registrationMaxSuccessPerIp: 30 } })) {
      await tx.systemSetting.upsert({ where: { key }, update: {}, create: { key, value } })
    }
    if (!await tx.userRole.count({ where: { role: { code: { in: ['admin', 'super_admin'] } } } })) {
      const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase(), password = process.env.SEED_ADMIN_PASSWORD
      if (!email || !password || password.length < 8 || password.startsWith('change-me')) throw new Error('首次初始化请配置有效 SEED_ADMIN_EMAIL 和至少8位 SEED_ADMIN_PASSWORD')
      if (await tx.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })) throw new Error('初始化邮箱已属于现有账号；禁止自动提权，请人工确认')
      const role = allRoles.find((r) => r.code === 'super_admin')!
      await tx.user.create({ data: { email, username: `admin_${Date.now().toString(36)}`, displayName: '平台管理员', userType: 'admin', passwordHash: await hash(password, 12), onboardingCompletedAt: new Date(), registrationSource: 'bootstrap', userRoles: { create: { roleId: role.id } } } })
    }
  }, { timeout: 20000 })
}
// CommonJS runtime 与 tsx CLI 均可直接执行，不依赖其他应用源码。
if (require.main === module) {
  const prisma = new PrismaClient()
  bootstrapDatabase(prisma).then(() => console.log('必要数据初始化完成')).catch(() => { console.error('必要数据初始化失败，请核对数据库、角色与初始管理员配置'); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
