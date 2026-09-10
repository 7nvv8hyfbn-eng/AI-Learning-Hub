<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PublicLayout from './layouts/PublicLayout.vue'
import LandingLayout from './layouts/LandingLayout.vue'
import CommunityLayout from './layouts/CommunityLayout.vue'
import ImmersiveLabLayout from './layouts/ImmersiveLabLayout.vue'
import PageState from './components/PageState.vue'
import QuizBridgeDialog from './components/QuizBridgeDialog.vue'
import AuthDialog from './components/AuthDialog.vue'
import CommunityComposer from './community/CommunityComposer.vue'
import { AUTH_SESSION_CLEARED_EVENT, dataMode, studentSession } from './services/api/client'
import { ACCOUNT_BANNED, SESSION_REPLACED, SESSION_REPLACED_MESSAGE } from '@ai-learning-hub/contracts'
import { useAuthStore } from './stores/auth'
import { useLearningStore } from './stores/learning'
import { useAuthUiStore } from './stores/authUi'
import CommunitySkeleton from './community/CommunitySkeleton.vue'
import { useCommunityDraft } from './community/composables/useCommunityDraft'
import { preserveVisibleText, recoveryTexts } from '../../packages/contracts/browser/recovery'
import { watchVisibleSession } from '../../packages/contracts/browser/session'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const learning = useLearningStore()
const bridgeMessage = ref('')
const recoveryWarning = ref('')
const apiState = ref<'loading' | 'success' | 'error'>('success')
const apiMessage = ref('')
let hideTimer: number | undefined

const viewState = computed(() => {
  if (apiState.value !== 'success') return apiState.value
  const value = String(route.query.state || 'success')
  return ['loading', 'empty', 'error'].includes(value) ? value : 'success'
})

const showBridgeNotice = (event: Event) => {
  bridgeMessage.value = (event as CustomEvent<{ message: string }>).detail.message
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => { bridgeMessage.value = '' }, 4600)
}

const loadApi = async () => {
  if (dataMode !== 'api') return
  try {
    await auth.restore()
    if (auth.user) await learning.syncFromApi()
  } catch (error) {
    bridgeMessage.value = error instanceof Error ? error.message : '会话恢复失败'
  }
}

const showApiError = (event: Event) => {
  if (auth.sessionNotice && !auth.user) return
  bridgeMessage.value = (event as CustomEvent<{ message: string }>).detail.message
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => { bridgeMessage.value = '' }, 4600)
}

const recovery = computed(() => auth.user ? recoveryTexts('student', auth.user.id) : [])
const preserveDrafts = () => {
  if (!auth.user) return
  useCommunityDraft().preserveSession()
  try { preserveVisibleText('student', auth.user.id) } catch { recoveryWarning.value = '浏览器存储空间不足，恢复文字暂存于当前页面；请勿关闭此标签页。' }
}
const clearApiSession = (event: Event) => {
  const detail = (event as CustomEvent<{ message?: string; code?: string; hadToken?: boolean }>).detail
  const showNotice = auth.user || detail?.hadToken || detail?.code === SESSION_REPLACED
  auth.clearSession()
  auth.connectionError = ''
  if (showNotice) auth.sessionNotice = detail?.message || '登录状态已失效，请重新登录'
}
let stopSessionCheck: (() => void) | undefined
const reconnect = async () => { await auth.restore(true); if (!auth.user && auth.authState === 'anonymous') useAuthUiStore().open({ redirect: route.fullPath, reason: '登录已失效，请重新登录后继续当前页面' }) }
const layout = computed(() => route.meta.layout === 'landing' ? LandingLayout : route.meta.layout === 'immersive' ? ImmersiveLabLayout : route.meta.layout === 'community' || (route.meta.layout === 'adaptive' && auth.user) ? CommunityLayout : PublicLayout)

const retry = () => {
  if (apiState.value === 'error') {
    void loadApi()
    return
  }
  const query = { ...route.query }
  delete query.state
  router.replace({ query })
}

onMounted(() => {
  if (studentSession.ended === SESSION_REPLACED) auth.sessionNotice = SESSION_REPLACED_MESSAGE
  if (studentSession.ended === ACCOUNT_BANNED) auth.sessionNotice = '账号已被封禁，请通过账号恢复与申诉入口查看处理决定。'
  window.addEventListener('quiz-bridge', showBridgeNotice)
  window.addEventListener('api-error', showApiError)
  window.addEventListener(AUTH_SESSION_CLEARED_EVENT, clearApiSession)
  window.addEventListener('student-auth-before-clear', preserveDrafts)
  stopSessionCheck = watchVisibleSession(() => auth.checkSession())
  void loadApi()
})
onBeforeUnmount(() => {
  window.removeEventListener('quiz-bridge', showBridgeNotice)
  window.removeEventListener('api-error', showApiError)
  window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, clearApiSession)
  window.removeEventListener('student-auth-before-clear', preserveDrafts)
  stopSessionCheck?.()
  window.clearTimeout(hideTimer)
})
</script>

<template>
  <div v-if="dataMode === 'mock'" class="demo-mode-badge" role="status">演示模式 · 数据不会同步到服务器</div>
  <aside v-if="auth.sessionNotice && !auth.user" class="community-notice" role="alert"><p>{{ auth.sessionNotice }}</p><button class="button primary" @click="useAuthUiStore().open({ redirect: route.fullPath, reason: auth.sessionNotice })">重新登录</button></aside>
  <aside v-if="auth.connectionError" class="community-notice" role="status">{{ auth.connectionError }} <button @click="auth.checkSession()">重新连接</button></aside>
  <p v-if="recoveryWarning" class="community-notice" role="status">{{ recoveryWarning }}</p>
  <details v-if="recovery.length" data-session-recovery class="community-notice"><summary>本账号恢复草稿 · 尚未同步（{{ recovery.length }}）</summary><article v-for="row in recovery" :key="row.id"><p>{{ row.route }} · {{ row.savedAt }} · {{ row.status }}</p><textarea readonly :value="row.text" rows="5" aria-label="未同步恢复文字" /></article><p>可复制文字后手动继续编辑，不会自动提交。</p></details>
  <CommunitySkeleton v-if="route.meta.requiresAuth && ['idle', 'restoring'].includes(auth.authState)" />
  <section v-else-if="route.meta.requiresAuth && (!auth.user || auth.authState === 'error')" class="community-empty"><h1>{{ auth.authState === 'error' ? '连接暂时中断' : '请登录后继续' }}</h1><p>{{ auth.restoreError }}</p><button class="button primary" @click="reconnect">重新连接</button></section>
  <component :is="layout" v-else>
    <RouterView v-slot="{ Component }">
      <PageState :state="viewState" :error-message="apiMessage" @retry="retry">
        <component :is="Component" :key="auth.user?.id || 'anonymous'" />
      </PageState>
    </RouterView>
  </component>
  <QuizBridgeDialog />
  <AuthDialog />
  <CommunityComposer v-if="auth.user" />
  <div v-if="bridgeMessage" class="toast" role="status">{{ bridgeMessage }}</div>
</template>
<style scoped>
.demo-mode-badge { position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 10000; background: #fff4df; color: #73521d; border: 1px solid #e7d0a7; border-radius: 8px; padding: 5px 12px; font-size: 12px; pointer-events: none; white-space: nowrap; }
</style>
