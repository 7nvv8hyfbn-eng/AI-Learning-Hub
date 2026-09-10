<script setup lang="ts">
import AppIcon from '../components/base/AppIcon.vue'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { governanceStatusLabels, reportCategories, sanctionLabels, type GovernanceAppealInput, type GovernanceMineDto } from '@ai-learning-hub/contracts'
import AppDialog from '../components/base/AppDialog.vue'
import { communityApi } from '../services/api/community'
import { dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
const route = useRoute(), recovery = computed(() => route.path === '/account-recovery')
const auth = useAuthStore()
const state = ref<GovernanceMineDto>({ actions: [], reports: [], appeals: [], reviews: [] })
const token = ref(''), identifier = ref(''), password = ref(''), error = ref(''), notice = ref(''), busy = ref(false), open = ref(false)
const reason = ref(''), evidence = ref(''), target = ref<Pick<GovernanceAppealInput, 'actionId' | 'reviewId'>>({})
const labels: Record<string, string> = { post: '帖子', resource: '资源作品', comment: '评论', collection: '公开合集', profile: '账号资料' }
const operationLabels: Record<string, string> = { post: '发帖', comment: '评论', upload: '上传', interaction: '互动', profile: '资料', collection: '公开合集', report: '举报' }
const date = (value: string) => new Date(value).toLocaleString('zh-CN')
let loadEpoch = 0, page = 1
const load = async (append = false) => {
  const epoch = ++loadEpoch
  const nextPage = append ? page + 1 : 1
  try {
    const data = recovery.value ? await communityApi.recoveryMine(token.value, nextPage) : await communityApi.governance(nextPage)
    if (epoch === loadEpoch) { state.value = append ? { actions: [...state.value.actions, ...data.actions], reports: [...state.value.reports, ...data.reports], appeals: [...state.value.appeals, ...data.appeals], reviews: [...state.value.reviews, ...data.reviews], hasMore: data.hasMore } : data; page = nextPage; error.value = '' }
  }
  catch (cause) { if (epoch === loadEpoch) { state.value = { actions: [], reports: [], appeals: [], reviews: [] }; error.value = cause instanceof Error ? cause.message : '处理记录读取失败'; if (recovery.value) token.value = '' } }
}
const verify = async () => {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { token.value = (await communityApi.recoverySession(identifier.value, password.value)).token; password.value = ''; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '账号验证失败' }
  finally { busy.value = false; password.value = '' }
}
const pending = (actionId?: string, reviewId?: string) => state.value.appeals.some((row) => (actionId ? row.actionId === actionId : row.reviewId === reviewId) && ['pending', 'reviewing'].includes(row.status))
const start = (actionId?: string, reviewId?: string) => { target.value = { ...(actionId ? { actionId } : { reviewId }) }; reason.value = ''; evidence.value = ''; open.value = true }
const submit = async () => {
  if (busy.value) return
  busy.value = true
  const input = { ...target.value, reason: reason.value.trim(), evidence: evidence.value.split('\n').map((x) => x.trim()).filter(Boolean) }
  try { if (recovery.value) await communityApi.recoveryAppeal(token.value, input); else await communityApi.appeal(input); open.value = false; notice.value = '申诉已提交，处理结果会在此处和通知中更新。'; await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '申诉提交失败' }
  finally { busy.value = false }
}
watch(() => [route.path, auth.user?.id], () => { loadEpoch++; state.value = { actions: [], reports: [], appeals: [], reviews: [] }; token.value = ''; password.value = ''; error.value = ''; notice.value = ''; open.value = false; if (!recovery.value && auth.user) void load() }, { immediate: true })
</script>
<template><section class="page-container governance-page">
  <header class="community-page-heading"><div><h1>{{ recovery ? '账号恢复与申诉' : '处理与申诉' }}</h1><p>查看具体内容、规则依据与期限；申诉由非原处理人复核。</p></div><button v-if="!recovery || token" class="button secondary small" @click="load()">刷新</button></header>
  <p v-if="dataMode === 'mock'" class="community-notice">当前为显式本地演示，记录不会提交服务器。</p>
  <form v-if="recovery && !token" class="dialog-form" @submit.prevent="verify"><p>账号无法正常登录时，仍可验证原有账号密码查看本人处理并申诉。恢复验证不会解除处罚。</p><label>用户名或邮箱<input v-model="identifier" required autocomplete="username" maxlength="254" /></label><label>原账号密码<input v-model="password" type="password" required autocomplete="current-password" minlength="8" maxlength="128" /></label><button class="button primary" :disabled="busy || dataMode === 'mock'">验证并查看本人记录</button><RouterLink to="/welcome" class="back-button" aria-label="返回首页使用忘记密码" title="返回首页使用忘记密码"><AppIcon name="back" /></RouterLink></form>
  <p v-if="error" class="community-error" role="alert">{{ error }}</p><p v-if="notice" class="community-notice" role="status">{{ notice }}</p>
  <template v-if="!recovery || token"><h2>涉及我的处理</h2>
    <article v-for="item in state.actions" :key="item.id" class="community-card governance-record"><h3>{{ sanctionLabels[item.action] }} · {{ labels[item.target.type] || item.target.type }}</h3><p>{{ item.target.title }} · 修订 {{ item.target.revision ?? '历史记录' }}</p><details v-if="item.target.text"><summary>查看涉及正文</summary><p style="white-space:pre-wrap">{{ item.target.text }}</p></details><p v-else-if="item.target.currentRevision !== item.target.revision">内容已变为修订 {{ item.target.currentRevision }}，此处罚只引用原修订。</p><p v-if="item.operations.length">受限功能：{{ item.operations.map((key) => operationLabels[key] || key).join('、') }}</p><p>规则依据：{{ item.ruleCode }}<br />处理理由：{{ item.reason }}</p><p>期限：{{ item.expiresAt ? date(item.expiresAt) : '未设到期时间' }} · {{ item.revokedAt ? '已撤销' : item.active ? '生效中' : '已到期或尚未开始' }}</p><p v-if="item.revokeReason">撤销理由：{{ item.revokeReason }}</p><RouterLink v-if="item.target.route && !recovery" :to="item.target.route">查看涉及内容</RouterLink><button v-if="!item.revokedAt" class="button secondary small" :disabled="pending(item.id)" @click="start(item.id)">{{ pending(item.id) ? '申诉处理中' : '提出申诉' }}</button></article>
    <p v-if="!state.actions.length">暂无处罚记录。</p>
    <article v-for="review in state.reviews" :key="review.id" class="community-card governance-record"><h3>{{ labels[review.targetType] || '内容' }}修订 {{ review.contentRevision }} 未通过复核</h3><p>规则版本 {{ review.ruleVersion }} · {{ review.reason }}</p><p>对象编号：{{ review.targetId }}</p><button class="button secondary small" :disabled="pending(undefined, review.id)" @click="start(undefined, review.id)">{{ pending(undefined, review.id) ? '申诉处理中' : '对此修订申诉' }}</button></article>
    <h2>我的申诉</h2><article v-for="item in state.appeals" :key="item.id" class="community-card governance-record"><strong>{{ governanceStatusLabels[item.status] }}</strong><p>{{ item.reason }}</p><p>{{ item.resultReason || '等待复核，重复点击不会重复提交。' }}</p><small>{{ date(item.createdAt) }} · 编号 {{ item.id }}</small></article><p v-if="!state.appeals.length">暂无申诉。</p>
    <h2>我提交的举报</h2><article v-for="item in state.reports" :key="item.id" class="community-card governance-record"><strong>{{ governanceStatusLabels[item.status] }} · {{ reportCategories[item.category] }}</strong><p>{{ item.target.title }}</p><p>{{ item.resultReason || item.description || '等待处理' }}</p><small>{{ date(item.createdAt) }} · 编号 {{ item.id }}</small></article><p v-if="!state.reports.length">暂无举报。</p>
    <button v-if="state.hasMore" class="button secondary" @click="load(true)">加载更多处理记录</button>
  </template>
  <AppDialog v-model="open" title="对具体处理提出申诉"><form class="dialog-form" @submit.prevent="submit"><label>申诉理由<textarea v-model="reason" required minlength="10" maxlength="1000" rows="5" /></label><label>补充证据链接（最多3条）<textarea v-model="evidence" maxlength="1502" rows="3" placeholder="每行一个 HTTPS 链接" /></label><p>同一事项只能有一条待处理申诉；处理后可凭新理由或证据再次提交。每天最多5次。</p><p v-if="error" class="community-error" role="alert">{{ error }}</p><button class="button primary" :disabled="busy">提交申诉</button></form></AppDialog>
</section></template>
<style scoped>.governance-page{max-width:960px}.governance-record{padding:20px;margin:14px 0;overflow-wrap:anywhere}.governance-record p{margin:10px 0}.governance-record .button{margin:8px}.dialog-form{display:grid;gap:12px;max-width:620px}.dialog-form label{display:grid;gap:6px}</style>
