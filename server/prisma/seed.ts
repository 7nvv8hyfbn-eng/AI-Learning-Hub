import { PrismaClient, PublishStatus, LabType, QuestionType } from '@prisma/client'
import {
  demoAchievements,
  demoActivities,
  demoArticles,
  demoCertificates,
  demoChallenges,
  demoCourses,
  demoHomepageModules,
  demoHomepageRelations,
  demoKnowledgeConcepts,
  demoLabs,
  demoLearningPlans,
  demoResources,
  demoStudents,
  demoThemes,
  fixtureMinimums,
} from '@ai-learning-hub/demo-fixtures'
import { hash } from 'bcryptjs'
import { isDeepStrictEqual } from 'node:util'
import { createRequire } from 'node:module'
import { seedCommunity } from './seed-community'
import { createCurriculumVersion, curriculumPayload } from './course-curriculum'
import { upgradeLanding } from '../src/modules/homepage/upgrade-landing'
import { bootstrapDatabase } from '../src/modules/persistence/bootstrap'
import { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../src/prisma/prisma.service'

const prisma = new PrismaClient()
if (process.env.LOAD_DEMO_DATA !== 'true') throw new Error('演示数据仅允许在 LOAD_DEMO_DATA=true 时显式初始化')

const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.invalid'
const studentEmail = process.env.SEED_STUDENT_EMAIL || 'student@example.invalid'
const adminPassword = process.env.SEED_ADMIN_PASSWORD
const studentPassword = process.env.SEED_STUDENT_PASSWORD

if (!adminPassword || !studentPassword) {
  throw new Error('SEED_ADMIN_PASSWORD 与 SEED_STUDENT_PASSWORD 必须通过环境变量提供')
}
const requiredAdminPassword = adminPassword
const requiredStudentPassword = studentPassword

const themes = demoThemes
const courses = demoCourses
const labs = demoLabs
const articles = demoArticles
const resources = demoResources

async function seed() {
  await bootstrapDatabase(prisma)
  // 已发布平台仅增补社区固定样例；不重写运营内容、发布快照或现有账号凭据。
  const existingPublication = await prisma.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
  if (existingPublication) {
    // 兼容历史空 publication：追加最近有效发布，不覆盖真实内容或任何历史版本。
    if (Array.isArray(existingPublication.snapshot) && existingPublication.snapshot.length === 0) {
      const history = await prisma.homepagePublication.findMany({ where: { version: { lt: existingPublication.version } }, orderBy: { version: 'desc' }, take: 100 })
      const valid = history.find((row) => Array.isArray(row.snapshot) && row.snapshot.length > 0)
      if (valid) await prisma.homepagePublication.create({ data: { version: existingPublication.version + 1, snapshot: valid.snapshot! } })
    }
    await seedCommunity(prisma)
    await upgradeLanding(prisma)
    return
  }
  // Seed在构建后运行；只加载编译模块，不要求运行镜像复制应用源码依赖树。
  const loadRuntime = createRequire(__filename)
  const { importCatalogAssets } = loadRuntime('../dist/modules/media/import-catalog') as typeof import('../src/modules/media/import-catalog')
  const { createStorageAdapter } = loadRuntime('../dist/modules/storage/storage.module') as typeof import('../src/modules/storage/storage.module')
  const permissions = [
    'dashboard.read', 'homepage.read', 'homepage.write', 'homepage.publish',
    'platform.manage',
    'theme.read', 'theme.write', 'theme.publish',
    'course.read', 'course.write', 'course.publish',
    'lab.read', 'lab.write', 'lab.publish',
    'resource.read', 'resource.write', 'resource.publish',
    'article.read', 'article.write', 'article.publish',
    'challenge.read', 'challenge.write', 'challenge.publish',
    'question.read', 'question.write',
    'growth.read', 'growth.write', 'settings.read', 'settings.write',
  ]
  for (const code of permissions) {
    await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } })
  }
  await prisma.permission.deleteMany({ where: { code: { in: ['content.read', 'content.write', 'content.publish'] } } })
  const adminRole = await prisma.role.upsert({ where: { code: 'admin' }, update: {}, create: { code: 'admin', name: '管理员' } })
  const superAdminRole = await prisma.role.upsert({ where: { code: 'super_admin' }, update: {}, create: { code: 'super_admin', name: '超级管理员' } })
  const contentEditorRole = await prisma.role.upsert({ where: { code: 'content_editor' }, update: {}, create: { code: 'content_editor', name: '内容编辑' } })
  const questionEditorRole = await prisma.role.upsert({ where: { code: 'question_editor' }, update: {}, create: { code: 'question_editor', name: '题库编辑' } })
  const operatorRole = await prisma.role.upsert({ where: { code: 'operator' }, update: {}, create: { code: 'operator', name: '运营人员' } })
  const studentRole = await prisma.role.upsert({ where: { code: 'student' }, update: {}, create: { code: 'student', name: '学生' } })
  const school = await prisma.school.upsert({ where: { code: 'ai-campus' }, update: {}, create: { code: 'ai-campus', name: 'AI 创客学院' } })
  const department = await prisma.department.upsert({
    where: { schoolId_code: { schoolId: school.id, code: 'computer-science' } },
    update: {},
    create: { schoolId: school.id, code: 'computer-science', name: '计算机科学与技术系' },
  })
  const allPermissions = await prisma.permission.findMany()
  for (const permission of allPermissions) {
    for (const roleId of [adminRole.id, superAdminRole.id]) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      })
    }
  }
  const roleGrants = new Map([
    [contentEditorRole.id, [
      'dashboard.read',
      'theme.read', 'theme.write', 'theme.publish',
      'course.read', 'course.write', 'course.publish',
      'lab.read', 'lab.write', 'lab.publish',
      'resource.read', 'resource.write', 'resource.publish',
      'article.read', 'article.write', 'article.publish',
    ]],
    [questionEditorRole.id, ['dashboard.read', 'challenge.read', 'challenge.write', 'challenge.publish', 'question.read', 'question.write']],
    [operatorRole.id, [
      'dashboard.read', 'homepage.read', 'homepage.write', 'homepage.publish',
      'theme.read', 'course.read', 'lab.read', 'resource.read', 'article.read', 'challenge.read',
      'growth.read', 'settings.read',
    ]],
  ])
  await prisma.rolePermission.deleteMany({ where: { roleId: { in: [...roleGrants.keys()] } } })
  for (const [roleId, codes] of roleGrants) {
    for (const permission of allPermissions.filter((item) => codes.includes(item.code))) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      })
    }
  }

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      username: 'admin',
      displayName: '平台管理员',
      email: adminEmail,
      passwordHash: await hash(requiredAdminPassword, 12),
      schoolId: school.id,
      departmentId: department.id,
      userType: 'admin',
      onboardingCompletedAt: new Date(),
      profile: { school: 'AI MAKER CAMPUS' },
    },
  })
  const student = await prisma.user.upsert({
    where: { email: studentEmail },
    update: {},
    create: {
      username: 'student',
      displayName: '造梦少年',
      email: studentEmail,
      passwordHash: await hash(requiredStudentPassword, 12),
      schoolId: school.id,
      departmentId: department.id,
      studentNo: '20260001',
      onboardingCompletedAt: new Date(),
      major: '计算机科学与技术',
      grade: '大二',
      profile: { school: '高校认证', program: 'AI 创客学院 · 计算机科学与技术', level: 1 },
    },
  })
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } }, update: {}, create: { userId: admin.id, roleId: adminRole.id } })
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: admin.id, roleId: superAdminRole.id } }, update: {}, create: { userId: admin.id, roleId: superAdminRole.id } })
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: student.id, roleId: studentRole.id } }, update: {}, create: { userId: student.id, roleId: studentRole.id } })
  const importedMedia = await importCatalogAssets(prisma, createStorageAdapter(prisma as PrismaService, new ConfigService()), admin.id)
  const coverId = (key: string) => {
    const id = importedMedia.assetIds[key]
    if (!id) throw new Error(`演示封面尚未导入: ${key}`)
    return id
  }
  const studentIds = new Map<string, string>([['student', student.id]])
  for (const demoStudent of demoStudents.filter((item) => item.username !== 'student')) {
    const saved = await prisma.user.upsert({
      where: { username: demoStudent.username },
      update: {},
      create: {
        username: demoStudent.username,
        displayName: demoStudent.displayName,
        email: `${demoStudent.username}@demo.invalid`,
        studentNo: demoStudent.studentNo,
        major: demoStudent.major,
        grade: demoStudent.grade,
        schoolId: school.id,
        departmentId: department.id,
        userType: 'student',
        onboardingCompletedAt: new Date(),
        profile: { demo: true, school: 'AI 创客学院' },
      },
    })
    studentIds.set(demoStudent.username, saved.id)
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: saved.id, roleId: studentRole.id } }, update: {}, create: { userId: saved.id, roleId: studentRole.id } })
  }

  const themeIds = new Map<string, string>()
  const courseIds = new Map<string, string>()
  const newThemeIds = new Set<string>()
  for (const [index, fixture] of themes.entries()) {
    const existing = await prisma.theme.findUnique({ where: { slug: fixture.slug } })
    if (existing) { themeIds.set(fixture.slug, existing.id); continue }
    const payload = {
      coverAssetId: coverId(fixture.coverAssetKey),
      accent: fixture.accent,
      coverVariant: fixture.coverVariant,
      icon: fixture.icon,
      recommended: true,
      learners: fixture.learners,
      courseCount: fixture.courseCount,
      hours: fixture.hours,
    }
    const theme = await prisma.theme.create({
      data: {
        coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed',
        slug: fixture.slug, title: fixture.title, summary: fixture.summary, status: PublishStatus.published, sortOrder: index,
        publishedAt: new Date(), payload,
      },
    })
    await prisma.themeVersion.upsert({
      where: { themeId_versionNo: { themeId: theme.id, versionNo: 1 } },
      update: { snapshot: { title: fixture.title, summary: fixture.summary, data: payload, paths: [] } },
      create: { themeId: theme.id, versionNo: 1, snapshot: { title: fixture.title, summary: fixture.summary, data: payload, paths: [] } },
    })
    themeIds.set(fixture.slug, theme.id)
    newThemeIds.add(theme.id)
  }

  for (const [courseIndex, fixture] of courses.entries()) {
    const existing = await prisma.course.findUnique({ where: { slug: fixture.slug } })
    if (existing) { courseIds.set(fixture.slug, existing.id); continue }
    const course = await prisma.$transaction(async (tx) => {
      const created = await tx.course.create({ data: {
        slug: fixture.slug, title: fixture.title, summary: fixture.summary, dataOrigin: 'demo_seed',
        themeId: themeIds.get(fixture.theme), sortOrder: courseIndex,
        payload: curriculumPayload(fixture, coverId(fixture.coverAssetKey)),
      } })
      await createCurriculumVersion(tx, created, fixture, importedMedia.assetIds, 1)
      return created
    }, { timeout: 60000 })
    courseIds.set(fixture.slug, course.id)
  }

  for (const [themeSlug, themeId] of themeIds) {
    if (!newThemeIds.has(themeId)) continue
    const fixture = themes.find((item) => item.slug === themeSlug)
    if (!fixture) continue
    const path = await prisma.learningPath.upsert({
      where: { themeId_name: { themeId, name: `${fixture.title}学习路径` } },
      update: { description: fixture.summary },
      create: { themeId, name: `${fixture.title}学习路径`, description: fixture.summary, status: PublishStatus.published },
    })
    for (const [index, stage] of fixture.path.entries()) {
      await prisma.learningPathStage.upsert({
        where: { pathId_stageKey: { pathId: path.id, stageKey: stage.key } },
        update: { name: stage.name, description: stage.description, stageType: stage.type, sortOrder: index, unlockRule: { countLabel: stage.countLabel, hours: stage.hours } },
        create: { pathId: path.id, stageKey: stage.key, name: stage.name, description: stage.description, stageType: stage.type, sortOrder: index, unlockRule: { countLabel: stage.countLabel, hours: stage.hours } },
      })
    }
    for (const fixtureCourse of courses.filter((course) => course.theme === themeSlug)) {
      const stage = await prisma.learningPathStage.findUnique({ where: { pathId_stageKey: { pathId: path.id, stageKey: fixtureCourse.slug } } })
      const courseId = courseIds.get(fixtureCourse.slug)
      if (stage && courseId) await prisma.pathContent.create({ data: { stageId: stage.id, targetType: 'course', targetId: courseId } })
    }
  }
  for (const themeId of newThemeIds) {
    const theme = await prisma.theme.findUnique({
      where: { id: themeId },
      include: { paths: { orderBy: { sortOrder: 'asc' }, include: { stages: { orderBy: { sortOrder: 'asc' }, include: { contents: true } } } } },
    })
    if (!theme) continue
    const version = await prisma.themeVersion.findUnique({ where: { themeId_versionNo: { themeId, versionNo: 1 } } })
    if (!version) continue
    await prisma.themeVersion.update({
      where: { id: version.id },
      data: { snapshot: JSON.parse(JSON.stringify({ title: theme.title, summary: theme.summary, data: theme.payload, paths: theme.paths })) },
    })
    await prisma.theme.update({ where: { id: themeId }, data: { currentDraftVersionId: version.id, publishedVersionId: version.id } })
  }

  const labIds = new Map<string, string>()
  for (const [labIndex, fixture] of labs.entries()) {
    const labType = fixture.labType as LabType
    const payload = {
      coverAssetId: coverId(fixture.coverAssetKey),
      category: fixture.labType === 'command' ? 'Linux 命令' : fixture.labType === 'deployment' ? '模型部署' : fixture.labType === 'hardware' ? '智能硬件' : fixture.labType === 'project' ? '综合项目' : 'AI Agent',
      level: fixture.level,
      durationMinutes: fixture.durationMinutes,
      icon: fixture.icon,
      coverVariant: fixture.coverVariant,
      completionRate: fixture.completionRate,
      participants: fixture.participants,
      steps: fixture.steps,
      result: fixture.result,
      skills: fixture.skills,
      objective: fixture.result,
      hints: ['先阅读任务目标', '按步骤完成受控操作', '用结果面板核对输出'],
      scoring: [{ label: '步骤完成', points: 60 }, { label: '结果正确', points: 30 }, { label: '复盘说明', points: 10 }],
    }
    const lab = await prisma.lab.upsert({
      where: { slug: fixture.slug },
      update: { coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed', title: fixture.title, summary: fixture.summary, labType, payload, sortOrder: labIndex, status: PublishStatus.published },
      create: {
        coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed',
        slug: fixture.slug, title: fixture.title, summary: fixture.summary, labType, status: PublishStatus.published, sortOrder: labIndex,
        publishedAt: new Date(), payload,
      },
    })
    labIds.set(fixture.slug, lab.id)
    const stepNames = ['阅读任务目标', '检查实验环境', '配置关键参数', '执行受控操作', '观察运行日志', '验证输出结果', '修正异常状态', '提交实验报告']
    for (let index = 0; index < fixture.steps; index += 1) {
      const stepKey = `step-${index + 1}`
      await prisma.labStep.upsert({
        where: { labId_stepKey: { labId: lab.id, stepKey } },
        update: { title: stepNames[index]!, description: `${fixture.title}：${stepNames[index]}。`, sortOrder: index, instruction: { action: 'confirm', type: fixture.labType, expectedLog: `${stepNames[index]}完成` }, validator: { type: 'confirmation', expected: true }, score: Math.floor(100 / fixture.steps) },
        create: { labId: lab.id, stepKey, title: stepNames[index]!, description: `${fixture.title}：${stepNames[index]}。`, sortOrder: index, instruction: { action: 'confirm', type: fixture.labType, expectedLog: `${stepNames[index]}完成` }, validator: { type: 'confirmation', expected: true }, score: Math.floor(100 / fixture.steps) },
      })
    }
    const steps = await prisma.labStep.findMany({ where: { labId: lab.id }, orderBy: { sortOrder: 'asc' } })
    const labVersion = await prisma.labVersion.upsert({
      where: { labId_versionNo: { labId: lab.id, versionNo: 1 } },
      update: { snapshot: JSON.parse(JSON.stringify({ title: lab.title, summary: lab.summary, data: payload, labType: lab.labType, steps })) },
      create: { labId: lab.id, versionNo: 1, snapshot: JSON.parse(JSON.stringify({ title: lab.title, summary: lab.summary, data: payload, labType: lab.labType, steps })) },
    })
    await prisma.lab.update({ where: { id: lab.id }, data: { currentDraftVersionId: labVersion.id, publishedVersionId: labVersion.id } })
  }

  const resourceIds = new Map<string, string>()
  for (const [resourceIndex, fixture] of resources.entries()) {
    const payload = { coverAssetId: coverId(fixture.coverAssetKey), theme: fixture.theme, difficulty: fixture.difficulty, icon: fixture.icon, coverVariant: fixture.coverVariant, featured: fixture.featured, favorites: fixture.favorites }
    const resource = await prisma.resource.upsert({
      where: { slug: fixture.slug },
      update: { coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed', title: fixture.title, summary: fixture.summary, category: fixture.category, format: fixture.format, payload, sortOrder: resourceIndex, downloadCount: fixture.downloads, viewCount: fixture.views, status: PublishStatus.published },
      create: {
        coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed',
        slug: fixture.slug, title: fixture.title, summary: fixture.summary, category: fixture.category, format: fixture.format, status: PublishStatus.published,
        sortOrder: resourceIndex, publishedAt: new Date(fixture.updatedAt), downloadCount: fixture.downloads, viewCount: fixture.views, payload,
      },
    })
    resourceIds.set(fixture.slug, resource.id)
    const resourceVersion = await prisma.resourceVersion.upsert({
      where: { resourceId_versionNo: { resourceId: resource.id, versionNo: 1 } },
      update: { snapshot: { title: resource.title, summary: resource.summary, category: resource.category, format: resource.format, visibility: resource.visibility, data: resource.payload, fileId: resource.fileId } },
      create: { resourceId: resource.id, versionNo: 1, snapshot: { title: resource.title, summary: resource.summary, category: resource.category, format: resource.format, visibility: resource.visibility, data: resource.payload, fileId: resource.fileId } },
    })
    await prisma.resource.update({ where: { id: resource.id }, data: { currentDraftVersionId: resourceVersion.id, publishedVersionId: resourceVersion.id } })
  }
  for (const [index, name] of ['学习手册', '提示词模板', '部署指南', 'Agent 案例', '命令速查', '硬件资料'].entries()) {
    await prisma.resourceCategory.upsert({ where: { code: `resource-${index + 1}` }, update: {}, create: { code: `resource-${index + 1}`, name, sortOrder: index + 1 } })
  }

  const articleIds = new Map<string, string>()
  for (const [articleIndex, fixture] of articles.entries()) {
    const payload = { coverAssetId: coverId(fixture.coverAssetKey), readMinutes: fixture.readMinutes, content: fixture.content, icon: fixture.icon, coverVariant: fixture.coverVariant, favorites: fixture.favorites }
    const article = await prisma.article.upsert({
      where: { slug: fixture.slug },
      update: { coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed', title: fixture.title, summary: fixture.summary, category: fixture.category, payload, sortOrder: articleIndex, viewCount: fixture.views, status: PublishStatus.published },
      create: {
        coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed',
        slug: fixture.slug, title: fixture.title, summary: fixture.summary, category: fixture.category, status: PublishStatus.published, sortOrder: articleIndex,
        publishedAt: new Date(fixture.publishedAt), viewCount: fixture.views, payload,
      },
    })
    articleIds.set(fixture.slug, article.id)
    if (fixture.featured) {
      await prisma.articleRecommendation.upsert({
        where: { articleId_positionKey: { articleId: article.id, positionKey: 'frontier_hero' } },
        update: { sortOrder: articleIndex },
        create: { articleId: article.id, positionKey: 'frontier_hero', sortOrder: articleIndex },
      })
    }
    const articleVersion = await prisma.articleVersion.upsert({
      where: { articleId_versionNo: { articleId: article.id, versionNo: 1 } },
      update: { snapshot: { title: article.title, summary: article.summary, category: article.category, data: payload } },
      create: { articleId: article.id, versionNo: 1, snapshot: { title: article.title, summary: article.summary, category: article.category, payload: article.payload } },
    })
    await prisma.article.update({ where: { id: article.id }, data: { currentDraftVersionId: articleVersion.id, publishedVersionId: articleVersion.id } })
  }
  for (const [index, name] of ['大模型', 'Agent', '多模态', '机器人', 'AI 安全'].entries()) {
    await prisma.articleCategory.upsert({ where: { code: `article-${index + 1}` }, update: {}, create: { code: `article-${index + 1}`, name, sortOrder: index + 1 } })
  }

  const challengeIds = new Map<string, string>()
  for (const [challengeIndex, fixture] of demoChallenges.entries()) {
    const payload = { coverAssetId: coverId(fixture.coverAssetKey), durationMinutes: fixture.durationMinutes, questions: fixture.questions, participants: fixture.participants, difficulty: fixture.difficulty, leaderboardEnabled: true, integration: 'web-native' }
    const challenge = await prisma.challenge.upsert({
      where: { slug: fixture.slug },
      update: { coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed', title: fixture.title, summary: fixture.summary, challengeType: fixture.type, targetScore: fixture.targetScore, rewardPoints: fixture.rewardPoints, payload, sortOrder: challengeIndex, status: PublishStatus.published },
      create: { coverAssetId: payload.coverAssetId, dataOrigin: 'demo_seed', slug: fixture.slug, title: fixture.title, summary: fixture.summary, challengeType: fixture.type, targetScore: fixture.targetScore, rewardPoints: fixture.rewardPoints, payload, sortOrder: challengeIndex, status: PublishStatus.published, publishedAt: new Date() },
    })
    challengeIds.set(fixture.slug, challenge.id)
  }
  const weeklyChallenge = await prisma.challenge.findUniqueOrThrow({ where: { slug: 'weekly-ai' } })
  for (const [ruleKey, config] of [['achievement', 'first-assessment'], ['certificate', 'ai-basics-pass']] as const) {
    await prisma.challengeRule.upsert({
      where: { challengeId_ruleKey: { challengeId: weeklyChallenge.id, ruleKey } },
      update: { config },
      create: { challengeId: weeklyChallenge.id, ruleKey, config },
    })
  }

  const bank = await prisma.questionBank.upsert({
    where: { id: 'seed-ai-basics' },
    update: {},
    create: { id: 'seed-ai-basics', name: 'AI 基础能力题库', status: PublishStatus.published },
  })
  await prisma.challenge.update({ where: { slug: 'weekly-ai' }, data: { questionBankId: bank.id } })
  const challengeRules = await prisma.challengeRule.findMany({ where: { challengeId: weeklyChallenge.id }, orderBy: { ruleKey: 'asc' } })
  const challengeVersion = await prisma.challengeVersion.upsert({
    where: { challengeId_versionNo: { challengeId: weeklyChallenge.id, versionNo: 1 } },
    update: {
      snapshot: {
        title: weeklyChallenge.title,
        summary: weeklyChallenge.summary,
        challengeType: weeklyChallenge.challengeType,
        targetScore: weeklyChallenge.targetScore,
        rewardPoints: weeklyChallenge.rewardPoints,
        questionBankId: bank.id,
        paperId: weeklyChallenge.paperId,
        data: weeklyChallenge.payload,
        rules: challengeRules,
      },
    },
    create: {
      challengeId: weeklyChallenge.id,
      versionNo: 1,
      snapshot: {
        title: weeklyChallenge.title,
        summary: weeklyChallenge.summary,
        challengeType: weeklyChallenge.challengeType,
        targetScore: weeklyChallenge.targetScore,
        rewardPoints: weeklyChallenge.rewardPoints,
        questionBankId: bank.id,
        paperId: weeklyChallenge.paperId,
        data: weeklyChallenge.payload,
        rules: challengeRules,
      },
    },
  })
  await prisma.challenge.update({
    where: { id: weeklyChallenge.id },
    data: { currentDraftVersionId: challengeVersion.id, publishedVersionId: challengeVersion.id },
  })
  for (const fixture of demoChallenges.filter((item) => item.slug !== 'weekly-ai')) {
    const challenge = await prisma.challenge.findUniqueOrThrow({ where: { slug: fixture.slug } })
    const version = await prisma.challengeVersion.upsert({
      where: { challengeId_versionNo: { challengeId: challenge.id, versionNo: 1 } },
      update: { snapshot: { title: challenge.title, summary: challenge.summary, challengeType: challenge.challengeType, targetScore: challenge.targetScore, rewardPoints: challenge.rewardPoints, questionBankId: bank.id, paperId: null, data: challenge.payload, rules: [] } },
      create: { challengeId: challenge.id, versionNo: 1, snapshot: { title: challenge.title, summary: challenge.summary, challengeType: challenge.challengeType, targetScore: challenge.targetScore, rewardPoints: challenge.rewardPoints, questionBankId: bank.id, paperId: null, data: challenge.payload, rules: [] } },
    })
    await prisma.challenge.update({ where: { id: challenge.id }, data: { questionBankId: bank.id, currentDraftVersionId: version.id, publishedVersionId: version.id } })
  }
  const knowledgeFixtures = demoKnowledgeConcepts
  const knowledgePoints = new Map<string, string>()
  for (const [code, name] of knowledgeFixtures) {
    const point = await prisma.knowledgePoint.upsert({ where: { code }, update: { name }, create: { code, name } })
    knowledgePoints.set(code, point.id)
  }
  const questionSeeds = knowledgeFixtures.flatMap(([code, name, value]) => ([
    { id: `seed-${code}-single`, code, type: QuestionType.single, difficulty: '入门', stem: `${name}的主要学习价值是？`, options: ['扩大所有模型参数', value, '跳过数据与验证', '允许无限制系统操作'], answer: 'B', analysis: `${name}的核心在于${value}。` },
    { id: `seed-${code}-true`, code, type: QuestionType.true_false, difficulty: '入门', stem: `学习${name}时，可以跳过输入校验和结果验证。`, options: ['正确', '错误'], answer: false, analysis: `任何 AI 学习与实践都需要输入校验和可复核结果，${name}也不例外。` },
    { id: `seed-${code}-multiple`, code, type: QuestionType.multiple, difficulty: '中级', stem: `应用${name}时，哪些做法有助于得到可靠结果？`, options: ['明确任务目标', '隐藏全部失败状态', '记录输入与输出证据', '授予不受限权限'], answer: ['A', 'C'], analysis: `明确目标并保留证据，才能验证${name}的实际效果。` },
    { id: `seed-${code}-short`, code, type: QuestionType.short_answer, difficulty: '进阶', stem: `请用一句话说明${name}的核心作用。`, options: [], answer: { keywords: [value], mode: 'all' }, analysis: `参考要点：${value}。` },
  ]))
  for (const fixture of questionSeeds) {
    const question = await prisma.question.upsert({
      where: { id: fixture.id },
      update: { knowledgePointId: knowledgePoints.get(fixture.code), questionType: fixture.type, difficulty: fixture.difficulty, stem: fixture.stem, options: fixture.options, standardAnswer: fixture.answer, analysis: fixture.analysis, status: PublishStatus.published },
      create: {
        id: fixture.id,
        bankId: bank.id,
        knowledgePointId: knowledgePoints.get(fixture.code),
        questionType: fixture.type,
        difficulty: fixture.difficulty,
        status: PublishStatus.published,
        stem: fixture.stem,
        options: fixture.options,
        standardAnswer: fixture.answer,
        analysis: fixture.analysis,
      },
    })
    const questionVersion = await prisma.questionVersion.upsert({
      where: { questionId_versionNo: { questionId: question.id, versionNo: 1 } },
      update: { snapshot: { stem: fixture.stem, options: fixture.options, standardAnswer: fixture.answer, analysis: fixture.analysis } },
      create: { questionId: question.id, versionNo: 1, snapshot: { stem: fixture.stem, options: fixture.options, standardAnswer: fixture.answer, analysis: fixture.analysis } },
    })
    await prisma.question.update({ where: { id: fixture.id }, data: { currentDraftVersionId: questionVersion.id, publishedVersionId: questionVersion.id } })
    await prisma.questionOption.deleteMany({ where: { questionId: question.id } })
    for (const [index, content] of fixture.options.entries()) {
      await prisma.questionOption.create({ data: { questionId: question.id, optionKey: String.fromCharCode(65 + index), content: String(content), sortOrder: index + 1 } })
    }
  }

  const achievementIds = new Map<string, string>()
  for (const fixture of demoAchievements) {
    const saved = await prisma.achievement.upsert({
      where: { code: fixture.code },
      update: { name: fixture.name, description: fixture.description },
      create: { code: fixture.code, name: fixture.name, description: fixture.description, rule: { event: fixture.code, count: 1 } },
    })
    achievementIds.set(fixture.code, saved.id)
  }
  const certificateIds = new Map<string, string>()
  for (const fixture of demoCertificates) {
    const saved = await prisma.certificate.upsert({
      where: { code: fixture.code },
      update: { name: fixture.name, description: fixture.description },
      create: { code: fixture.code, name: fixture.name, description: fixture.description, rule: { event: fixture.code } },
    })
    certificateIds.set(fixture.code, saved.id)
  }
  for (const [index, moduleKey] of ['overview', 'ability_card', 'badges', 'recent_courses', 'lab_records', 'favorites', 'plans', 'growth_stats'].entries()) {
    await prisma.growthModuleSetting.upsert({
      where: { moduleKey },
      update: {},
      create: { moduleKey, title: moduleKey, sortOrder: index + 1, displayLimit: 6 },
    })
  }
  const publicSettings: Array<[string, string | number | boolean | string[]]> = [
    ['platform_name', 'AI数智化学习平台'],
    ['platform_subtitle', '高校 AI 创客学习平台'],
    ['upload_max_mb', 20],
    ['allowed_file_types', ['pdf', 'docx', 'pptx', 'zip', 'txt', 'png', 'jpg', 'webp']],
    ['session_minutes', 10080],
    ['notification_enabled', true],
    ['allowed_login_domains', []],
    ['settings_version', 0],
  ]
  for (const [key, value] of publicSettings) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value, sensitive: false } })
  }

  const notification = await prisma.notification.findFirst({ where: { title: '欢迎使用 AI 数智化学习平台' } })
  if (!notification) {
    await prisma.notification.create({
      data: { title: '欢迎使用 AI 数智化学习平台', content: '从学习主题开始，完成一次课程或受控实训。', status: PublishStatus.published, publishedAt: new Date() },
    })
  }

  const homepageTargetIds = {
    theme: themeIds,
    course: courseIds,
    lab: labIds,
    resource: resourceIds,
    article: articleIds,
    challenge: challengeIds,
  }
  for (const [sortOrder, fixture] of demoHomepageModules.entries()) {
    const config = fixture.moduleKey === 'student_activity' ? { ...fixture.config, items: demoActivities.slice(0, 6) } : fixture.config
    const module = await prisma.homepageModule.upsert({
      where: { moduleKey: fixture.moduleKey },
      update: { name: fixture.name, config, status: PublishStatus.published, enabled: true, sortOrder },
      create: { moduleKey: fixture.moduleKey, name: fixture.name, config, status: PublishStatus.published, publishedAt: new Date(), sortOrder },
    })
    await prisma.homepageItem.deleteMany({ where: { moduleId: module.id } })
    const relations = demoHomepageRelations[fixture.moduleKey]
    for (const [itemOrder, relation] of relations.entries()) {
      const targetId = homepageTargetIds[relation.type as keyof typeof homepageTargetIds].get(relation.slug)
      if (!targetId) throw new Error(`首页推荐关联不存在：${fixture.moduleKey}/${relation.type}/${relation.slug}`)
      await prisma.homepageItem.create({ data: { moduleId: module.id, targetType: relation.type, targetId, sortOrder: itemOrder, enabled: true } })
    }
    const items = await prisma.homepageItem.findMany({ where: { moduleId: module.id }, orderBy: { sortOrder: 'asc' } })
    const moduleVersion = await prisma.homepageModuleVersion.upsert({
      where: { moduleId_versionNo: { moduleId: module.id, versionNo: 1 } },
      update: { snapshot: { moduleKey: fixture.moduleKey, name: fixture.name, moduleType: module.moduleType, enabled: true, sortOrder, config, items } },
      create: { moduleId: module.id, versionNo: 1, snapshot: { moduleKey: fixture.moduleKey, name: fixture.name, moduleType: module.moduleType, enabled: true, sortOrder, config, items } },
    })
    await prisma.homepageModule.update({ where: { id: module.id }, data: { currentDraftVersionId: moduleVersion.id, publishedVersionId: moduleVersion.id } })
  }
  const publishedModules = await prisma.homepageModule.findMany({
    where: { enabled: true, status: PublishStatus.published },
    orderBy: { sortOrder: 'asc' },
    include: { items: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
  })
  const publicationSnapshot = publishedModules.map((module) => ({
    moduleKey: module.moduleKey,
    name: module.name,
    moduleType: module.moduleType,
    enabled: module.enabled,
    sortOrder: module.sortOrder,
    config: module.config,
    items: module.items.map((item) => ({
      targetType: item.targetType,
      targetId: item.targetId,
      titleOverride: item.titleOverride,
      sortOrder: item.sortOrder,
      enabled: item.enabled,
    })),
  }))
  const latestPublication = await prisma.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
  if (!latestPublication || !isDeepStrictEqual(latestPublication.snapshot, publicationSnapshot)) {
    await prisma.homepagePublication.create({
      data: { version: (latestPublication?.version || 0) + 1, snapshot: publicationSnapshot },
    })
  }

  for (const [index, fixture] of demoLearningPlans.entries()) {
    await prisma.learningPlan.upsert({
      where: { id: fixture.id },
      update: { title: fixture.title, progress: fixture.progress, status: fixture.progress === 100 ? 'completed' : 'active' },
      create: { id: fixture.id, userId: student.id, title: fixture.title, startDate: new Date('2026-08-01T00:00:00.000Z'), targetDate: new Date(`2026-09-${String(8 + index * 2).padStart(2, '0')}T00:00:00.000Z`), progress: fixture.progress },
    })
  }
  for (const [index, activity] of demoActivities.entries()) {
    await prisma.growthPoint.upsert({
      where: { userId_eventType_reference: { userId: student.id, eventType: 'demo_activity', reference: activity.reference } },
      update: { points: activity.points },
      create: { userId: student.id, eventType: 'demo_activity', points: activity.points, reference: activity.reference },
    })
    await prisma.activityEvent.upsert({
      where: { id: `demo-activity-${index + 1}` },
      update: { eventType: 'learning_activity', targetType: 'demo', targetId: activity.reference, payload: { student: activity.student, action: activity.action, points: activity.points } },
      create: { id: `demo-activity-${index + 1}`, userId: index === 0 ? student.id : null, eventType: 'learning_activity', targetType: 'demo', targetId: activity.reference, payload: { student: activity.student, action: activity.action, points: activity.points }, createdAt: new Date(Date.UTC(2026, 7, 29, 9, 0 - index * 5)) },
    })
  }
  for (const [index, fixture] of demoAchievements.entries()) {
    const achievementId = achievementIds.get(fixture.code)
    if (!achievementId) continue
    await prisma.userAchievement.upsert({
      where: { userId_achievementId: { userId: student.id, achievementId } },
      update: { evidence: { source: 'demo-fixtures', order: index + 1 } },
      create: { userId: student.id, achievementId, evidence: { source: 'demo-fixtures', order: index + 1 } },
    })
  }
  for (const [index, fixture] of demoCertificates.entries()) {
    const certificateId = certificateIds.get(fixture.code)
    if (!certificateId) continue
    await prisma.userCertificate.upsert({
      where: { userId_certificateId: { userId: student.id, certificateId } },
      update: { evidence: { source: 'demo-fixtures' } },
      create: { userId: student.id, certificateId, serialNo: `DEMO-2026-${String(index + 1).padStart(4, '0')}`, evidence: { source: 'demo-fixtures' } },
    })
  }
  for (let dayOffset = 0; dayOffset < fixtureMinimums.dailyStatistics; dayOffset += 1) {
    const date = new Date(Date.UTC(2026, 7, 29 - dayOffset))
    await prisma.dailyUserStatistic.upsert({
      where: { date },
      update: { activeUsers: 180 + (dayOffset % 7) * 12, learningMinutes: 6840 + (dayOffset % 5) * 420 },
      create: { date, activeUsers: 180 + (dayOffset % 7) * 12, learningMinutes: 6840 + (dayOffset % 5) * 420 },
    })
  }
  for (const [index, [username, userId]] of [...studentIds.entries()].entries()) {
    const attemptId = `demo-attempt-${username}`
    const score = 96 - index * 2
    await prisma.assessmentAttempt.upsert({
      where: { id: attemptId },
      update: { score, answers: { demo: true } },
      create: { id: attemptId, userId, challengeId: weeklyChallenge.id, score, answers: { demo: true } },
    })
    await prisma.challengeBestScore.upsert({
      where: { userId_challengeId: { userId, challengeId: weeklyChallenge.id } },
      update: { attemptId, score },
      create: { userId, challengeId: weeklyChallenge.id, attemptId, score },
    })
  }
  await seedCommunity(prisma)
  await upgradeLanding(prisma)
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    await prisma.$disconnect()
    throw error
  })
