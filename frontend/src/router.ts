import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useAuthUiStore } from './stores/authUi'

declare module 'vue-router' {
  interface RouteMeta { layout?: 'public' | 'landing' | 'adaptive' | 'community' | 'immersive'; communityMode?: 'feed' | 'wide'; requiresAuth?: boolean; title?: string }
}

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to, _from, saved) => to.meta.layout === 'community' || (to.meta.layout === 'adaptive' && useAuthStore().user) ? false : saved || { top: 0 },
  routes: [
    { path: '/community/governance', component: () => import('./community/CommunityGovernanceView.vue'), meta: { title: '处理与申诉', layout: 'community', communityMode: 'wide', requiresAuth: true } },
    { path: '/account-recovery', component: () => import('./community/CommunityGovernanceView.vue'), meta: { title: '账号恢复与申诉', layout: 'public', requiresAuth: false } },
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: 'AI 创客社区', layout: 'landing', requiresAuth: false } },
    { path: '/welcome', name: 'welcome', component: () => import('./views/HomeView.vue'), meta: { title: 'AI 创客社区', layout: 'landing', requiresAuth: false } },
    { path: '/community', component: () => import('./community/CommunityFeedView.vue'), meta: { title: '学习社区', requiresAuth: true, layout: 'community', communityMode: 'feed' } },
    { path: '/community/post/:postId', component: () => import('./community/CommunityPostView.vue'), meta: { title: '学习讨论', requiresAuth: true, layout: 'community', communityMode: 'feed' } },
    { path: '/community/topic/:slug', component: () => import('./community/CommunityCollectionView.vue'), meta: { title: '学习话题', communityView: 'topic', requiresAuth: true, layout: 'community', communityMode: 'feed' } },
    { path: '/community/user/:username', component: () => import('./community/CommunityProfileView.vue'), meta: { title: '社区主页', requiresAuth: true, layout: 'community', communityMode: 'feed' } },
    { path: '/community/search', component: () => import('./community/CommunitySearchView.vue'), meta: { title: '社区搜索', requiresAuth: true, layout: 'community', communityMode: 'wide' } },
    { path: '/community/drafts', component: () => import('./community/CommunityDraftsView.vue'), meta: { title: '草稿箱', requiresAuth: true, layout: 'community', communityMode: 'wide' } },
    { path: '/community/verification', component: () => import('./community/CommunityVerificationView.vue'), meta: { title: '校园实名认证', requiresAuth: true, layout: 'community', communityMode: 'wide' } },
    { path: '/community/onboarding', component: () => import('./community/CommunityOnboardingView.vue'), meta: { title: '开始学习', requiresAuth: true, layout: 'public' } },
    { path: '/bookmarks', component: () => import('./community/CommunityCollectionView.vue'), meta: { title: '收藏与笔记', communityView: 'bookmarks', requiresAuth: true, layout: 'community', communityMode: 'wide' } },
    { path: '/notifications', component: () => import('./community/NotificationsView.vue'), meta: { title: '消息通知', requiresAuth: true, layout: 'community', communityMode: 'wide' } },
    { path: '/__homepage-preview', name: 'homepage-preview', component: () => import('./views/HomepagePreviewView.vue'), meta: { title: '落地页草稿预览', layout: 'landing', requiresAuth: false } },
    { path: '/topics', name: 'topics', component: () => import('./views/TopicsView.vue'), meta: { title: '通识基础', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/courses/:courseId', name: 'course', component: () => import('./views/CourseView.vue'), meta: { title: '课程学习', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/labs', name: 'labs', component: () => import('./views/LabsView.vue'), meta: { title: '实训项目', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/labs/:labId', name: 'lab', component: () => import('./views/LabWorkspaceView.vue'), meta: { title: '实训工作台', dark: true, layout: 'immersive', requiresAuth: true } },
    { path: '/resources', name: 'resources', component: () => import('./views/ResourcesView.vue'), meta: { title: '教程中心', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/resources/watch/:postId', name: 'resource-watch', component: () => import('./views/ResourceDetailView.vue'), meta: { title: '观看资源', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/resources/read/:postId', name: 'resource-read', component: () => import('./views/ResourceDetailView.vue'), meta: { title: '阅读资源', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/resources/collections/:collectionId', name: 'resource-collection', component: () => import('./views/ResourceCollectionView.vue'), meta: { title: '学习合集', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/resources/studio', name: 'resource-studio', component: () => import('./views/ResourceStudioView.vue'), meta: { title: '资源创作中心', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/frontier', name: 'frontier', component: () => import('./views/FrontierView.vue'), meta: { title: 'AI 前沿', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/assessments', name: 'assessments', component: () => import('./views/AssessmentsView.vue'), meta: { title: '挑战与测评', layout: 'adaptive', requiresAuth: true, communityMode: 'wide' } },
    { path: '/profile', name: 'profile', component: () => import('./views/ProfileView.vue'), meta: { title: '个人中心', layout: 'community', requiresAuth: true, communityMode: 'wide' } },
    { path: '/terms', component: () => import('./views/LegalView.vue'), meta: { title: '用户协议', layout: 'public', requiresAuth: false } },
    { path: '/privacy', component: () => import('./views/LegalView.vue'), meta: { title: '隐私政策', layout: 'public', requiresAuth: false } },
    { path: '/reset-password', component: () => import('./views/AccountRecoveryView.vue'), meta: { title: '重置密码', layout: 'public', requiresAuth: false } },
    { path: '/verify-email', component: () => import('./views/AccountRecoveryView.vue'), meta: { title: '验证邮箱', layout: 'public', requiresAuth: false } },
    { path: '/:pathMatch(.*)*', redirect: '/', meta: { title: '页面不存在', layout: 'public', requiresAuth: false } },
  ],
})

router.beforeEach(async (to, from) => {
  const auth = useAuthStore()
  await auth.restore()
  if (to.path === '/' && auth.user) return '/community'
  if (to.meta.requiresAuth && !auth.user && auth.authState !== 'error') {
    useAuthUiStore().open({ redirect: to.fullPath, reason: to.path.startsWith('/labs/') ? '登录后可进入实训工作台' : '登录后可进入学习社区' })
    return from.matched.length ? false : { path: '/welcome' }
  }
})

router.afterEach((to) => {
  document.title = `${String(to.meta.title)}｜AI数智化学习平台`
})

export default router
