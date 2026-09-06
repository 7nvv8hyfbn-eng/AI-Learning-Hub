<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LANDING_DEFAULT_CONFIG, type HomepageResolvedItemDto, type LandingConfigMap, type LandingModuleKey, type LandingPublicAuthor, type PublicHomepageDto } from '@ai-learning-hub/contracts'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import FollowButton from '../components/base/FollowButton.vue'
import LandingContentCard from './LandingContentCard.vue'
import { landingAsset } from '../assets/landing/manifest'
import { useAuthStore } from '../stores/auth'
import { useAuthUiStore } from '../stores/authUi'
import { useCommunityStore } from '../stores/community'
import { itemPath } from '../homepage/module-utils'
import { badgeLabels } from '../community/labels'
import { communityApi } from '../services/api/community'
const props = defineProps<{ homepage: PublicHomepageDto; preview?: boolean }>()
const router = useRouter(), auth = useAuthStore(), authUi = useAuthUiStore(), community = useCommunityStore()
const capabilities = ref<HTMLElement>()
const followError = ref('')
const followingLoading = ref(false)
watch(() => auth.user?.id, async (id) => {
  followError.value = ''
  followingLoading.value = Boolean(id && !props.preview)
  if (!id || props.preview) return
  try {
    const following = await communityApi.following(id)
    if (auth.user?.id !== id) return
    const followedIds = new Set(following.map((user) => user.id))
    for (const item of creators.value) community.authorFollowing[author(item).id] = followedIds.has(author(item).id)
  } catch { if (auth.user?.id === id) followError.value = '关注状态暂未同步，请稍后进入社区查看。' }
  finally { if (auth.user?.id === id) followingLoading.value = false }
}, { immediate: true })
const moduleFor = (key: LandingModuleKey) => props.homepage.modules.find((module) => module.moduleKey === key)
const config = <K extends LandingModuleKey>(key: K) => ({ ...LANDING_DEFAULT_CONFIG[key], ...moduleFor(key)?.config }) as LandingConfigMap[K]
const hero = computed(() => config('landing_hero')), ability = computed(() => config('landing_capabilities'))
const overview = computed(() => config('landing_community_overview')), cta = computed(() => config('landing_bottom_cta'))
const heroSlots = [
  { className: 'landing-mosaic-note', variant: 'note', cover: 'robotCar' },
  { className: 'landing-mosaic-visual', variant: 'visual', cover: 'robotVision' },
  { className: 'landing-mosaic-code', variant: 'code', cover: 'aiWorkspace' },
  { className: 'landing-mosaic-resource', variant: 'resource', cover: 'robotCar' },
  { className: 'landing-mosaic-topic', variant: 'note', cover: 'aiWorkspace' },
] as const
const heroItems = computed(() => {
  const items = (moduleFor('landing_hero')?.items || []).slice(0, 5)
  return heroSlots.map((_, slot) => items.find((item, index) => (item.slot ?? index) === slot))
})
const topics = computed(() => (moduleFor('landing_community_overview')?.items || []).filter((item) => item.targetType === 'community_topic').slice(0, 5))
const creators = computed(() => (moduleFor('landing_community_overview')?.items || []).filter((item) => item.targetType === 'community_user').slice(0, 4))
const author = (item: HomepageResolvedItemDto) => item.data as unknown as LandingPublicAuthor
const navigate = (path = '/community', action?: () => Promise<unknown>) => {
  if (props.preview) return
  if (!auth.user) authUi.open({ redirect: path, action })
  else { void router.push(path); void action?.() }
}
const openItem = (item: HomepageResolvedItemDto) => navigate(itemPath(item))
const follow = (item: HomepageResolvedItemDto) => {
  if (props.preview || followingLoading.value || auth.user?.id === author(item).id) return
  const action = async () => {
    try { await community.follow(author(item).id, false, !community.authorFollowing[author(item).id]); followError.value = '' }
    catch { followError.value = '关注操作未完成，请稍后重试。'; window.dispatchEvent(new CustomEvent('api-error', { detail: { message: followError.value } })) }
  }
  if (!auth.user) authUi.open({ redirect: itemPath(item), action })
  else void action()
}
const learnMore = () => capabilities.value?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
</script>
<template>
  <div v-if="moduleFor('landing_hero')" class="landing-page">
    <section class="landing-hero landing-container" aria-labelledby="landing-title">
      <div class="landing-hero-copy">
        <div class="landing-brand"><span class="brand-mark">A</span><div><strong>{{ hero.brandName }}</strong><small>{{ hero.brandSubtitle }}</small></div></div>
        <span class="landing-eyebrow">{{ hero.eyebrow }}</span>
        <h1 id="landing-title">{{ hero.titleFirst }}<span>{{ hero.titleSecond }}</span></h1>
        <p class="landing-description">{{ hero.description }}</p>
        <div class="landing-actions"><button class="button primary landing-login" type="button" @click="navigate()">{{ auth.user ? '进入社区' : hero.primaryLabel }}<AppIcon name="arrow-right" :size="20" /></button><button class="button secondary" type="button" @click="learnMore">{{ hero.secondaryLabel }}</button></div>
        <div v-if="hero.memberDisplay !== 'hidden'" class="landing-social-proof"><div class="landing-avatar-stack"><CommunityAvatar v-for="creator in homepage.community?.creators.slice(0, 4)" :key="creator.id" :name="creator.displayName" :username="creator.username" size="xs" /></div><span v-if="hero.memberDisplay === 'count' && homepage.community"><strong>{{ homepage.community.members.toLocaleString('zh-CN') }}</strong> 位学习者在这里学习与创造</span><span v-else>和更多创作者一起，让想法发生</span></div>
      </div>
      <div class="landing-hero-mosaic" aria-label="社区内容预览">
        <img class="landing-hero-arms" :src="landingAsset(hero.image, 'heroArms')" alt="" width="960" height="640" fetchpriority="high" />
        <template v-for="(slot, index) in heroSlots" :key="slot.className">
          <LandingContentCard v-if="heroItems[index]" :class="slot.className" :item="heroItems[index]!" :variant="slot.variant" :cover="slot.cover" @open="openItem" />
          <button v-else-if="index === 4" type="button" class="landing-content-card landing-mosaic-topic landing-card-note" @click="navigate('/community')"><div class="landing-card-copy"><span class="landing-tag">社区精选</span><h3>更多社区帖子正在路上</h3><p>进入社区，发现最新的学习分享与实践记录。</p><span class="landing-card-link">浏览社区 <AppIcon name="arrow-right" :size="14" /></span></div></button>
        </template>
      </div>
    </section>
    <section v-if="moduleFor('landing_capabilities')" ref="capabilities" class="landing-capabilities landing-container" aria-labelledby="landing-capabilities-title">
      <h2 id="landing-capabilities-title">{{ ability.title }}</h2>
      <div class="landing-capability-grid"><article v-for="(item, index) in ability.items.slice(0, 6)" :key="index" class="landing-capability"><img :src="landingAsset(item.icon, 'learningQuestion')" alt="" width="96" height="96" loading="lazy" /><h3>{{ item.title }}</h3><p>{{ item.description }}</p></article></div>
    </section>
    <section v-if="moduleFor('landing_featured')" class="landing-featured landing-container" aria-labelledby="landing-featured-title">
      <div class="landing-section-heading"><h2 id="landing-featured-title">{{ config('landing_featured').title }}</h2><button type="button" class="text-link" @click="navigate()">查看全部内容 <AppIcon name="arrow-right" :size="16" /></button></div>
      <div class="landing-featured-grid"><LandingContentCard v-for="(item, index) in moduleFor('landing_featured')?.items.slice(0, 3)" :key="`${item.targetType}:${item.slug}`" :item="item" :cover="(['robotCar', 'robotVision', 'aiWorkspace'] as const)[index]" @open="openItem" /></div>
      <p v-if="!moduleFor('landing_featured')?.items.length" class="landing-empty">暂无公开精选内容，社区的新作品很快会在这里与你相遇。</p>
    </section>
    <section v-if="moduleFor('landing_community_overview')" class="landing-overview landing-container" aria-label="社区话题与创作者">
      <article class="landing-overview-panel"><div class="landing-section-heading"><h2>{{ overview.topicsTitle }}</h2><button class="text-link" type="button" @click="navigate('/community/search?type=topics')">查看更多 <AppIcon name="arrow-right" :size="14" /></button></div>
        <button v-for="topic in topics" :key="topic.slug" class="landing-topic-row" type="button" @click="openItem(topic)"><span class="landing-topic-symbol" aria-hidden="true">#</span><span><strong>{{ topic.title }}</strong><small>{{ topic.data.postCount }} 条公开讨论 · {{ topic.data.followerCount }} 人关注</small></span><span class="landing-topic-status">{{ topic.data.recommended ? '热门' : '话题' }}</span></button><p v-if="!topics.length" class="landing-empty">暂无公开话题</p>
      </article>
      <article class="landing-overview-panel"><div class="landing-section-heading"><h2>{{ overview.creatorsTitle }}</h2><button class="text-link" type="button" @click="navigate('/community/search?type=users')">查看更多 <AppIcon name="arrow-right" :size="14" /></button></div>
        <p v-if="followError" role="status" class="landing-empty">{{ followError }}</p>
        <div v-for="creator in creators" :key="creator.slug" class="landing-creator-row"><button class="landing-creator-profile" type="button" @click="openItem(creator)"><CommunityAvatar :name="creator.title" :username="creator.slug" :src="author(creator).avatarUrl" size="md" /><span><strong>{{ creator.title }} <small>{{ badgeLabels[author(creator).verifiedType as keyof typeof badgeLabels] || '社区创作者' }}</small></strong><p>{{ creator.summary || '分享学习与实践经验' }}</p></span></button><FollowButton v-if="auth.user?.id !== author(creator).id" :active="community.authorFollowing[author(creator).id]" :pending="followingLoading || community.operations[`follow:user:${author(creator).id}`]" :label="`关注${creator.title}`" @click="follow(creator)" /></div><p v-if="!creators.length" class="landing-empty">暂无公开创作者</p>
      </article>
    </section>
    <section v-if="moduleFor('landing_bottom_cta')" class="landing-bottom-cta landing-container" aria-labelledby="landing-cta-title"><div><h2 id="landing-cta-title">{{ cta.title }}</h2><p>{{ cta.description }}</p><button class="button primary landing-login" type="button" @click="navigate()">{{ auth.user ? '进入社区' : cta.buttonLabel }}<AppIcon name="arrow-right" :size="20" /></button></div><img :src="landingAsset(cta.image, 'ctaRobot')" alt="" width="1200" height="600" loading="lazy" /></section>
    <footer class="landing-footer landing-container"><strong>{{ hero.brandName }}</strong><span>© {{ new Date().getFullYear() }} AI数智化学习平台</span><RouterLink to="/terms">用户协议</RouterLink><RouterLink to="/privacy">隐私政策</RouterLink></footer>
  </div>
  <section v-else class="landing-container landing-empty"><h1>社区落地页正在准备中</h1><p>请稍后再来，或登录后继续学习。</p><button class="button primary" @click="navigate()">登录 / 注册</button></section>
</template>
