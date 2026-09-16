<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CategoryCover from '../components/base/CategoryCover.vue'
import LabCard from '../components/cards/LabCard.vue'
import ContentPagination from '../components/ContentPagination.vue'
import PageHero from '../components/PageHero.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
import { useLabsStore } from '../stores/content/labs'
import { useLearningStore } from '../stores/learning'

const store = useLearningStore()
const auth = useAuthStore()
const labsStore = useLabsStore()
const { items: labs } = storeToRefs(labsStore)
const category = ref('全部实验')
const sort = ref('综合排序')
const toolsOpen = ref(false)
const categories = ['全部实验', '模型部署', 'AI Agent', 'Linux 命令', '智能硬件']
const featured = computed(() => labs.value[0])
const accountDataReady = computed(() => dataMode === 'mock' || store.accountSyncState === 'synced')
const accountDataMessage = computed(() => {
  if (!auth.user) return '登录后查看实验记录与提交情况。'
  return store.accountSyncState === 'sync-error' ? '账号实验数据暂不可用。' : '正在同步账号实验数据…'
})
const filtered = computed(() => {
  const result = labs.value.filter((lab) => category.value === '全部实验' || lab.category === category.value)
  const levelOrder: Record<string, number> = { 入门: 1, 中级: 2, 进阶: 3 }
  if (sort.value === '难度优先') return [...result].sort((a, b) => (levelOrder[a.level] || 99) - (levelOrder[b.level] || 99))
  if (sort.value === '时长最短') return [...result].sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity))
  if (sort.value === '参与最多') return [...result].sort((a, b) => (b.learners ?? 0) - (a.learners ?? 0))
  if (sort.value === '最新发布') return [...result].reverse()
  return result
})
onMounted(() => { void labsStore.load() })
</script>

<template>
  <div class="page-container">
    <PageHero eyebrow="实践你的 AI 能力" title="模拟实训中心" description="在真实感云环境中动手实践，通过受控步骤、即时反馈与结果验证掌握 AI 工程技能。" visual-key="labsHeroAssetId">
      <div class="value-pills"><span><AppIcon name="container" :size="16" />真实感环境</span><span><AppIcon name="growth" :size="16" />循序渐进</span><span><AppIcon name="check" :size="16" />即时反馈</span><span><AppIcon name="achievement" :size="16" />学以致用</span></div>
    </PageHero>
    <div class="category-tabs" role="tablist"><button v-for="item in categories" :key="item" type="button" :class="{ active: category === item }" @click="category = item">{{ item }}</button></div>
    <section v-if="featured" class="featured-lab">
      <CategoryCover :title="featured.title" :media="featured" eager />
      <div><span class="tag orange">推荐实训</span><h2>{{ featured.title }}</h2><p>{{ featured.description }}</p><div class="meta"><span>{{ featured.level }}</span><span>{{ featured.minutes === undefined ? '时长 —' : `${featured.minutes} 分钟` }}</span><span>{{ featured.steps === undefined ? '步骤 —' : `${featured.steps} 个步骤` }}</span><span>{{ featured.learners === undefined ? '参与人数 —' : `${featured.learners.toLocaleString()} 人参与` }}</span></div><ProgressBar v-if="featured.completion !== undefined" :value="featured.completion" label="完成率" /><span v-else>完成率 —</span></div>
      <div class="featured-actions"><RouterLink class="button primary" :to="`/labs/${featured.id}`">立即开始实验</RouterLink><RouterLink class="button secondary" :to="`/labs/${featured.id}`">查看详情</RouterLink></div>
    </section>
    <div class="labs-layout">
      <section>
        <div class="catalog-toolbar"><strong>全部实训 <small>{{ category === '全部实验' ? labsStore.total : `本页 ${filtered.length}` }} 个项目</small></strong><select v-model="sort" aria-label="实训排序"><option>综合排序</option><option>难度优先</option><option>时长最短</option><option>最新发布</option><option>参与最多</option></select></div>
        <div class="four-grid"><LabCard v-for="lab in filtered" :key="lab.id" :lab="lab" /></div>
        <ContentPagination :page="labsStore.page" :page-size="labsStore.pageSize" :total="labsStore.total" @change="labsStore.load({ page: $event })" />
      </section>
      <aside class="study-aside lab-aside"><h3>实训规则</h3><ul><li>仅使用受控模拟环境。</li><li>命令经过白名单，不连接真实 Shell。</li><li>步骤、日志和结果由服务端状态机驱动。</li></ul><button class="button secondary full-width" type="button" @click="toolsOpen = true">环境与工具说明</button><h3>我的实验记录</h3><template v-if="accountDataReady"><div v-if="store.recentLabs.length" class="lab-record-list"><RouterLink v-for="labId in store.recentLabs.slice(0, 4)" :key="labId" :to="`/labs/${labId}`">最近学习 · {{ labs.find((item) => item.id === labId)?.title || labId }} <small>{{ store.labProgress[labId] || 0 }}%</small></RouterLink></div><p v-else>暂无实验记录。</p><RouterLink v-if="store.recentLabs[0] || featured" class="button primary full-width" :to="`/labs/${store.recentLabs[0] || featured?.id}`">继续学习</RouterLink><h3>{{ dataMode === 'api' ? '已提交' : '本地完成' }}</h3><strong class="big-number">{{ store.submittedLabs.length }}</strong></template><p v-else class="notice">{{ accountDataMessage }}</p><div class="lab-badges"><span><AppIcon name="shield" :size="16" />受控环境</span><span><AppIcon name="tool" :size="16" />白名单工具</span><span><AppIcon name="file" :size="16" />实训报告</span></div></aside>
    </div>
    <section v-if="dataMode === 'mock'"><div class="section-heading"><div><span class="eyebrow">推荐路径</span><h2>选择一条实训成长路线</h2></div></div><div class="three-grid path-cards"><article v-for="(title, index) in ['AI 工程师入门路径', '大模型应用开发路径', '智能硬件 + AI 实战路径']" :key="title"><span>路径 0{{ index + 1 }}</span><div class="path-node-icons" aria-hidden="true"><i /><i /><i /><i /></div><h3>{{ title }}</h3><p>{{ 6 + index * 2 }} 个实验 · {{ 12 + index * 4 }} 小时 · {{ 3260 - index * 420 }} 人学习</p><RouterLink to="/labs">查看路径 <AppIcon name="arrow-right" :size="15" /></RouterLink></article></div></section>
    <section><div class="section-heading"><div><span class="eyebrow">实训目录</span><h2>已发布实验</h2></div></div><div class="hot-lab-ranking"><RouterLink v-for="(lab, index) in [...labs].sort((a, b) => (b.learners ?? 0) - (a.learners ?? 0)).slice(0, 5)" :key="lab.id" :to="`/labs/${lab.id}`"><strong>0{{ index + 1 }}</strong><CategoryCover :title="lab.title" :media="lab" :variant="lab.coverVariant" :icon="lab.icon" /><span>{{ lab.title }}<small>{{ lab.learners === undefined ? '参与人数 —' : `${lab.learners.toLocaleString()} 人参与` }}</small></span><em>{{ dataMode === 'api' ? '已发布' : `${98 - index * 7} 热度` }}</em></RouterLink></div></section>
  </div>
  <AppDialog v-model="toolsOpen" title="环境与工具说明"><p>{{ dataMode === 'api' ? '实训动作、校验、状态和评分由服务端发布版本驱动。' : '模拟环境使用预设步骤、白名单命令和状态机，不连接真实服务器 Shell。' }}</p><ul><li>Agent 流程：Vue Flow</li><li>运行日志：xterm.js 只读终端</li><li>{{ dataMode === 'api' ? '工具由已发布实训定义提供' : '工具调用仅允许前端演示白名单' }}</li></ul></AppDialog>
</template>
