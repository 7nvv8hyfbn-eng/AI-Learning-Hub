<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { assistantConfigDefaults, type AssistantAdminConfigDto, type AssistantConnectionDto } from '@ai-learning-hub/contracts'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import { usePermissionAction } from '../composables/usePermissionAction'
import { assistantApi } from '../services/assistant'
import idle from '../assets/assistant-idle.webp'

const canWrite = usePermissionAction('settings.write')
const form = reactive({ ...assistantConfigDefaults })
const saved = ref<AssistantAdminConfigDto>(), loading = ref(false), saving = ref(false), testing = ref(false)
const error = ref(''), notice = ref(''), connection = ref<AssistantConnectionDto>()
const busy = computed(() => loading.value || saving.value || testing.value)
async function read() {
  const config = await assistantApi.config()
  saved.value = config
  Object.assign(form, { enabled: config.enabled, name: config.name, welcome: config.welcome, position: config.position, digestEnabled: config.digestEnabled, keywords: config.keywords, length: config.length, style: config.style })
}
async function load() {
  if (busy.value) return
  loading.value = true; error.value = ''; notice.value = ''
  try { await read() } catch (cause) { error.value = cause instanceof Error ? cause.message : '读取设置失败' }
  finally { loading.value = false }
}
async function save() {
  if (!canWrite.value || busy.value || !saved.value || !form.name.trim() || !form.welcome.trim()) return
  saving.value = true; error.value = ''; notice.value = ''
  try {
    await assistantApi.save({ ...form, name: form.name.trim(), welcome: form.welcome.trim(), expectedRevision: saved.value.revision })
    await read()
    notice.value = '设置已保存并重新读取；刷新学生端后生效'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存设置失败' }
  finally { saving.value = false }
}
async function testConnection() {
  if (!canWrite.value || busy.value) return
  testing.value = true; connection.value = undefined
  try { connection.value = await assistantApi.test() }
  catch (cause) { connection.value = { ok: false, message: cause instanceof Error ? cause.message : '测试连接失败' } }
  finally { testing.value = false }
}
onMounted(load)
</script>
<template>
  <AdminPageHeader title="小雪助手设置" description="设置学习助手的外观、问答与帖子简讯">
    <template #actions><button class="admin-secondary" type="button" :disabled="busy" @click="load">重新读取</button><button class="admin-primary" type="button" :disabled="busy || !saved || !canWrite || !form.name.trim() || !form.welcome.trim()" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button></template>
  </AdminPageHeader>
  <p v-if="error" class="assistant-error" role="alert">{{ error }}</p><p v-if="notice" class="assistant-success" role="status">{{ notice }}</p><p v-if="loading" role="status">正在读取设置…</p>
  <div class="assistant-settings-grid">
    <section class="admin-card assistant-settings">
      <h2>基础信息</h2>
      <fieldset :disabled="busy || !saved || !canWrite">
        <label class="assistant-switch"><input v-model="form.enabled" type="checkbox">启用小雪助手</label>
        <label>助手名称<input v-model="form.name" maxlength="20" required></label>
        <label>欢迎语<textarea v-model="form.welcome" rows="4" maxlength="200" required /></label>
        <label>悬浮位置<select v-model="form.position"><option value="right">右下角</option><option value="left">左下角</option></select></label>
      </fieldset>
      <h2>模型连接</h2>
      <dl><dt>配置状态</dt><dd>{{ saved ? saved.modelConfigured ? '已配置' : '未配置' : '尚未读取' }}</dd><dt>模型名称</dt><dd>{{ saved?.modelName || '未配置' }}</dd><dt>服务地址</dt><dd>{{ saved?.modelBaseUrl || '未配置' }}</dd></dl>
      <p class="assistant-hint">模型连接信息由服务端配置，密钥不在此页面显示。</p>
      <button class="admin-secondary" type="button" :disabled="busy || !saved || !canWrite" @click="testConnection">{{ testing ? '正在连接模型…' : '测试连接' }}</button>
      <p v-if="connection" :class="connection.ok ? 'assistant-success' : 'assistant-error'" role="status">{{ connection.message }}</p>
      <h2 class="assistant-digest-heading">帖子简讯</h2>
      <fieldset :disabled="busy || !saved || !canWrite">
        <label class="assistant-switch"><input v-model="form.digestEnabled" type="checkbox">启用帖子简讯</label>
        <label class="assistant-switch"><input v-model="form.keywords" type="checkbox">显示关键词</label>
        <label>简讯长度<select v-model="form.length"><option value="short">简短 · 约50字</option><option value="standard">标准 · 约100字</option><option value="long">详细 · 约200字</option></select></label>
        <label>简讯风格<select v-model="form.style"><option value="plain">通俗易懂</option><option value="professional">专业严谨</option><option value="friendly">轻松有趣</option></select></label>
      </fieldset>
      <p class="assistant-hint">简讯设置保存后用于下一次生成；刷新学生端更新入口与关键词显示。关闭帖子简讯不影响普通问答。</p>
    </section>
    <aside class="admin-card assistant-preview"><h2>实时外观预览</h2><p class="assistant-hint">保存设置并刷新学生端后生效。</p>
      <div class="assistant-preview-stage" :class="{ 'is-left': form.position === 'left' }"><div class="assistant-preview-chat"><strong>{{ form.name || '小雪助手' }}</strong><h3>今天想探索什么？</h3><p>{{ form.welcome }}</p><div>输入你的问题…</div></div><img :src="idle" alt="小雪助手外观预览" width="112" height="112"><span v-if="!form.enabled" class="assistant-preview-disabled">助手已关闭 · 保存后隐藏学生端入口</span></div>
    </aside>
  </div>
</template>
<style scoped>
.assistant-settings-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.assistant-digest-heading { margin-top: 28px; }
.assistant-settings, .assistant-preview { padding: 24px; } h2 { margin: 0 0 18px; font-size: 18px; } fieldset { border: 0; padding: 0; margin: 0 0 28px; display: grid; gap: 18px; min-width: 0; }
label { display: grid; gap: 8px; font-size: 14px; } .assistant-switch { display: flex; align-items: center; } input:not([type=checkbox]), textarea, select { width: 100%; box-sizing: border-box; border: 1px solid var(--line); background: var(--surface); border-radius: 10px; padding: 10px 12px; color: var(--text); font: inherit; } textarea { resize: vertical; }
dl { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px; font-size: 14px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; } .assistant-hint { color: var(--muted); font-size: 13px; line-height: 1.6; } .assistant-error { color: #b94329; } .assistant-success { color: #287247; }
.assistant-preview-stage { position: relative; min-height: 420px; border-radius: 18px; padding: 20px; background: var(--page); display: flex; align-items: end; flex-direction: column; gap: 8px; } .assistant-preview-stage.is-left { align-items: start; }
.assistant-preview-chat { width: min(100%, 300px); box-sizing: border-box; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); box-shadow: 0 8px 28px #37271c0b; overflow-wrap: anywhere; } .assistant-preview-chat strong { display: block; padding-bottom: 16px; border-bottom: 1px solid var(--line); } .assistant-preview-chat h3 { font-size: 18px; } .assistant-preview-chat p { white-space: pre-wrap; line-height: 1.7; font-size: 14px; } .assistant-preview-chat div { margin-top: 24px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; color: var(--muted); font-size: 13px; } .assistant-preview-disabled { font-size: 13px; color: var(--muted); }
button:disabled { opacity: .55; cursor: default; } @media (max-width: 1000px) { .assistant-settings-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
