import { Injectable } from '@nestjs/common'
import type { CommunityContentBlock, CommunityExportDto, CommunityExportFormat, CommunityPostDetailDto } from '@ai-learning-hub/contracts'
import { CommunityPostService } from './post.service'
import { CommunityCommentService } from './comment.service'

@Injectable()
export class CommunityExportService {
  constructor(private readonly posts: CommunityPostService, private readonly comments: CommunityCommentService) {}

  async exportPost(userId: string, id: string, format: CommunityExportFormat = 'json', includeComments = true): Promise<CommunityExportDto> {
    const post = await this.posts.detail(userId, id)
    const comments = includeComments ? await this.comments.list(userId, id) : []
    const base = this.base(post)
    if (format === 'markdown') return { format, mimeType: 'text/markdown', extension: 'md', filename: base, content: this.toMarkdown(post, comments) }
    if (format === 'csv') return { format, mimeType: 'text/csv', extension: 'csv', filename: base, content: this.toCsv(post) }
    return { format: 'json', mimeType: 'application/json', extension: 'json', filename: base, content: JSON.stringify({ post, comments }, null, 2) }
  }

  private base(post: CommunityPostDetailDto) {
    const safe = (post.title || post.type || 'community-post').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60)
    return `${safe}-${post.id.slice(-8)}`
  }

  private toMarkdown(post: CommunityPostDetailDto, comments: Awaited<ReturnType<CommunityCommentService['list']>>): string {
    const typeLabel = { question: '学习问答', note: '学习笔记', lab_result: '实训成果', project: '创客项目', frontier_discussion: '前沿讨论', achievement: '学习成就', general: '学习交流' }[post.type]
    const lines: string[] = []
    lines.push(`# ${post.title || typeLabel}`, '')
    const meta = [`作者：${post.author.displayName}`, `类型：${typeLabel}`, `时间：${new Date(post.publishedAt).toLocaleString('zh-CN')}`]
    if (post.topics.length) meta.push(`话题：${post.topics.map((t) => t.name).join('、')}`)
    if (post.visibility === 'school') meta.push('范围：同校')
    lines.push(`> ${meta.join(' · ')}`, '')
    for (const block of post.contentBlocks as CommunityContentBlock[]) {
      if (block.type === 'paragraph' && block.text.trim()) lines.push(block.text.trim(), '')
      else if (block.type === 'code') lines.push('```' + (block.language || 'text'), block.code, '```', '')
      else if (block.type === 'quote' && block.text.trim()) lines.push('> ' + block.text.trim(), '')
      else if (block.type === 'image') lines.push(`![${block.alt || '图片'}](/api/v1/community/media/${encodeURIComponent(block.fileId)}/url)`, '')
    }
    if (post.bindings.length) {
      lines.push('## 关联内容', '')
      for (const ref of post.bindings) lines.push(`- [${ref.title || ref.type}](${ref.route || '#'})`)
      lines.push('')
    }
    lines.push('---', '', `> 👍 ${post.stats.likes} · 💬 ${post.stats.comments} · 🔖 ${post.stats.bookmarks}`, '')
    const visible = comments.filter((c) => !c.deleted)
    if (visible.length) {
      lines.push('## 评论', '')
      for (const comment of visible) lines.push(`**${comment.author.displayName}**（${new Date(comment.createdAt).toLocaleString('zh-CN')}）：`, '', comment.body, '')
    }
    return lines.join('\n').trim() + '\n'
  }

  private toCsv(post: CommunityPostDetailDto): string {
    const escape = (value: unknown) => {
      const text = value == null ? '' : String(value)
      return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
    }
    const header = ['id', 'type', 'status', 'visibility', 'title', 'author', 'publishedAt', 'editedAt', 'topics', 'bindings', 'likes', 'useful', 'comments', 'bookmarks', 'body']
    const body = (post.contentBlocks as CommunityContentBlock[]).map((block) => block.type === 'code' ? block.code : block.type === 'image' ? `[图片]${block.alt || ''}` : block.type === 'heading' ? block.text : block.type === 'list' ? block.items.join(' ') : block.text).join('\n')
    const row = [post.id, post.type, post.status, post.visibility, post.title, post.author.displayName, post.publishedAt, post.editedAt, post.topics.map((t) => t.name).join(';'), post.bindings.map((r) => `${r.type}:${r.title || r.id}`).join(';'), post.stats.likes, post.stats.useful, post.stats.comments, post.stats.bookmarks, body].map(escape).join(',')
    return [header.map(escape).join(','), row].join('\n') + '\n'
  }
}