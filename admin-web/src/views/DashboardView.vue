<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DashboardDto } from '@ai-learning-hub/contracts'
import AdminKpiCard from '../components/AdminKpiCard.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import TrendChart from '../components/TrendChart.vue'
import { api } from '../services/api'
import { useSessionStore } from '../stores/session'
import { visibleAdminNavigation } from '../navigation'

const data = ref<DashboardDto | null>(null)
const error = ref('')
const session = useSessionStore()
const modules = computed(() => visibleAdminNavigation(session.user?.permissions || []).flatMap((group) => group.items).filter((item) => !['/dashboard', '/settings'].includes(item[2])))
const canVisit = (path: string) => modules.value.some((item) => item[2] === path)
const visibleTodos = computed(() => (data.value?.todos || []).filter((item) => canVisit(item.route)))
onMounted(async () => {
  try { data.value = await api('/admin/dashboard') } catch (reason) { error.value = reason instanceof Error ? reason.message : '加载失败' }
})
</script>

<template>
  <AdminPageHeader title="数据看板" description="社区运营优先，兼顾学习内容与真实学习行为" />
  <div v-if="error" class="error-banner">{{ error }}</div>
  <div class="kpi-grid">
    <AdminKpiCard icon="article" label="今日社区发布" :value="data?.community.todayPosts ?? '—'" color="#ff4d1f" />
    <AdminKpiCard icon="users" label="今日活跃用户" :value="data?.community.activeUsers ?? '—'" color="#22b66c" />
    <AdminKpiCard icon="check" label="待回答问题" :value="data?.community.unanswered ?? '—'" color="#7c4dff" />
    <AdminKpiCard icon="article" label="待处理举报" :value="data?.community.pendingReports ?? '—'" color="#3478f6" />
  </div>
  <div class="kpi-grid"><AdminKpiCard icon="course" label="已发布课程" :value="data?.learning.publishedCourses ?? '—'" color="#7c4dff" /><AdminKpiCard icon="lab" label="已发布实训" :value="data?.learning.publishedLabs ?? '—'" color="#3478f6" /><AdminKpiCard icon="resource" label="已发布资源" :value="data?.learning.publishedResources ?? '—'" color="#f2a500" /><AdminKpiCard icon="challenge" label="进行中挑战" :value="data?.learning.activeChallenges ?? '—'" color="#22b66c" /></div>
  <section class="panel module-overview"><h2>模块运营概览</h2><div><RouterLink v-for="[icon, title, path] in modules" :key="path" :to="path"><i style="background: #fff0e9; color: #ff4d1f"><AdminIcon :name="icon" :size="21" /></i><strong>{{ title }}</strong><small>内容管理与运营</small><span>进入管理 <AdminIcon name="arrow-right" :size="14" /></span></RouterLink></div></section>
  <div class="dashboard-bottom">
    <section class="panel trend-panel"><div class="panel-heading"><h2>平台活跃趋势</h2><span>近 7 天</span></div><div class="chart-legend"><span>— 活跃用户数</span><span>— 学习分钟</span></div><TrendChart :data="data?.trend || []" /><div class="trend-summary"><span>最近一天活跃用户<b>{{ data?.trend.at(-1)?.activeUsers ?? '—' }}</b></span><span>最近一天学习分钟<b>{{ data?.trend.at(-1)?.learningMinutes ?? '—' }}</b></span></div></section>
    <div class="dashboard-side-stack">
      <section class="panel todo-panel"><div class="panel-heading"><h2>待办事项</h2></div><ul><li v-for="item in visibleTodos.slice(0, 4)" :key="item.id"><i><AdminIcon name="check" :size="18" /></i><div><RouterLink :to="item.route"><strong>{{ item.title }}</strong></RouterLink><small>{{ item.module }} · {{ item.priority }}</small></div><time>{{ item.dueAt ? new Date(item.dueAt).toLocaleString('zh-CN') : '无截止时间' }}</time></li><li v-if="!visibleTodos.length" class="empty-row">暂无待审核、待发布或定时任务。</li></ul></section>
      <section class="panel quick-actions"><h2>快捷操作</h2><div><RouterLink v-if="canVisit('/community')" to="/community">社区<small>处理社区待办</small></RouterLink><RouterLink v-if="canVisit('/homepage')" to="/homepage">门户<small>配置落地页</small></RouterLink><RouterLink v-if="canVisit('/courses')" to="/courses">课程<small>管理课程</small></RouterLink><RouterLink v-if="canVisit('/resources')" to="/resources">资源<small>管理资源</small></RouterLink></div></section>
    </div>
  </div>
  <section class="panel recent-operations"><div class="panel-heading"><h2>最近操作</h2><RouterLink to="/settings">查看全部 <AdminIcon name="arrow-right" :size="14" /></RouterLink></div><div v-for="item in data?.operations.slice(0, 4)" :key="item.id"><i><AdminIcon name="settings" :size="14" /></i><span><b>{{ item.method }}</b> {{ item.path }}（{{ item.result }}）</span><small>{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</small></div><p v-if="!data?.operations.length">暂无管理操作日志。</p></section>
</template>
