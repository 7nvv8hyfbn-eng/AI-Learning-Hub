import { request, writeRequest } from './client'
import type { AuthSessionDto, AuthUser, RegisterInput, RegistrationConfigDto } from '@ai-learning-hub/contracts'
export type StudentUser = AuthUser

export const authApi = {
  async login(identifier: string, password: string, remember = true) {
    const result = await request<{ user: StudentUser; accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password, remember }) }, false)
    sessionStorage.setItem('student-access-token', result.accessToken)
    return result.user
  },
  async logout() {
    await request('/auth/logout', { method: 'POST' }).catch(() => undefined)
    sessionStorage.removeItem('student-access-token')
  },
  me: () => request<StudentUser>('/me'),
  registrationConfig: () => request<RegistrationConfigDto>('/auth/registration-config', {}, false),
  async register(input: RegisterInput) {
    const result = await writeRequest<AuthSessionDto & { notice?: string }>('/auth/register', 'POST', input, undefined, false)
    sessionStorage.setItem('student-access-token', result.accessToken)
    if (result.notice) window.dispatchEvent(new CustomEvent('api-error', { detail: { message: result.notice } }))
    return result.user
  },
  forgotPassword: (email: string) => request<{ message: string }>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }, false),
  resetPassword: (token: string, password: string) => request('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }, false),
  verifyEmail: (token: string) => request('/auth/email/verify', { method: 'POST', body: JSON.stringify({ token }) }, false),
}
