import type { CourseDetailDto, CourseSummaryDto, PageResult } from '@ai-learning-hub/contracts'
import { PublishStatus } from '@ai-learning-hub/contracts'
import { demoCourses, getCourseCurriculum } from '@ai-learning-hub/demo-fixtures'
import { defineStore } from 'pinia'
import { courses as mockCourses } from '../../data/mock'
import { dataMode, request } from '../../services/api/client'
import type { Course } from '../../types'
import { apiCatalogCover, localCatalogMedia } from '../../media/catalog'
import { localPage, normalizePageQuery, pageKey, pageUrl, type ContentPageQuery } from './paging'

export const mapCourse = (item: CourseSummaryDto): Course => ({
  id: item.slug,
  title: item.title,
  description: item.summary,
  category: String(item.data.category || '尚未配置') as Course['category'],
  level: String(item.data.level || '尚未配置') as Course['level'],
  hours: typeof item.data.hours === 'number'
    ? item.data.hours
    : typeof item.data.durationMinutes === 'number'
      ? item.data.durationMinutes / 60
      : undefined,
  learners: typeof item.data.learners === 'number' ? item.data.learners : undefined,
  mode: String(item.data.mode || '尚未配置') as Course['mode'],
  ...apiCatalogCover(item.data),
  coverVariant: typeof item.data.coverVariant === 'string' ? item.data.coverVariant : undefined,
  icon: typeof item.data.icon === 'string' ? item.data.icon : undefined,
})

export const useCoursesStore = defineStore('content-courses', {
  state: () => ({
    items: [] as Course[],
    selected: null as CourseDetailDto | null,
    page: 1,
    pageSize: 12,
    total: 0,
    keyword: '',
    cache: {} as Record<string, PageResult<Course>>,
    loading: false,
    error: '',
  }),
  actions: {
    async load(input: ContentPageQuery = {}, force = false) {
      const query = normalizePageQuery(input, this)
      const key = pageKey(query)
      const cached = this.cache[key]
      if (cached && !force) {
        Object.assign(this, cached, { keyword: query.keyword })
        return
      }
      if (dataMode === 'mock') {
        const result = localPage(mockCourses.map((item) => ({ ...item })), query)
        this.cache[key] = result
        Object.assign(this, result, { keyword: query.keyword })
        return
      }
      this.loading = true
      this.error = ''
      try {
        const page = await request<PageResult<CourseSummaryDto>>(pageUrl('/courses', query))
        const result = { ...page, items: page.items.map(mapCourse) }
        this.cache[key] = result
        Object.assign(this, result, { keyword: query.keyword })
      }
      catch (error) { this.error = error instanceof Error ? error.message : '课程加载失败'; throw error }
      finally { this.loading = false }
    },
    async detail(slug: string) {
      if (dataMode === 'mock') {
        const fixture = demoCourses.find((item) => item.slug === slug)
        const curriculum = getCourseCurriculum(slug)
        const listed = mockCourses.find((item) => item.id === slug)
        if (!fixture || !curriculum || !listed) { this.selected = null; return null }
        this.selected = {
          id: slug, slug, title: fixture.title, summary: fixture.summary, status: PublishStatus.PUBLISHED, sortOrder: 0, publishedAt: null, updatedAt: '',
          data: { ...listed, rating: fixture.rating, chapters: curriculum.chapters.length, instructor: { name: fixture.instructor, title: 'AI 通识课程讲师' } },
          chapters: curriculum.chapters.map((chapter, ci) => ({
            id: `${slug}:chapter:${ci}`, title: chapter.title, description: '', sortOrder: ci + 1,
            lessons: chapter.lessons.map((lesson, li) => ({
              ...lesson, id: `${slug}:lesson:${ci}:${li}`, lessonType: 'article', sortOrder: li + 1,
              blocks: lesson.blocks.map((block, bi) => ({ ...block, id: `${slug}:block:${ci}:${li}:${bi}`, sortOrder: bi + 1,
                content: block.blockType === 'image' ? { ...block.content, url: localCatalogMedia(String(block.content.assetId))?.url || '' } : { ...block.content },
              })),
            })),
          })), relatedResources: [], relatedLabs: [],
        }
        return this.selected
      }
      this.selected = await request<CourseDetailDto>(`/courses/${encodeURIComponent(slug)}`)
      return this.selected
    },
  },
})
