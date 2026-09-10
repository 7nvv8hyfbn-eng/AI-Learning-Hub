<script setup lang="ts">
import CommunityAvatar from './base/CommunityAvatar.vue'
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppDialog from './base/AppDialog.vue'
import AppIcon from './base/AppIcon.vue'
import { useAuthStore } from '../stores/auth'
import { useAuthUiStore } from '../stores/authUi'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const authUi = useAuthUiStore()
const searchOpen = ref(false)
const navOpen = ref(false)
const query = ref('')
const navigation = [
  ['探索首页', '/welcome'],
  ['教程中心', '/resources'],
  ['通识基础', '/topics'],
  ['实训项目', '/labs'],
  ['AI 前沿', '/frontier'],
  ['挑战与测评', '/assessments'],
]

const submitSearch = () => {
  const value = query.value.trim()
  if (!value) return
  searchOpen.value = false
  router.push({ path: '/topics', query: { q: value } })
}
const logout = async () => {
  await auth.logout()
  await router.replace('/')
}
watch(() => route.query.login, (value) => { if (value === '1') { authUi.open({ redirect: String(route.query.redirect || route.path), reason: '登录后继续当前操作' }); const query = { ...route.query }; delete query.login; delete query.redirect; void router.replace({ query }) } }, { immediate: true })
</script>

<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <header class="app-header">
    <div class="header-inner">
      <RouterLink class="brand" to="/welcome" aria-label="AI MAKER CAMPUS 首页">
        <span class="brand-mark" aria-hidden="true">A</span>
        <span><strong>AI MAKER CAMPUS</strong><small>高校 AI 创客学习平台</small></span>
      </RouterLink>
      <nav id="main-navigation" class="main-nav" :class="{ 'mobile-open': navOpen }" aria-label="主导航">
        <RouterLink v-for="[label, path] in navigation" :key="path" :to="path" @click="navOpen = false">{{ label }}</RouterLink>
        <RouterLink class="mobile-nav-cta" to="/topics" @click="navOpen = false">开始学习</RouterLink>
      </nav>
      <div class="header-actions">
        <span v-if="auth.dataMode === 'api'" class="api-mode-badge">真实 API</span>
        <button class="icon-button" type="button" aria-label="全站搜索" @click="searchOpen = true"><AppIcon name="search" :size="18" /></button>
        <RouterLink v-if="auth.user" class="header-avatar" to="/profile" aria-label="进入个人中心"><CommunityAvatar :src="auth.user.avatarUrl" :username="auth.user.username" :name="auth.user.displayName" /></RouterLink>
        <button v-else class="button secondary small" type="button" @click="authUi.open()">登录 / 注册</button>
        <RouterLink v-if="auth.user" class="text-link" to="/community">进入学习社区</RouterLink>
        <button v-if="auth.user" class="text-link" type="button" @click="logout">退出</button>
        <RouterLink class="button primary header-cta" to="/topics">开始学习</RouterLink>
        <button class="icon-button mobile-nav-toggle" :class="{ 'close-button': navOpen }" type="button" :aria-expanded="navOpen" aria-controls="main-navigation" :aria-label="navOpen ? '关闭主导航' : '打开主导航'" @click="navOpen = !navOpen"><AppIcon :name="navOpen ? 'close' : 'menu'" :size="20" /></button>
      </div>
    </div>
  </header>
  <AppDialog v-model="searchOpen" title="搜索课程、主题和技能">
    <form class="dialog-form" @submit.prevent="submitSearch">
      <label class="sr-only" for="global-search">搜索内容</label>
      <input id="global-search" v-model="query" autofocus placeholder="例如：AI Agent" />
      <button class="button primary" type="submit">搜索学习内容</button>
    </form>
  </AppDialog>
</template>
