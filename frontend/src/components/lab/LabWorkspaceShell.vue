<script setup lang="ts">
import { computed } from 'vue'
import { resources } from '../../data/mock'
import { dataMode } from '../../services/api/client'
import { useLearningStore } from '../../stores/learning'
import type { LabDefinition, LabRunState } from '../../labs/types'
import CategoryCover from '../base/CategoryCover.vue'
import AppIcon from '../base/AppIcon.vue'
import ProgressBar from '../ProgressBar.vue'
import LabTerminal from './LabTerminal.vue'

const props = defineProps<{
  definition: LabDefinition
  state: LabRunState
  progress: number
  score: number
  activeStep: number
  logs: string[]
  result: string
}>()

const emit = defineEmits<{
  run: []
  stop: []
  reset: []
  submit: []
  'update:activeStep': [value: number]
}>()

const store = useLearningStore()
const favorite = computed(() => store.isFavorite('lab', props.definition.id))
const related = computed(() => props.definition.relatedResourceIds
  .map((id) => resources.find((resource) => resource.id === id))
  .filter((resource): resource is (typeof resources)[number] => !!resource))
</script>

<template>
  <div class="lab-page">
    <div class="page-container">
      <section class="lab-hero">
        <div>
          <RouterLink class="back-link back-button" to="/labs" aria-label="返回实训项目" title="返回实训项目"><AppIcon name="back" /></RouterLink>
          <span class="tag purple">{{ definition.category }} · {{ definition.level }}</span>
          <h1>{{ definition.title }}</h1>
          <p>{{ definition.subtitle }}</p>
          <div class="meta"><span>{{ definition.duration ? `预计 ${definition.duration} 分钟` : '预计时长 —' }}</span><span>{{ dataMode === 'api' ? '服务端受控状态机' : '浏览器内受控模拟' }}</span></div>
          <ProgressBar :value="progress" label="学习进度" dark />
        </div>
        <CategoryCover :title="definition.title" :media="definition" :variant="definition.coverVariant" icon="terminal" eager />
        <div class="lab-hero-actions">
          <button class="button lab-secondary" type="button" @click="emit('reset')">重新开始</button>
          <button class="button lab-secondary" type="button" @click="store.toggleFavorite('lab', definition.id)">{{ favorite ? '已收藏' : '收藏实验' }}</button>
          <button class="button primary" type="button" :disabled="state === 'success' || state === 'submitted' || (dataMode === 'api' && state === 'running')" @click="emit('run')">{{ state === 'running' ? (dataMode === 'api' ? '请提交当前步骤动作' : '完成当前步骤') : (dataMode === 'api' ? '开始运行' : '开始模拟') }}</button>
        </div>
      </section>

      <div class="workspace-layout">
        <aside class="step-panel">
          <div class="panel-title"><strong>实验步骤</strong><span>共 {{ definition.steps.length }} 步</span></div>
          <button v-for="(step, index) in definition.steps" :key="step.id" type="button" :class="{ active: activeStep === index + 1, done: index + 1 < activeStep || state === 'success' || state === 'submitted' }" @click="emit('update:activeStep', index + 1)">
            <strong>{{ String(index + 1).padStart(2, '0') }}</strong>
            <span>{{ step.title }}</span>
            <small>{{ index + 1 < activeStep || state === 'success' || state === 'submitted' ? '已完成' : (step.minutes ? `${step.minutes} 分钟` : '时长 —') }}</small>
          </button>
          <button class="report-link" type="button" :disabled="state !== 'success'" @click="emit('submit')"><AppIcon name="file" :size="17" />提交实验报告</button>
        </aside>

        <section class="workspace-main">
          <slot />
          <div class="terminal-header">
            <strong>{{ dataMode === 'api' ? '服务端运行日志' : '模拟运行日志' }}</strong>
            <span :class="`status ${state}`">{{ state }}</span>
            <button v-if="state === 'running' && dataMode === 'mock'" type="button" @click="emit('run')"><AppIcon name="check" :size="16" />完成当前步骤</button>
            <button v-if="state === 'running'" type="button" @click="emit('stop')">■ 停止</button>
            <button v-else type="button" :disabled="state === 'success' || state === 'submitted'" @click="emit('run')"><AppIcon name="play" :size="16" />运行</button>
            <button type="button" @click="emit('reset')">重置</button>
          </div>
          <LabTerminal :lines="logs" :label="`${definition.title}${dataMode === 'api' ? '服务端' : '模拟'}运行日志`" />
          <div class="simulation-boundary">{{ dataMode === 'api' ? '前端只提交发布版本允许的动作，状态、校验与评分以服务端结果为准。' : '所有命令与设备操作均在受控模拟器中执行，不连接真实服务器、Shell、硬件或模型服务。' }}</div>
        </section>

        <aside class="guidance-panel">
          <div class="outline-title"><strong>任务指导</strong><span>{{ state }}</span></div>
          <section><h3>任务描述</h3><p>{{ definition.task }}</p></section>
          <section><h3>提示与建议</h3><ul><li v-for="hint in definition.hints" :key="hint">{{ hint }}</li></ul></section>
          <section><h3>评分标准</h3><p v-for="rule in definition.scoring" :key="rule.label">{{ rule.label }}：{{ rule.points }} 分</p></section>
          <section><h3>实时反馈</h3><p><span class="status-dot" />当前状态：{{ state }}</p><p>{{ result || '按步骤完成配置后运行模拟。' }}</p></section>
        </aside>
      </div>

      <section class="lab-related">
        <div class="section-heading"><div><span class="eyebrow">学习辅助</span><h2>相关资源</h2></div><RouterLink to="/resources">查看全部资源 <AppIcon name="arrow-right" :size="15" /></RouterLink></div>
        <div v-if="dataMode === 'mock'" class="five-resource-grid"><RouterLink v-for="resource in related" :key="resource.id" :to="{ path: '/resources', query: { preview: resource.id } }"><span :class="`format ${resource.format.toLowerCase()}`">{{ resource.format }}</span><strong>{{ resource.title }}</strong><p>{{ resource.theme }} · {{ resource.difficulty }}</p><small>演示资源 · 查看详情 <AppIcon name="arrow-right" :size="14" /></small></RouterLink></div>
        <div v-else-if="definition.relatedResourceIds.length" class="five-resource-grid"><RouterLink v-for="slug in definition.relatedResourceIds" :key="slug" :to="{ path: '/resources', query: { preview: slug } }"><strong>{{ slug }}</strong><small>查看已发布资源 <AppIcon name="arrow-right" :size="14" /></small></RouterLink></div>
        <p v-else>尚未关联已发布资源。</p>
      </section>

      <section class="lab-result">
        <div><span class="eyebrow">实验成绩</span><h2>{{ score || '--' }} <small>/ 100</small></h2><p>{{ result || '运行成功后可提交实验报告。' }}</p></div>
        <div class="radar simple-radar" aria-label="实验评分示意图" />
        <div class="result-actions"><button class="button lab-secondary" type="button" @click="emit('reset')">重新开始</button><button class="button primary" type="button" :disabled="state !== 'success'" @click="emit('submit')">{{ state === 'submitted' ? '已提交' : '提交实验报告' }}</button></div>
      </section>
    </div>
  </div>
</template>
