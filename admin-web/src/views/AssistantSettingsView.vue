<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref } from 'vue'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import idleArt from '../assets/assistant-idle.webp'
import { adminAssistantConfig, saveAdminAssistantConfig, testAssistantConnection, type AdminAssistantConfig, type AssistantConfig } from '../services/assistant'
import { usePermissionAction } from '../composables/usePermissionAction'

const canWrite = usePermissionAction('settings.write')
const config = ref<AdminAssistantConfig>()
const form = reactive<AssistantConfig>({
  enabled: true,
  name: '小雪助手',
  welcome: '我是小雪，你的AI学习伙伴。可以问我关于课程、路线和练习的问题。',
  position: 'right',
  digestEnabled: false,
  keywords: false,
  length: 'standard',
  style: 'friendly',
})
const loadError = ref('')
const saving = ref(false)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message?: string }>()

const load = async () => {
  loadError.value = ''
  try {
    config.value = await adminAssistantConfig()
    Object.assign(form, {
      enabled: config.value.enabled,
      name: config.value.name,
      welcome: config.value.welcome,
      position: config.value.position,
      digestEnabled: config.value.digestEnabled,
      keywords: config.value.keywords,
      length: config.value.length,
      style: config.value.style,
    })
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : '助手设置读取失败'
  }
}

const save = async () => {
  if (!config.value) return
  if (!canWrite.value) { ElMessage.warning('当前账号仅可查看助手设置'); return }
  if (saving.value) return
  saving.value = true
  try {
    const result = await saveAdminAssistantConfig({ ...form, expectedRevision: config.value.revision })
    config.value = { ...config.value, ...form, revision: result.revision }
    ElMessage.success('小雪助手设置已保存')
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '保存失败')
    void load()
  } finally {
    saving.value = false
  }
}

const test = async () => {
  if (testing.value) return
  testing.value = true
  testResult.value = undefined
  try {
    testResult.value = await testAssistantConnection()
  } catch (cause) {
    testResult.value = { ok: false, message: cause instanceof Error ? cause.message : '测试连接失败' }
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<template>
  <AdminPageHeader title="小雪助手设置" description="管理学生端小雪助手的开关、名称、欢迎语与位置；模型配置只从服务端部署环境读取">
    <template #actions><button class="admin-primary" type="button" :disabled="saving || !canWrite" @click="save">保存设置</button></template>
  </AdminPageHeader>
  <p v-if="loadError" class="error-banner" role="alert">{{ loadError }} <button type="button" @click="load">重新读取最新设置</button></p>
  <div class="assistant-settings-layout">
    <section class="panel">
      <h2>基础设置</h2>
      <form class="admin-form" @submit.prevent="save">
        <label class="toggle-row">启用小雪助手<el-switch v-model="form.enabled" :disabled="!canWrite" /></label>
        <label>助手名称<input v-model="form.name" maxlength="40" :disabled="!canWrite" /></label>
        <label>欢迎语<textarea v-model="form.welcome" maxlength="200" rows="3" :disabled="!canWrite" /></label>
        <label>位置<select v-model="form.position" :disabled="!canWrite"><option value="right">右下角</option><option value="left">左下角</option></select></label>
      </form>

      <h2>模型状态</h2>
      <p class="settings-note">模型地址、名称与密钥均从服务端部署环境读取；本页不读取、不展示任何密钥。</p>
      <ul class="assistant-model-status">
        <li>模型配置：<b>{{ config?.modelConfigured ? `已配置${config.modelName ? `（${config.modelName}）` : ''}` : '未配置' }}</b></li>
        <li v-if="config?.modelConfigured">服务地址：{{ config.modelBaseUrl || '（未设置）' }}</li>
      </ul>
      <div class="assistant-actions">
        <button class="admin-secondary" type="button" :disabled="testing" @click="test">{{ testing ? '测试中…' : '测试连接' }}</button>
      </div>
      <p v-if="testResult" class="assistant-test-result" :class="testResult.ok ? 'success' : 'failure'" role="status"><b>{{ testResult.ok ? '连接成功' : '连接失败' }}</b> {{ testResult.message }}</p>

      <h2>帖子简讯</h2>
      <p class="settings-note">根据当前帖子正文生成摘要与关键词；帖子内容只作参考，不会执行其中的指令。</p>
      <form class="admin-form" @submit.prevent="save">
        <label class="toggle-row">启用帖子简讯<el-switch v-model="form.digestEnabled" :disabled="!canWrite" /></label>
        <label class="toggle-row">同时提供关键词<el-switch v-model="form.keywords" :disabled="!canWrite" /></label>
        <label>摘要长度<select v-model="form.length" :disabled="!canWrite"><option value="short">简短</option><option value="standard">标准</option><option value="long">详细</option></select></label>
      </form>
      <button class="admin-primary" type="button" :disabled="saving || !canWrite" @click="save">保存设置</button>
    </section>

    <section class="panel assistant-preview">
      <h2>外观预览</h2>
      <div class="assistant-preview-stage" :class="`position-${form.position}`">
        <div class="assistant-preview-pet">
          <img :src="idleArt" alt="" width="112" height="112" />
          <span>{{ form.name || '小雪助手' }}</span>
        </div>
        <div class="assistant-preview-bubble">
          <strong>{{ form.name || '小雪助手' }}</strong>
          <p>{{ form.welcome || '（未填写欢迎语）' }}</p>
        </div>
      </div>
      <p class="settings-note">预览仅表示外观与位置，不代表已保存。</p>
    </section>
  </div>
</template>

<style scoped>
.assistant-settings-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
}
.assistant-settings-layout > section {
  padding: 20px;
}
.assistant-settings-layout h2 {
  margin-top: 24px;
}
.assistant-settings-layout h2:first-child {
  margin-top: 0;
}
.assistant-model-status {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}
.assistant-model-status b {
  color: var(--text);
}
.assistant-actions {
  margin-top: 14px;
}
.assistant-test-result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 12px;
}
.assistant-test-result.success {
  color: #1a7f37;
  background: #ecf8ef;
}
.assistant-test-result.failure {
  color: #a73518;
  background: #fff4f0;
}
.assistant-preview-stage {
  position: relative;
  min-height: 260px;
  margin-top: 8px;
  border: 1px dashed var(--line);
  border-radius: 14px;
  background:
    linear-gradient(var(--line) 1px, transparent 1px),
    linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 22px 22px;
  overflow: hidden;
}
.assistant-preview-pet {
  position: absolute;
  bottom: 24px;
  display: grid;
  justify-items: center;
  gap: 2px;
  width: 112px;
}
.assistant-preview-pet img {
  width: 112px;
  height: 112px;
  object-fit: contain;
}
.assistant-preview-pet span {
  font-size: 10px;
  color: #ac806a;
}
.assistant-preview-stage.position-right .assistant-preview-pet {
  right: 24px;
}
.assistant-preview-stage.position-left .assistant-preview-pet {
  left: 24px;
}
.assistant-preview-bubble {
  position: absolute;
  top: 26px;
  width: min(300px, calc(100% - 40px));
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
.assistant-preview-bubble strong {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
}
.assistant-preview-bubble p {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
  white-space: pre-line;
}
.assistant-preview-stage.position-right .assistant-preview-bubble {
  right: 40px;
}
.assistant-preview-stage.position-left .assistant-preview-bubble {
  left: 40px;
}
@media (max-width: 900px) {
  .assistant-settings-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>