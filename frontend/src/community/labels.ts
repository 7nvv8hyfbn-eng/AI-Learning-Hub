import type { CommunityPostType } from '@ai-learning-hub/contracts'
export const postLabels: Record<CommunityPostType, string> = { question: '学习问答', note: '学习笔记', lab_result: '实训成果', project: '创客项目', frontier_discussion: '前沿讨论', achievement: '学习成就', general: '学习交流' }
export const badgeLabels = { none: '', teacher: '认证教师', official: '官方', mentor: '学习导师' }
export const communityNavActive = (path: string, target: string) => {
  if (target === '/community') return path === target || /^\/community\/(post|search|topic|user)(\/|$)/.test(path)
  if (target === '/topics' && path.startsWith('/courses/')) return true
  return path === target || path.startsWith(`${target}/`)
}
export const relativeTime = (value: string, now = Date.now()) => {
  const date = new Date(value), elapsed = Math.max(0, now - date.getTime())
  if (elapsed < 60000) return '刚刚'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`
  const today = new Date(now), yesterday = new Date(now); yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return `${Math.floor(elapsed / 3600000)} 小时前`
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}), month: 'long', day: 'numeric' })
}
export const communityNavigation = [
  { label: '社区首页', path: '/community', icon: 'message', desktop: true, mobile: true, mobileOrder: 1, requiresAuth: true },
  { label: '学时排名', path: '/study-ranking', icon: 'trophy', desktop: true, mobile: false, mobileOrder: 0, requiresAuth: true },
  { label: '学习主题', path: '/topics', icon: 'layers', desktop: true, mobile: true, mobileOrder: 2, requiresAuth: true },
  { label: '实训项目', path: '/labs', icon: 'terminal', desktop: true, mobile: false, mobileOrder: 0, requiresAuth: true },
  { label: '资源中心', path: '/resources', icon: 'folder', desktop: true, mobile: false, mobileOrder: 0, requiresAuth: true },
  { label: 'AI 前沿', path: '/frontier', icon: 'sparkles', desktop: true, mobile: false, mobileOrder: 0, requiresAuth: true },
  { label: '挑战与测评', path: '/assessments', icon: 'trophy', desktop: true, mobile: false, mobileOrder: 0, requiresAuth: true },
  { label: '我的成长', path: '/profile', icon: 'chart', desktop: true, mobile: true, mobileOrder: 5, requiresAuth: true },
  { label: '收藏与笔记', path: '/bookmarks', icon: 'bookmark', desktop: true, mobile: false, mobileOrder: 0, requiresAuth: true },
  { label: '消息通知', path: '/notifications', icon: 'bell', desktop: true, mobile: true, mobileOrder: 4, requiresAuth: true },
  { label: '草稿箱', path: '/community/drafts', icon: 'edit', desktop: true, mobile: false, mobileOrder: 0, requiresAuth: true },
]
