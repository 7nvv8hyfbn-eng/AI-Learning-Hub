import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PublishStatus } from '@prisma/client'
import { ContentSupportService } from '../../common/content/content-support.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { PageQueryDto } from '../../common/content/page-query.dto'
import type { CreateCourseDto, UpdateCourseDto } from './course.dto'

const dataFields = ['category', 'level', 'coverAssetId', 'mode', 'hours', 'durationMinutes', 'certificate']

@Injectable()
export class CourseService {
  constructor(private readonly prisma: PrismaService, private readonly support: ContentSupportService) {}
  remove(id: string, actorId: string) { return this.support.remove('course', id, actorId) }

  private courseData(input: CreateCourseDto | UpdateCourseDto) {
    const data = this.support.pick(input, dataFields)
    if (input.instructorName !== undefined || input.instructorTitle !== undefined) {
      data.instructor = { name: input.instructorName || '', title: input.instructorTitle || '' }
    }
    return data
  }

  private snapshot(snapshot: Prisma.JsonValue | null | undefined) {
    const value = this.support.data(snapshot)
    return {
      title: typeof value.title === 'string' ? value.title : undefined,
      summary: typeof value.summary === 'string' ? value.summary : undefined,
      data: this.support.data((value.data || value.payload) as Prisma.JsonValue),
    }
  }

  async list(query: PageQueryDto, publicOnly = false) {
    const where = this.support.where(query, publicOnly)
    const [items, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({ ...this.support.page(query), where, include: { publishedVersion: true } }),
      this.prisma.course.count({ where }),
    ])
    const covers = await this.support.media.prepare(items, publicOnly)
    return {
      items: await Promise.all(items.map(async (item) => {
        const published = publicOnly ? this.snapshot(item.publishedVersion?.snapshot) : null
        return this.support.render('course', {
          ...item,
          title: published?.title || item.title,
          summary: published?.summary || item.summary,
        }, !publicOnly, published?.data || this.support.data(item.payload), covers)
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    }
  }

  async detail(value: string, publicOnly = false) {
    const item = await this.prisma.course.findFirst({
      where: { OR: [{ id: value }, { slug: value }], deletedAt: null, ...(publicOnly ? { status: PublishStatus.published } : {}) },
      include: {
        currentDraftVersion: { include: { chapters: { orderBy: { sortOrder: 'asc' }, include: { lessons: { orderBy: { sortOrder: 'asc' }, include: { blocks: { orderBy: { sortOrder: 'asc' } } } } } } } },
        publishedVersion: { include: { chapters: { orderBy: { sortOrder: 'asc' }, include: { lessons: { orderBy: { sortOrder: 'asc' }, include: { blocks: { orderBy: { sortOrder: 'asc' } } } } } } } },
        resources: {
          where: publicOnly ? { resource: { status: PublishStatus.published, deletedAt: null } } : {},
          orderBy: { sortOrder: 'asc' },
          include: { resource: true },
        },
        labs: {
          where: publicOnly ? { lab: { status: PublishStatus.published, deletedAt: null } } : {},
          orderBy: { sortOrder: 'asc' },
          include: { lab: true },
        },
      },
    })
    if (!item) throw new NotFoundException('课程不存在')
    const published = publicOnly ? this.snapshot(item.publishedVersion?.snapshot) : null
    return {
      ...await this.support.render('course', {
        ...item,
        title: published?.title || item.title,
        summary: published?.summary || item.summary,
      }, !publicOnly, published?.data || this.support.data(item.payload)),
      ...(!publicOnly ? {
        themeId: item.themeId,
        currentDraftVersionId: item.currentDraftVersionId,
        publishedVersionId: item.publishedVersionId,
      } : {}),
      chapters: (publicOnly ? item.publishedVersion : item.currentDraftVersion)?.chapters || [],
      relatedResources: item.resources.map((link) => ({
        ...(!publicOnly ? { id: link.resource.id } : {}),
        slug: link.resource.slug,
        title: link.resource.title,
      })),
      relatedLabs: item.labs.map((link) => ({
        ...(!publicOnly ? { id: link.lab.id } : {}),
        slug: link.lab.slug,
        title: link.lab.title,
      })),
    }
  }

  async create(input: CreateCourseDto, actorId: string) {
    const data = { coverAssetId: null, ...this.courseData(input) }
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, input.coverAssetId)
      const course = await tx.course.create({
        data: {
          coverAssetId: input.coverAssetId || null,
          slug: input.slug,
          title: input.title,
          summary: input.summary,
          sortOrder: input.sortOrder,
          themeId: input.themeId || null,
          payload: this.support.sanitize(data),
        },
      })
      const version = await tx.courseVersion.create({
        data: { courseId: course.id, versionNo: 1, snapshot: this.support.json({ title: course.title, summary: course.summary, data }) },
      })
      return tx.course.update({ where: { id: course.id }, data: { currentDraftVersionId: version.id } })
    })
    await this.support.audit(actorId, 'create', 'courses', item.id)
    return this.support.render('course', item, true)
  }

  async update(id: string, input: UpdateCourseDto, actorId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, input.coverAssetId)
      const draftId = await this.ensureDraft(id, tx)
      const current = await tx.course.findUniqueOrThrow({ where: { id } })
      const data = { ...this.support.data(current.payload), ...this.courseData(input) }
      const course = await tx.course.update({ where: { id }, data: {
        ...this.support.pick(input, ['title', 'summary', 'sortOrder', 'themeId', 'coverAssetId']),
        payload: this.support.sanitize(data), version: { increment: 1 },
      } })
      const draft = await tx.courseVersion.findUniqueOrThrow({ where: { id: draftId } })
      await tx.courseVersion.update({ where: { id: draftId }, data: { snapshot: this.support.json({ ...this.support.data(draft.snapshot), title: course.title, summary: course.summary, data }) } })
      return course
    })
    await this.support.audit(actorId, 'update', 'courses', id)
    return this.support.render('course', item, true)
  }

  async setPublished(id: string, published: boolean, actorId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, undefined)
      const draftId = published ? await this.ensureDraft(id, tx) : null
      if (published && !draftId) throw new BadRequestException('课程没有可发布草稿版本')
      return tx.course.update({ where: { id }, data: published
        ? { status: PublishStatus.published, publishedAt: new Date(), publishedVersionId: draftId, version: { increment: 1 } }
        : { status: PublishStatus.archived, version: { increment: 1 } } })
    })
    await this.support.audit(actorId, published ? 'publish' : 'archive', 'courses', id)
    return this.support.render('course', item, true)
  }

  async editStructure<T>(kind: 'course' | 'chapter' | 'lesson' | 'block', id: string, change: (tx: Prisma.TransactionClient, targetId: string, versionId: string, resolveId: (value: string) => string) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, undefined)
      const version = kind === 'chapter' ? (await tx.courseChapter.findUnique({ where: { id }, include: { version: true } }))?.version
        : kind === 'lesson' ? (await tx.courseLesson.findUnique({ where: { id }, include: { chapter: { include: { version: true } } } }))?.chapter.version
        : kind === 'block' ? (await tx.lessonBlock.findUnique({ where: { id }, include: { lesson: { include: { chapter: { include: { version: true } } } } } }))?.lesson.chapter.version
        : null
      if (kind !== 'course' && !version) throw new NotFoundException('课程结构不存在')
      const remapped = new Map<string, string>(), versionId = await this.ensureDraft(kind === 'course' ? id : version!.courseId, tx, remapped)
      if (version && version.id !== versionId && !remapped.has(id)) throw new ConflictException('课程草稿已变化，请刷新后编辑，已发布版本不会被修改')
      const resolveId = (value: string) => remapped.get(value) || value
      return change(tx, resolveId(id), versionId, resolveId)
    })
  }

  private async ensureDraft(courseId: string, tx: Prisma.TransactionClient, remapped = new Map<string, string>()): Promise<string> {
    const course = await tx.course.findUnique({
      where: { id: courseId, deletedAt: null },
      include: {
        currentDraftVersion: { include: { chapters: { orderBy: { sortOrder: 'asc' }, include: { lessons: { orderBy: { sortOrder: 'asc' }, include: { blocks: { orderBy: { sortOrder: 'asc' } } } } } } } },
        _count: { select: { versions: true } },
      },
    })
    if (!course) throw new NotFoundException('课程不存在')
    if (course.currentDraftVersionId && course.currentDraftVersionId !== course.publishedVersionId) return course.currentDraftVersionId
      const source = course.currentDraftVersion
      const version = await tx.courseVersion.create({
        data: {
          courseId,
          versionNo: course._count.versions + 1,
          snapshot: (source?.snapshot || { title: course.title, summary: course.summary, data: this.support.data(course.payload) }) as Prisma.InputJsonValue,
        },
      })
      for (const chapter of source?.chapters || []) {
        const createdChapter = await tx.courseChapter.create({
          data: { courseVersionId: version.id, title: chapter.title, description: chapter.description, sortOrder: chapter.sortOrder },
        })
        remapped.set(chapter.id, createdChapter.id)
        for (const lesson of chapter.lessons) {
          const createdLesson = await tx.courseLesson.create({
            data: {
              chapterId: createdChapter.id,
              title: lesson.title,
              summary: lesson.summary,
              lessonType: lesson.lessonType,
              durationMinutes: lesson.durationMinutes,
              sortOrder: lesson.sortOrder,
            },
          })
          remapped.set(lesson.id, createdLesson.id)
          for (const block of lesson.blocks) {
            const createdBlock = await tx.lessonBlock.create({
              data: { lessonId: createdLesson.id, blockType: block.blockType, sortOrder: block.sortOrder, content: block.content as Prisma.InputJsonValue },
            })
            remapped.set(block.id, createdBlock.id)
          }
        }
      }
      await tx.course.update({ where: { id: courseId }, data: { currentDraftVersionId: version.id } })
      return version.id
  }

  async setRelations(courseId: string, resourceIds: string[], labIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, undefined)
      await this.ensureDraft(courseId, tx)
      await tx.courseResource.deleteMany({ where: { courseId } })
      await tx.courseLab.deleteMany({ where: { courseId } })
      for (const [sortOrder, resourceId] of resourceIds.entries()) {
        await tx.courseResource.create({ data: { courseId, resourceId, sortOrder } })
      }
      for (const [sortOrder, labId] of labIds.entries()) {
        await tx.courseLab.create({ data: { courseId, labId, sortOrder } })
      }
    })
    return this.detail(courseId)
  }

  async createDraftFromCollection(collectionId: string, input: { courseId?: string; slug?: string; title?: string }, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`collection-course:${collectionId}:${input.courseId || input.slug || ''}`},0))::text`
      const collection = await tx.learningCollection.findUnique({
        where: { id: collectionId },
        include: {
          items: {
            include: {
              contribution: {
                include: { post: { include: { author: true } }, videoAsset: true },
              },
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          },
        },
      })
      if (!collection) throw new NotFoundException('合集不存在')
      if (!collection.items.length) throw new BadRequestException('空合集不能生成课程')
      const invalid = collection.items.find(({ contribution }) =>
        !contribution.teachingReuseConsent ||
        contribution.post.status !== 'published' ||
        contribution.post.visibility !== 'public' ||
        !!contribution.post.deletedAt ||
        contribution.post.author.status !== 'active')
      if (invalid) throw new BadRequestException(`作品“${invalid.contribution.post.title || invalid.contribution.postId}”未公开发布、作者失效或未授权教学复用`)

      let courseId = input.courseId
      let versionId: string
      if (courseId) {
        const existing = await tx.collectionCourseReference.findUnique({ where: { collectionId_courseId: { collectionId, courseId } } })
        if (existing) return existing
        versionId = await this.ensureDraft(courseId, tx)
      } else {
        const slug = input.slug?.trim(), title = input.title?.trim()
        if (!slug || !title) throw new BadRequestException('新建课程需要课程标识和标题')
        const durationMinutes = collection.items.reduce((total, item) => total + Math.max(1, Math.ceil((item.contribution.videoAsset?.durationSeconds || 600) / 60)), 0)
        const data = { category: '资源合集', mode: 'self-paced', durationMinutes }
        const course = await tx.course.create({
          data: { slug, title, summary: collection.description || collection.learningGoal || `由“${collection.name}”合集生成的课程草稿`, payload: this.support.json(data) },
        })
        const version = await tx.courseVersion.create({ data: { courseId: course.id, versionNo: 1, snapshot: this.support.json({ title, summary: course.summary, data }) } })
        await tx.course.update({ where: { id: course.id }, data: { currentDraftVersionId: version.id } })
        courseId = course.id
        versionId = version.id
      }

      const chapter = await tx.courseChapter.create({
        data: { courseVersionId: versionId, title: collection.name, description: collection.learningGoal || collection.description, sortOrder: 0 },
      })
      for (const [sortOrder, item] of collection.items.entries()) {
        const source = item.contribution
        const lesson = await tx.courseLesson.create({
          data: {
            chapterId: chapter.id,
            title: source.post.title || '未命名资源',
            summary: source.post.plainText.slice(0, 240),
            lessonType: source.kind,
            durationMinutes: Math.min(600, Math.max(1, Math.ceil((source.videoAsset?.durationSeconds || 600) / 60))),
            sortOrder,
          },
        })
        await tx.lessonBlock.create({
          data: {
            lessonId: lesson.id,
            blockType: 'resource',
            sortOrder: 0,
            content: this.support.json({
              title: source.post.title || '学习资源',
              route: source.kind === 'video' ? `/resources/watch/${source.postId}` : `/resources/read/${source.postId}`,
              sourcePostId: source.postId,
              sourceAuthorId: source.post.authorId,
            }),
          },
        })
      }
      const reference = await tx.collectionCourseReference.create({
        data: { collectionId, courseId: courseId!, courseVersionId: versionId, createdBy: actorId, sourceRevision: collection.revision },
      })
      await tx.auditLog.create({
        data: { actorId, action: 'resource_collection_to_course', targetType: 'course', targetId: courseId!, details: { collectionId, courseVersionId: versionId, sourceRevision: collection.revision } },
      })
      return reference
    })
    return { courseId: result.courseId, courseVersionId: result.courseVersionId, collectionId: result.collectionId, sourceRevision: result.sourceRevision }
  }
}
