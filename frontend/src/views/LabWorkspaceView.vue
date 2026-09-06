<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch, type Component } from 'vue'
import { useRoute } from 'vue-router'
import NotFoundState from '../components/NotFoundState.vue'
import AppIcon from '../components/base/AppIcon.vue'
import LabWorkspaceShell from '../components/lab/LabWorkspaceShell.vue'
import { getLabDefinition } from '../labs/registry'
import { canTransition, progressForState } from '../labs/stateMachine'
import type { LabDefinition, LabRunState, LabType } from '../labs/types'
import { behaviorApi, type LabRunDto } from '../services/api/behavior'
import { dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
import { useLabsStore } from '../stores/content/labs'
import { useLearningStore } from '../stores/learning'
import { useCommunityStore } from '../stores/community'
import { apiCatalogCover } from '../media/catalog'

const route = useRoute()
const store = useLearningStore()
const auth = useAuthStore()
const labsStore = useLabsStore()
const apiDefinition = ref<LabDefinition>()
const apiRun = ref<LabRunDto | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const definition = computed(() => dataMode === 'api' ? apiDefinition.value : getLabDefinition(String(route.params.labId)))
const state = ref<LabRunState>('ready')
const activeStep = ref(1)
const score = ref(0)
const logs = ref<string[]>([])
const result = ref('')
const apiPayloadText = ref('{}')
let timer: number | undefined
let logIndex = 0

const workspaceByType: Record<LabType, Component> = {
  agent: defineAsyncComponent(() => import('../components/lab/workspaces/AgentWorkspace.vue')),
  deployment: defineAsyncComponent(() => import('../components/lab/workspaces/DeploymentWorkspace.vue')),
  command: defineAsyncComponent(() => import('../components/lab/workspaces/CommandWorkspace.vue')),
  hardware: defineAsyncComponent(() => import('../components/lab/workspaces/HardwareWorkspace.vue')),
  project: defineAsyncComponent(() => import('../components/lab/workspaces/ProjectWorkspace.vue')),
}
const workspace = computed(() => definition.value ? workspaceByType[definition.value.type] : workspaceByType.agent)
const progress = computed(() => {
  if (!definition.value) return 0
  if (dataMode === 'api') return apiRun.value?.progress || 0
  const stored = store.labProgress[definition.value.id] ?? definition.value.initialProgress
  return Math.max(stored, progressForState(state.value, definition.value.initialProgress))
})
const shareResult = () => {
  if (!definition.value || state.value !== 'submitted') return
  useCommunityStore().openComposer({ type: 'lab_result', title: `${definition.value.title} · 我的实训复盘`, contentBlocks: [{ type: 'paragraph', text: `已完成${definition.value.title}。使用工具：${definition.value.tools.map((tool) => tool.label).join('、') || '受控实训工作台'}。结果摘要：${definition.value.result}。我的经验与改进：` }], bindings: [{ type: 'lab', id: definition.value.id }, ...(apiRun.value ? [{ type: 'lab_run' as const, id: apiRun.value.id }] : [])], ...(apiRun.value ? { sourceType: 'lab_run', sourceId: apiRun.value.id } : {}) })
}

const stopTimer = () => {
  window.clearInterval(timer)
  timer = undefined
}

const moveTo = (next: LabRunState) => {
  if (state.value === next || canTransition(state.value, next)) state.value = next
}

const applyApiRun = (run: LabRunDto) => {
  apiRun.value = run
  state.value = run.status
  activeStep.value = Math.min(definition.value?.steps.length || 1, run.currentStep + 1)
  score.value = run.score
  if (definition.value) void store.setLabProgress(definition.value.id, run.progress)
}

const operationError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '实训操作失败'
  logs.value = [...logs.value, `[error] ${message}`]
}

const clearLocal = () => {
  stopTimer()
  state.value = 'ready'
  activeStep.value = 1
  score.value = 0
  result.value = ''
  logs.value = [dataMode === 'api' ? '[ready] 实验已重置，等待服务端运行' : '[ready] 实验已重置，等待运行模拟']
}
const reset = async () => {
  if (dataMode === 'api' && apiRun.value) {
    try {
      const run = await behaviorApi.actOnLab(apiRun.value.id, 'reset')
      applyApiRun(run)
    } catch (error) {
      operationError(error)
      return
    }
  }
  clearLocal()
}

const currentApiAction = computed(() => {
  const step = labsStore.selected?.steps[apiRun.value?.currentStep || 0]
  const configured = step?.instruction.action
  return typeof configured === 'string' ? configured as Parameters<typeof behaviorApi.actOnLab>[1] : 'confirm'
})

const submitApiAction = async () => {
  if (!apiRun.value || apiRun.value.status !== 'running') return
  try {
    const payload = JSON.parse(apiPayloadText.value || '{}') as Record<string, unknown>
    const run = await behaviorApi.actOnLab(apiRun.value.id, currentApiAction.value, payload)
    applyApiRun(run)
    logs.value = [...logs.value, run.status === 'success' ? '[success] 全部发布步骤已通过服务端校验' : `[state] 步骤 ${run.currentStep} 已完成`]
    apiPayloadText.value = '{}'
    if (run.status === 'success' && definition.value) result.value = definition.value.result
  } catch (error) {
    operationError(error)
  }
}

const run = async () => {
  if (dataMode === 'api') {
    if (!definition.value) return
    try {
      let current = apiRun.value
      if (!current) current = await behaviorApi.startLab(definition.value.id)
      if (current.status === 'ready') current = await behaviorApi.actOnLab(current.id, 'run')
      else if (current.status === 'running') {
        operationError(new Error('请在工作区提交当前步骤要求的动作'))
        return
      } else {
        operationError(new Error('当前运行已结束，请先重新开始'))
        return
      }
      applyApiRun(current)
      logs.value = [...logs.value, current.status === 'success' ? '[success] 全部发布步骤已通过服务端校验' : `[state] ${current.status} · 步骤 ${current.currentStep}/${definition.value.steps.length}`]
      if (current.status === 'success') result.value = definition.value.result
    } catch (error) {
      operationError(error)
    }
    return
  }
  if (!definition.value || state.value === 'running') return
  if (!canTransition(state.value, 'running')) state.value = 'ready'
  moveTo('running')
  score.value = 0
  result.value = ''
  logs.value = []
  logIndex = 0
  stopTimer()
  timer = window.setInterval(() => {
    if (!definition.value) return
    logs.value = [...logs.value, definition.value.logs[logIndex]]
    activeStep.value = Math.min(definition.value.steps.length, logIndex + 1)
    logIndex += 1
    if (logIndex >= definition.value.logs.length) {
      stopTimer()
      moveTo('success')
      score.value = 86 + (definition.value.id.length % 8)
      result.value = definition.value.result
      store.setLabProgress(definition.value.id, 88)
    }
  }, 420)
}

const stop = async () => {
  if (dataMode === 'api') {
    if (!apiRun.value || apiRun.value.status !== 'running') return
    try {
      const run = await behaviorApi.actOnLab(apiRun.value.id, 'stop')
      applyApiRun(run)
      logs.value = [...logs.value, '[stopped] 服务端已停止本次运行']
    } catch (error) { operationError(error) }
    return
  }
  if (state.value !== 'running') return
  stopTimer()
  moveTo('stopped')
  result.value = '模拟运行已安全停止，可以继续调整后重新运行。'
  logs.value = [...logs.value, '[stopped] 用户停止了前端模拟']
}

const submit = async () => {
  if (!definition.value || state.value !== 'success') return
  if (dataMode === 'api') {
    if (!apiRun.value) return
    try {
      const run = await behaviorApi.submitLab(apiRun.value.id)
      applyApiRun(run)
    } catch (error) {
      operationError(error)
      return
    }
  }
  if (!await store.submitLab(definition.value.id)) return
  moveTo('submitted')
  logs.value = [...logs.value, dataMode === 'api'
    ? '[submitted] 服务端已接收报告并更新成长记录'
    : '[submitted] 报告已在本地演示状态中标记提交']
  result.value = dataMode === 'api'
    ? `${definition.value.result} 报告已写入学习账号。`
    : `${definition.value.result} 报告仅保存在浏览器，不代表服务端已接收。`
}

const loadDefinition = async () => {
  clearLocal()
  apiRun.value = null
  if (dataMode !== 'api') return
  detailLoading.value = true
  detailError.value = ''
  apiDefinition.value = undefined
  try {
    const item = await labsStore.detail(String(route.params.labId))
    if (!item) return
    apiDefinition.value = {
      ...apiCatalogCover(item.data),
      id: item.slug,
      type: item.labType,
      title: item.title,
      subtitle: item.summary,
      category: item.data.category || item.labType,
      level: item.data.level || '尚未配置',
      duration: item.data.durationMinutes || 0,
      coverVariant: item.labType,
      steps: item.steps.map((step) => ({ id: step.id, title: step.title, minutes: 0 })),
      tools: item.tools.map((tool) => ({ id: `${tool.toolType}:${tool.name}`, label: tool.name, mode: 'simulated' })),
      initialProgress: 0,
      scoring: item.data.scoring || item.steps.map((step) => ({ label: step.title, points: step.score })),
      relatedResourceIds: item.resources.map((resource) => resource.slug),
      task: item.data.task || item.summary,
      hints: item.data.hints || [],
      logs: item.steps.map((step) => `[step] ${step.title}`),
      result: item.data.resultSubmission || '实训已通过服务端校验，可以提交报告。',
    }
    if (!auth.user) {
      logs.value = [...logs.value, '[login-required] 登录后可启动实训，当前仅展示公开配置']
      return
    }
    const active = await behaviorApi.activeLabRun(item.slug)
    if (active) {
      applyApiRun(active)
      logs.value = active.events?.map((event) => `[${event.type}] ${event.message}`) || []
    }
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '实训详情加载失败'
  } finally {
    detailLoading.value = false
  }
}

watch(() => route.params.labId, () => void loadDefinition(), { immediate: true })
watch(() => auth.user?.id, (userId) => { if (userId && apiDefinition.value) void loadDefinition() })
onBeforeUnmount(stopTimer)
</script>

<template>
  <div v-if="detailLoading" class="page-container"><div class="notice">正在读取已发布实训配置…</div></div>
  <div v-else-if="detailError" class="page-container"><div class="notice error">{{ detailError }}，未回退到演示配置。</div></div>
  <NotFoundState
    v-else-if="!definition || !definition.steps.length"
    title="没有找到这个实训"
    description="未知实训或尚未发布步骤配置，不会回退到演示配置。"
    back-to="/labs"
    back-label="返回实训中心"
  />
  <LabWorkspaceShell
    v-else
    :definition="definition"
    :state="state"
    :progress="progress"
    :score="score"
    :active-step="activeStep"
    :logs="logs"
    :result="result"
    @update:active-step="activeStep = $event"
    @run="run"
    @stop="stop"
    @reset="reset"
    @submit="submit"
  >
    <RouterLink class="text-link" :to="`/community/search?bindingId=${route.params.labId}`">查看实训相关成果 <AppIcon name="arrow-up-right" :size="14" /></RouterLink>
    <section v-if="state === 'submitted'" class="community-lab-share"><strong>把这次实践变成有帮助的学习交流</strong><p>只预填实训名称和结果摘要，不包含日志、评分细则或敏感输入。</p><button class="button primary" type="button" @click="shareResult">分享实训成果</button></section>
    <section v-if="dataMode === 'api'" class="workspace-type">
      <div class="workspace-heading"><div><strong>服务端步骤动作</strong><small>当前只允许：{{ currentApiAction }}</small></div><span class="status" :class="state">{{ state }}</span></div>
      <form class="dialog-form" @submit.prevent="submitApiAction">
        <label>动作参数（JSON）<textarea v-model="apiPayloadText" rows="6" :disabled="state !== 'running'" /></label>
        <button class="button primary" type="submit" :disabled="state !== 'running'">提交 {{ currentApiAction }}</button>
      </form>
    </section>
    <component :is="workspace" v-else :definition="definition" :state="state" />
  </LabWorkspaceShell>
</template>
