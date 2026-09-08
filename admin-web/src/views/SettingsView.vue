<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import { api } from '../services/api'
import { publicPageVisualKeys, type AdminPageVisualsDto, type PublicPageVisualKey, type RegistrationConfigDto, type RegistrationSettingsDto } from '@ai-learning-hub/contracts'
import { usePermissionAction } from '../composables/usePermissionAction'
import PersistenceStatus from '../components/PersistenceStatus.vue'
import MediaAssetPicker from '../components/MediaAssetPicker.vue'

interface Setting { key: string; value: unknown; sensitive: boolean }
interface School { id: string; name: string; departments: Array<{ id: string; name: string }>; _count: { users: number } }
interface SystemLog { id: string; result?: string; method?: string; path?: string; createdAt: string }
interface Notification { id: string; title: string; status: string; _count: { reads: number } }
const settings = ref<Setting[]>([])
const schools = ref<School[]>([])
const loginLogs = ref<SystemLog[]>([])
const operationLogs = ref<SystemLog[]>([])
const notifications = ref<Notification[]>([])
const settingsVersion = ref(0)
const registration = ref<RegistrationConfigDto>()
const registrationError = ref('')
const canWrite = usePermissionAction('settings.write')
const canReadMedia = usePermissionAction('media.read'), canManageVisuals = usePermissionAction('media.default.manage')
const visuals = ref<AdminPageVisualsDto>(), visualError = ref(''), visualBusy = ref(false)
const visualLabels: Record<PublicPageVisualKey, string> = { topicsHeroAssetId: '通识基础', labsHeroAssetId: '实训工坊', resourcesHeroAssetId: '教程中心', frontierHeroAssetId: 'AI 前沿', assessmentsHeroAssetId: '挑战测评', profileHeroAssetId: '个人中心' }
const loadVisuals = async () => {
  if (!canReadMedia.value) return
  visualError.value = ''
  try { visuals.value = await api<AdminPageVisualsDto>('/admin/page-visuals') }
  catch (cause) { visualError.value = cause instanceof Error ? cause.message : '页面主视觉读取失败' }
}
const saveVisuals = async () => {
  if (!visuals.value || !canManageVisuals.value || visualBusy.value) return
  visualBusy.value = true; visualError.value = ''
  try {
    await api('/admin/page-visuals', { method: 'PUT', body: JSON.stringify({ value: { ...visuals.value.value }, expectedRevision: visuals.value.revision }) })
    await loadVisuals()
    ElMessage.success('六个页面主视觉已保存')
  } catch (cause) { visualError.value = cause instanceof Error ? cause.message : '页面主视觉保存失败' }
  finally { visualBusy.value = false }
}
const saveRegistration = async () => {
  if (!canWrite.value) { registrationError.value = '当前账号仅可查看注册设置'; return }
  if (!registration.value) return
  registrationError.value = ''
  const { mode, emailVerification, agreementVersion, passwordMinLength, schoolRequired, registrationRateWindowMinutes, registrationMaxAttemptsPerIp, registrationMaxAttemptsPerIdentifier, registrationMaxSuccessPerIp } = registration.value
  try { registration.value = await api<RegistrationConfigDto>('/admin/registration/settings', { method: 'PATCH', body: JSON.stringify({ mode, emailVerification, agreementVersion, passwordMinLength, schoolRequired, registrationRateWindowMinutes, registrationMaxAttemptsPerIp, registrationMaxAttemptsPerIdentifier, registrationMaxSuccessPerIp, expectedRevision: registration.value.revision } satisfies RegistrationSettingsDto) }); ElMessage.success('注册设置已保存并生效') }
  catch (cause) { registrationError.value = cause instanceof Error ? cause.message : '注册设置保存失败' }
}
const notification = reactive({ title: '', content: '' })
const form = reactive<Record<string, string | number | boolean | string[]>>({
  platform_name: 'AI MAKER CAMPUS',
  platform_subtitle: '高校 AI 创客学习平台',
  upload_max_mb: 20,
  allowed_file_types: ['pdf','docx','pptx','zip','txt','png','jpg','webp'],
  session_minutes: 10080,
  notification_enabled: true,
  allowed_login_domains: [] as string[],
})
const allowedFileTypesText = ref('pdf,docx,pptx,zip,txt,png,jpg,webp')
const allowedLoginDomainsText = ref('')
onMounted(async () => {
  void loadVisuals()
  try { registration.value = await api<RegistrationConfigDto>('/admin/registration/settings') } catch (cause) { registrationError.value = cause instanceof Error ? cause.message : '注册配置读取失败' }
  ;[settings.value, schools.value, loginLogs.value, operationLogs.value, notifications.value] = await Promise.all([
    api<Setting[]>('/admin/settings'),
    api<School[]>('/admin/schools'),
    api<SystemLog[]>('/admin/login-logs'),
    api<SystemLog[]>('/admin/operation-logs'),
    api<Notification[]>('/admin/notifications'),
  ])
  settingsVersion.value = Number(settings.value.find((item) => item.key === 'settings_version')?.value || 0)
  for (const item of settings.value) {
    if (item.sensitive || !(item.key in form) || item.value === null) continue
    if (typeof form[item.key] === 'number') form[item.key] = Number(item.value)
    else if (typeof form[item.key] === 'boolean') form[item.key] = Boolean(item.value)
    else if (Array.isArray(form[item.key])) form[item.key] = Array.isArray(item.value) ? item.value.map(String) : []
    else form[item.key] = String(item.value)
  }
  allowedFileTypesText.value = (form.allowed_file_types as string[]).join(',')
  allowedLoginDomainsText.value = (form.allowed_login_domains as string[]).join(',')
})
const save = async () => {
  form.allowed_file_types = allowedFileTypesText.value.split(',').map((item) => item.trim().replace(/^\./, '')).filter(Boolean)
  form.allowed_login_domains = allowedLoginDomainsText.value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  const result = await api<{ version: number }>('/admin/settings/batch', {
    method: 'PATCH',
    body: JSON.stringify({
      version: settingsVersion.value + 1,
      items: Object.entries(form).map(([key, value]) => ({ key, value })),
    }),
  })
  settingsVersion.value = result.version
  ElMessage.success('系统设置已保存')
}
const createNotification = async () => {
  const created = await api<Notification>('/admin/notifications', { method: 'POST', body: JSON.stringify(notification) })
  const published = await api<Notification>(`/admin/notifications/${created.id}/publish`, { method: 'POST' })
  notifications.value.unshift({ ...published, _count: { reads: 0 } })
  Object.assign(notification, { title: '', content: '' })
  ElMessage.success('通知已发布')
}
</script>

<template>
  <PersistenceStatus />
  <AdminPageHeader title="系统设置" description="维护平台公开配置；敏感密钥只通过部署环境注入">
    <template #actions><button class="admin-primary" type="button" @click="save">保存设置</button></template>
  </AdminPageHeader>
  <div class="settings-grid">
    <section v-if="canReadMedia" class="panel page-visual-settings">
      <h2>页面主视觉</h2>
      <p class="settings-note">仅六个公开页面的图片设置，独立于通用系统配置；移除显式图片后使用对应默认图。</p>
      <div v-if="visuals" class="page-visual-grid"><div v-for="key in publicPageVisualKeys" :key="key"><h3>{{ visualLabels[key] }}</h3><MediaAssetPicker v-model="visuals.value[key]" kind="hero" content-type="page_hero" :category-key="key.replace('HeroAssetId', '')" :disabled="!canManageVisuals || visualBusy" /></div></div>
      <p v-if="visualError" class="error-banner" role="alert">{{ visualError }} <button type="button" :disabled="visualBusy" @click="loadVisuals">重新读取最新设置</button></p>
      <button class="admin-primary" type="button" :disabled="!visuals || !canManageVisuals || visualBusy" @click="saveVisuals">保存页面主视觉</button>
    </section>
    <section class="panel"><h2>注册设置</h2><form v-if="registration" class="admin-form" @submit.prevent="saveRegistration"><label>注册模式<select v-model="registration.mode"><option value="open">开放注册</option><option value="invite">邀请注册</option><option value="closed">关闭注册</option></select></label><label class="toggle-row">注册时验证邮箱<el-switch v-model="registration.emailVerification" :disabled="!registration.mailAvailable" /></label><label>协议版本<input v-model="registration.agreementVersion" required maxlength="60" /></label><label>密码最低长度<input v-model.number="registration.passwordMinLength" type="number" min="8" max="72" required /></label><label>频率时间窗（分钟）<input v-model.number="registration.registrationRateWindowMinutes" type="number" min="1" max="1440" required /></label><label>单 IP 最大尝试<input v-model.number="registration.registrationMaxAttemptsPerIp" type="number" min="10" max="10000" required /></label><label>单账号标识最大尝试<input v-model.number="registration.registrationMaxAttemptsPerIdentifier" type="number" min="2" max="100" required /></label><label>单 IP 最大成功注册数<input v-model.number="registration.registrationMaxSuccessPerIp" type="number" min="5" max="1000" required /></label><label class="toggle-row">首次引导学校必填<el-switch v-model="registration.schoolRequired" /></label><p class="settings-note">共享出口的 IP 阈值应高于账号标识阈值。邮件通道{{ registration.mailAvailable ? '已配置' : '未配置，找回密码不可用' }}；邀请码{{ registration.inviteAvailable ? '已配置' : '尚未配置' }}。密钥只能在部署环境注入。</p><button class="admin-primary">保存注册设置</button></form><p v-if="registrationError" role="alert">{{ registrationError }}</p></section>
    <section class="panel"><h2>平台基础信息</h2><form class="admin-form" @submit.prevent="save"><label>平台名称<input v-model="form.platform_name as string" /></label><label>平台副标题<input v-model="form.platform_subtitle as string" /></label><label>会话时长（分钟）<input v-model.number="form.session_minutes as number" type="number" min="15" /></label><label class="toggle-row">启用平台通知<el-switch v-model="form.notification_enabled as boolean" /></label><label>允许登录的邮箱域名（逗号分隔）<input v-model="allowedLoginDomainsText" placeholder="为空表示不限制" /></label></form></section>
    <section class="panel"><h2>文件与存储策略</h2><form class="admin-form" @submit.prevent="save"><label>单文件上限（MB）<input v-model.number="form.upload_max_mb as number" type="number" min="1" max="20" /></label><label>允许的扩展名<input v-model="allowedFileTypesText" /></label><p class="settings-note">扩展名按字符串数组保存；本地、MinIO 与 S3 驱动由服务部署环境选择。访问密钥不会通过本页面读取或返回。</p></form></section>
    <section class="panel"><h2>组织机构</h2><p class="settings-note">学校、院系与用户归属来自同一 PostgreSQL 数据源。</p><ul><li v-for="school in schools" :key="school.id">{{ school.name }}：{{ school.departments.map((item) => item.name).join('、') || '暂无院系' }}（{{ school._count.users }} 人）</li></ul></section>
    <section class="panel"><h2>发布平台通知</h2><form class="admin-form" @submit.prevent="createNotification"><label>通知标题<input v-model="notification.title" required maxlength="120" /></label><label>通知内容<textarea v-model="notification.content" required maxlength="2000" rows="3" /></label><button class="admin-primary" type="submit">创建并发布</button></form><p class="settings-note">已发布 {{ notifications.filter((item) => item.status === 'published').length }} 条，累计已读 {{ notifications.reduce((sum, item) => sum + item._count.reads, 0) }} 次。</p></section>
    <section class="panel"><h2>运行审计</h2><p class="settings-note">最近登录 {{ loginLogs.length }} 条，管理操作 {{ operationLogs.length }} 条；日志不展示密码、令牌或原始 IP。</p><ul><li v-for="item in operationLogs.slice(0, 4)" :key="item.id">{{ item.method }} {{ item.path }} · {{ item.result }} · {{ new Date(item.createdAt).toLocaleString('zh-CN') }}</li></ul></section>
    <section class="panel security-boundary"><h2>安全边界</h2><ul><li>JWT、数据库和对象存储密钥仅从运行环境读取。</li><li>学生端公开接口不返回题目答案与评分规则。</li><li>实训仅执行结构化白名单动作，不开放真实 Shell。</li><li>管理接口由服务端 RBAC 校验，不依赖前端菜单。</li></ul></section>
  </div>
</template>

<style scoped>
.page-visual-settings { grid-column: 1 / -1; min-width: 0; }
.page-visual-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.page-visual-grid > div { min-width: 0; }
.page-visual-grid h3 { font-size: 14px; }
@media (max-width: 1100px) { .page-visual-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .page-visual-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
