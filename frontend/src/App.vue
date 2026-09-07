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
import { AUTH_SESSION_CLEARED_EVENT, dataMode } from './services/api/client'
import { useAuthStore } from './stores/auth'
import { useLearningStore } from './stores/learning'
import { useAuthUiStore } from './stores/authUi'
import CommunitySkeleton from './community/CommunitySkeleton.vue'
import AppIcon from './components/base/AppIcon.vue'
import { communityAvatars } from './assets/community/manifest'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const learning = useLearningStore()
const bridgeMessage = ref('')
const apiState = ref<'loading' | 'success' | 'error'>('success')
const apiMessage = ref('')
let hideTimer: number | undefined

const stackAvatars = [communityAvatars['student-male-01'], communityAvatars['student-male-02'], communityAvatars['student-female-01']]
const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

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
  void loadApi()
})
onBeforeUnmount(() => {
  window.removeEventListener('quiz-bridge', showBridgeNotice)
  window.removeEventListener('api-error', showApiError)
  window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, clearApiSession)
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
  <button class="float-publish-pill" type="button" aria-label="回到顶部" title="回到顶部" @click="scrollToTop"><span class="float-publish-arrow" aria-hidden="true"><AppIcon name="arrow-up-right" :size="16" /></span><span class="float-publish-avatars" aria-hidden="true"><img v-for="(avatar, index) in stackAvatars" :key="avatar" :src="avatar" alt="" :style="{ zIndex: 3 - index }" /></span><span class="float-publish-label">已发布</span></button>
  <CommunityComposer v-if="auth.user" />
  <div v-if="bridgeMessage" class="toast" role="status">{{ bridgeMessage }}</div>
</template>
<style scoped>
.demo-mode-badge { position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 10000; background: #fff4df; color: #73521d; border: 1px solid #e7d0a7; border-radius: 8px; padding: 5px 12px; font-size: 12px; pointer-events: none; white-space: nowrap; }
.float-publish-pill { position: fixed; right: 24px; bottom: 24px; z-index: 9999; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 18px 0 12px; background: var(--amc-orange); border: 0; border-radius: var(--amc-radius-pill); box-shadow: var(--amc-shadow-float); cursor: pointer; animation: float-publish-pulse 2.2s ease-in-out infinite; }
.float-publish-arrow { display: flex; align-items: center; justify-content: center; color: #fff; }
.float-publish-avatars { display: flex; align-items: center; padding-left: 2px; }
.float-publish-avatars img { width: 26px; height: 26px; margin-left: -8px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .18); }
.float-publish-avatars img:first-child { margin-left: 0; }
.float-publish-label { color: #fff; font-size: 14px; font-weight: 600; letter-spacing: .02em; white-space: nowrap; }
@keyframes float-publish-pulse { 0%, 100% { box-shadow: var(--amc-shadow-float); transform: translateY(0); } 50% { box-shadow: 0 16px 42px rgba(255, 77, 31, .32); transform: translateY(-3px); } }
@media (max-width: 767px) { .float-publish-pill { right: 16px; bottom: 84px; } }
</style>
