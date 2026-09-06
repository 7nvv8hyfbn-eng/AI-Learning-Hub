<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CourseCard from '../components/CourseCard.vue'
import ContentPagination from '../components/ContentPagination.vue'
import PageHero from '../components/PageHero.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
import { useCoursesStore } from '../stores/content/courses'
import { useThemesStore } from '../stores/content/themes'
import { useLearningStore } from '../stores/learning'
import type { Course } from '../types'

const route = useRoute()
const router = useRouter()
const store = useLearningStore()
const auth = useAuthStore()
const courseStore = useCoursesStore()
const themeStore = useThemesStore()
const { items: courses } = storeToRefs(courseStore)
const { items: themes } = storeToRefs(themeStore)
const query = ref(String(route.query.q || ''))
const category = ref(String(route.query.category || '全部主题'))
const level = ref(String(route.query.level || '全部难度'))
const duration = ref(String(route.query.duration || '全部时长'))
const mode = ref(String(route.query.mode || '全部方式'))
const sort = ref(String(route.query.sort || '综合排序'))
const categories = computed(() => dataMode === 'api'
  ? ['全部主题', ...themes.value.map((theme) => theme.title)]
  : ['全部主题', '大模型 LLM', 'AI Agent', '图像生成', '模型部署', '智能硬件', 'AI 安全'])
const overallProgress = computed(() => {
  const values = Object.values(store.courseProgress)
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0
})
const accountDataReady = computed(() => !!auth.user && (dataMode === 'mock' || store.accountSyncState === 'synced'))
const accountDataMessage = computed(() => {
  if (!auth.user) return '登录后查看学习进度与最近记录。'
  return store.accountSyncState === 'sync-error' ? '账号学习数据同步失败，请稍后重试。' : '正在同步账号学习数据…'
})
const recentCourses = computed(() => store.recentCourses
  .map((id) => courses.value.find((course) => course.id === id))
  .filter((course): course is NonNullable<typeof course> => !!course))

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  const result = courses.value.filter((course) =>
    (!keyword || `${course.title}${course.description}${course.category}`.toLowerCase().includes(keyword)) &&
    (category.value === '全部主题' || course.category === category.value) &&
    (level.value === '全部难度' || course.level === level.value) &&
    (duration.value === '全部时长' ||
      (duration.value === '0～2 小时' && (course.hours ?? Infinity) <= 2) ||
      (duration.value === '2～5 小时' && (course.hours ?? 0) > 2 && (course.hours ?? Infinity) <= 5) ||
      (duration.value === '5～10 小时' && (course.hours ?? 0) > 5 && (course.hours ?? Infinity) <= 10) ||
      (duration.value === '10 小时以上' && (course.hours ?? 0) > 10)) &&
    (mode.value === '全部方式' || course.mode === mode.value))
  return sort.value === '时长最短'
    ? [...result].sort((a, b) => (a.hours ?? Infinity) - (b.hours ?? Infinity))
    : sort.value === '学习人数'
      ? [...result].sort((a, b) => (b.learners ?? 0) - (a.learners ?? 0))
      : result
})
const activeFilterCount = computed(() => [level.value !== '全部难度', duration.value !== '全部时长', mode.value !== '全部方式'].filter(Boolean).length)
const courseProgress = (course: Course) => store.courseProgress[course.id] ?? (dataMode === 'mock' ? course.progress ?? 0 : 0)
const suggestedCourse = computed(() => recentCourses.value[0] || filtered.value[0] || courses.value[0])

onMounted(() => Promise.all([courseStore.load(), themeStore.load()]))

watch([query, category, level, duration, mode, sort], () => {
  const params: Record<string, string> = {}
  if (query.value) params.q = query.value
  if (category.value !== '全部主题') params.category = category.value
  if (level.value !== '全部难度') params.level = level.value
  if (duration.value !== '全部时长') params.duration = duration.value
  if (mode.value !== '全部方式') params.mode = mode.value
  if (sort.value !== '综合排序') params.sort = sort.value
  if (new URLSearchParams(params).toString() !== new URLSearchParams(route.query as Record<string, string>).toString()) router.push({ query: params })
})

watch(() => route.query, (params) => {
  query.value = String(params.q || '')
  category.value = String(params.category || '全部主题')
  level.value = String(params.level || '全部难度')
  duration.value = String(params.duration || '全部时长')
  mode.value = String(params.mode || '全部方式')
  sort.value = String(params.sort || '综合排序')
})

const reset = () => {
  query.value = ''
  category.value = '全部主题'
  level.value = '全部难度'
  duration.value = '全部时长'
  mode.value = '全部方式'
  sort.value = '综合排序'
}
const clearCourseFilters = () => {
  level.value = '全部难度'
  duration.value = '全部时长'
  mode.value = '全部方式'
}
const search = () => courseStore.load({ page: 1, keyword: query.value }, true)
</script>

<template>
  <div class="page-container topics-board">
    <PageHero class="topics-hero" eyebrow="精选主题" title="从想法到作品，用 AI 创造无限可能" description="系统化学习 · 实战项目 · 成长看得见" visual-key="topicsHeroAssetId" />

    <nav class="topics-theme-nav" aria-label="课程主题分类">
      <button v-for="item in categories" :key="item" type="button" :class="{ active: category === item }" :title="`${item} · ${themes.find((theme) => theme.title === item)?.data.courseCount || 0} 门课程`" @click="category = item">
        <AppIcon :name="`topics-${themes.find((theme) => theme.title === item)?.slug || 'all'}`" :size="18" />
        <span>{{ item }}</span>
        <small v-if="item !== '全部主题'">{{ themes.find((theme) => theme.title === item)?.data.courseCount || 0 }}</small>
      </button>
    </nav>

    <section id="course-board" class="topics-course-board">
      <header class="topics-section-heading topics-course-heading">
        <div><AppIcon name="sparkles" :size="20" /><h2>课程任务清单</h2></div>
        <div class="topics-course-tools">
          <form class="topics-course-search" role="search" @submit.prevent="search">
            <AppIcon name="search" :size="16" />
            <input v-model="query" aria-label="搜索课程" placeholder="搜索课程、主题或技能…" />
            <button class="button primary" type="submit" aria-label="搜索课程"><AppIcon name="search" :size="17" /></button>
          </form>
          <select v-model="sort" aria-label="课程排序"><option>综合排序</option><option>时长最短</option><option>学习人数</option></select>
          <details class="topics-filter-popover">
            <summary><AppIcon name="sliders" :size="16" />筛选 <small v-if="activeFilterCount">{{ activeFilterCount }}</small></summary>
            <div>
              <label>难度<select v-model="level"><option>全部难度</option><option>入门</option><option>初级</option><option>中级</option><option>高级</option></select></label>
              <label>学习时长<select v-model="duration"><option>全部时长</option><option>0～2 小时</option><option>2～5 小时</option><option>5～10 小时</option><option>10 小时以上</option></select></label>
              <label>学习方式<select v-model="mode"><option>全部方式</option><option>视频</option><option>图文</option><option>实战项目</option><option>互动实验</option></select></label>
              <button class="text-link" type="button" @click="clearCourseFilters"><AppIcon name="refresh" :size="15" />清空筛选</button>
            </div>
          </details>
          <RouterLink class="button primary topics-course-action" :to="suggestedCourse ? `/courses/${suggestedCourse.id}` : '#course-board'">继续学习 <AppIcon name="arrow-up-right" :size="15" /></RouterLink>
        </div>
      </header>
      <div v-if="filtered.length" class="card-grid topics-course-grid">
        <CourseCard v-for="course in filtered" :id="`course-${course.id}`" :key="course.id" :course="course" variant="topics-board" />
      </div>
      <div v-else class="inline-empty"><h3>没有找到匹配课程</h3><p>试试清空筛选条件。</p><button class="button secondary" type="button" @click="reset">重置筛选</button></div>
      <ContentPagination :page="courseStore.page" :page-size="courseStore.pageSize" :total="courseStore.total" @change="courseStore.load({ page: $event, keyword: query })" />
    </section>

    <section class="topics-progress-board">
      <header class="topics-section-heading"><div><AppIcon name="topics-progress" :size="20" /><div><h2>我的学习进度</h2><p>查看账号课程进度和最近学习</p></div></div></header>
      <div v-if="accountDataReady" class="topics-progress-layout">
        <div class="topics-progress-ring" :style="{ '--topics-progress': `${overallProgress * 3.6}deg` }"><strong>{{ overallProgress }}%</strong><span>总进度</span></div>
        <div class="topics-progress-stats">
          <span><strong>{{ Object.keys(store.courseProgress).length }}</strong>已学课程</span>
          <span><strong>{{ store.recentCourses.length }}</strong>最近学习</span>
          <span><strong>{{ Object.values(store.courseProgress).filter((value) => value === 100).length }}</strong>已完成</span>
        </div>
        <div class="topics-progress-next">
          <span>最近学习</span>
          <RouterLink v-if="suggestedCourse" :to="`/courses/${suggestedCourse.id}`"><strong>{{ suggestedCourse.title }}</strong><small>{{ courseProgress(suggestedCourse) ? `继续学习 · ${courseProgress(suggestedCourse)}%` : '开始学习' }}</small></RouterLink>
          <p v-else>暂无最近学习课程。</p>
          <RouterLink class="button secondary small" to="/profile">进入学习中心</RouterLink>
        </div>
      </div>
      <p v-else class="notice">{{ accountDataMessage }}</p>
    </section>

    <section class="topics-recommendations">
      <header class="topics-section-heading"><div><AppIcon name="topics-hot" :size="20" /><div><h2>为你推荐</h2><p>发现更多优质课程</p></div></div></header>
      <div v-if="dataMode === 'mock'" class="card-grid topics-recommendation-grid">
        <CourseCard v-for="course in courses.slice(4, 8)" :key="course.id" :course="course" compact variant="topics-board" />
      </div>
      <div v-else class="inline-empty small-empty"><p>个性化推荐尚未配置。</p></div>
    </section>
  </div>
</template>
