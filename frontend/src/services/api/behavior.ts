import type { FavoriteType } from '../../types'
import { request } from './client'

export interface LabRunDto {
  id: string
  status: 'ready' | 'running' | 'success' | 'failed' | 'stopped' | 'submitted'
  currentStep: number
  progress: number
  score: number
  events?: Array<{ type: string; message: string; sequence: number }>
}

export interface GrowthAchievementItem {
  code: string
  name: string
  description: string
  rule: { type: string; event?: string; threshold?: number; days?: number }
  earnerCount: number
  unlocked: boolean
  unlockedAt: string | null
  progress: { current: number; target: number }
}

export const behaviorApi = {
  enroll: (courseId: string) => request(`/courses/${encodeURIComponent(courseId)}/enroll`, { method: 'POST' }),
  favorites: () => request<Array<{ targetType: FavoriteType; targetId: string }>>('/me/favorites'),
  addFavorite: (targetType: FavoriteType, targetId: string) => request('/favorites', { method: 'POST', body: JSON.stringify({ targetType, targetId }) }),
  removeFavorite: (targetType: FavoriteType, targetId: string) => request(`/favorites/${targetType}/${encodeURIComponent(targetId)}`, { method: 'DELETE' }),
  saveLessonProgress: (lessonId: string, completed: boolean, positionSeconds = 0) => request<{
    lessonId: string
    completed: boolean
    positionSeconds: number
    courseProgress: { courseId: string; completedLessons: number; totalLessons: number; percentage: number }
  }>(`/lessons/${encodeURIComponent(lessonId)}/progress`, {
    method: 'PUT',
    body: JSON.stringify({ completed, positionSeconds }),
  }),
  saveCourseNote: (courseId: string, content: string) => request(`/courses/${encodeURIComponent(courseId)}/note`, { method: 'PUT', body: JSON.stringify({ content }) }),
  saveLessonNote: (lessonId: string, content: string) => request(`/lessons/${encodeURIComponent(lessonId)}/note`, { method: 'PUT', body: JSON.stringify({ content }) }),
  activeLabRun: (labId: string) => request<LabRunDto | null>(`/labs/${encodeURIComponent(labId)}/my-active-run`),
  startLab: (labId: string) => request<LabRunDto>(`/labs/${encodeURIComponent(labId)}/runs`, { method: 'POST' }),
  actOnLab: (
    runId: string,
    action: 'run' | 'command' | 'input' | 'select_tool' | 'connect' | 'confirm' | 'submit_step' | 'stop' | 'reset',
    payload?: Record<string, unknown>,
  ) => request<LabRunDto>(`/lab-runs/${encodeURIComponent(runId)}/actions`, {
    method: 'POST',
    body: JSON.stringify({ action, payload }),
  }),
  submitLab: (runId: string) => request<LabRunDto>(`/lab-runs/${encodeURIComponent(runId)}/submit`, { method: 'POST' }),
  recordView: (targetType: 'resource' | 'article', targetSlug: string) => request<{ counted: boolean }>('/events/view', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetSlug }),
  }),
  growth: () => request<Record<string, unknown>>('/me/growth'),
  achievements: () => request<{ items: GrowthAchievementItem[] }>('/me/achievements'),
  plans: () => request<Array<Record<string, unknown>>>('/me/learning-plans'),
  addPlan: (title: string, targetDate: string) => request('/me/learning-plans', { method: 'POST', body: JSON.stringify({ title, targetDate }) }),
  updatePlan: (id: string, value: Record<string, unknown>) => request(`/me/learning-plans/${id}`, { method: 'PATCH', body: JSON.stringify(value) }),
}
