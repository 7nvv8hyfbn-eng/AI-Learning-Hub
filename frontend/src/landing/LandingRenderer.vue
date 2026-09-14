<script setup lang="ts">
import { BRAND_NAME, BRAND_MARK } from '@ai-learning-hub/contracts'
import CommunityUserBadges from '../community/CommunityUserBadges.vue'
import { appVersion } from '../version'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LANDING_DEFAULT_CONFIG, type HomepageResolvedItemDto, type LandingConfigMap, type LandingModuleKey, type LandingPublicAuthor, type PublicHomepageDto } from '@ai-learning-hub/contracts'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import FollowButton from '../components/base/FollowButton.vue'
import LandingContentCard from './LandingContentCard.vue'
import { landingAsset, landingAssets } from '../assets/landing/manifest'
import { useAuthStore } from '../stores/auth'
import { useAuthUiStore } from '../stores/authUi'
import { useCommunityStore } from '../stores/community'
import { itemPath } from '../homepage/module-utils'
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
        <div class="landing-brand"><span class="brand-mark">{{ BRAND_MARK }}</span><div><strong>{{ hero.brandName }}</strong><small>{{ hero.brandSubtitle }}</small></div></div>
        <span class="landing-eyebrow">{{ hero.eyebrow }}</span>
        <h1 id="landing-title" :aria-label="[hero.titleFirst, hero.titleSecond].join(' ')">{{ hero.titleFirst }}<span>{{ hero.titleSecond }}</span></h1>
        <p class="landing-description">{{ hero.description }}</p>
        <div class="landing-actions"><button class="button primary landing-login" type="button" @click="navigate()">{{ auth.user ? '进入社区' : hero.primaryLabel }}<AppIcon name="arrow-right" :size="20" /></button><button class="button secondary" type="button" @click="learnMore">{{ hero.secondaryLabel }}</button></div>
        <div v-if="hero.memberDisplay !== 'hidden'" class="landing-social-proof"><div class="landing-avatar-stack"><CommunityAvatar v-for="creator in homepage.community?.creators.slice(0, 4)" :key="creator.id" :name="creator.displayName" :username="creator.username" size="xs" /></div><span v-if="hero.memberDisplay === 'count' && homepage.community"><strong>{{ homepage.community.members.toLocaleString('zh-CN') }}</strong> 位学习者在这里学习与创造</span><span v-else>和更多创作者一起，让想法发生</span></div>
      </div>
      <div class="landing-hero-mosaic" aria-label="社区内容预览">
        <img class="landing-hero-arms" :src="landingAsset(hero.image, 'heroArms')" alt="" width="960" height="640" fetchpriority="high" />
        <button type="button" class="landing-content-card landing-mosaic-note landing-card-note" @click="navigate('/community')">
          <div class="landing-card-copy">
            <div class="landing-author"><CommunityAvatar name="平台内容" size="sm" /><span>平台内容<small>学习与分享</small></span></div>
            <h3>今天学到的 AI，动手试一试</h3><p>从一个问题、一段笔记或一次小实验开始，记录思路，也分享你的发现。</p>
            <div class="landing-card-meta"><span class="landing-card-link">浏览社区 <AppIcon name="arrow-right" :size="14" /></span></div>
          </div>
        </button>
        <button type="button" class="landing-content-card landing-mosaic-visual landing-card-visual" @click="navigate('/labs/model-service')">
          <img class="landing-cover" :src="landingAssets.robotVision" alt="机械臂模型部署实训" width="960" height="540" decoding="async" />
          <div class="landing-card-copy"><span class="landing-tag">实训项目</span><h3>部署你的第一个 AI 模型</h3></div>
        </button>
        <button type="button" class="landing-content-card landing-mosaic-code landing-card-code" @click="navigate('/labs/agent-workbench')">
          <img class="landing-cover" :src="landingAssets.aiWorkspace" alt="AI Agent 工作流" width="960" height="540" decoding="async" />
          <div class="landing-card-copy"><h3>AI Agent 智能助手开发实训</h3></div>
        </button>
        <button type="button" class="landing-content-card landing-mosaic-resource landing-card-resource" @click="navigate('/resources?preview=llm-handbook')">
          <div class="landing-card-copy"><span class="landing-tag">学习资源</span><h3>大模型入门学习手册</h3><p>梳理核心术语、学习路径和练习建议。</p></div>
        </button>
        <button type="button" class="landing-content-card landing-mosaic-topic landing-card-note" @click="navigate('/community')">
          <div class="landing-card-copy">
            <div class="landing-author"><CommunityAvatar name="平台内容" size="sm" /><span>平台内容<small>交流与共创</small></span></div>
            <h3>把想法带进社区，一起做出来</h3><p>分享作品、交流方法、提出问题。让每一次尝试，都成为下一次进步的起点。</p>
            <div class="landing-card-meta"><span class="landing-card-link">参与交流 <AppIcon name="arrow-right" :size="14" /></span></div>
          </div>
        </button>
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
        <div v-for="creator in creators" :key="creator.slug" class="landing-creator-row"><button class="landing-creator-profile" type="button" @click="openItem(creator)"><CommunityAvatar :name="creator.title" :username="creator.slug" :src="author(creator).avatarUrl" size="md" /><span><strong>{{ creator.title }} <CommunityUserBadges :badges="author(creator).badges" :verified-type="author(creator).verifiedType" /></strong><p>{{ creator.summary || '分享学习与实践经验' }}</p></span></button><FollowButton v-if="auth.user?.id !== author(creator).id" :active="community.authorFollowing[author(creator).id]" :pending="followingLoading || community.operations[`follow:user:${author(creator).id}`]" :label="`关注${creator.title}`" @click="follow(creator)" /></div><p v-if="!creators.length" class="landing-empty">暂无公开创作者</p>
      </article>
    </section>
    <section v-if="moduleFor('landing_bottom_cta')" class="landing-bottom-cta landing-container" aria-labelledby="landing-cta-title"><div><h2 id="landing-cta-title">{{ cta.title }}</h2><p>{{ cta.description }}</p><button class="button primary landing-login" type="button" @click="navigate()">{{ auth.user ? '进入社区' : cta.buttonLabel }}<AppIcon name="arrow-right" :size="20" /></button></div><img :src="landingAsset(cta.image, 'ctaRobot')" alt="" width="1200" height="600" loading="lazy" /></section>
    <footer class="landing-footer landing-container"><strong>{{ hero.brandName }}</strong><span>© {{ new Date().getFullYear() }} {{ BRAND_NAME }} · <span class="app-version" aria-label="应用版本">{{ appVersion }}</span></span><RouterLink to="/terms">用户协议</RouterLink><RouterLink to="/privacy">隐私政策</RouterLink></footer>
  </div>
  <section v-else class="landing-container landing-empty"><h1>社区落地页正在准备中</h1><p>请稍后再来，或登录后继续学习。</p><button class="button primary" @click="navigate()">登录 / 注册</button></section>
</template>
