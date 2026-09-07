import type { CommunityContentBlock } from '@ai-learning-hub/contracts'

export interface ExportMeta { author?: string; origin?: string; link?: string }

export const safeFileBase = (value: string) => (value.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'community'

export const exportWatermark = (meta: ExportMeta) => [
  '来源：AI 数智化学习平台 · 题盒社区',
  `作者：${meta.author || '社区学习者'}`,
  meta.origin ? `出处：${meta.origin}` : '',
  meta.link ? `链接：${meta.link}` : '',
  `下载时间：${new Date().toLocaleString('zh-CN')}`,
].filter((line): line is string => !!line)

export const blocksToText = (blocks: CommunityContentBlock[]) => blocks.map((block) => {
  if (block.type === 'code') return `${block.language || 'text'}：\n${block.code}`
  if (block.type === 'image') return `[图片：${block.alt || '未命名图片'}]`
  return block.text
}).join('\n\n')

export const blocksToMarkdown = (blocks: CommunityContentBlock[]) => blocks.map((block) => {
  if (block.type === 'code') return ['```' + (block.language || 'text'), block.code, '```'].join('\n')
  if (block.type === 'image') return `> [图片：${block.alt || '未命名图片'}]`
  return block.text
}).join('\n\n')

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { return false }
}

export const downloadText = (name: string, content: string, type = 'text/plain;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
