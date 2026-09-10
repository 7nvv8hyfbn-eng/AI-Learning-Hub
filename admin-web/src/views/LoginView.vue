<script setup lang="ts">
import AdminIcon from '../components/AdminIcon.vue'
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { MfaHintDto } from '@ai-learning-hub/contracts'
import { api } from '../services/api'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'

const form = reactive({ identifier: '', password: '' })
const code = ref('')
const session = useSessionStore()
const router = useRouter()
const route = useRoute()
const hint = ref<MfaHintDto | null>(null)
const hintError = ref('')
let hintTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const refreshHint = async () => {
  const challenge = session.mfa?.challenge
  if (!challenge || !session.mfa?.experienceHint) return
  hint.value = null; hintError.value = ''
  clearTimeout(hintTimer)
  try {
    const result = await api<MfaHintDto>('/admin-auth/mfa-hint', { method: 'POST', body: JSON.stringify({ challenge }) }, false)
    if (disposed || session.mfa?.challenge !== challenge) return
    hint.value = result
    hintTimer = setTimeout(() => void refreshHint(), Math.max(1000, result.expiresAt - Date.now() + 250))
  } catch (error) {
    if (session.mfa?.challenge === challenge) hintError.value = error instanceof Error ? error.message : '提示码读取失败'
  }
}
watch(() => session.mfa?.challenge, () => {
  clearTimeout(hintTimer); hint.value = null; hintError.value = ''
  void refreshHint()
})
onBeforeUnmount(() => { disposed = true; clearTimeout(hintTimer) })
const submit = async () => {
  try {
    if (session.mfa) await session.verifyMfa(code.value)
    else { await session.login(form.identifier, form.password); form.password = '' }
  } catch { return }
  code.value = ''
  if (session.user && !session.recoveryCodes.length) await enter()
}
const enter = async () => {
  session.recoveryCodes = []
  const redirect = String(route.query.redirect || '/dashboard')
  await router.replace(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard')
}
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="login-brand"><span>A</span><div><strong>AI MAKER CAMPUS</strong><small>高校 AI 创客学习平台｜管理后台</small></div></div>
      <div><p class="eyebrow">统一数据管理</p><h1>欢迎回来</h1><p>登录后管理课程、实训、资源和学习成长数据。</p></div>
      <section v-if="session.recoveryCodes.length" aria-label="一次性恢复码">
        <h2>保存恢复码</h2><p>每个恢复码只能使用一次。请离线妥善保存，关闭后不会再次显示。</p>
        <ul><li v-for="item in session.recoveryCodes" :key="item"><code>{{ item }}</code></li></ul>
        <button class="admin-primary" type="button" @click="enter">已保存，进入后台</button>
      </section>
      <form v-else @submit.prevent="submit">
        <template v-if="!session.mfa">
        <label>管理员账号 / 邮箱<input v-model="form.identifier" autocomplete="username" required autofocus placeholder="请输入账号或邮箱" /></label>
        <label>密码<input v-model="form.password" type="password" autocomplete="current-password" minlength="8" required placeholder="请输入密码" /></label>
        </template>
        <template v-else>
          <div v-if="session.mfa.experienceHint" role="status">
            <p v-if="hint?.code">体验环境提示码：<strong>{{ hint.code }}</strong>（到期自动更新）</p>
            <p v-else-if="hint">上一组验证码已使用，正在等待下一组。</p>
            <p v-else-if="!hintError">正在读取体验环境提示码…</p>
            <p v-if="hintError" class="form-error">{{ hintError }} <button type="button" class="text-link" @click="refreshHint">重试</button></p>
          </div>
          <p v-if="session.mfa.experienceHint">输入上方提示码即可登录；也可使用认证器动态码。</p>
          <p v-else-if="session.mfa.enrollment">请在认证器中添加 TOTP 账号，输入下方密钥，再填写6位验证码完成绑定。</p>
          <label v-if="session.mfa.secret">认证器密钥<input :value="session.mfa.secret" readonly autocomplete="off" /></label>
          <label>{{ session.mfa.enrollment ? '6位动态验证码' : '动态验证码或一次性恢复码' }}<input v-model="code" required autocomplete="one-time-code" maxlength="64" /></label>
          <button type="button" class="back-button" @click="session.mfa = null; code = ''" aria-label="返回密码登录" title="返回密码登录"><AdminIcon name="back" /></button>
        </template>
        <p v-if="session.error" class="form-error" role="alert">{{ session.error }}</p>
        <button class="admin-primary" type="submit" :disabled="session.loading">{{ session.loading ? '正在验证…' : session.mfa ? '验证并登录' : '登录管理后台' }}</button>
      </form>
      <small>账号由环境初始化流程创建，页面不内置默认凭据。</small>
    </section>
  </main>
</template>
