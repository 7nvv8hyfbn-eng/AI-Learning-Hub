import { iconRegistry } from '@ai-learning-hub/catalog-assets/icons/registry'

export interface GrowthTier { label: string; cover: string; color: string; soft: string }

export const growthTiers: GrowthTier[] = [
  { label: '普通', cover: 'cover-llm', color: 'var(--amc-purple)', soft: 'var(--amc-purple-soft)' },
  { label: '优秀', cover: 'cover-agent', color: 'var(--amc-green)', soft: 'var(--amc-green-soft)' },
  { label: '精英', cover: 'cover-deployment', color: 'var(--amc-blue)', soft: 'var(--amc-blue-soft)' },
  { label: '限定', cover: 'cover-hardware', color: 'var(--amc-warning)', soft: 'var(--amc-yellow-soft)' },
]

const fixedTiers: Record<string, number> = {
  'first-login': 0, 'profile-done': 0, 'first-post': 0,
  'posts-5': 1, 'answer-1': 1, 'answer-5': 1, 'useful-10': 1,
  'lesson-10': 2, 'lab-5': 2, 'assessment-5': 2,
  'streak-7': 3, 'points-1000': 3,
}

export const growthTier = (code: string): GrowthTier => {
  const index = code in fixedTiers ? fixedTiers[code] : [...code].reduce((total, ch) => (total * 31 + ch.charCodeAt(0)) % 997, 0) % growthTiers.length
  return growthTiers[index] || growthTiers[0]
}

export const growthIcon = (code: string) => (Object.hasOwn(iconRegistry, code) ? code : 'achievement')

export const growthProgressUnit = (rule: { type?: string; event?: string } = {}) => {
  if (rule.type === 'streak') return '天'
  if (rule.type === 'points') return '分'
  if (rule.type === 'lesson_complete') return '节课'
  if (rule.type === 'lab_complete') return '个实训'
  if (rule.type === 'assessment_pass') return '次测评'
  if (rule.type === 'event_count') {
    if (rule.event === 'community_post_publish') return '篇帖子'
    if (rule.event === 'community_comment_create') return '条回答'
    if (rule.event === 'answer_accepted') return '次被采纳'
    if (rule.event === 'community_useful_add') return '次获有用'
    if (rule.event === 'student_register' || rule.event === 'onboarding_completed') return '次'
  }
  return '次'
}
