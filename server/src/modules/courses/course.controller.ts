import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import type { AuthUser } from '../auth/auth.types'
import { PageQueryDto } from '../../common/content/page-query.dto'
import { CourseRelationsDto, CreateBlockDto, CreateChapterDto, CreateCourseDto, CreateLessonDto, ReorderCourseDto, UpdateBlockDto, UpdateChapterDto, UpdateCourseDto, UpdateLessonDto } from './course.dto'
import { CourseService } from './course.service'
import { bindCourseImage } from './course-images'

@Controller('admin/courses')
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminCourseController {
  constructor(private readonly courses: CourseService) {}
  @Delete(':id') @Permissions('course.write') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.courses.remove(id, user.id) }
  @Get() @Permissions('course.read') list(@Query() query: PageQueryDto) { return this.courses.list(query) }
  @Post() @Permissions('course.write') create(@Body() input: CreateCourseDto, @CurrentUser() user: AuthUser) { return this.courses.create(input, user.id) }
  @Get(':id') @Permissions('course.read') detail(@Param('id') id: string) { return this.courses.detail(id) }
  @Patch(':id') @Permissions('course.write') update(@Param('id') id: string, @Body() input: UpdateCourseDto, @CurrentUser() user: AuthUser) { return this.courses.update(id, input, user.id) }
  @Post(':id/publish') @Permissions('course.publish') publish(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.courses.setPublished(id, true, user.id) }
  @Post(':id/archive') @Permissions('course.publish') archive(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.courses.setPublished(id, false, user.id) }
  @Put(':id/relations') @Permissions('course.write') relations(@Param('id') id: string, @Body() input: CourseRelationsDto) { return this.courses.setRelations(id, input.resourceIds, input.labIds) }
}

@Controller('admin')
@UseGuards(AuthGuard, PermissionsGuard)
export class CourseStructureController {
  constructor(private readonly courses: CourseService) {}

  @Post('courses/:id/chapters') @Permissions('course.write')
  async chapter(@Param('id') courseId: string, @Body() input: CreateChapterDto) {
    return this.courses.editStructure('course', courseId, (tx, _id, versionId) => tx.courseChapter.create({ data: { courseVersionId: versionId, ...input } }))
  }

  @Patch('course-chapters/:id') @Permissions('course.write')
  updateChapter(@Param('id') id: string, @Body() input: UpdateChapterDto) {
    return this.courses.editStructure('chapter', id, (tx, targetId) => tx.courseChapter.update({ where: { id: targetId }, data: input }))
  }

  @Delete('course-chapters/:id') @Permissions('course.write')
  deleteChapter(@Param('id') id: string) { return this.courses.editStructure('chapter', id, (tx, targetId) => tx.courseChapter.delete({ where: { id: targetId } })) }

  @Put('courses/:id/chapters/reorder') @Permissions('course.write')
  async reorderChapters(@Param('id') courseId: string, @Body() input: ReorderCourseDto) {
    return this.courses.editStructure('course', courseId, async (tx, _id, versionId, resolveId) => {
      const items = input.items.map((item) => ({ ...item, id: resolveId(item.id) }))
      const valid = await tx.courseChapter.count({ where: { courseVersionId: versionId, id: { in: items.map((item) => item.id) } } })
      if (valid !== items.length) throw new NotFoundException('章节不属于当前课程草稿')
      for (const item of items) await tx.courseChapter.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
      return tx.courseChapter.findMany({ where: { courseVersionId: versionId }, orderBy: { sortOrder: 'asc' } })
    })
  }

  @Post('chapters/:id/lessons') @Permissions('course.write')
  lesson(@Param('id') chapterId: string, @Body() input: CreateLessonDto) {
    return this.courses.editStructure('chapter', chapterId, (tx, targetId) => tx.courseLesson.create({ data: { chapterId: targetId, ...input } }))
  }

  @Patch('course-lessons/:id') @Permissions('course.write')
  updateLesson(@Param('id') id: string, @Body() input: UpdateLessonDto) {
    return this.courses.editStructure('lesson', id, (tx, targetId) => tx.courseLesson.update({ where: { id: targetId }, data: input }))
  }

  @Delete('course-lessons/:id') @Permissions('course.write')
  deleteLesson(@Param('id') id: string) { return this.courses.editStructure('lesson', id, (tx, targetId) => tx.courseLesson.delete({ where: { id: targetId } })) }

  @Put('chapters/:id/lessons/reorder') @Permissions('course.write')
  async reorderLessons(@Param('id') chapterId: string, @Body() input: ReorderCourseDto) {
    return this.courses.editStructure('chapter', chapterId, async (tx, targetId, _versionId, resolveId) => {
      const items = input.items.map((item) => ({ ...item, id: resolveId(item.id) }))
      const valid = await tx.courseLesson.count({ where: { chapterId: targetId, id: { in: items.map((item) => item.id) } } })
      if (valid !== items.length) throw new NotFoundException('课时不属于当前章节')
      for (const item of items) await tx.courseLesson.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
      return tx.courseLesson.findMany({ where: { chapterId: targetId }, orderBy: { sortOrder: 'asc' } })
    })
  }

  @Post('lessons/:id/blocks') @Permissions('course.write')
  block(@Param('id') lessonId: string, @Body() input: CreateBlockDto) {
    return this.courses.editStructure('lesson', lessonId, async (tx, targetId) => {
      const content = input.blockType === 'image' ? await bindCourseImage(tx, input.content) : input.content
      return tx.lessonBlock.create({ data: { lessonId: targetId, blockType: input.blockType, sortOrder: input.sortOrder, content: content as Prisma.InputJsonValue } })
    })
  }

  @Patch('lesson-blocks/:id') @Permissions('course.write')
  updateBlock(@Param('id') id: string, @Body() input: UpdateBlockDto) {
    return this.courses.editStructure('block', id, async (tx, targetId) => {
      const previous = await tx.lessonBlock.findUniqueOrThrow({ where: { id: targetId } })
      const blockType = input.blockType || previous.blockType
      const value = input.content || previous.content as Record<string, unknown>
      const content = blockType === 'image' ? await bindCourseImage(tx, value, previous.content as Record<string, unknown>) : value
      return tx.lessonBlock.update({ where: { id: targetId }, data: { blockType, content: content as Prisma.InputJsonValue } })
    })
  }

  @Delete('lesson-blocks/:id') @Permissions('course.write')
  deleteBlock(@Param('id') id: string) { return this.courses.editStructure('block', id, (tx, targetId) => tx.lessonBlock.delete({ where: { id: targetId } })) }

  @Put('lessons/:id/blocks/reorder') @Permissions('course.write')
  async reorderBlocks(@Param('id') lessonId: string, @Body() input: ReorderCourseDto) {
    return this.courses.editStructure('lesson', lessonId, async (tx, targetId, _versionId, resolveId) => {
      const items = input.items.map((item) => ({ ...item, id: resolveId(item.id) }))
      const valid = await tx.lessonBlock.count({ where: { lessonId: targetId, id: { in: items.map((item) => item.id) } } })
      if (valid !== items.length) throw new NotFoundException('内容块不属于当前课时')
      for (const item of items) await tx.lessonBlock.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })
      return tx.lessonBlock.findMany({ where: { lessonId: targetId }, orderBy: { sortOrder: 'asc' } })
    })
  }
}

@Controller('courses')
export class PublicCourseController {
  constructor(private readonly courses: CourseService) {}
  @Get() list(@Query() query: PageQueryDto) { return this.courses.list(query, true) }
  @Get(':slug') detail(@Param('slug') slug: string) { return this.courses.detail(slug, true) }
}
