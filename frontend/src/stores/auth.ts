import { defineStore } from 'pinia'
import { authApi, type StudentUser } from '../services/api/auth'
import { ApiError, dataMode, restoreRefresh, studentSession } from '../services/api/client'
import type { AuthUser, RegisterInput, RegistrationConfigDto } from '@ai-learning-hub/contracts'
import { passwordProblem } from '@ai-learning-hub/contracts'
import { useLearningStore } from './learning'
import { useCommunityStore } from './community'
import { useAuthUiStore } from './authUi'
export type AuthState = 'idle' | 'restoring' | 'authenticated' | 'anonymous' | 'error'
const demoUser = (): AuthUser => ({ id: 'student', username: 'student', email: '', displayName: '造梦少年', roles: ['student'], permissions: [], badges: [], avatarUrl: null, school: null, major: null, onboardingCompleted: true, emailVerificationRequired: false, identityVerificationStatus: 'approved', communityWriteEnabled: true })
const demoUsername = (value: string) => {
  const username = value.trim().toLowerCase()
  if (!/^(?!_)(?!.*__)[a-z0-9_]{4,24}(?<!_)$/.test(username) || ['admin', 'administrator', 'root', 'system', 'official', 'moderator', 'support', 'api', 'www'].includes(username)) throw new Error('账号不可用，请使用4～24位字母、数字或下划线')
  return username
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as StudentUser | null,
    loading: false,
    error: '',
    dataMode,
    initialized: false,
    authState: 'idle' as AuthState, restoreError: '', lastRestoreAt: 0,
    sessionNotice: '', connectionError: '',
    restorePromise: null as Promise<void> | null,
    registrationConfig: null as RegistrationConfigDto | null,
  }),
  actions: {
    clearSession(clearAction = true) {
      if (this.user) window.dispatchEvent(new CustomEvent('student-auth-before-clear'))
      sessionStorage.removeItem('student-access-token')
      sessionStorage.removeItem('student-user')
      sessionStorage.removeItem('student-after-onboarding')
      useAuthUiStore().afterOnboardingAction = null
      if (clearAction) useAuthUiStore().action = null
      this.user = null
      this.authState = 'anonymous'
      useCommunityStore().clear()
      useLearningStore().clearAccountState()
    },
    async checkSession() {
      if (!this.user || dataMode !== 'api') return
      const generation = studentSession.generation
      try {
        const user = await authApi.me()
        if (generation !== studentSession.generation || this.user?.id !== user.id) return
        this.user.badges = user.badges
        useCommunityStore().syncAuthors([{ id: user.id, badges: user.badges }])
        this.connectionError = ''
      }
      catch (error) { if (generation !== studentSession.generation) return; if (!(error instanceof ApiError) || error.status !== 401) this.connectionError = '连接暂时异常，未提交内容已保留'; else if (!studentSession.ended) studentSession.end(error.code) }
    },
    restore(force = false): Promise<void> {
      if (this.restorePromise) return this.restorePromise
      if (!force && ['authenticated', 'anonymous'].includes(this.authState)) return Promise.resolve()
      this.authState = 'restoring'; this.restoreError = ''
      const generation = studentSession.generation
      this.restorePromise = Promise.resolve().then(async () => {
        try {
          if (dataMode === 'mock') {
            this.user = sessionStorage.getItem('community-demo-login') ? JSON.parse(localStorage.getItem('community-demo-user') || 'null') || demoUser() : null
          } else {
            if (!sessionStorage.getItem('student-access-token') && !await restoreRefresh()) { this.clearSession(); return }
            const user = await authApi.me()
            if (!user.roles.includes('student')) { await authApi.logout(); throw new ApiError('该账号不是学生账号', 401) }
            this.user = user
          }
          this.authState = this.user ? 'authenticated' : 'anonymous'; this.initialized = true
        } catch (error) {
          if (generation !== studentSession.generation) return
          if (error instanceof ApiError && error.status === 401) this.clearSession()
          else { this.authState = 'error'; this.restoreError = error instanceof Error ? error.message : '网络暂时不可用，请重新连接'; this.initialized = false }
        } finally { this.lastRestoreAt = Date.now(); this.restorePromise = null }
      })
      return this.restorePromise
    },
    async loadRegistrationConfig() {
      this.registrationConfig = dataMode === 'mock' ? { mode: 'open', emailVerification: false, agreementVersion: '2026-08-30', passwordMinLength: 12, schoolRequired: false, registrationRateWindowMinutes: 15, registrationMaxAttemptsPerIp: 120, registrationMaxAttemptsPerIdentifier: 8, registrationMaxSuccessPerIp: 30, mailAvailable: false, inviteAvailable: false } : await authApi.registrationConfig()
      return this.registrationConfig
    },
    async register(input: RegisterInput) {
      this.loading = true; this.error = ''
      try {
        const problem = passwordProblem(input.password, [input.username, input.email], this.registrationConfig?.passwordMinLength)
        if (problem) throw new Error(problem)
        if (dataMode === 'mock') {
          this.user = { ...demoUser(), username: demoUsername(input.username), displayName: input.displayName, email: input.email.trim().toLowerCase(), onboardingCompleted: false, identityVerificationStatus: 'unsubmitted', communityWriteEnabled: false }
          localStorage.setItem('community-demo-user', JSON.stringify(this.user)); sessionStorage.setItem('community-demo-login', 'true')
        } else this.user = await authApi.register(input)
        this.authState = 'authenticated'; this.initialized = true; this.sessionNotice = ''; this.connectionError = ''
        if (dataMode === 'api') void useLearningStore().syncFromApi().catch(() => window.dispatchEvent(new CustomEvent('api-error', { detail: { message: '账号已创建，学习资料暂未同步，请稍后重试' } })))
      } catch (error) { this.error = error instanceof Error ? error.message : '注册失败'; throw error }
      finally { this.loading = false }
    },
    async login(identifier: string, password: string, remember = true) {
      this.loading = true
      this.error = ''
      if (dataMode === 'api') this.clearSession(!!this.user)
      try {
        if (dataMode === 'mock') { this.user = JSON.parse(localStorage.getItem('community-demo-user') || 'null') || demoUser(); this.authState = 'authenticated'; this.initialized = true; sessionStorage.setItem('community-demo-login', 'true'); return }
        this.user = await authApi.login(identifier, password, remember)
        if (!this.user.roles.includes('student')) {
          await authApi.logout()
          this.user = null
          throw new Error('该账号不是学生账号')
        }
        sessionStorage.setItem('student-user', JSON.stringify(this.user))
        this.authState = 'authenticated'; this.initialized = true; this.sessionNotice = ''; this.connectionError = ''
      } catch (error) {
        this.error = error instanceof Error ? error.message : '登录失败'
        throw error
      } finally { this.loading = false }
    },
    async logout() {
      if (dataMode === 'api') await authApi.logout()
      sessionStorage.removeItem('community-demo-login')
      this.clearSession()
    },
  },
})
