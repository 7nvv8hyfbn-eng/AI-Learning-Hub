<script setup lang="ts">
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityProfileDto } from '@ai-learning-hub/contracts'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { userProfile, assessmentAchievements } from '../data/mock'
import PageHeroArt from '../components/PageHeroArt.vue'
import CategoryCover from '../components/base/CategoryCover.vue'
import { dataMode } from '../services/api/client'
import { communityApi } from '../services/api/community'
import { useAuthStore } from '../stores/auth'
import { useArticlesStore } from '../stores/content/articles'
import { useCoursesStore } from '../stores/content/courses'
import { useLabsStore } from '../stores/content/labs'
import { useResourcesStore } from '../stores/content/resources'
import { useLearningStore } from '../stores/learning'

const store = useLearningStore()
const auth = useAuthStore()
const router = useRouter()
const communityProfile = ref<CommunityProfileDto | null>(null)
const courseStore = useCoursesStore()
const labStore = useLabsStore()
const resourceStore = useResourcesStore()
const articleStore = useArticlesStore()
const { items: courses } = storeToRefs(courseStore)
const { items: labs } = storeToRefs(labStore)
const { items: resources } = storeToRefs(resourceStore)
const { items: articles } = storeToRefs(articleStore)
const displayName = computed(() => communityProfile.value?.displayName || auth.user?.displayName || '学习者')
const accountDataReady = computed(() => dataMode === 'mock' || store.accountSyncState === 'synced')
const accountDataMessage = computed(() => {
  if (!auth.user) return '登录后查看账号学习数据。'
  return store.accountSyncState === 'sync-error' ? '账号学习数据暂不可用。' : '正在同步账号学习数据…'
})
const planOpen = ref(false)
const badgeOpen = ref('')
const favoriteTab = ref('全部')
const planName = ref('')
const planDate = ref('')
const favoriteItems = computed(() => {
  const all = [
    ...courses.value.map((item) => ({ ...item, type: '课程', favoriteType: 'course' as const, date: '' })),
    ...labs.value.map((item) => ({ ...item, type: '实验', favoriteType: 'lab' as const, date: '' })),
    ...resources.value.map((item) => ({ ...item, type: '资源', favoriteType: 'resource' as const, date: item.updatedAt })),
    ...articles.value.map((item) => ({ ...item, type: '文章', favoriteType: 'article' as const, date: item.publishedAt })),
  ].filter((item) => store.isFavorite(item.favoriteType, item.id))
  return favoriteTab.value === '全部' ? all : all.filter((item) => item.type === favoriteTab.value)
})
const completedCourses = computed(() => Object.values(store.courseProgress).filter((progress) => progress === 100).length)
const completedLabs = computed(() => store.submittedLabs.length)
const recentCourses = computed(() => store.recentCourses.map((id) => courses.value.find((course) => course.id === id)).filter((course): course is NonNullable<typeof course> => !!course))
const recentLabs = computed(() => store.recentLabs.map((id) => labs.value.find((lab) => lab.id === id)).filter((lab): lab is NonNullable<typeof lab> => !!lab))
const overviewRows = computed(() => [
  ['最近课程', accountDataReady.value ? `${store.recentCourses.length} 门` : '—'],
  ['完成课程', accountDataReady.value ? `${completedCourses.value} 门` : '—'],
  ['完成实验', accountDataReady.value ? `${completedLabs.value} 个` : '—'],
  ['收藏内容', accountDataReady.value ? `${store.favorites.length} 项` : '—'],
  ['学习计划', accountDataReady.value ? `${store.plans.length} 个` : '—'],
  ['测评入口', accountDataReady.value ? `${store.assessmentRecords.length} 次` : '—'],
])
const abilities = [
  ['AI 工程实践', 76, '#ff4d1f'], ['数据理解与处理', 64, '#27b86b'], ['模型应用', 82, '#6e5bff'],
  ['AI 创新与设计', 58, '#e5a91d'], ['编程与工具', 74, '#3478f6'], ['AI 素养与伦理', 69, '#27b86b'],
]
const badges = assessmentAchievements
const openEdit = () => router.push(`/community/user/${auth.user?.username}?settings=1`)
const createPlan = async () => {
  if (!planName.value.trim() || !planDate.value) return
  if (!await store.addPlan({
    id: `plan-${Date.now()}`,
    name: planName.value.trim(),
    targetDate: planDate.value,
    status: '进行中',
  })) return
  planName.value = ''
  planDate.value = ''
  planOpen.value = false
}
onMounted(() => {
  void Promise.all([
    courseStore.load(), labStore.load(), resourceStore.load(), articleStore.load(),
    auth.user ? communityApi.profile(auth.user.username).then((profile) => { communityProfile.value = profile }) : Promise.resolve(),
  ])
})
</script>

<template>
  <nav class="community-profile-links"><RouterLink :to="`/community/user/${auth.user?.username}`">我的社区主页</RouterLink><RouterLink :to="`/community/user/${auth.user?.username}?tab=topics`">关注的话题</RouterLink><RouterLink :to="`/community/user/${auth.user?.username}?tab=following`">关注的人</RouterLink><RouterLink to="/bookmarks">我的收藏与笔记</RouterLink><RouterLink to="/notifications">社区通知</RouterLink></nav>
  <div class="page-container profile-page">
    <section class="profile-hero">
      <PageHeroArt visual-key="profileHeroAssetId" />
      <div class="profile-user"><CommunityAvatar :src="auth.user?.avatarUrl" :username="auth.user?.username" :name="displayName" size="lg" /><div><h1>{{ displayName }} <small>{{ dataMode === 'api' ? '统一学习账号' : '高校认证' }}</small></h1><p>{{ dataMode === 'api' ? (auth.user?.email || '尚未登录') : userProfile.program }}</p><span>{{ communityProfile ? (communityProfile.bio || '还没有填写个人介绍。') : '正在读取社区资料…' }}</span><div class="hero-actions"><button class="button secondary small" type="button" @click="openEdit">编辑资料</button></div></div></div>
      <div class="profile-level"><div><strong>{{ dataMode === 'api' ? '等级 —' : `Lv.${userProfile.level}` }}</strong><span>{{ dataMode === 'api' ? '等级规则尚未配置' : '离下一等级还差 1200 经验值' }}</span></div><ProgressBar v-if="dataMode === 'mock'" :value="82" /><span v-else>等级进度 —</span><div class="profile-kpis"><span><strong>{{ dataMode === 'api' ? '—' : userProfile.streak }}</strong>连续学习/天</span><span><strong>{{ dataMode === 'api' ? '—' : `${userProfile.weeklyHours}h` }}</strong>本周学习</span><span><strong>{{ dataMode === 'api' ? (accountDataReady ? (store.serverGrowth?.points ?? 0) : '—') : userProfile.points }}</strong>成就点</span></div></div>
    </section>
    <section><div class="section-heading"><h2>学习总览</h2><RouterLink to="/assessments">学习数据详情 <AppIcon name="arrow-right" :size="15" /></RouterLink></div><p v-if="!accountDataReady" class="notice">{{ accountDataMessage }}</p><div class="stat-row six"><article v-for="[label, value] in overviewRows" :key="label"><strong>{{ value }}</strong><span>{{ label }}</span></article></div></section>
    <section v-if="dataMode === 'mock'"><div class="section-heading"><h2>我的 AI 能力卡</h2></div><div class="capability-layout"><div class="ability-profile-grid"><article v-for="[title, value, color] in abilities" :key="title"><span class="direction-icon"><AppIcon name="growth" :size="22" /></span><div><h3>{{ title }}</h3><small>Lv.{{ Math.ceil(Number(value) / 20) }} · 进阶者</small><div class="mini-progress"><i :style="{ width: `${value}%`, background: String(color) }" /></div></div></article></div><aside class="radar-card"><h3>综合能力雷达</h3><svg viewBox="0 0 220 200" role="img" aria-label="我的能力与同级平均能力雷达图"><polygon points="110,18 190,65 180,155 110,188 40,155 30,65" fill="none" stroke="#e6e2de" /><polygon points="110,52 160,79 152,134 109,157 64,134 60,80" fill="rgba(110,91,255,.08)" stroke="#6e5bff" stroke-width="2" stroke-dasharray="5 5" /><polygon points="110,42 168,75 160,140 108,165 57,138 53,75" fill="rgba(255,77,31,.18)" stroke="#ff4d1f" stroke-width="3" /><line v-for="point in ['110,18', '190,65', '180,155', '110,188', '40,155', '30,65']" :key="point" x1="110" y1="100" :x2="point.split(',')[0]" :y2="point.split(',')[1]" stroke="#eee" /></svg><div class="radar-legend"><span><i class="mine" />我的能力</span><span><i class="average" />同级平均</span></div><p>综合能力评级：<strong>进阶者</strong></p><span>超过本校 86% 的同学</span></aside></div></section>
    <section><div class="section-heading"><h2>我的徽章墙</h2><button v-if="dataMode === 'mock'" class="text-link" type="button" @click="badgeOpen = '全部徽章'">查看全部（{{ badges.length }}）<AppIcon name="arrow-right" :size="15" /></button></div><div v-if="dataMode === 'mock'" class="badge-wall"><button v-for="badge in badges" :key="badge.title" type="button" :class="{ locked: !badge.unlocked }" @click="badgeOpen = badge.title"><span><AppIcon :name="badge.icon" :size="32" /></span><strong>{{ badge.title }}</strong><small>{{ badge.unlocked ? '已获得' : '保持学习解锁' }}</small></button></div><p v-else-if="accountDataReady" class="notice">服务端已记录 {{ store.serverGrowth?.achievements ?? 0 }} 枚成就、{{ store.serverGrowth?.certificates ?? 0 }} 份证书。</p><p v-else class="notice">{{ accountDataMessage }}</p></section>
    <div class="profile-two-column">
      <section><div class="section-heading"><h2>最近学习课程</h2><RouterLink to="/topics">全部课程 <AppIcon name="arrow-right" :size="15" /></RouterLink></div><p v-if="!accountDataReady" class="notice">{{ accountDataMessage }}</p><div v-else-if="recentCourses.length" class="record-list"><article v-for="course in recentCourses" :key="course.id"><CategoryCover class="record-cover" :title="course.title" :media="course" /><div><strong>{{ course.title }}</strong><small>{{ course.hours }} 小时 · {{ dataMode === 'api' ? '账号学习记录' : '本地学习记录' }}</small><ProgressBar :value="store.courseProgress[course.id] || 0" /></div><RouterLink class="button primary small" :to="`/courses/${course.id}`">继续学习</RouterLink></article></div><p v-else>暂无最近学习课程。</p></section>
      <section><div class="section-heading"><h2>实践记录</h2><RouterLink to="/labs">全部实验 <AppIcon name="arrow-right" :size="15" /></RouterLink></div><p v-if="!accountDataReady" class="notice">{{ accountDataMessage }}</p><div v-else-if="recentLabs.length" class="record-list"><article v-for="lab in recentLabs" :key="lab.id"><CategoryCover class="record-cover" :title="lab.title" :media="lab" /><div><strong>{{ lab.title }}</strong><small>完成度 {{ store.labProgress[lab.id] || 0 }}% · {{ dataMode === 'api' ? '账号实践记录' : '本地演示记录' }}</small><ProgressBar :value="store.labProgress[lab.id] || 0" /></div><RouterLink class="button primary small" :to="`/labs/${lab.id}`">进入实验</RouterLink></article></div><p v-else>暂无实践记录。</p></section>
    </div>
    <div class="profile-two-column">
      <section class="favorites-panel"><div class="section-heading"><h2>我的收藏</h2></div><p v-if="!accountDataReady" class="notice">{{ accountDataMessage }}</p><template v-else><div class="compact-tabs"><button v-for="tab in ['全部', '课程', '实验', '资源', '文章']" :key="tab" type="button" :class="{ active: favoriteTab === tab }" @click="favoriteTab = tab">{{ tab }}</button></div><div v-if="favoriteItems.length" class="favorite-list"><div v-for="item in favoriteItems" :key="`${item.favoriteType}-${item.id}`"><CategoryCover class="record-cover" :title="item.title" :media="item" /><span class="tag">{{ item.type }}</span><strong>{{ item.title }}</strong><small>收藏于 {{ item.date }}</small><button type="button" @click="store.toggleFavorite(item.favoriteType, item.id)">取消收藏</button></div></div><div v-else class="inline-empty small-empty"><p>暂无收藏内容。</p><RouterLink to="/topics">去发现课程 <AppIcon name="arrow-right" :size="15" /></RouterLink></div></template></section>
      <section class="plan-card"><div class="section-heading"><h2>学习计划</h2><button v-if="accountDataReady" class="text-link" type="button" @click="planOpen = true">创建计划 <AppIcon name="arrow-right" :size="15" /></button></div><p v-if="!accountDataReady" class="notice">{{ accountDataMessage }}</p><div v-else-if="store.plans.length" class="plan-list"><article v-for="plan in store.plans" :key="plan.id"><span class="tag green">{{ plan.status }}</span><h3>{{ plan.name }}</h3><p>目标日期：{{ plan.targetDate }}</p><button class="button secondary small" type="button" @click="store.togglePlan(plan.id)">{{ plan.status === '进行中' ? '标记完成' : '恢复进行中' }}</button></article></div><div v-else class="inline-empty small-empty"><p>暂无学习计划。</p></div></section>
    </div>
    <section class="profile-cta"><div><h2>{{ dataMode === 'api' ? '继续完成已发布的学习与实训任务' : '继续积累你的 AI 能力！' }}</h2><p>每一次学习、每一次解决问题的积累，都在增长你的 AI 能力。</p><RouterLink class="button primary" to="/topics">探索更多课程</RouterLink></div><div v-if="dataMode === 'mock'" class="profile-kpis"><span><strong>18.6h</strong>本月学习时长</span><span><strong>7 个</strong>本月实验完成</span><span><strong>860 分</strong>本月成就点</span></div><div class="trophy"><AppIcon name="trophy" :size="52" /></div></section>
  </div>
  <AppDialog v-model="planOpen" title="创建学习计划"><form class="dialog-form" @submit.prevent="createPlan"><label>计划名称<input v-model="planName" required maxlength="50" autofocus /></label><label>目标日期<input v-model="planDate" required type="date" /></label><div class="notice">{{ dataMode === 'api' ? '计划将写入学习账号，并在管理后台成长记录中可查。' : '演示计划只保存在浏览器本地。' }}</div><button class="button primary" type="submit">创建学习计划</button></form></AppDialog>
  <AppDialog :model-value="!!badgeOpen" :title="badgeOpen || '徽章详情'" @update:model-value="badgeOpen = ''"><div class="badge-detail"><AppIcon :name="badges.find((badge) => badge.title === badgeOpen)?.icon || 'achievement'" :size="48" /></div><p>完成对应学习与实践目标后获得。当前徽章数据为演示内容。</p></AppDialog>
</template>
