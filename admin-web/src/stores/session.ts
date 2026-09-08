import { defineStore } from 'pinia'
import { api } from '../services/api'

import type { AuthUser as AdminUser } from '@ai-learning-hub/contracts'

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: null as AdminUser | null,
    initialized: false,
    loading: false,
    error: '',
  }),
  actions: {
    async restore() {
      try {
        const user = await api<AdminUser>('/me')
        this.user = user.permissions.length ? user : null
      } catch {
        this.user = null
        sessionStorage.removeItem('admin-access-token')
      } finally {
        this.initialized = true
      }
    },
    async login(identifier: string, password: string) {
      this.loading = true
      this.error = ''
      try {
        const result = await api<{ user: AdminUser; accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) }, false)
        if (!result.user.permissions.length) throw new Error('该账号没有管理后台权限')
        this.user = result.user
        sessionStorage.setItem('admin-user', JSON.stringify(result.user))
        sessionStorage.setItem('admin-access-token', result.accessToken)
      } catch (error) {
        this.error = error instanceof Error ? error.message : '登录失败'
        throw error
      } finally {
        this.loading = false
        this.initialized = true
      }
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
      this.user = null
      sessionStorage.removeItem('admin-user')
      sessionStorage.removeItem('admin-access-token')
    },
  },
})
