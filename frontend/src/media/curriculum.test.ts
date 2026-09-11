import { describe, expect, it } from 'vitest'
import { courseCurricula, demoCourses, demoThemes } from '@ai-learning-hub/demo-fixtures'
import { getCatalogAsset } from '@ai-learning-hub/catalog-assets'

describe('通识课程内容完整性', () => {
  it('所有现有课程都有独立章节、练习及来源，时长和主题数量由实际内容推导', () => {
    expect(courseCurricula).toHaveLength(24)
    expect(courseCurricula.map((course) => course.slug).sort()).toEqual(demoCourses.map((course) => course.slug).sort())
    const fingerprints = new Map<string, Set<string>>()
    const unique = (type: string, value: unknown) => {
      const key = JSON.stringify(value), seen = fingerprints.get(type) || new Set<string>()
      expect(seen.has(key), `${type}重复：${key}`).toBe(false)
      seen.add(key); fingerprints.set(type, seen)
    }
    for (const course of courseCurricula) {
      const fixture = demoCourses.find((item) => item.slug === course.slug)!
      const lessons = course.chapters.flatMap((chapter) => chapter.lessons)
      expect(course.chapters.length).toBeGreaterThanOrEqual(3)
      expect(lessons.length).toBeGreaterThanOrEqual(6)
      expect(fixture.chapters).toBe(course.chapters.length)
      expect(fixture.durationMinutes).toBe(lessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0))
      expect(fixture.hours).toBe(fixture.durationMinutes / 60)
      expect(course.sources.length).toBeGreaterThan(0)
      unique('章节集合', course.chapters.map((chapter) => chapter.title))
      unique('课时集合', lessons.map((lesson) => lesson.title))
      const images: string[] = []
      for (const lesson of lessons) {
        expect(lesson.blocks.filter((block) => block.blockType === 'image').length).toBeLessThanOrEqual(2)
        expect(lesson.blocks.some((block) => block.blockType === 'quiz')).toBe(true)
        expect(lesson.blocks.some((block) => block.blockType === 'key_points')).toBe(true)
        for (const block of lesson.blocks) {
          if (['paragraph', 'diagram', 'quiz', 'key_points'].includes(block.blockType)) unique(block.blockType, block.content)
          expect(JSON.stringify(block.content)).not.toMatch(/众所周知|综上所述|赋能|全方位提升|深度解析|<img/)
          if (block.blockType !== 'image') continue
          const asset = getCatalogAsset(String(block.content.assetId))
          expect(asset).toMatchObject({ kind: 'illustration', contentSlug: course.slug, mascot: true, width: 1200, height: 900 })
          expect(block.content.alt).toBe(asset?.altText)
          expect(String(block.content.caption).length).toBeGreaterThan(8)
          images.push(String(block.content.assetId))
        }
      }
      expect(images.length).toBeGreaterThanOrEqual(2)
      expect(images.length).toBeLessThanOrEqual(3)
      expect(new Set(images).size).toBe(images.length)
      expect(getCatalogAsset(fixture.coverAssetKey)).toMatchObject({ kind: 'cover', contentSlug: course.slug, mascot: true, width: 1200, height: 900 })
    }
    for (const theme of demoThemes) {
      const courses = demoCourses.filter((course) => course.theme === theme.slug)
      expect(theme.courseCount).toBe(courses.length)
      expect(theme.hours).toBe(courses.reduce((sum, course) => sum + course.hours, 0))
    }
  })
})
