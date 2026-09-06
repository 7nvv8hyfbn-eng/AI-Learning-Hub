<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import AdminDialog from '../components/AdminDialog.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminKpiCard from '../components/AdminKpiCard.vue'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import AdminStatusTag from '../components/AdminStatusTag.vue'
import AdminPagination from '../components/AdminPagination.vue'
import { api } from '../services/api'
import { usePermissionAction } from '../composables/usePermissionAction'

import type { AdminUserDto as UserRow, PageResult } from '@ai-learning-hub/contracts'
import { userQueryString } from '../services/users'
import { useRoute } from 'vue-router'
const route = useRoute()
interface GrowthModule { id: string; title: string; description?: string; enabled: boolean; displayLimit?: number; sortOrder?: number }
interface GrowthRule { id: string; code: string; name: string; description: string; enabled: boolean; _count?: { users: number } }
interface Growth {
  user: UserRow
  points: number
  progress: unknown[]
  runs: Array<{ status?: string }>
  attempts: Array<{ score: number }>
  favorites: unknown[]
  plans: Array<{ id: string; title: string; status: string; progress: number; targetDate?: string }>
  achievements: Array<{ achievement: { name: string } }>
  certificates: Array<{ certificate: { name: string } }>
  wrongQuestions: unknown[]
  knowledgeStats: unknown[]
}
const users = ref<UserRow[]>([])
const modules = ref<GrowthModule[]>([])
const selected = ref<UserRow | null>(null)
const growth = ref<Growth | null>(null)
const keyword = ref('')
const schoolFilter = ref(''), statusFilter = ref(''), accountError = ref(''), userPage = ref(1), userTotal = ref(0)
const canWrite = usePermissionAction('growth.write')
const rulesOpen = ref(false)
const createOpen = ref(false)
const moduleOpen = ref(false)
const achievements = ref<GrowthRule[]>([])
const certificates = ref<GrowthRule[]>([])
const recommendationRules = ref<Record<string, unknown>>({})
const ruleText = ref('{}')
const createForm = reactive({ type: 'achievement', code: '', name: '', description: '', rule: '{"points":100}' })
const editingModule = ref<GrowthModule | null>(null)
const moduleMeta: Record<string, [string, string, string]> = {
  overview: ['学习总览', '学习时长、完成课程', '◷'],
  ability_card: ['AI 能力卡', '知识与实践能力', 'growth'],
  badges: ['微章墙', '成果与荣誉', '♛'],
  recent_courses: ['最近学习课程', '课程进度与推荐', 'course'],
  lab_records: ['实验记录', '实训报告与成果', 'lab'],
  favorites: ['我的收藏', '课程、资讯与资源', 'resource'],
  plans: ['学习计划', '目标与进度管理', 'theme'],
  growth_stats: ['成长统计', '积分、连续学习', '▥'],
}
const moduleView = (item: GrowthModule) => moduleMeta[item.id] || [item.title, '个人中心展示模块', 'resource']
const filtered = computed(() => users.value)
const schoolOptions = computed(() => [...new Map(users.value.filter((u) => u.school).map((u) => [u.school!.id, u.school!])).values()])
let userLoadEpoch = 0
const loadUsers = async (page = 1) => {
  const epoch = ++userLoadEpoch
  try { const result = await api<PageResult<UserRow>>(`/admin/users/growth-list?${userQueryString({ page, pageSize: 20, keyword: keyword.value, status: statusFilter.value, schoolId: schoolFilter.value })}`); if (epoch === userLoadEpoch) { users.value = result.items; userPage.value = result.page; userTotal.value = result.total } }
  catch (cause) { if (epoch === userLoadEpoch) accountError.value = cause instanceof Error ? cause.message : '读取失败' }
}
watch([keyword, schoolFilter, statusFilter], () => { void loadUsers() })
const loadGrowth = async (user: UserRow) => { selected.value = user; growth.value = await api(`/admin/users/${user.id}/growth`) }
const toggleModule = async (item: GrowthModule, enabled: boolean) => {
  await api(`/admin/growth/modules/${item.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
  item.enabled = enabled
}
const openModule = (item: GrowthModule) => { editingModule.value = item; moduleOpen.value = true }
const saveModule = async () => {
  if (!editingModule.value) return
  const updated = await api<GrowthModule>(`/admin/growth/modules/${editingModule.value.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: editingModule.value.title, description: editingModule.value.description || '', displayLimit: editingModule.value.displayLimit || 6, enabled: editingModule.value.enabled }),
  })
  Object.assign(editingModule.value, updated)
  moduleOpen.value = false
  ElMessage.success('成长模块设置已保存')
}
const openRules = () => {
  ruleText.value = JSON.stringify(recommendationRules.value, null, 2)
  rulesOpen.value = true
}
const saveRules = async () => {
  const value = JSON.parse(ruleText.value) as Record<string, unknown>
  await api('/admin/recommendation-rules', { method: 'PATCH', body: JSON.stringify({ value }) })
  recommendationRules.value = value
  rulesOpen.value = false
  ElMessage.success('推荐规则已保存')
}
const createRule = async () => {
  const path = createForm.type === 'achievement' ? '/admin/achievements' : '/admin/certificates'
  await api(path, { method: 'POST', body: JSON.stringify({ code: createForm.code, name: createForm.name, description: createForm.description, rule: JSON.parse(createForm.rule) }) })
  ;[achievements.value, certificates.value] = await Promise.all([api<GrowthRule[]>('/admin/achievements'), api<GrowthRule[]>('/admin/certificates')])
  Object.assign(createForm, { type: 'achievement', code: '', name: '', description: '', rule: '{"points":100}' })
  createOpen.value = false
  ElMessage.success('成长规则已创建')
}
onMounted(async () => {
  await loadUsers()
  ;[modules.value, achievements.value, certificates.value, recommendationRules.value] = await Promise.all([
    api<GrowthModule[]>('/admin/growth/modules'),
    api<GrowthRule[]>('/admin/achievements'),
    api<GrowthRule[]>('/admin/certificates'),
    api<Record<string, unknown>>('/admin/recommendation-rules'),
  ])
  if (typeof route.query.userId === 'string') {
    growth.value = await api<Growth>(`/admin/users/${encodeURIComponent(route.query.userId)}/growth`)
    selected.value = growth.value.user
  } else if (users.value[0]) await loadGrowth(users.value[0])
})
</script>

<template>
  <AdminPageHeader title="用户成长管理" description="管理用户个人中心与成长体系展示内容及规则">
    <template #actions><button class="admin-secondary" type="button" :disabled="!canWrite" @click="openRules">成长体系设置</button><RouterLink class="admin-secondary" to="/users">用户与账号</RouterLink><button class="admin-primary" type="button" :disabled="!canWrite" @click="createOpen = true">新建徽章/证书</button></template>
  </AdminPageHeader>
  <div class="kpi-grid">
    <AdminKpiCard icon="users" label="学习者总数" :value="userTotal" color="#ff4d1f" />
    <AdminKpiCard icon="course" label="学习记录" :value="growth?.progress.length || 0" color="#22b66c" />
    <AdminKpiCard icon="lab" label="实训记录" :value="growth?.runs.length || 0" color="#7c4dff" />
    <AdminKpiCard icon="challenge" label="测评记录" :value="growth?.attempts.length || 0" color="#3478f6" />
  </div>
  <section class="growth-layout panel">
    <aside class="growth-modules">
      <h2>成长模块管理</h2><p>控制个人中心与成长体系各模块的展示与配置</p>
      <div v-for="item in modules" :key="item.id"><i>{{ moduleView(item)[2] }}</i><strong>{{ moduleView(item)[0] }}<small>{{ moduleView(item)[1] }}</small></strong><el-switch :model-value="item.enabled" :disabled="!canWrite" @change="toggleModule(item, Boolean($event))" /><button type="button" :disabled="!canWrite" @click="openModule(item)">管理</button></div>
    </aside>
    <div class="learner-list">
      <div class="panel-heading"><div><h2>学习者列表</h2><small>查看与管理学习成长数据与展示内容</small></div><input v-model="keyword" placeholder="搜索用户名、姓名、学号、学校" /><select v-model="schoolFilter"><option value="">全部学校</option><option v-for="item in schoolOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select><select v-model="statusFilter"><option value="">全部状态</option><option value="active">正常</option><option value="disabled">已禁用</option></select></div>
      <div class="learner-table-head"><span>用户</span><span>学校</span><span>学习记录</span><span>账号状态</span><span>操作</span></div>
      <button v-for="user in filtered" :key="user.id" type="button" :class="{ selected: selected?.id === user.id }" @click="loadGrowth(user)">
        <span>{{ user.displayName.slice(0, 1) }}</span>
        <strong>{{ user.displayName }}<small>ID：{{ user.id.slice(-6) }}</small></strong>
        <em>{{ user.school?.name || '—' }}</em>
        <span class="growth-progress"><small>{{ selected?.id === user.id ? (growth?.progress.length || 0) : '—' }} 条课时进度</small></span>
        <AdminStatusTag :status="user.status" />
        <b>查看</b>
      </button>
      <p v-if="accountError" role="alert">{{ accountError }}</p><AdminPagination :page="userPage" :page-size="20" :total="userTotal" @change="loadUsers" />
    </div>
    <aside v-if="growth" class="learner-detail">
      <div class="learner-profile"><span>{{ growth.user.displayName.slice(0, 1) }}</span><div><h2>{{ growth.user.displayName }} <small>等级 —</small></h2><p>{{ growth.user.email }} · ID {{ growth.user.id.slice(-6) }}</p><AdminStatusTag :status="growth.user.status" /></div></div>
      <h3>学习数据快照</h3>
      <div class="growth-snapshot"><span><i><AdminIcon name="clock" :size="16" /></i><b>—</b>学习时长</span><span><i><AdminIcon name="course" :size="16" /></i><b>{{ growth.progress.length }}</b>课时进度</span><span><i><AdminIcon name="lab" :size="16" /></i><b>{{ growth.runs.filter((item) => item.status === 'submitted').length }}</b>实训提交</span><span><i><AdminIcon name="trophy" :size="16" /></i><b>{{ growth.achievements.length }}</b>获得徽章</span><span><i><AdminIcon name="achievement" :size="16" /></i><b>{{ growth.certificates.length }}</b>证书获得</span></div>
      <h3>获得的徽章 <small>全部（{{ growth.achievements.length }}）</small></h3>
      <div v-if="growth.achievements.length" class="badge-row"><span v-for="item in growth.achievements" :key="item.achievement.name"><i><AdminIcon name="trophy" :size="20" /></i><small>{{ item.achievement.name }}</small></span></div><p v-else>暂无徽章。</p>
      <h3>学习计划 <small>全部（{{ growth.plans.length }}）</small></h3>
      <div v-for="plan in growth.plans" :key="plan.id" class="plan-card"><div><b>{{ plan.title }}</b><AdminStatusTag :status="plan.status" /></div><small>进度 {{ plan.progress }}%{{ plan.targetDate ? ` · 目标 ${String(plan.targetDate).slice(0, 10)}` : '' }}</small><i><span :style="{ width: `${plan.progress}%` }"></span></i></div><p v-if="!growth.plans.length">暂无学习计划。</p>
      <h3>智能推荐规则</h3><pre>{{ JSON.stringify(recommendationRules, null, 2) }}</pre>
    </aside>
  </section>
  <section class="panel growth-quick-actions"><h2>成长规则</h2><p>徽章 {{ achievements.length }} 项，证书 {{ certificates.length }} 项；用户数据导出基于当前真实列表。</p></section>
  <AdminDialog v-model="rulesOpen" title="成长推荐规则"><form class="admin-form" @submit.prevent="saveRules"><label>规则 JSON<textarea v-model="ruleText" rows="12" required /></label><button class="admin-primary" type="submit">保存规则</button></form></AdminDialog>
  <AdminDialog v-model="createOpen" title="新建徽章或证书"><form class="admin-form" @submit.prevent="createRule"><label>类型<select v-model="createForm.type"><option value="achievement">徽章</option><option value="certificate">证书</option></select></label><label>规则编码<input v-model="createForm.code" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></label><label>名称<input v-model="createForm.name" required /></label><label>说明<textarea v-model="createForm.description" required /></label><label>触发规则 JSON<textarea v-model="createForm.rule" required rows="5" /></label><button class="admin-primary" type="submit">创建</button></form></AdminDialog>
  <AdminDialog v-model="moduleOpen" title="成长模块设置"><form v-if="editingModule" class="admin-form" @submit.prevent="saveModule"><label>标题<input v-model="editingModule.title" required /></label><label>说明<textarea v-model="editingModule.description" /></label><label>展示条数<input v-model.number="editingModule.displayLimit" type="number" min="1" max="100" /></label><label class="toggle-row">启用<el-switch v-model="editingModule.enabled" /></label><button class="admin-primary" type="submit">保存模块</button></form></AdminDialog>
</template>
