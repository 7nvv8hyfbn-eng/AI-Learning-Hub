import {
  demoAchievements,
  demoActivities,
  demoArticles,
  demoCourses,
  demoLabs,
  demoResources,
} from '@ai-learning-hub/demo-fixtures'
import { reactive } from 'vue'
import { mockCatalogCover } from '../media/catalog'
import heroCampus from '../assets/hero-campus.webp'
import learningCover from '../assets/learning-cover.webp'
import labCover from '../assets/lab-cover.webp'
import type { Article, Course, Lab, ResourceItem } from '../types'

export const assets = { heroCampus, learningCover, labCover }

const themeMeta = {
  llm: { category: '大模型 LLM', accent: '#6e5bff' },
  agent: { category: 'AI Agent', accent: '#27b86b' },
  image: { category: '图像生成', accent: '#a05cf6' },
  deployment: { category: '模型部署', accent: '#3478f6' },
  hardware: { category: '智能硬件', accent: '#e5a91d' },
  security: { category: 'AI 安全', accent: '#16a67a' },
} as const

export const courses = /* @__PURE__ */ reactive<Course[]>(demoCourses.map((item) => ({
  id: item.slug,
  title: item.title,
  description: item.summary,
  category: themeMeta[item.theme as keyof typeof themeMeta].category,
  level: item.level as Course['level'],
  hours: item.hours,
  learners: item.learners,
  progress: item.progress,
  mode: item.mode as Course['mode'],
  ...mockCatalogCover('course', item.theme, item.coverAssetKey),
  coverVariant: item.coverVariant,
  accent: themeMeta[item.theme as keyof typeof themeMeta].accent,
  icon: item.icon,
})))

const labCategory = {
  agent: 'AI Agent',
  deployment: '模型部署',
  command: 'Linux 命令',
  hardware: '智能硬件',
  project: '综合项目',
} as const

export const labs = /* @__PURE__ */ reactive<Lab[]>(demoLabs.map((item) => ({
  id: item.slug,
  title: item.title,
  description: item.summary,
  category: labCategory[item.labType],
  level: item.level as Lab['level'],
  minutes: item.durationMinutes,
  steps: item.steps,
  completion: item.completionRate,
  learners: item.participants,
  ...mockCatalogCover('lab', item.labType, item.coverAssetKey),
  coverVariant: item.coverVariant,
  icon: item.icon,
})))

export const resources = /* @__PURE__ */ reactive<ResourceItem[]>(demoResources.map((item) => ({
  id: item.slug,
  title: item.title,
  category: item.category,
  format: item.format,
  theme: item.theme,
  difficulty: item.difficulty as ResourceItem['difficulty'],
  featured: item.featured,
  downloads: item.downloads,
  updatedAt: item.updatedAt,
  ...mockCatalogCover('resource', item.category, item.coverAssetKey),
  coverVariant: item.coverVariant,
  icon: item.icon,
})))

export const articles = /* @__PURE__ */ reactive<Article[]>(demoArticles.map((item) => ({
  id: item.slug,
  title: item.title,
  summary: item.summary,
  category: item.category,
  readMinutes: item.readMinutes,
  publishedAt: item.publishedAt,
  content: item.content,
  ...mockCatalogCover('article', item.category, item.coverAssetKey),
  coverVariant: item.coverVariant,
  icon: item.icon,
})))

export const makerProjects = /* @__PURE__ */ reactive(demoLabs.filter((item) => item.labType === 'project').slice(0, 3).map((item) => ({
  id: item.slug,
  title: item.title,
  description: item.summary,
  skills: item.skills.join(' · '),
  steps: item.steps,
  duration: `${Math.round(item.durationMinutes / 30) / 2} 小时`,
  ...mockCatalogCover('lab', item.labType, item.coverAssetKey),
  coverVariant: item.coverVariant,
  icon: item.icon,
})))

export const studentActivities = /* @__PURE__ */ reactive(import.meta.env.PROD && import.meta.env.VITE_DATA_MODE === 'api' ? [] : demoActivities.slice(0, 6).map((item, index) => ({
  student: item.student,
  action: item.action,
  time: ['刚刚', '6 分钟前', '18 分钟前', '32 分钟前', '48 分钟前', '1 小时前'][index],
  points: `+${item.points} 经验值`,
})))

export const assessmentAchievements = /* @__PURE__ */ reactive(demoAchievements.map((item, index) => ({
  title: item.name,
  icon: item.code,
  unlocked: index < 4,
  description: item.description,
})))

export const userProfile = /* @__PURE__ */ reactive(import.meta.env.PROD && import.meta.env.VITE_DATA_MODE === 'api' ? { name: '', school: '', program: '', level: 0, experience: 0, streak: 0, weeklyHours: 0, points: 0 } : {
  name: '造梦少年',
  school: '高校认证',
  program: 'AI 创客学院 · 计算机科学与技术 · 大二',
  level: 28,
  experience: 12800,
  streak: 24,
  weeklyHours: 12.6,
  points: 3280,
})
