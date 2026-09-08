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
import { AUTH_SESSION_CLEARED_EVENT, COMMUNITY_VERIFICATION_REQUIRED_EVENT, dataMode } from './services/api/client'
import { useAuthStore } from './stores/auth'
import { useLearningStore } from './stores/learning'
import { useAuthUiStore } from './stores/authUi'
import CommunitySkeleton from './community/CommunitySkeleton.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const learning = useLearningStore()
const bridgeMessage = ref('')
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
  bridgeMessage.value = (event as CustomEvent<{ message: string }>).detail.message
  window.clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => { bridgeMessage.value = '' }, 4600)
}

const clearApiSession = () => auth.clearSession()
const verificationRequired = async () => { await auth.restore(true); await router.push('/community/verification') }
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
  window.addEventListener('quiz-bridge', showBridgeNotice)
  window.addEventListener('api-error', showApiError)
  window.addEventListener(AUTH_SESSION_CLEARED_EVENT, clearApiSession)
  window.addEventListener(COMMUNITY_VERIFICATION_REQUIRED_EVENT, verificationRequired)
  void loadApi()
})
onBeforeUnmount(() => {
  window.removeEventListener('quiz-bridge', showBridgeNotice)
  window.removeEventListener('api-error', showApiError)
  window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, clearApiSession)
  window.removeEventListener(COMMUNITY_VERIFICATION_REQUIRED_EVENT, verificationRequired)
  window.clearTimeout(hideTimer)
})
</script>

<template>
  <div v-if="dataMode === 'mock'" class="demo-mode-badge" role="status">演示模式 · 数据不会同步到服务器</div>
  <CommunitySkeleton v-if="route.meta.requiresAuth && ['idle', 'restoring'].includes(auth.authState)" />
  <section v-else-if="route.meta.requiresAuth && (!auth.user || auth.authState === 'error')" class="community-empty"><h1>{{ auth.authState === 'error' ? '连接暂时中断' : '请登录后继续' }}</h1><p>{{ auth.restoreError }}</p><button class="button primary" @click="reconnect">重新连接</button></section>
  <component :is="layout" v-else>
    <RouterView v-slot="{ Component }">
      <PageState :state="viewState" :error-message="apiMessage" @retry="retry">
        <component :is="Component" />
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
