<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { AdminIdentityVerificationDto, AdminUserDetailDto, AdminUserQueryDto, AdminUserSummaryDto, IdentityVerificationStatus, PageResult } from '@ai-learning-hub/contracts'
import { ElMessage } from 'element-plus'
import { usersApi } from '../services/users'
import { useSessionStore } from '../stores/session'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import AdminPagination from '../components/AdminPagination.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminUserAvatar from '../components/AdminUserAvatar.vue'
import FrontendModeratorGrants from '../components/FrontendModeratorGrants.vue'
import UserPublicBadges from '../components/UserPublicBadges.vue'
import { api } from '../services/api'
const session = useSessionStore(), can = (permission: string) => session.user?.permissions.includes(permission)
const query = reactive<AdminUserQueryDto>({ page: 1, pageSize: 20, keyword: '', sortBy: 'createdAt', sortOrder: 'desc' })
const result = ref<PageResult<AdminUserSummaryDto>>({ items: [], page: 1, pageSize: 20, total: 0 })
const options = ref<Awaited<ReturnType<typeof usersApi.options>>>({ schools: [], roles: [] })
const selected = ref<AdminUserDetailDto | null>(null), tab = ref('基础资料'), busy = ref(false), error = ref('')
const identity = ref<AdminIdentityVerificationDto | null>(null), identityLoading = ref(false), identityRevealed = ref(false)
const growth = ref<{ points: number; progress: unknown[]; runs: unknown[]; attempts: unknown[]; plans: unknown[]; favorites: unknown[]; achievements: unknown[]; certificates: unknown[] } | null>(null)
const operation = ref(''), reason = ref(''), operationOpen = ref(false), editing = ref(false)
const actionTarget = ref<{ id: string; displayName: string; revision: number } | null>(null)
const form = reactive({ displayName: '', schoolId: '', departmentId: '', major: '', grade: '', studentNo: '', teacherNo: '' })
const labels: Record<string, string> = { active: '启用 / 解锁账号', disabled: '禁用账号', locked: '锁定账号', 'revoke-sessions': '强制退出全部会话', 'reset-onboarding': '重置首次引导', 'reset-password': '发送密码重置邮件', 'identity-approve': '通过实名认证', 'identity-reject': '驳回实名认证', 'identity-revoke': '撤销实名认证' }
const verificationLabels: Record<IdentityVerificationStatus, string> = { unsubmitted: '未提交', pending: '待审核', approved: '已认证', rejected: '已驳回', revoked: '已撤销' }
let listEpoch = 0, detailEpoch = 0
const load = async (page = 1) => {
  const epoch = ++listEpoch; busy.value = true; error.value = ''; query.page = page
  try { const rows = await usersApi.list(query); if (epoch === listEpoch) result.value = rows }
  catch (cause) { if (epoch === listEpoch) error.value = cause instanceof Error ? cause.message : '用户读取失败' }
  finally { if (epoch === listEpoch) busy.value = false }
}
const inspect = async (id: string) => {
  const epoch = ++detailEpoch; error.value = ''; growth.value = null; identity.value = null; identityRevealed.value = false; selected.value = null; tab.value = '基础资料'
  try {
    const value = await usersApi.detail(id)
    if (epoch !== detailEpoch) return
    selected.value = value
    if (can('growth.read')) { const data = await api<NonNullable<typeof growth.value>>(`/admin/users/${id}/growth`); if (epoch === detailEpoch) growth.value = data }
  } catch (cause) { if (epoch === detailEpoch) error.value = cause instanceof Error ? cause.message : '详情读取失败' }
}
const loadIdentity = async () => {
  if (!selected.value || !can('user.identity.read') || selected.value.verification.status === 'unsubmitted') return
  identityLoading.value = true; error.value = ''
  try { identity.value = await usersApi.verification(selected.value.user.id) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '实名资料读取失败' }
  finally { identityLoading.value = false }
}
const selectTab = (value: string) => { tab.value = value; if (value === '实名认证' && !identity.value) void loadIdentity() }
const openAction = (action: string) => {
  if (!selected.value) return
  const user = selected.value.user
  actionTarget.value = { id: user.id, displayName: user.displayName, revision: user.revision }
  Object.assign(form, { displayName: user.displayName, schoolId: user.school?.id || '', departmentId: user.department?.id || '', major: user.major || '', grade: user.grade || '', studentNo: user.studentNo || '', teacherNo: user.teacherNo || '' })
  operation.value = action; reason.value = ''; operationOpen.value = true; editing.value = action === 'edit'
}
const openIdentityAction = (action: 'approve' | 'reject' | 'revoke') => {
  if (!selected.value || !identity.value || identity.value.revision === null) return
  actionTarget.value = { id: selected.value.user.id, displayName: selected.value.user.displayName, revision: identity.value.revision }
  operation.value = `identity-${action}`; reason.value = ''; operationOpen.value = true; editing.value = false
}
const apply = async () => {
  if (!actionTarget.value) return
  busy.value = true; error.value = ''
  try {
    const { id, revision } = actionTarget.value
    if (editing.value) {
      const { studentNo, ...editable } = form
      await usersApi.update(id, { ...editable, ...(can('user.identity.read') ? { studentNo } : {}), reason: reason.value, expectedRevision: revision })
    }
    else if (operation.value.startsWith('identity-')) await usersApi.reviewVerification(id, operation.value.slice(9) as 'approve' | 'reject' | 'revoke', { reason: reason.value, expectedRevision: revision })
    else await usersApi.action(id, operation.value, reason.value, revision)
    operationOpen.value = false; await Promise.all([load(result.value.page), inspect(id)]); ElMessage.success('操作已保存并记录审计')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false }
}
const exportUsers = async () => {
  busy.value = true
  try {
    const rows: AdminUserSummaryDto[] = []
    const filters = { ...query }
    for (let page = 1;; page++) { const data = await usersApi.export({ ...filters, page, pageSize: 100 }); rows.push(...data.items); if (page * data.pageSize >= data.total) break }
    const escape = (value: string) => `"${(/^[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`
    const csv = [['用户名', '显示名称', '邮箱', '类型', '学校', '状态'], ...rows.map((u) => [u.username, u.displayName, u.email, u.userType, u.school?.name || '', u.status])].map((row) => row.map(escape).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a')
    link.href = url; link.download = 'users.csv'; link.click(); URL.revokeObjectURL(url)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '导出失败' }
  finally { busy.value = false }
}
const time = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN') : '—'
const pending = () => { query.identityVerificationStatus = 'pending'; void load() }
onMounted(async () => { await load(); try { options.value = await usersApi.options() } catch (cause) { error.value = cause instanceof Error ? cause.message : '选项读取失败' } })
</script>
<template>
  <AdminPageHeader title="用户与账号" description="统一管理真实账号、注册资料、实名审核、会话与社区活动。"><template #actions><button v-if="can('user.identity.read')" class="admin-secondary" :disabled="busy" @click="pending">待审核实名认证</button><button v-if="can('user.export')" class="admin-secondary" :disabled="busy" @click="exportUsers">导出筛选结果</button><button class="admin-secondary" :disabled="busy" @click="load(result.page)">刷新</button></template></AdminPageHeader>
  <p v-if="error" role="alert" class="error-banner">{{ error }}</p>
  <form class="panel users-filters" @submit.prevent="load()">
    <label>搜索<input v-model="query.keyword" :placeholder="can('user.identity.read') ? '账号 / 昵称 / 邮箱 / 学号' : '账号 / 昵称 / 邮箱'" /></label>
    <label>账号状态<select v-model="query.status"><option :value="undefined">全部</option><option value="active">正常</option><option value="disabled">禁用</option><option value="locked">锁定</option></select></label>
    <label>认证状态<select v-model="query.identityVerificationStatus"><option :value="undefined">全部</option><option v-for="(label, value) in verificationLabels" :key="value" :value="value">{{ label }}</option></select></label>
    <label>注册起始<input v-model="query.createdFrom" type="date" /></label><label>注册截止<input v-model="query.createdTo" type="date" /></label>
    <details class="users-more-filters"><summary>更多筛选</summary><div><label>类型<select v-model="query.userType"><option :value="undefined">全部</option><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label><label>角色<select v-model="query.role"><option :value="undefined">全部</option><option v-for="role in options.roles" :key="role.code" :value="role.code">{{ role.name }}</option></select></label><label>学校<select v-model="query.schoolId"><option :value="undefined">全部</option><option v-for="school in options.schools" :key="school.id" :value="school.id">{{ school.name }}</option></select></label><label>来源<input v-model="query.registrationSource" placeholder="email / bootstrap" /></label><label>首次引导<select v-model="query.onboardingCompleted"><option :value="undefined">全部</option><option :value="true">已完成</option><option :value="false">未完成</option></select></label><label>邮箱验证<select v-model="query.emailVerified"><option :value="undefined">全部</option><option :value="true">已验证</option><option :value="false">未验证</option></select></label><label>最近登录起始<input v-model="query.lastLoginFrom" type="date" /></label><label>最近登录截止<input v-model="query.lastLoginTo" type="date" /></label><label>排序<select v-model="query.sortBy"><option value="createdAt">注册时间</option><option value="lastLoginAt">最近登录</option><option value="displayName">显示名称</option></select></label><label>顺序<select v-model="query.sortOrder"><option value="desc">降序</option><option value="asc">升序</option></select></label></div></details>
    <button class="admin-primary" :disabled="busy">查询</button>
  </form>
  <section class="panel users-table"><table><thead><tr><th>用户</th><th>账号</th><th>账号状态</th><th>认证状态</th><th v-if="can('user.identity.read')">学号</th><th>注册时间</th><th>最近登录</th><th>社区动态</th><th>操作</th></tr></thead><tbody><tr v-for="user in result.items" :key="user.id" :class="{ selected: selected?.user.id === user.id }"><td><AdminUserAvatar :name="user.displayName" :src="user.avatar" /><strong>{{ user.displayName }}</strong><small>{{ user.email }}</small></td><td>@{{ user.username }}</td><td>{{ {active:'正常',disabled:'禁用',locked:'锁定'}[user.status] || user.status }}</td><td><span class="identity-status" :data-status="user.identityVerificationStatus">{{ verificationLabels[user.identityVerificationStatus] }}</span></td><td v-if="can('user.identity.read')">{{ user.studentNo || '—' }}</td><td>{{ time(user.createdAt) }}</td><td>{{ time(user.lastLoginAt) }}</td><td>{{ user.communityPostCount }} 条</td><td><button class="admin-text" @click="inspect(user.id)">详情</button></td></tr></tbody></table><p v-if="!result.items.length" class="admin-empty">{{ busy ? '正在读取…' : '没有匹配用户' }}</p><AdminPagination :page="result.page" :page-size="result.pageSize" :total="result.total" @change="load" /></section>
  <section v-if="selected" class="panel users-detail">
    <header><h2>{{ selected.user.displayName }}</h2><nav class="community-admin-tabs"><button v-for="label in ['基础资料','账号与安全','实名认证','社区资料','学习数据','操作记录']" :key="label" :class="{active:tab===label}" @click="selectTab(label)">{{ label }}</button></nav></header>
    <dl v-if="tab==='基础资料'"><dt>用户名 / 邮箱</dt><dd>{{ selected.user.username }} · {{ selected.user.email }}</dd><dt>学校 / 院系</dt><dd>{{ selected.user.school?.name || '—' }} / {{ selected.user.department?.name || '—' }}</dd><dt>专业 / 年级</dt><dd>{{ selected.user.major || '—' }} / {{ selected.user.grade || '—' }}</dd><dt>学号 / 教师编号</dt><dd>{{ can('user.identity.read') ? selected.user.studentNo || '—' : '无查看权限' }} / {{ selected.user.teacherNo || '—' }}</dd><dt>类型 / 来源</dt><dd>{{ selected.user.userType }} / {{ selected.user.registrationSource }}</dd><dt>创建 / 更新</dt><dd>{{ time(selected.user.createdAt) }} / {{ time(selected.user.updatedAt) }}</dd></dl>
    <dl v-else-if="tab==='账号与安全'"><dt>账号 / 角色</dt><dd>{{ selected.user.status }} · {{ selected.user.roles.join('、') }}</dd><dt>邮箱验证</dt><dd>{{ time(selected.security.emailVerifiedAt) }}</dd><dt>协议 / 同意时间</dt><dd>{{ selected.security.agreementVersion || '—' }} · {{ time(selected.security.agreementAcceptedAt) }}</dd><dt>最近登录 / 结果</dt><dd>{{ time(selected.user.lastLoginAt) }} · {{ selected.security.lastLoginResult || '—' }}</dd><dt>有效会话</dt><dd>{{ selected.security.activeSessions }}</dd><dt>密码</dt><dd>{{ selected.security.passwordSet ? '已设置（不可查看）' : '未设置' }}</dd><dt>身份绑定</dt><dd>{{ selected.security.identities.map(i=>i.provider).join('、') || '无' }}</dd></dl>
    <section v-else-if="tab==='实名认证'" class="identity-detail"><p v-if="selected.verification.status==='unsubmitted'">该用户尚未提交实名认证。</p><p v-else-if="!can('user.identity.read')">当前账号没有实名资料查看权限。</p><p v-else-if="identityLoading">正在读取实名资料并记录敏感访问审计…</p><template v-else-if="identity"><dl><dt>真实姓名</dt><dd>{{ identity.realName }}</dd><dt>身份证号</dt><dd><code>{{ identityRevealed ? identity.idNumber : identity.maskedIdNumber }}</code> <button class="admin-text" type="button" @click="identityRevealed = !identityRevealed">{{ identityRevealed ? '收起完整号码' : '查看完整号码' }}</button></dd><dt>班级 / 学号</dt><dd>{{ identity.className }} / {{ identity.studentNo }}</dd><dt>提交时间</dt><dd>{{ time(identity.submittedAt) }}</dd><dt>认证状态</dt><dd>{{ verificationLabels[identity.status] }}<span v-if="identity.suspectedDuplicateStudentNo" class="identity-warning">疑似重复学号</span></dd><dt>审核时间 / 人员</dt><dd>{{ time(identity.reviewedAt) }} / {{ identity.reviewedBy?.displayName || '—' }}</dd><dt>审核意见</dt><dd>{{ identity.reviewReason || '—' }}</dd></dl><div v-if="can('user.identity.review')" class="identity-actions"><button v-if="identity.status==='pending'" class="admin-primary" @click="openIdentityAction('approve')">通过</button><button v-if="identity.status==='pending'" class="admin-secondary" @click="openIdentityAction('reject')">驳回</button><button v-if="identity.status==='approved'" class="admin-secondary" @click="openIdentityAction('revoke')">撤销认证</button></div></template></section>
    <dl v-else-if="tab==='社区资料'"><dt>介绍</dt><dd>{{ selected.community.headline }}<p>{{ selected.community.bio }}</p></dd><dt>认证 / 擅长方向</dt><dd>{{ selected.community.verifiedType }} / {{ selected.community.expertiseTopics.join('、') || '—' }}</dd><dt>社区活动</dt><dd>{{ selected.community.postCount }} 动态 · {{ selected.community.commentCount }} 评论 · {{ selected.community.followingCount }} 关注 · {{ selected.community.followerCount }} 粉丝 · {{ selected.community.reportCount }} 举报</dd></dl>
    <div v-else-if="tab==='学习数据'"><p v-if="!can('growth.read')">没有学习数据查看权限</p><template v-else-if="growth"><p>积分 {{ growth.points }} · 课程进度 {{ growth.progress.length }} · 实训 {{ growth.runs.length }} · 测评 {{ growth.attempts.length }}</p><p>学习计划 {{ growth.plans.length }} · 收藏 {{ growth.favorites.length }} · 徽章 {{ growth.achievements.length }} · 证书 {{ growth.certificates.length }}</p><RouterLink :to="{path: '/growth', query: {userId: selected.user.id}}">进入用户成长</RouterLink></template></div>
    <div v-else><h3>用户行为</h3><p v-for="event in selected.activities" :key="event.id">{{ time(event.occurredAt) }} · {{ event.eventType }} · {{ event.entityType }}</p><h3>账号审计</h3><p v-for="event in selected.audits" :key="event.id">{{ time(event.createdAt) }} · {{ event.action }} · {{ event.reason }}</p></div>
    <UserPublicBadges v-if="can('user.badge.manage')" :key="`badges:${selected.user.id}`" :user-id="selected.user.id" :user-revision="selected.user.revision" :readonly="selected.user.id === session.user?.id" />
    <FrontendModeratorGrants v-if="can('user.moderator.manage') && selected.user.id !== session.user?.id" id="frontend-moderator-grants" :key="selected.user.id" :detail="selected" @saved="inspect(selected!.user.id)" />
    <footer v-if="selected.user.id!==session.user?.id"><template v-if="can('user.write')"><button class="admin-secondary" @click="openAction('edit')">编辑安全资料</button><button v-for="action in ['active','disabled','locked','reset-onboarding','reset-password']" :key="action" class="admin-secondary" @click="openAction(action)">{{ labels[action] }}</button></template><button v-if="can('user.session.revoke')" class="admin-secondary" @click="openAction('revoke-sessions')">强制退出全部会话</button></footer>
  </section>
  <AdminDialog v-model="operationOpen" :title="`${editing ? '修改用户资料' : labels[operation]} · ${actionTarget?.displayName || ''}`"><form class="admin-form" @submit.prevent="apply"><template v-if="editing"><label>显示名称<input v-model="form.displayName" required maxlength="40" /></label><label>学校<select v-model="form.schoolId" @change="form.departmentId=''"><option value="">未填写</option><option v-for="school in options.schools" :key="school.id" :value="school.id">{{ school.name }}</option></select></label><label>院系<select v-model="form.departmentId"><option value="">未填写</option><option v-for="dept in options.schools.find(s=>s.id===form.schoolId)?.departments || []" :key="dept.id" :value="dept.id">{{ dept.name }}</option></select></label><label>专业<input v-model="form.major" maxlength="100" /></label><label>年级<input v-model="form.grade" maxlength="40" /></label><label v-if="can('user.identity.read')">学号<input v-model="form.studentNo" :disabled="selected?.verification.status==='approved'" maxlength="100" /></label><label>教师编号<input v-model="form.teacherNo" maxlength="100" /></label></template><label>操作原因<textarea v-model="reason" minlength="4" maxlength="500" required /></label><p v-if="error" role="alert">{{ error }}</p><button class="admin-primary" :disabled="busy">确认并记录审计</button></form></AdminDialog>
</template>
<style scoped>
.users-filters { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; padding:20px; margin-bottom:20px }.users-filters label { display:grid; gap:5px; font-size:12px }.users-filters input,.users-filters select { width:100%; min-width:0 }.users-more-filters{grid-column:1/-1}.users-more-filters summary{cursor:pointer;font-size:13px;color:#686460}.users-more-filters>div{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:12px}.users-table { overflow:auto }.users-table table { width:100%; min-width:960px; border-collapse:collapse }.users-table th,.users-table td { text-align:left; padding:14px; border-bottom:1px solid #ece5de; font-size:13px }.users-table small { display:block; margin-top:4px; color:#686460; overflow-wrap:anywhere }.identity-status{white-space:nowrap}.identity-status[data-status="approved"]{color:#218653}.identity-status[data-status="pending"]{color:#b76400}.identity-status[data-status="rejected"],.identity-status[data-status="revoked"]{color:#b73b34}.selected { background:#fff6f1 }.users-detail { margin-top:20px; padding:24px }.users-detail dl { display:grid; grid-template-columns:160px 1fr; gap:14px }.users-detail dd { margin:0; overflow-wrap:anywhere }.users-detail footer,.identity-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:22px }.identity-detail code{font-size:14px}.identity-warning{margin-left:10px;color:#b73b34}.identity-actions{margin-bottom:8px}@media(max-width:1000px){.users-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.users-more-filters>div{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
