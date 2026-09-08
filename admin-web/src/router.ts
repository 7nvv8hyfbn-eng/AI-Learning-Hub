import { createRouter, createWebHistory } from 'vue-router'
import AdminLayout from './components/AdminLayout.vue'
import { useSessionStore } from './stores/session'
import { visibleAdminNavigation } from './navigation'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true, title: '登录' } },
    {
      path: '/',
      component: AdminLayout,
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: () => import('./views/DashboardView.vue'), meta: { title: '数据看板', permission: 'dashboard.read' } },
        { path: 'community', component: () => import('./views/CommunityView.vue'), meta: { title: '社区运营', permission: 'community.read' } },
        { path: 'homepage', component: () => import('./views/HomepageView.vue'), meta: { title: '门户落地页', permission: 'homepage.read' } },
        { path: 'themes', component: () => import('./views/management/ThemeManagementView.vue'), meta: { title: '通识基础管理', permission: 'theme.read' } },
        { path: 'courses', component: () => import('./views/management/CourseManagementView.vue'), meta: { title: '课程内容管理', permission: 'course.read' } },
        { path: 'labs', component: () => import('./views/management/LabManagementView.vue'), meta: { title: '实训项目管理', permission: 'lab.read' } },
        { path: 'resources', component: () => import('./views/management/ResourceManagementView.vue'), meta: { title: '教程中心管理', permission: 'resource.read' } },
        { path: 'media', component: () => import('./views/MediaLibraryView.vue'), meta: { title: '素材库', permission: 'media.read' } },
        { path: 'articles', component: () => import('./views/management/ArticleManagementView.vue'), meta: { title: 'AI 前沿管理', permission: 'article.read' } },
        { path: 'challenges', component: () => import('./views/management/ChallengeManagementView.vue'), meta: { title: '挑战测评管理', permission: 'challenge.read' } },
        { path: 'growth', component: () => import('./views/GrowthView.vue'), meta: { title: '用户成长管理', permission: 'growth.read' } },
        { path: 'users', component: () => import('./views/UsersView.vue'), meta: { title: '用户与账号', permission: 'user.read' } },
        { path: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '系统设置', permission: 'settings.read' } },
        { path: 'search', component: () => import('./views/GlobalSearchView.vue'), meta: { title: '全局搜索' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach(async (to) => {
  document.title = `${String(to.meta.title || '管理后台')}｜AI数智化学习平台`
  const session = useSessionStore()
  if (!session.initialized) await session.restore()
  const landing = visibleAdminNavigation(session.user?.permissions || [])[0]?.items[0]?.[2] || '/search'
  if (!to.meta.public && !session.user) return { path: '/login', query: { redirect: to.fullPath } }
  if (!to.meta.public && to.meta.permission && !session.user?.permissions.includes(String(to.meta.permission))) return landing
  if (to.path === '/login' && session.user) return landing
})

export default router
