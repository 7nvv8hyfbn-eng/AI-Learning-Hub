<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageHero from '../components/PageHero.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import CommunitySkeleton from '../community/CommunitySkeleton.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { useAuthStore } from '../stores/auth'
import { communityApi, type CommunityPersonStudyRanking, type CommunitySchoolStudyRankingRow, type CommunityStudyRankingRow, type CommunityStudyPeriod } from '../services/api/community'
const auth = useAuthStore(), route = useRoute(), router = useRouter()

const schoolId = computed(() => (route.params.schoolId as string | undefined) || '')
const isDetail = computed(() => !!schoolId.value)
type MainTab = 'p-total' | 'p-week' | 's-total' | 's-week'
type PersonTab = 'p-total' | 'p-week'
const mainTab = ref<MainTab>('p-total')
const detailTab = ref<PersonTab>(route.query.tab === 'week' ? 'p-week' : 'p-total')

const loading = ref(false), error = ref('')
const personData = ref<CommunityPersonStudyRanking>()
const schoolList = ref<CommunitySchoolStudyRankingRow[]>([])
const schoolName = ref('')
const cache = new Map<string, unknown>()

const load = async (force = false) => {
  const key = isDetail.value ? `sp:${schoolId.value}:${detailTab.value}` : mainTab.value
  if (!force && cache.has(key)) { apply(key); return }
  loading.value = true; error.value = ''
  try {
    if (isDetail.value) {
      const period: CommunityStudyPeriod = detailTab.value === 'p-week' ? 'week' : 'total'
      const data = await communityApi.studyRankingSchool(schoolId.value, period)
      cache.set(key, data); apply(key)
      if (!schoolName.value) await resolveSchoolName(schoolId.value)
    } else if (mainTab.value === 's-total' || mainTab.value === 's-week') {
      const period: CommunityStudyPeriod = mainTab.value === 's-week' ? 'week' : 'total'
      const data = await communityApi.studyRankingSchoolBoard(period)
      cache.set(key, data.items); apply(key)
      if (!schoolName.value) schoolName.value = data.items[0]?.name || ''
    } else {
      const period: CommunityStudyPeriod = mainTab.value === 'p-week' ? 'week' : 'total'
      const data = await communityApi.studyRankingPerson(period)
      cache.set(key, data); apply(key)
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '学时排名读取失败' } finally { loading.value = false }
}
const apply = (key: string) => {
  if (key.startsWith('sp:')) personData.value = cache.get(key) as CommunityPersonStudyRanking
  else if (key.startsWith('s-')) schoolList.value = (cache.get(key) as CommunitySchoolStudyRankingRow[]) || []
  else personData.value = cache.get(key) as CommunityPersonStudyRanking
}
const resolveSchoolName = async (id: string) => {
  const sKey = 's-total'
  let list: CommunitySchoolStudyRankingRow[]
  if (cache.has(sKey)) list = cache.get(sKey) as CommunitySchoolStudyRankingRow[]
  else { const data = await communityApi.studyRankingSchoolBoard('total'); list = data.items; cache.set(sKey, list) }
  schoolName.value = list.find((row) => row.schoolId === id)?.name || ''
}
watch([mainTab, detailTab, schoolId], () => void load())
onMounted(() => void load())

const board = computed<CommunityStudyRankingRow[]>(() => personData.value?.items ?? [])
const myRank = computed(() => personData.value?.myRank ?? 0)
const myHours = computed(() => personData.value?.myHours ?? 0)
const podium = computed(() => board.value.slice(0, 3))
const rest = computed(() => board.value.slice(3))
const isMe = (row: CommunityStudyRankingRow) => row.userId === auth.user?.id
const medal = (index: number) => ['🥇', '🥈', '🥉'][index] ?? ''

const openSchool = (row: CommunitySchoolStudyRankingRow) => {
  const tab = mainTab.value === 's-week' ? 'week' : 'total'
  void router.push({ path: `/study-ranking/school/${row.schoolId}`, query: { tab } })
}
const backToMain = () => void router.push('/study-ranking')
</script>
<template>
  <div class="page-container study-ranking-page">
    <template v-if="!isDetail">
      <PageHero eyebrow="学习社区" title="学时排名" description="看看谁在学习上投入最多时间，向身边的榜样看齐。" visual-key="assessmentsHeroAssetId" />
      <nav class="community-filters" aria-label="榜单切换">
        <button :class="{ active: mainTab === 'p-total' }" type="button" @click="mainTab = 'p-total'">个人总榜</button>
        <button :class="{ active: mainTab === 'p-week' }" type="button" @click="mainTab = 'p-week'">个人周榜</button>
        <button :class="{ active: mainTab === 's-total' }" type="button" @click="mainTab = 's-total'">高校总榜</button>
        <button :class="{ active: mainTab === 's-week' }" type="button" @click="mainTab = 's-week'">高校周榜</button>
      </nav>
      <p v-if="mainTab.startsWith('p-') && myRank" class="muted study-mine">我的名次：第 {{ myRank }} 名 · {{ myHours }} 学时</p>
      <CommunitySkeleton v-if="loading" />
      <p v-else-if="error" role="alert" class="community-error">{{ error }} <button class="text-link" type="button" @click="load(true)">重试</button></p>
      <template v-else>
        <template v-if="mainTab.startsWith('p-')">
          <section v-if="podium.length" class="ranking-podium">
            <article v-for="(row, index) in podium" :key="row.userId" :class="['rank-top', `rank-${index + 1}`]">
              <strong class="rank-medal">{{ medal(index) }}</strong>
              <RouterLink class="rank-avatar-link" :to="`/community/user/${row.username}`"><CommunityAvatar :src="undefined" :username="row.username" :name="row.displayName" /></RouterLink>
              <strong class="rank-name">{{ row.displayName }}</strong>
              <small>{{ row.school }}<template v-if="row.major"> · {{ row.major }}</template></small>
              <strong class="rank-hours">{{ row.hours }}<small> 学时</small></strong>
            </article>
          </section>
          <section v-if="rest.length">
            <ol class="rank-list">
              <li v-for="(row, index) in rest" :key="row.userId" :class="{ 'rank-me': isMe(row) }">
                <span class="rank-no">{{ index + 4 }}</span>
                <RouterLink class="rank-avatar-link" :to="`/community/user/${row.username}`"><CommunityAvatar :src="undefined" :username="row.username" :name="row.displayName" size="xs" /></RouterLink>
                <span class="rank-name">{{ row.displayName }}<small>{{ row.school }}<template v-if="row.major"> · {{ row.major }}</template></small></span>
                <span class="rank-hours"><strong>{{ row.hours }}</strong> 学时<em v-if="isMe(row)">我</em></span>
              </li>
            </ol>
          </section>
          <p v-if="!board.length" class="notice">还没有可统计的学习记录。学时由真实学习行为累计：成长积分（每 10 积分 = 1 学时）、视频观看时长、课程学习进度折算——先去学习主题或实训中心积累吧。</p>
        </template>
        <template v-else>
          <section v-if="schoolList.length">
            <ol class="rank-list">
              <li v-for="(row, index) in schoolList" :key="row.schoolId">
                <button class="school-card" type="button" @click="openSchool(row)">
                  <span class="rank-no" :class="{ 'rank-no-top': index < 3 }">{{ index < 3 ? medal(index) : index + 1 }}</span>
                  <span class="rank-name">{{ row.name }}</span>
                  <span class="rank-hours"><strong>{{ row.hours }}</strong> 学时<AppIcon class="school-arrow" name="arrow-right" :size="15" /></span>
                </button>
              </li>
            </ol>
          </section>
          <p v-if="!schoolList.length" class="notice">还没有高校产生学习记录，等待同学们开始学习后这里会自动点亮。</p>
        </template>
      </template>
    </template>
    <template v-else>
      <header class="school-detail-head">
        <button class="text-link" type="button" @click="backToMain"><AppIcon name="arrow-left" :size="16" />返回榜单</button>
        <h1>{{ schoolName || '校内学时排名' }}</h1>
        <nav class="community-filters" aria-label="校内榜单切换">
          <button :class="{ active: detailTab === 'p-total' }" type="button" @click="detailTab = 'p-total'">个人总榜</button>
          <button :class="{ active: detailTab === 'p-week' }" type="button" @click="detailTab = 'p-week'">个人周榜</button>
        </nav>
      </header>
      <p v-if="myRank" class="muted study-mine">我的校内名次：第 {{ myRank }} 名 · {{ myHours }} 学时</p>
      <CommunitySkeleton v-if="loading" />
      <p v-else-if="error" role="alert" class="community-error">{{ error }} <button class="text-link" type="button" @click="load(true)">重试</button></p>
      <template v-else>
        <section v-if="podium.length" class="ranking-podium">
          <article v-for="(row, index) in podium" :key="row.userId" :class="['rank-top', `rank-${index + 1}`]">
            <strong class="rank-medal">{{ medal(index) }}</strong>
            <RouterLink class="rank-avatar-link" :to="`/community/user/${row.username}`"><CommunityAvatar :src="undefined" :username="row.username" :name="row.displayName" /></RouterLink>
            <strong class="rank-name">{{ row.displayName }}</strong>
            <small>{{ row.major || row.school }}</small>
            <strong class="rank-hours">{{ row.hours }}<small> 学时</small></strong>
          </article>
        </section>
        <section v-if="rest.length">
          <ol class="rank-list">
            <li v-for="(row, index) in rest" :key="row.userId" :class="{ 'rank-me': isMe(row) }">
              <span class="rank-no">{{ index + 4 }}</span>
              <RouterLink class="rank-avatar-link" :to="`/community/user/${row.username}`"><CommunityAvatar :src="undefined" :username="row.username" :name="row.displayName" size="xs" /></RouterLink>
              <span class="rank-name">{{ row.displayName }}<small>{{ row.major || row.school }}</small></span>
              <span class="rank-hours"><strong>{{ row.hours }}</strong> 学时<em v-if="isMe(row)">我</em></span>
            </li>
          </ol>
        </section>
        <p v-if="!board.length" class="notice">本校还没有同学产生学习记录。</p>
      </template>
    </template>
  </div>
</template>
<style scoped>
.rank-avatar-link { display: inline-flex; border-radius: 50%; flex-shrink: 0; }
.study-mine { margin: 0 0 14px; font-weight: 650; }
.school-detail-head { display: grid; gap: 10px; margin: 8px 0 6px; }
.school-detail-head h1 { margin: 0; font-size: 1.6rem; letter-spacing: -.01em; }
.school-detail-head .text-link { display: inline-flex; align-items: center; gap: 5px; justify-self: start; }
ol.rank-list { padding-left: 0; margin: 0; list-style: none; }
.rank-list li { padding: 0; border-bottom: 1px solid var(--border); border-radius: 10px; }
.school-card { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 12px 10px; border: 0; background: transparent; text-align: left; cursor: pointer; border-radius: 10px; transition: background var(--amc-duration-control) var(--amc-ease); }
.school-card:hover { background: var(--amc-bg-soft); }
.rank-no { width: 30px; color: var(--muted); font-weight: 700; }
.rank-no.rank-no-top { font-size: 16px; }
.rank-name { display: grid; gap: 2px; flex: 1; min-width: 0; font-weight: 650; overflow-wrap: anywhere; }
.rank-name small { color: var(--muted); font-size: 12px; font-weight: 400; }
.rank-hours { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; color: var(--text); white-space: nowrap; }
.rank-hours strong { font-size: 17px; color: var(--brand); }
.rank-hours .school-arrow { color: var(--muted); }
.ranking-podium { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 22px 0; }
.ranking-podium article { display: grid; justify-items: center; gap: 6px; padding: 20px 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-card); background: white; text-align: center; }
.rank-top.rank-1 { border-color: #f0c14b; box-shadow: 0 6px 18px rgba(240, 193, 75, .18); }
.rank-top.rank-2 { border-color: #c9cdd4; }
.rank-top.rank-3 { border-color: #d9a06b; }
.rank-medal { font-size: 26px; line-height: 1; }
.rank-top .rank-name { font-size: 15px; }
.rank-top small { color: var(--muted); font-size: 12px; }
.ranking-podium .rank-hours { font-size: 20px; }
.ranking-podium .rank-hours small { font-size: 12px; font-weight: 500; color: var(--muted); }
.rank-list em { font-style: normal; margin-left: 8px; padding: 1px 7px; border-radius: 999px; background: var(--amc-orange-soft); color: var(--amc-orange); font-size: 11px; }
</style>
