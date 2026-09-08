<script setup lang="ts">
import type { CampusIdentityVerificationDto, IdentityVerificationStatus } from '@ai-learning-hub/contracts'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { communityApi } from '../services/api/community'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()
const state = ref<CampusIdentityVerificationDto | null>(null)
const form = reactive({ realName: '', idNumber: '', className: '', studentNo: '' })
const loading = ref(true), saving = ref(false), error = ref('')
const labels: Record<IdentityVerificationStatus, string> = { unsubmitted: '未提交', pending: '待审核', approved: '已认证', rejected: '已驳回', revoked: '已撤销' }
const canSubmit = computed(() => !state.value || ['unsubmitted', 'rejected', 'revoked'].includes(state.value.status))
const load = async () => {
  loading.value = true; error.value = ''
  try {
    state.value = await communityApi.verification()
    form.className = state.value.className || ''
    form.studentNo = state.value.studentNo || ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '认证状态读取失败' }
  finally { loading.value = false }
}
const syncAuth = async () => { await auth.restore(true) }
const submit = async () => {
  saving.value = true; error.value = ''
  try {
    state.value = await communityApi.submitVerification({ ...form, ...(state.value?.revision == null ? {} : { expectedRevision: state.value.revision }) })
    form.realName = ''; form.idNumber = ''
    await syncAuth()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '认证资料提交失败' }
  finally { saving.value = false }
}
const demoReview = async (status: 'approved' | 'rejected' | 'revoked') => {
  state.value = await communityApi.demoVerificationStatus(status, status === 'rejected' ? '演示：资料照片与填写信息不一致，请核对后重交。' : status === 'revoked' ? '演示：账号资料变更，需要重新核验。' : '演示：人工核验通过。')
  await syncAuth()
}
onMounted(load)
</script>

<template>
  <section class="verification-page">
    <header><p>校园身份核验</p><h1>实名认证</h1><span>认证资料仅用于校园身份人工核验，不会展示在社区个人主页。</span></header>
    <p v-if="auth.dataMode === 'mock'" class="verification-demo">演示模式 · 数据不会同步到服务器；页面只使用虚构测试资料。</p>
    <p v-if="error" class="community-error" role="alert">{{ error }} <button v-if="!state" class="text-link" @click="load">重试</button></p>
    <div v-if="loading" class="verification-card">正在读取认证状态…</div>
    <template v-else-if="state">
      <section class="verification-card verification-status">
        <div><small>当前状态</small><strong :data-status="state.status">{{ labels[state.status] }}</strong></div>
        <dl v-if="state.status !== 'unsubmitted'">
          <div><dt>姓名</dt><dd>{{ state.maskedRealName || '—' }}</dd></div><div><dt>身份证号</dt><dd>{{ state.maskedIdNumber || '—' }}</dd></div>
          <div><dt>班级</dt><dd>{{ state.className || '—' }}</dd></div><div><dt>学号</dt><dd>{{ state.studentNo || '—' }}</dd></div>
          <div><dt>提交时间</dt><dd>{{ state.submittedAt ? new Date(state.submittedAt).toLocaleString('zh-CN') : '—' }}</dd></div><div><dt>审核时间</dt><dd>{{ state.reviewedAt ? new Date(state.reviewedAt).toLocaleString('zh-CN') : '—' }}</dd></div>
        </dl>
        <p v-if="state.reviewReason" class="verification-reason"><b>审核意见：</b>{{ state.reviewReason }}</p>
        <p v-if="state.status === 'pending'">资料正在由管理员人工审核，期间仍可浏览社区和正常学习。</p>
        <p v-if="state.status === 'approved'">认证已通过，社区互动权限现已开放，无需重新登录。</p>
      </section>
      <form v-if="canSubmit" class="verification-card verification-form" @submit.prevent="submit">
        <h2>{{ state.status === 'unsubmitted' ? '提交认证资料' : '修改并重新提交' }}</h2>
        <div class="verification-fields"><label>真实姓名 *<input v-model.trim="form.realName" required minlength="2" maxlength="40" autocomplete="name" /></label><label>身份证号 *<input v-model.trim="form.idNumber" required minlength="18" maxlength="18" inputmode="text" autocomplete="off" /></label><label>班级 *<input v-model.trim="form.className" required maxlength="80" autocomplete="organization-title" /></label><label>学号 *<input v-model.trim="form.studentNo" required maxlength="40" autocomplete="off" /></label></div>
        <p>完整身份证号只会加密保存，并仅供具备专门权限的审核人员核验。</p>
        <div class="verification-actions"><button class="button primary" :disabled="saving">{{ saving ? '提交中…' : '提交认证' }}</button><button type="button" class="button secondary" @click="router.push('/community')">稍后认证，先浏览</button></div>
      </form>
      <div v-else class="verification-actions"><RouterLink class="button secondary" to="/community">返回社区</RouterLink></div>
      <section v-if="auth.dataMode === 'mock' && ['pending', 'approved'].includes(state.status)" class="verification-card verification-simulator">
        <h2>演示审核</h2><p>以下操作只切换当前浏览器中的虚构状态，用于检查完整状态流。</p>
        <div class="verification-actions"><button v-if="state.status === 'pending'" class="button secondary" @click="demoReview('approved')">模拟通过</button><button v-if="state.status === 'pending'" class="button secondary" @click="demoReview('rejected')">模拟驳回</button><button v-if="state.status === 'approved'" class="button secondary" @click="demoReview('revoked')">模拟撤销</button></div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.verification-page{width:min(calc(100% - 48px),860px);margin:auto;padding:32px 0 64px}.verification-page>header{margin-bottom:22px}.verification-page>header p{margin:0;color:var(--amc-orange);font-weight:700}.verification-page h1{margin:5px 0 8px}.verification-page>header span,.verification-card>p{color:var(--amc-text-secondary)}.verification-demo,.verification-card{padding:18px 20px;border:1px solid var(--amc-border);border-radius:16px;background:var(--amc-surface)}.verification-demo{margin:0 0 16px;background:var(--amc-primary-soft);color:var(--amc-text-primary)}.verification-card{margin-bottom:16px}.verification-status>div:first-child{display:flex;align-items:center;gap:12px}.verification-status strong{font-size:18px}.verification-status strong[data-status="approved"]{color:var(--amc-success)}.verification-status strong[data-status="rejected"],.verification-status strong[data-status="revoked"]{color:var(--amc-error)}.verification-status dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 20px;margin:18px 0 0}.verification-status dl div{min-width:0}.verification-status dt{font-size:12px;color:var(--amc-text-muted)}.verification-status dd{margin:4px 0 0;overflow-wrap:anywhere}.verification-reason{padding:12px;border-radius:10px;background:var(--amc-bg-page)}.verification-form h2,.verification-simulator h2{margin:0 0 16px}.verification-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.verification-fields label{display:grid;gap:7px;font-weight:600}.verification-fields input{width:100%;height:42px;padding:0 12px;border:1px solid var(--amc-border);border-radius:10px;background:#fff;color:inherit}.verification-fields input:focus{outline:2px solid color-mix(in srgb,var(--amc-orange) 22%,transparent);border-color:var(--amc-orange)}.verification-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.verification-form .verification-actions{margin-top:18px}@media(max-width:767px){.verification-page{width:min(calc(100% - 28px),860px);padding-top:20px}.verification-status dl,.verification-fields{grid-template-columns:1fr}}
</style>
