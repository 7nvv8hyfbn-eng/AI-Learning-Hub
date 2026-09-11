import { llmCurriculum } from './llm'
import { agentCurriculum } from './agent'
import { imageCurriculum } from './image'
import { deploymentCurriculum } from './deployment'
import { hardwareCurriculum } from './hardware'
import { securityCurriculum } from './security'
import type { CourseCurriculum } from './types'

export const curriculumVersion = 'xiaoxue-v2'
export const courseCurricula: CourseCurriculum[] = [...llmCurriculum, ...agentCurriculum, ...imageCurriculum, ...deploymentCurriculum, ...hardwareCurriculum, ...securityCurriculum]
for (const course of courseCurricula) {
  const last = course.chapters.at(-1)?.lessons.at(-1)
  for (const source of course.sources) last?.blocks.push({ blockType: 'resource', content: { title: source.title, sourceUrl: source.url } })
}
export const getCourseCurriculum = (slug: string) => courseCurricula.find((course) => course.slug === slug)
export type { CourseCurriculum, CurriculumLesson, CurriculumBlock } from './types'
