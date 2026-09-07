<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import PageHero from '../components/PageHero.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import CommunitySkeleton from '../community/CommunitySkeleton.vue'
import { useAuthStore } from '../stores/auth'
import { communityApi, type CommunityStudyRanking, type CommunityStudyRankingRow } from '../services/api/community'

const auth = useAuthStore()
const tab = ref<'total' | 'week'>('total')
const loading = ref(false), error = ref('')
const payload = ref<CommunityStudyRanking>()

const load = async () => {
  loading.value = true; error.value = ''
  try { payload.value = await communityApi.studyRanking() } catch (cause) { error.value = cause instanceof Error ? cause.message : '学时排名读取失败' } finally { loading.value = false }
}
onMounted(() => void load())

const board = computed<CommunityStudyRankingRow[]>(() => (tab.value === 'total' ? payload.value?.total.items : payload.value?.week.items) ?? [])
const myRank = computed(() => (tab.value === 'total' ? payload.value?.total.myRank : payload.value?.week.myRank) ?? 0)
const myHours = computed(() => (tab.value === 'total' ? payload.value?.total.myHours : payload.value?.week.myHours) ?? 0)
const podium = computed(() => board.value.slice(0, 3))
const rest = computed(() => board.value.slice(3))
const isMe = (row: CommunityStudyRankingRow) => row.userId === auth.user?.id
</script>
<template>
  <div class="page-container study-ranking-page">
    <PageHero eyebrow="学习社区" title="学时排名" description="看看谁在学习上投入最多时间，向身边的榜样看齐。" visual-key="assessmentsHeroAssetId" />
    <nav class="community-filters" aria-label="榜单切换">
      <button :class="{ active: tab === 'total' }" type="button" @click="tab = 'total'">总榜</button>
      <button :class="{ active: tab === 'week' }" type="button" @click="tab = 'week'">本周榜</button>
    </nav>
    <p v-if="myRank" class="muted study-mine">我的名次：第 {{ myRank }} 名 · {{ myHours }} 学时</p>
    <CommunitySkeleton v-if="loading" />
    <p v-else-if="error" role="alert" class="community-error">{{ error }} <button class="text-link" type="button" @click="load()">重试</button></p>
    <template v-else>
      <section v-if="podium.length" class="ranking-podium">
        <article v-for="(row, index) in podium" :key="row.userId" :class="['rank-top', `rank-${index + 1}`]">
          <strong class="rank-medal">{{ ['🥇', '🥈', '🥉'][index] }}</strong>
          <CommunityAvatar :src="undefined" :username="row.username" :name="row.displayName" />
          <strong class="rank-name">{{ row.displayName }}</strong>
          <small>{{ row.school }}<template v-if="row.major"> · {{ row.major }}</template></small>
          <strong class="rank-hours">{{ row.hours }}<small> 学时</small></strong>
        </article>
      </section>
      <section v-if="rest.length">
        <ol class="rank-list">
          <li v-for="(row, index) in rest" :key="row.userId" :class="{ 'rank-me': isMe(row) }">
            <span class="rank-no">{{ index + 4 }}</span>
            <CommunityAvatar :src="undefined" :username="row.username" :name="row.displayName" size="xs" />
            <span class="rank-name">{{ row.displayName }}<small>{{ row.school }}<template v-if="row.major"> · {{ row.major }}</template></small></span>
            <span class="rank-hours"><strong>{{ row.hours }}</strong> 学时<em v-if="isMe(row)">我</em></span>
          </li>
        </ol>
      </section>
      <p v-if="!board.length" class="notice">还没有可统计的学习记录。学时由真实学习行为累计：成长积分（每 10 积分 = 1 学时）、视频观看时长、课程学习进度折算——先去学习主题或实训中心积累吧。</p>
    </template>
  </div>
</template>
<style scoped>
.study-mine { margin: 0 0 14px; font-weight: 650; }
.ranking-podium { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 22px 0; }
.ranking-podium article { display: grid; justify-items: center; gap: 6px; padding: 20px 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-card); background: white; text-align: center; }
.rank-top.rank-1 { border-color: #f0c14b; box-shadow: 0 6px 18px rgba(240, 193, 75, .18); }
.rank-top.rank-2 { border-color: #c9cdd4; }
.rank-top.rank-3 { border-color: #d9a06b; }
.rank-medal { font-size: 26px; line-height: 1; }
.rank-top .rank-name { font-size: 15px; }
.rank-top small { color: var(--muted); font-size: 12px; }
.rank-hours { font-size: 20px; font-weight: 750; color: var(--brand); }
.rank-hours small { font-size: 12px; font-weight: 500; color: var(--muted); }
ol.rank-list { padding-left: 0; margin: 0; list-style: none; }
.rank-list li { display: flex; align-items: center; gap: 12px; padding: 12px 10px; border-bottom: 1px solid var(--border); border-radius: 10px; }
.rank-list li.rank-me { background: #fff7f0; border-left: 3px solid var(--brand); }
.rank-no { width: 30px; color: var(--muted); font-weight: 700; }
.rank-name { display: grid; gap: 2px; flex: 1; min-width: 0; font-weight: 650; overflow-wrap: anywhere; }
.rank-name small { color: var(--muted); font-size: 12px; font-weight: 400; }
.rank-list .rank-hours { font-size: 15px; }
.rank-list em { font-style: normal; margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: var(--amc-orange-soft); color: var(--amc-orange); font-size: 11px; }
</style>
