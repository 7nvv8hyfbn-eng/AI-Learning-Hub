<script setup lang="ts">
import { ensureAuth } from '../composables/useRequireAuth'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { ChallengeDetailDto } from '@ai-learning-hub/contracts'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import ContentPagination from '../components/ContentPagination.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { assessmentAchievements } from '../data/mock'
import CategoryCover from '../components/base/CategoryCover.vue'
import PageHeroArt from '../components/PageHeroArt.vue'
import { loadAssessmentRanking, type ChallengeRankingEntry } from '../services/api/assessments'
import { dataMode } from '../services/api/client'
import { quizBridge } from '../services/quizBridge'
import { useAuthStore } from '../stores/auth'
import { useChallengesStore } from '../stores/content/challenges'
import { useLearningStore } from '../stores/learning'

const store = useLearningStore()
const auth = useAuthStore()
const challengeStore = useChallengesStore()
const { items: challenges } = storeToRefs(challengeStore)
const route = useRoute()
const selectedChallenge = ref<ChallengeDetailDto | null>(null)
const selectionError = ref(''), selectionLoading = ref(false)
const challenge = computed(() => route.query.challenge === undefined ? challenges.value[0] : selectedChallenge.value)
const challengeRules = computed(() => JSON.stringify(Object.fromEntries(
  Object.entries(challenge.value?.data || {}).filter(([key]) => ![
    'coverAssetId', 'cover', 'coverAlt', 'coverFocalPoint', 'coverSource', 'coverFallback',
  ].includes(key)),
), null, 2))
let selectionEpoch = 0, rankingEpoch = 0
const accountDataReady = computed(() => dataMode === 'mock' || store.accountSyncState === 'synced')
const accountDataMessage = computed(() => {
  if (!auth.user) return '登录后查看测评记录与知识正确率。'
  return store.accountSyncState === 'sync-error' ? '账号测评数据暂不可用。' : '正在同步账号测评数据…'
})
const ranking = ref<ChallengeRankingEntry[]>([])
const rankingState = ref<'idle' | 'login-required' | 'ready' | 'error'>('idle')
const rankingMessage = ref('')
const challengeLoadError = ref('')
const dimension = ref<'知识点' | '能力维度'>('知识点')
const rankTab = ref<'本周榜' | '总榜'>('本周榜')
const school = ref('全部高校')
const ruleOpen = ref(false)
const wrongOpen = ref(false)
const abilities = [
  ['机器学习基础', 82, 48], ['深度学习基础', 76, 42], ['数据分析与处理', 88, 61], ['编程与算法', 70, 39],
  ['计算机视觉', 64, 31], ['自然语言处理', 79, 45], ['数据可视化', 91, 58], ['AI 应用实践', 73, 36],
]
const startChallenge = () => {
  if (!ensureAuth('登录后可参与挑战', startChallenge)) return
  if (!challenge.value) return
  const id = challenge.value.slug
  store.recordAssessment('challenge', id)
  quizBridge.startChallenge(id)
}
const startAssessment = (id: string) => {
  if (!ensureAuth('登录后可参与测评', () => startAssessment(id))) return
  store.recordAssessment('assessment', id)
  quizBridge.startAssessment(id)
}
const startPractice = (id: string) => {
  if (!ensureAuth('登录后可参与练习', () => startPractice(id))) return
  store.recordAssessment('practice', id)
  quizBridge.startPractice(id)
}
const loadChallenges = async () => {
  challengeLoadError.value = ''
  try {
    await challengeStore.load()
    if (dataMode === 'mock') await selectChallenge(route.query.challenge)
  } catch (error) {
    challengeLoadError.value = error instanceof Error ? error.message : '挑战加载失败'
  }
}
const selectChallenge = async (slug: unknown) => {
  const epoch = ++selectionEpoch
  selectedChallenge.value = null; selectionError.value = ''; selectionLoading.value = false; ruleOpen.value = false
  if (slug === undefined) return
  if (typeof slug !== 'string' || !slug.trim() || slug.length > 120) { selectionError.value = '挑战标识无效，请从已发布挑战列表重新选择。'; return }
  selectionLoading.value = true
  try {
    const item = dataMode === 'api' ? await challengeStore.detail(slug) : challenges.value.find((item) => item.slug === slug)
    if (epoch !== selectionEpoch) return
    selectedChallenge.value = item || null
    if (!item) selectionError.value = '该挑战不存在或尚未发布。'
  } catch { if (epoch === selectionEpoch) selectionError.value = '该挑战暂不可用，请重试或从已发布挑战列表重新选择。' }
  finally { if (epoch === selectionEpoch) selectionLoading.value = false }
}
const loadRanking = async () => {
  const epoch = ++rankingEpoch
  ranking.value = []; rankingMessage.value = ''
  if (!challenge.value) {
    rankingState.value = 'ready'
    return
  }
  rankingState.value = 'idle'
  const result = await loadAssessmentRanking(auth.user, challenge.value.slug)
  if (epoch !== rankingEpoch) return
  ranking.value = result.items
  rankingState.value = result.state
  rankingMessage.value = result.state === 'error' ? result.message : ''
}
onMounted(() => {
  void loadChallenges()
})
watch(() => route.query.challenge, (slug) => { void selectChallenge(slug) }, { immediate: true })
watch([challenge, () => auth.user], () => { void loadRanking() }, { immediate: true })
onBeforeUnmount(() => { selectionEpoch++; rankingEpoch++ })
</script>

<template>
  <div class="page-container assessment-page">
    <section class="assessment-title"><PageHeroArt visual-key="assessmentsHeroAssetId" /><div><span class="eyebrow">学习 · 实践 · 验证</span><h1>挑战与测评</h1><p>检验学习效果，发现知识盲点，持续突破自我。</p></div><aside><template v-if="accountDataReady"><strong>已记录 {{ store.assessmentRecords.length }} 次测评</strong><ProgressBar :value="store.serverGrowth?.knowledgeAccuracy || 0" label="知识正确率" /></template><p v-else class="notice">{{ accountDataMessage }}</p><button v-if="dataMode === 'mock'" class="text-link" type="button" @click="quizBridge.openReport()">查看学习报告 <AppIcon name="arrow-right" :size="16" /></button></aside></section>
    <section v-if="challenge" class="challenge-hero">
      <div><span class="tag purple">已发布挑战</span><h2>{{ challenge.title }}</h2><p>{{ challenge.summary }}</p><div class="meta"><span>目标 {{ challenge.targetScore }} 分</span><span>{{ challenge.data.endAt ? `截止 ${challenge.data.endAt.slice(0, 10)}` : '长期开放' }}</span><span>奖励 {{ challenge.rewardPoints }} 积分</span></div><div class="hero-actions"><button class="button primary" type="button" @click="startChallenge">立即参加挑战</button><button class="button secondary" type="button" @click="ruleOpen = true">查看挑战规则</button></div></div>
      <CategoryCover :title="challenge.title" :media="challenge.data" eager />
      <div class="challenge-target"><h3>挑战目标</h3><strong>{{ challenge.targetScore }} 分</strong><ProgressBar v-if="accountDataReady" :value="store.serverGrowth?.knowledgeAccuracy || 0" label="知识正确率" /><span v-else>{{ accountDataMessage }}</span><span v-if="rankingState === 'ready'">排行榜已有 {{ ranking.length }} 条有效最佳成绩</span><span v-else-if="rankingState === 'login-required'">登录后查看挑战排行榜</span><span v-else-if="rankingState === 'error'">{{ rankingMessage }}</span><span v-else>排行榜加载中…</span><span>通过后奖励 {{ challenge.rewardPoints }} 积分</span></div>
    </section>
    <div v-else-if="selectionError" class="inline-empty" role="alert"><p>{{ selectionError }}</p><RouterLink class="back-button" to="/assessments" aria-label="返回挑战列表" title="返回挑战列表"><AppIcon name="back" /></RouterLink></div>
    <div v-else-if="selectionLoading" class="inline-empty" role="status"><p>正在加载指定挑战…</p></div>
    <div v-else-if="challengeLoadError" class="inline-empty"><p>{{ challengeLoadError }}</p></div>
    <div v-else-if="dataMode === 'api'" class="inline-empty"><p>{{ challengeStore.loading ? '正在加载已发布挑战…' : '当前没有已发布挑战。' }}</p></div>
    <section v-if="challenges.length" class="challenge-catalog" aria-label="选择已发布挑战">
      <RouterLink v-for="item in challenges" :key="item.id" :to="{ path: '/assessments', query: { challenge: item.slug } }" :aria-current="challenge?.slug === item.slug ? 'true' : undefined">
        <CategoryCover :title="item.title" :media="item.data" />
        <div><strong>{{ item.title }}</strong><small>目标 {{ item.targetScore }} 分 · {{ item.rewardPoints }} 积分</small></div>
      </RouterLink>
    </section>
    <div class="assessment-grid">
      <section class="exam-card"><span class="eyebrow">{{ dataMode === 'api' ? '统一题库' : '全真模拟测评' }}</span><h2>{{ dataMode === 'api' ? '已发布挑战列表' : 'AI 综合能力测评' }}</h2><div v-if="dataMode === 'api'" class="exam-stats"><button v-for="item in challenges" :key="item.id" class="text-link" type="button" @click="startAssessment(item.slug)">{{ item.title }} · 目标 {{ item.targetScore }} 分</button><ContentPagination :page="challengeStore.page" :page-size="challengeStore.pageSize" :total="challengeStore.total" @change="challengeStore.load({ page: $event })" /></div><template v-else><p>60 道题 · 90 分钟 · 综合难度</p><div class="exam-stats"><span><strong>{{ store.assessmentRecords.length }}</strong>本地入口记录</span><span><strong>演示</strong>桥接状态</span><span><strong>待接入</strong>真实成绩</span></div><button class="button primary" type="button" @click="startAssessment('full-ai')">开始模拟测评</button></template></section>
      <aside class="leaderboard"><div class="panel-title"><h3>挑战排行榜</h3><div v-if="dataMode === 'mock'"><button v-for="tab in ['本周榜', '总榜'] as const" :key="tab" type="button" :class="{ active: rankTab === tab }" @click="rankTab = tab">{{ tab }}</button></div></div><label v-if="dataMode === 'mock'" class="rank-filter">学校筛选<select v-model="school"><option>全部高校</option><option>本校</option><option>同城高校</option></select></label><ol v-if="rankingState === 'ready' && ranking.length"><li v-for="item in ranking.slice(0, 10)" :key="item.userId"><span>{{ String(item.rank).padStart(2, '0') }}</span>{{ item.displayName }}<strong>{{ item.score }}</strong></li></ol><p v-else-if="rankingState === 'login-required'">登录后查看挑战排行榜。</p><p v-else-if="rankingState === 'error'">{{ rankingMessage }}</p><p v-else-if="rankingState === 'ready'">暂无有效成绩。</p><p v-else>排行榜加载中…</p></aside>
    </div>
    <template v-if="dataMode === 'mock'">
    <section>
      <div class="section-heading"><div><span class="eyebrow">能力诊断</span><h2>知识点掌握情况</h2></div><div class="segmented"><button v-for="item in ['知识点', '能力维度'] as const" :key="item" type="button" :class="{ active: dimension === item }" @click="dimension = item">{{ item }}</button></div></div>
      <div class="four-grid ability-cards"><article v-for="[title, rate, done] in abilities" :key="title"><span>{{ dimension }}</span><h3>{{ title }}</h3><strong>{{ rate }}%</strong><ProgressBar :value="Number(rate)" /><small>已完成 {{ done }} 道题</small></article></div>
    </section>
    <div class="assessment-grid">
      <section class="wrong-card"><div class="panel-title"><div><span class="eyebrow">错题回顾</span><h2>注意力机制的主要作用是？</h2></div><button class="text-link" type="button" @click="quizBridge.openWrongQuestions()">查看全部错题 <AppIcon name="arrow-right" :size="16" /></button></div><div class="wrong-options"><span>A. 直接提升参数规模</span><span class="correct">B. 捕捉序列中不同位置的关联</span><span>C. 替代全部数据清洗</span></div><p>你的答案：A · 正确答案：B · 本题错误率 38%</p><button class="button secondary" type="button" @click="wrongOpen = true">查看解析</button></section>
      <aside class="study-aside"><h3>近期成绩</h3><div v-for="(item, index) in ['本周 AI 挑战', '大模型专项练习', 'Python 基础测评']" :key="item" class="result-row"><strong>{{ item }}</strong><span>{{ 86 - index * 4 }}% · {{ 18 + index * 4 }} 分钟</span><small>{{ index === 0 ? '第 128 名' : `${82 - index * 3} 分 · ${['A', 'B+', 'B'][index]} 级` }} · {{ index + 1 }} 天前</small></div></aside>
    </div>
    <section><div class="section-heading"><h2>推荐练习</h2></div><div class="three-grid practice-grid"><article v-for="(title, index) in ['强化学习基础', '计算机视觉入门', '模型安全边界']" :key="title"><span>薄弱项推荐</span><h3>{{ title }}</h3><p>{{ 12 + index * 3 }} 道题 · 当前正确率 {{ 62 + index * 4 }}%</p><button class="button secondary" type="button" @click="startPractice(`practice-${index}`)">开始练习</button></article></div></section>
    <section><div class="section-heading"><div><span class="eyebrow">成长记录</span><h2>我的成就</h2></div></div><div class="assessment-achievements"><article v-for="achievement in assessmentAchievements" :key="achievement.title" :class="{ locked: !achievement.unlocked }"><span><AppIcon :name="achievement.icon" :size="32" /></span><div><h3>{{ achievement.title }}</h3><p>{{ achievement.description }}</p><small>{{ achievement.unlocked ? '已获得' : '待解锁' }}</small></div></article></div></section>
    </template>
  </div>
  <AppDialog v-model="ruleOpen" title="挑战规则" class="challenge-rules-dialog"><pre v-if="dataMode === 'api'">{{ challengeRules }}</pre><ol v-else><li>答题入口由《题盒》统一提供。</li><li>本页不保存题库、计时或判分逻辑。</li><li>演示入口记录只保存在当前浏览器。</li></ol></AppDialog>
  <AppDialog v-model="wrongOpen" title="错题解析"><p>注意力机制通过相关性权重聚合不同位置的信息，从而建立上下文联系。</p><button class="button primary" type="button" @click="startPractice('attention')">通过《题盒》继续练习</button></AppDialog>
</template>
