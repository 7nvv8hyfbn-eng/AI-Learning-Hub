import type { AdminIdentityVerificationDto, AdminUserDetailDto, AdminUserQueryDto, AdminUserSummaryDto, AdminUserUpdateInput, IdentityReviewInput, PageResult } from '@ai-learning-hub/contracts'
import { api } from './api'
export const userQueryString = (query: object) => new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)])).toString()
export const usersApi = {
  list: (query: AdminUserQueryDto) => api<PageResult<AdminUserSummaryDto>>(`/admin/users?${userQueryString(query)}`),
  detail: (id: string) => api<AdminUserDetailDto>(`/admin/users/${id}`),
  verification: (id: string) => api<AdminIdentityVerificationDto>(`/admin/users/${id}/verification`),
  reviewVerification: (id: string, action: 'approve' | 'reject' | 'revoke', input: IdentityReviewInput) => api<{ updated: boolean }>(`/admin/users/${id}/verification/${action}`, { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: AdminUserUpdateInput) => api<AdminUserDetailDto>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  action: (id: string, action: string, reason: string, expectedRevision: number) => api(`/admin/users/${id}/${['active', 'disabled', 'locked'].includes(action) ? 'status' : action}`, { method: ['active', 'disabled', 'locked'].includes(action) ? 'PATCH' : 'POST', body: JSON.stringify(['active', 'disabled', 'locked'].includes(action) ? { status: action, reason, expectedRevision } : { reason }) }),
  export: (query: AdminUserQueryDto) => api<PageResult<AdminUserSummaryDto>>(`/admin/users/export?${userQueryString(query)}`),
  options: () => api<{ schools: Array<{ id: string; name: string; departments: Array<{ id: string; name: string }> }>; roles: Array<{ code: string; name: string }> }>('/admin/users/options'),
}
