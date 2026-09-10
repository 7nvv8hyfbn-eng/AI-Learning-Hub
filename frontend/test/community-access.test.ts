// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { communityOperations } from '@ai-learning-hub/contracts'
import { useCommunityAccess } from '../src/community/composables/useCommunityAccess'
import { useCommunityStore } from '../src/stores/community'
import { ApiError, request, studentSession } from '../src/services/api/client'

const actor = vi.hoisted(() => ({ user: { id: 'readonly-student', communityWriteEnabled: false, identityVerificationStatus: 'unsubmitted' } }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => actor }))
vi.mock('../src/services/api/community', () => ({ communityApi: {} }))

beforeEach(() => {
  setActivePinia(createPinia()); actor.user.communityWriteEnabled = false
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('未认证浏览与主动认证提示', () => {
  it('资格未加载时read允许，所有公开写操作受限；服务端具体限制优先', () => {
    const access = useCommunityAccess(), store = useCommunityStore()
    expect(access.decision('read')).toMatchObject({ allowed: true, reasonCode: null })
    for (const operation of communityOperations.filter(value => value !== 'read')) expect(access.decision(operation)).toMatchObject({ allowed: false, reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED' })
    actor.user.communityWriteEnabled = true
    expect(access.decision('interaction').allowed).toBe(true)
    store.eligibility = { operations: { read: { allowed: false, reasonCode: 'ACCOUNT_UNAVAILABLE' } } } as never
    expect(access.decision('read')).toMatchObject({ allowed: false, reasonCode: 'ACCOUNT_UNAVAILABLE' })
  })
  it('点击写操作只设置提示，继续浏览可关闭；不派发全局跳转事件', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent'), access = useCommunityAccess(), store = useCommunityStore()
    expect(access.requireWrite('interaction')).toBe(false)
    expect(store.accessNotice).toMatchObject({ reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED', nextAction: { label: '前往认证', route: '/community/verification' } })
    expect(dispatch).not.toHaveBeenCalled()
    store.accessNotice = null
    expect(access.requireWrite('read')).toBe(true)
    expect(store.accessNotice).toBeNull()
  })
  it('全部新建发布入口统一拦截，已认证发帖及私有草稿恢复继续可用', () => {
    const store = useCommunityStore()
    store.openComposer()
    expect(store.composerOpen).toBe(false)
    expect(store.accessNotice?.reasonCode).toBe('COMMUNITY_VERIFICATION_REQUIRED')
    store.openComposer({ contribution: { kind: 'video', tags: [], teachingReuseConsent: false } })
    expect(store.composerOpen).toBe(false)
    actor.user.communityWriteEnabled = true; store.openComposer()
    expect(store.composerOpen).toBe(true)
    store.clear(); actor.user.communityWriteEnabled = false
    store.openComposer({ status: 'draft' }, 'own-draft', { intent: 'restore' })
    expect(store.composerOpen).toBe(true)
  })
  it('请求403保留ApiError全部引导字段，不派发事件或结束登录会话', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent'), end = vi.spyOn(studentSession, 'end')
    const payload = { code: 40301, errorCode: 'COMMUNITY_VERIFICATION_REQUIRED', message: '完成校园实名认证后即可参与社区互动。', nextAction: { label: '前往认证', route: '/community/verification' }, data: null }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 403, headers: { 'content-type': 'application/json' } })))
    const error = await request('/community/users/synthetic/follow', { method: 'PUT' }).catch(error => error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, code: payload.errorCode, message: payload.message, nextAction: payload.nextAction })
    expect(dispatch).not.toHaveBeenCalled(); expect(end).not.toHaveBeenCalled()
  })
})
