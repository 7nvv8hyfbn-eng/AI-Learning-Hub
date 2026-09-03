<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommunityStore } from '../stores/community'
import { badgeLabels } from './labels'
import CommunitySkeleton from './CommunitySkeleton.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import FollowButton from '../components/base/FollowButton.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { communityArt } from '../assets/community/manifest'
const store = useCommunityStore()
const error = ref('')
const tasks = computed(() => [
  { label: '今日学习任务', item: store.context?.todayPlan, route: '/profile', guide: '制定今天的小目标', category: 'plan', icon: 'target' },
  { label: '继续学习', item: store.context?.continueCourse, route: '/topics', guide: '选择一门感兴趣的课程', category: 'course', icon: 'course' },
  { label: '继续实训', item: store.context?.continueLab, route: '/labs', guide: '开始一次受控实训', category: 'lab', icon: 'terminal' },
  { label: '本周挑战', item: store.context?.currentChallenge, route: '/assessments', guide: '查看挑战与测评', category: 'challenge', icon: 'trophy' },
])
const follow = async (id: string, topic: boolean, active: boolean) => { error.value = ''; try { await store.follow(id, topic, active) } catch (cause) { error.value = cause instanceof Error ? cause.message : '关注失败，请重试' } }
</script>
<template><aside class="community-right-rail" aria-label="学习辅助">
  <CommunitySkeleton v-if="!store.context && !store.error" :rows="2" />
  <template v-else>
  <section class="community-rail-card learning-rhythm-card">
    <img v-bind="communityArt.notebook" class="rail-notebook" alt="" />
    <h2>我的学习节奏</h2>
    <article v-for="task in tasks" :key="task.label" class="rail-task" :class="`task-${task.category}`">
      <AppIcon class="rail-task-icon" :name="task.icon" :size="24" />
      <div><small>{{ task.label }}</small><RouterLink :to="task.item?.route || task.route"><span>{{ task.item?.title || task.guide }}</span><AppIcon name="arrow-up-right" :size="17" /></RouterLink><progress v-if="task.item?.progress !== undefined" :value="task.item.progress" max="100" :aria-label="task.label" /></div>
    </article>
  </section>
  <section class="community-rail-card rail-topics-card">
    <h2>正在讨论的话题</h2>
    <div v-for="topic in (store.context?.trendingTopics || []).slice(0, 5)" :key="topic.id" class="rail-topic"><RouterLink :to="`/community/topic/${topic.slug}`"><strong># {{ topic.name }}</strong><small>{{ topic.postCount }} 条学习交流<span v-if="topic.postCount >= 10" class="rail-topic-heat"><AppIcon name="energy" :size="13" />{{ topic.postCount >= 50 ? '热' : '上升' }}</span></small></RouterLink><FollowButton :active="topic.following" :label="`${topic.following ? '取消关注' : '关注'}话题 ${topic.name}`" :pending="store.operations[`follow:topic:${topic.id}`]" @click="follow(topic.id, true, !topic.following)" /></div>
    <p v-if="!store.context?.trendingTopics.length">暂无话题，先分享一个学习问题。</p>
    <RouterLink class="text-link rail-more" to="/community/search?type=topics">查看更多话题 <AppIcon name="arrow-right" :size="14" /></RouterLink>
    <img v-bind="communityArt.topicPlanet" class="rail-planet" alt="" loading="lazy" />
  </section>
  <section class="community-rail-card rail-people-card">
    <h2>一起向前的伙伴</h2>
    <div v-for="user in (store.context?.suggestedUsers || []).slice(0, 3)" :key="user.id" class="rail-person"><RouterLink :to="`/community/user/${user.username}`"><CommunityAvatar :src="user.avatar" :username="user.username" :name="user.displayName" size="sm" /><span><strong>{{ user.displayName }}</strong><small>{{ badgeLabels[user.verifiedType] || '学习创作者' }}</small></span></RouterLink><FollowButton :active="!!store.authorFollowing[user.id]" :label="`${store.authorFollowing[user.id] ? '取消关注' : '关注'}用户 ${user.displayName}`" :pending="store.operations[`follow:user:${user.id}`]" @click="follow(user.id, false, !store.authorFollowing[user.id])" /></div>
    <div v-if="store.context?.suggestedUsers.length" class="rail-avatar-group"><CommunityAvatar v-for="user in store.context.suggestedUsers.slice(0, 4)" :key="user.id" :src="user.avatar" :username="user.username" :name="user.displayName" size="xs" /><RouterLink class="icon-button" to="/community/search?type=users" aria-label="查看更多学习伙伴"><AppIcon name="more-circle" :size="18" /></RouterLink></div>
    <RouterLink class="text-link rail-more" to="/community/search?type=users">查看更多：搜索学习者</RouterLink>
  </section>
  <p v-if="error" class="community-error" role="alert">{{ error }}</p>
  <small class="community-rail-footer">AI MAKER CAMPUS · 让学习留下作品</small>
  </template>
</aside></template>
