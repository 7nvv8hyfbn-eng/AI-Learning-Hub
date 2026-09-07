<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityHomeIcon from '../components/base/CommunityHomeIcon.vue'
import { booksSortingIcon, treasureChestIcon } from '../assets/community/manifest'
import AppDialog from '../components/base/AppDialog.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import { communityArt } from '../assets/community/manifest'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../services/api/community'
import { communityNavigation, communityNavActive } from '../community/labels'
import CommunityRightRail from '../community/CommunityRightRail.vue'
import CommunityPostMenu from '../community/CommunityPostMenu.vue'
import { provideCommunityScrollRoot } from '../community/composables/useCommunityScrollRoot'
const auth = useAuthStore(), store = useCommunityStore(), router = useRouter(), route = useRoute()
const collapsed = ref(false), menuOpen = ref(false)
const mainScroll = provideCommunityScrollRoot()
const wide = computed(() => route.meta.communityMode === 'wide')
const profileRoute = computed(() => `/community/user/${auth.user?.username}`)
const groups = [
  { label: '发现与学习', items: communityNavigation.filter((item) => !['/profile', '/bookmarks', '/notifications', '/community/drafts'].includes(item.path)) },
  { label: '个人', items: communityNavigation.filter((item) => ['/profile', '/bookmarks', '/notifications', '/community/drafts'].includes(item.path)) },
]
watch(collapsed, (value) => { try { localStorage.setItem('community-sidebar-collapsed', String(value)) } catch { /* 隐私模式仍可使用当前选择。 */ } })
let polling: number | undefined
const loadUnread = async () => { if (document.visibilityState !== 'visible') return; const epoch = store.epoch; try { const result = await communityApi.unread(); if (epoch === store.epoch) store.unread = result.count } catch { /* 内容区保留可重试错误，不中断正在阅读的页面。 */ } }
const logout = async () => { await auth.logout(); await router.replace('/') }
onMounted(() => { try { collapsed.value = localStorage.getItem('community-sidebar-collapsed') === 'true' } catch { /* 不要求浏览器允许持久存储。 */ }; void store.loadContext(auth.user?.id).catch((error: Error) => { store.error = error.message }); void loadUnread(); polling = window.setInterval(loadUnread, 60000) })
onBeforeUnmount(() => window.clearInterval(polling))
</script>
<template>
  <div class="community-shell" :class="{ 'sidebar-collapsed': collapsed, 'community-wide': wide }">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside class="community-sidebar">
      <RouterLink class="brand community-brand" to="/community"><span class="brand-mark">A</span><span class="nav-label"><strong>AI MAKER CAMPUS</strong><small>高校 AI 创客学习平台</small></span></RouterLink>
      <button class="sidebar-collapse icon-button" type="button" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" @click="collapsed = !collapsed"><AppIcon name="menu" :size="20" /></button>
      <nav class="community-sidebar-nav" aria-label="学习社区导航"><section v-for="group in groups" :key="group.label" class="community-nav-group"><h2 class="nav-label">{{ group.label }}</h2><RouterLink v-for="item in group.items" :key="item.path" :to="item.path" :title="item.label" :class="{ active: communityNavActive(route.path, item.path) }" :aria-current="communityNavActive(route.path, item.path) ? 'page' : undefined"><CommunityHomeIcon v-if="item.path === '/community'" :size="21" /><img v-else-if="item.path === '/labs'" class="app-icon nav-custom-icon" :src="booksSortingIcon" width="21" height="21" alt="" /><AppIcon v-else :name="item.icon" :size="21" /><span class="nav-label">{{ item.label }}</span><b v-if="item.path === '/notifications' && store.unread" class="notification-count">{{ store.unread }}</b></RouterLink></section></nav>
      <button class="button primary community-publish" type="button" title="发布内容" @click="store.openComposer()"><AppIcon name="plus" :size="20" /><span class="nav-label">发布内容</span></button>
      <div class="community-account">
        <CommunityPostMenu label="账户菜单"><template #trigger><CommunityAvatar :src="auth.user?.avatarUrl" :username="auth.user?.username" :name="auth.user?.displayName || '学习者'" /><span class="nav-label"><strong>{{ auth.user?.displayName }}</strong><small>{{ auth.dataMode === 'mock' ? '显式演示模式' : '统一学习账号' }}</small></span><AppIcon class="nav-label account-more" name="more-circle" :size="18" /></template><RouterLink :to="profileRoute" role="menuitem">个人主页</RouterLink><RouterLink :to="`${profileRoute}?settings=1`" role="menuitem">账号设置</RouterLink><button type="button" role="menuitem" @click="logout">退出登录</button></CommunityPostMenu>
        <RouterLink class="text-link nav-label portal-link" to="/welcome">查看品牌门户 <AppIcon name="arrow-right" :size="14" /></RouterLink>
      </div>
      <img v-bind="communityArt.sidebarPlanet" class="sidebar-decoration" alt="" loading="lazy" />
    </aside>
    <header class="community-mobile-header"><RouterLink class="brand" to="/community"><span class="brand-mark">A</span><strong>AI MAKER CAMPUS</strong></RouterLink><button class="icon-button" aria-label="更多功能" @click="menuOpen = true"><AppIcon name="menu" /></button></header>
    <main id="main-content" ref="mainScroll" class="community-main" tabindex="-1"><slot /></main>
    <CommunityRightRail v-if="!wide" />
    <nav class="community-bottom-nav" aria-label="移动主导航"><RouterLink v-for="item in communityNavigation.filter((item) => item.mobile).sort((a, b) => a.mobileOrder - b.mobileOrder)" :key="item.path" :to="item.path" :class="{ active: communityNavActive(route.path, item.path) }" :style="{ order: item.mobileOrder }"><AppIcon :name="item.icon" :size="21" /><span>{{ item.label.replace('首页', '').replace('主题', '').replace('项目', '').replace('消息', '').replace('成长', '') }}</span></RouterLink><button class="mobile-publish-button" @click="store.openComposer()"><AppIcon name="plus" :size="24" /><span>发布</span></button></nav>
    <AppDialog v-model="menuOpen" title="学习社区"><nav class="community-more"><RouterLink v-for="item in communityNavigation" :key="item.path" :to="item.path" @click="menuOpen = false">{{ item.label }}</RouterLink><RouterLink to="/welcome" @click="menuOpen = false">品牌门户</RouterLink><button class="text-link" @click="logout">退出登录</button></nav></AppDialog>
    <button class="community-floating-publish" aria-label="快捷发布" @click="store.openComposer()"><AppIcon name="plus" /></button>
  </div>
</template>
