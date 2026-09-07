<script setup lang="ts">
import { computed, ref } from 'vue'
import PageHero from '../components/PageHero.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import { useAuthStore } from '../stores/auth'

interface RankingRow { name: string; username: string; school: string; major: string; hours: number }

const auth = useAuthStore()
const tab = ref<'total' | 'week'>('total')

/* 演示榜单：同学名单与学时为固定演示数据；「我」的学时同样为演示值 */
const classmates: RankingRow[] = [
  { name: '张一帆', username: 'zhangyifan', school: 'AI 创客学院', major: '人工智能', hours: 328 },
  { name: '李思远', username: 'lisiyuan', school: '数智工程学院', major: '计算机科学', hours: 289 },
  { name: '王梓萌', username: 'wangzimeng', school: 'AI 创客学院', major: '软件工程', hours: 263 },
  { name: '陈子豪', username: 'chenzihao', school: '信息学院', major: '数据科学', hours: 242 },
  { name: '刘雨欣', username: 'liuyuxin', school: 'AI 创客学院', major: '人工智能', hours: 224 },
  { name: '赵晨阳', username: 'zhaochenyang', school: '数智工程学院', major: '软件工程', hours: 205 },
  { name: '孙悦', username: 'sunyue', school: '信息学院', major: '计算机科学', hours: 190 },
  { name: '周博文', username: 'zhoubowen', school: 'AI 创客学院', major: '数据科学', hours: 175 },
  { name: '吴佳琪', username: 'wujiaqi', school: '数智工程学院', major: '人工智能', hours: 161 },
  { name: '郑浩然', username: 'zhenghaoran', school: 'AI 创客学院', major: '计算机科学', hours: 149 },
  { name: '何静怡', username: 'hejingyi', school: '信息学院', major: '软件工程', hours: 136 },
  { name: '高天佑', username: 'gaotianyou', school: 'AI 创客学院', major: '人工智能', hours: 124 },
  { name: '林晓峰', username: 'linxiaofeng', school: '数智工程学院', major: '数据科学', hours: 113 },
  { name: '罗雪', username: 'luoxue', school: '信息学院', major: '计算机科学', hours: 102 },
  { name: '梁俊', username: 'liangjun', school: 'AI 创客学院', major: '软件工程', hours: 93 },
  { name: '宋佳霖', username: 'songjialin', school: '数智工程学院', major: '人工智能', hours: 84 },
  { name: '唐悦然', username: 'tangyueran', school: '信息学院', major: '计算机科学', hours: 76 },
  { name: '韩明轩', username: 'hanmingxuan', school: 'AI 创客学院', major: '数据科学', hours: 68 },
  { name: '冯思涵', username: 'fengsihan', school: '数智工程学院', major: '计算机科学', hours: 61 },
  { name: '曹宇航', username: 'caoyuhang', school: '信息学院', major: '软件工程', hours: 54 }
]
const weeklyHours = [16, 13, 11, 10, 9, 9, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 2]

const me = computed<RankingRow>(() => ({
  name: `${auth.user?.displayName || '我'}（我）`,
  username: auth.user?.username || 'me',
  school: auth.user?.school || 'AI 创客学院',
  major: auth.user?.major || '计算机科学与技术',
  hours: tab.value === 'total' ? 126 : 12
}))
const board = computed<RankingRow[]>(() => {
  const rows = classmates.map((row, index) => ({ ...row, hours: tab.value === 'total' ? row.hours : weeklyHours[index] ?? 1 }))
  rows.push({ ...me.value, hours: me.value.hours })
  return rows.sort((a, b) => b.hours - a.hours)
})
const podium = computed(() => board.value.slice(0, 3))
const rest = computed(() => board.value.slice(3))
const isMe = (row: RankingRow) => row.username === (auth.user?.username || 'me')
</script>
<template>
  <div class="page-container study-ranking-page">
    <PageHero eyebrow="学习社区" title="学时排名" description="看看谁在学习上投入最多时间，向身边的榜样看齐。" visual-key="assessmentsHeroAssetId" />
    <nav class="community-filters" aria-label="榜单切换">
      <button :class="{ active: tab === 'total' }" type="button" @click="tab = 'total'">总榜</button>
      <button :class="{ active: tab === 'week' }" type="button" @click="tab = 'week'">本周榜</button>
    </nav>
    <section class="ranking-podium">
      <article v-for="(row, index) in podium" :key="row.username" :class="['rank-top', `rank-${index + 1}`]">
        <strong class="rank-medal">{{ ['🥇', '🥈', '🥉'][index] }}</strong>
        <CommunityAvatar :src="undefined" :username="row.username" :name="row.name" />
        <strong class="rank-name">{{ row.name }}</strong>
        <small>{{ row.school }} · {{ row.major }}</small>
        <strong class="rank-hours">{{ row.hours }}<small> 学时</small></strong>
      </article>
    </section>
    <section>
      <ol class="rank-list">
        <li v-for="(row, index) in rest" :key="row.username" :class="{ 'rank-me': isMe(row) }">
          <span class="rank-no">{{ index + 4 }}</span>
          <CommunityAvatar :src="undefined" :username="row.username" :name="row.name" size="xs" />
          <span class="rank-name">{{ row.name }}<small>{{ row.school }} · {{ row.major }}</small></span>
          <span class="rank-hours"><strong>{{ row.hours }}</strong> 学时<em v-if="isMe(row)">我</em></span>
        </li>
      </ol>
    </section>
    <p class="notice study-demo-note">当前为演示榜单：同学名单与学时为平台演示数据，用于展示排名功能。</p>
  </div>
</template>
<style scoped>
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
.study-demo-note { margin: 16px 0 0; }
</style>
