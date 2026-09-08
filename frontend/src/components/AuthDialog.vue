<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppDialog from './base/AppDialog.vue'
import { useAuthStore } from '../stores/auth'
import { useAuthUiStore } from '../stores/authUi'
import { useLearningStore } from '../stores/learning'
import { authApi } from '../services/api/auth'
const auth = useAuthStore(), ui = useAuthUiStore(), router = useRouter()
const identifier = ref(''), username = ref(''), email = ref(''), password = ref(''), confirmation = ref(''), displayName = ref(''), inviteCode = ref(''), agreement = ref(false), remember = ref(true), forgot = ref(false), message = ref(''), localError = ref('')
watch(() => ui.visible, async (open) => { if (!open) { password.value = ''; confirmation.value = ''; return }; localError.value = ''; message.value = ''; forgot.value = false; auth.error = ''; try { await auth.loadRegistrationConfig() } catch (error) { localError.value = error instanceof Error ? error.message : '注册配置读取失败' } }, { immediate: true })
const submit = async () => {
  localError.value = ''; message.value = ''
  const registering = ui.mode === 'register'
  try {
    if (forgot.value) {
      if (auth.dataMode === 'mock') { message.value = '本地演示账号不发送邮件，也不修改真实服务端账号。'; return }
      message.value = (await authApi.forgotPassword(email.value)).message; return
    }
    if (registering) {
      if (!agreement.value) throw new Error('请阅读并同意用户协议与隐私政策')
      if (password.value !== confirmation.value) throw new Error('两次密码不一致')
      if (!/[A-Za-z]/.test(password.value) || !/\d/.test(password.value)) throw new Error('密码须同时包含字母和数字')
      if (new TextEncoder().encode(password.value).length > 72) throw new Error('密码不能超过72个UTF-8字节（汉字通常占3字节）')
      if (!auth.registrationConfig || auth.registrationConfig.mode === 'closed') throw new Error('注册暂不可用，请稍后重试或联系管理员')
      await auth.register({ username: username.value, displayName: displayName.value, email: email.value, password: password.value, agreementVersion: auth.registrationConfig!.agreementVersion, ...(inviteCode.value ? { inviteCode: inviteCode.value } : {}) })
    } else {
      await auth.login(identifier.value, password.value, remember.value)
      if (auth.dataMode === 'api') void useLearningStore().syncFromApi().catch(() => window.dispatchEvent(new CustomEvent('api-error', { detail: { message: '登录成功，学习资料暂未同步，请稍后重试' } })))
    }
    const target = ui.redirect, action = ui.action
    ui.visible = false; ui.action = null; password.value = ''; confirmation.value = ''
    if (registering || (!auth.user?.communityWriteEnabled && action)) { await router.push('/community/verification'); return }
    if (target) await router.push(target)
    else await router.push('/community')
    await action?.()
  } catch (error) { localError.value = error instanceof Error ? error.message : '认证失败' }
}
</script>
<template><AppDialog :model-value="ui.visible" title="统一学习账号" :close-on-backdrop="false" @update:model-value="ui.close()">
  <p v-if="ui.reason" class="community-notice">{{ ui.reason }}</p>
  <div class="community-feed-tabs"><button :aria-selected="ui.mode === 'login'" @click="ui.mode = 'login'; forgot = false">登录</button><button v-if="auth.registrationConfig?.mode !== 'closed'" :aria-selected="ui.mode === 'register'" @click="ui.mode = 'register'; forgot = false">注册</button></div>
  <p v-if="auth.dataMode === 'mock'" class="community-notice">这是本地演示账号，不会创建真实服务端账号。</p>
  <form class="dialog-form" @submit.prevent="submit">
    <label v-if="ui.mode === 'register' && !forgot">登录账号<input v-model="username" required minlength="4" maxlength="24" pattern="(?!_)(?!.*__)[A-Za-z0-9_]{4,24}(?<!_)" autocomplete="username" placeholder="4～24位字母、数字或下划线" /></label>
    <label v-if="ui.mode === 'register' && !forgot">显示名称<input v-model="displayName" required minlength="2" maxlength="40" autocomplete="nickname" /></label>
    <label v-if="ui.mode === 'register' || forgot">邮箱<input v-model="email" type="email" required autocomplete="email" maxlength="254" /></label>
    <label v-else>账号 / 邮箱<input v-model="identifier" required autocomplete="username" minlength="3" maxlength="254" /></label>
    <template v-if="!forgot"><label>密码<input v-model="password" type="password" required :minlength="ui.mode === 'login' ? 8 : auth.registrationConfig?.passwordMinLength || 8" maxlength="128" :autocomplete="ui.mode === 'login' ? 'current-password' : 'new-password'" /></label>
      <template v-if="ui.mode === 'register'"><label>确认密码<input v-model="confirmation" type="password" required autocomplete="new-password" /></label><label v-if="auth.registrationConfig?.mode === 'invite'">邀请码<input v-model="inviteCode" required /></label><label class="community-checkbox"><input v-model="agreement" type="checkbox" required />我已阅读并同意 <RouterLink to="/terms" target="_blank">用户协议</RouterLink>和<RouterLink to="/privacy" target="_blank">隐私政策</RouterLink></label></template>
      <div v-else class="composer-row"><label class="community-checkbox"><input v-model="remember" type="checkbox" />记住登录状态</label><button class="text-link" type="button" @click="forgot = true">忘记密码</button><RouterLink to="/account-recovery" @click="ui.close()">账号恢复与申诉</RouterLink></div>
    </template>
    <p v-if="localError || auth.error" class="community-error" role="alert">{{ localError || auth.error }}</p><p v-if="message" role="status">{{ message }}</p>
    <button class="button primary" :disabled="auth.loading || (!forgot && ui.mode === 'register' && (!auth.registrationConfig || auth.registrationConfig.mode === 'closed'))">{{ auth.loading ? '处理中…' : forgot ? '发送重置邮件' : ui.mode === 'register' ? '注册并开始学习' : '登录' }}</button>
    <button v-if="forgot" type="button" class="text-link" @click="forgot = false">返回登录</button>
    <p v-if="auth.registrationConfig?.mode === 'closed'" class="muted">注册已关闭，请联系管理员创建账号。</p>
  </form>
</AppDialog></template>
