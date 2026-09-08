<script setup lang="ts">
import { reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'

const form = reactive({ identifier: '', password: '' })
const session = useSessionStore()
const router = useRouter()
const route = useRoute()
const submit = async () => {
  try { await session.login(form.identifier, form.password) } catch { return }
  await router.replace(String(route.query.redirect || '/dashboard'))
}
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="login-brand"><span>A</span><div><strong>AI MAKER CAMPUS</strong><small>高校 AI 创客学习平台｜管理后台</small></div></div>
      <div><p class="eyebrow">统一数据管理</p><h1>欢迎回来</h1><p>登录后管理课程、实训、资源和学习成长数据。</p></div>
      <form @submit.prevent="submit">
        <label>管理员账号 / 邮箱<input v-model="form.identifier" autocomplete="username" required autofocus placeholder="请输入账号或邮箱" /></label>
        <label>密码<input v-model="form.password" type="password" autocomplete="current-password" minlength="8" required placeholder="请输入密码" /></label>
        <p v-if="session.error" class="form-error" role="alert">{{ session.error }}</p>
        <button class="admin-primary" type="submit" :disabled="session.loading">{{ session.loading ? '正在登录…' : '登录管理后台' }}</button>
      </form>
      <small>账号由环境初始化流程创建，页面不内置默认凭据。</small>
    </section>
  </main>
</template>
