import { getCatalogAsset } from '../../../catalog-assets/manifest'

export interface CurriculumBlock { blockType: 'paragraph' | 'image' | 'diagram' | 'quiz' | 'key_points' | 'code' | 'resource'; content: Record<string, unknown> }
export interface CurriculumLesson { title: string; summary: string; durationMinutes: number; blocks: CurriculumBlock[] }
export interface CourseCurriculum {
  slug: string
  sources: Array<{ title: string; url: string }>
  chapters: Array<{ title: string; lessons: CurriculumLesson[] }>
}

// 只压缩课程数据的重复结构；正文、练习和图注均逐课编写。
export function lesson(title: string, paragraphs: [string, string], exercise: [string, string], remember: string, image?: CurriculumBlock, nodes?: string[], code?: [string, string]): CurriculumLesson {
  return { title, summary: remember, durationMinutes: 15, blocks: [
    { blockType: 'paragraph', content: { text: paragraphs[0] } },
    ...(image ? [image] : []),
    { blockType: 'paragraph', content: { text: paragraphs[1] } },
    ...(nodes ? [{ blockType: 'diagram' as const, content: { nodes } }] : []),
    ...(code ? [{ blockType: 'code' as const, content: { language: code[0], code: code[1] } }] : []),
    { blockType: 'quiz', content: { question: exercise[0], answer: exercise[1] } },
    { blockType: 'key_points', content: { items: [remember] } },
  ] }
}

export function illustration(slug: string, point: string, caption: string): CurriculumBlock {
  const assetId = `lesson-v2--${slug}--${point}`
  const asset = getCatalogAsset(assetId)
  if (!asset || asset.kind !== 'illustration') throw new Error(`课程插图缺少素材清单：${assetId}`)
  return { blockType: 'image', content: { assetId, alt: asset.altText, caption, aspectRatio: '4:3', width: asset.width, height: asset.height } }
}
