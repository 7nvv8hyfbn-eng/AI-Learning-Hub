<script setup lang="ts">
import CommunityUserBadges from './CommunityUserBadges.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CommunityProfileDto, CommunityProfileInput, CommunityProfileRelationDto, CommunityProfileTab, CommunityReplySummaryDto, LearningCollectionSummaryDto, ResourceHubItemDto } from '@ai-learning-hub/contracts'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import FollowButton from '../components/base/FollowButton.vue'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../services/api/community'
import CommunityEmptyState from './CommunityEmptyState.vue'
import CommunityPostCard from './CommunityPostCard.vue'
import CommunityPostMenu from './CommunityPostMenu.vue'
import CommunityReportDialog from './CommunityReportDialog.vue'
import CommunitySkeleton from './CommunitySkeleton.vue'
import { contentDetectionNotice } from './labels'
import { resourceHubApi } from '../services/api/resourceHub'
import ResourceHubCard from '../components/ResourceHubCard.vue'
import { useCommunityAccess } from './composables/useCommunityAccess'

const route = useRoute(), router = useRouter(), auth = useAuthStore(), store = useCommunityStore()
const { requireWrite } = useCommunityAccess()
const profile = ref<CommunityProfileDto | null>(null)
const posts = ref<NonNullable<CommunityProfileDto['pinnedPost']>[]>([])
const replies = ref<CommunityReplySummaryDto[]>([])
const cursor = ref<string | null>(null)
type ProfileTab = CommunityProfileTab | 'resources' | 'collections'
const tab = ref<ProfileTab>('posts')
const resourceItems = ref<ResourceHubItemDto[]>([])
const resourceCollections = ref<LearningCollectionSummaryDto[]>([])
const resourceKind = ref<'all' | ResourceHubItemDto['kind']>('all')
const legacyPanel = ref<'topics' | 'following' | null>(null)
const loading = ref(false), moreLoading = ref(false), error = ref(''), notice = ref(''), editOpen = ref(false), saving = ref(false)
const relationOpen = ref<'followers' | 'following' | null>(null), relationPeople = ref<CommunityProfileRelationDto[]>([]), relationCursor = ref<string | null>(null)
const avatarCanvas = ref<HTMLCanvasElement>(), bannerCanvas = ref<HTMLCanvasElement>()
const avatarFile = ref<File | null>(null), bannerFile = ref<File | null>(null), username = ref('')
const form = ref<CommunityProfileInput>({ expectedUserRevision: 1, expectedProfileRevision: 1, displayName: '', bio: '', headline: '', location: '', websiteUrl: '', expertiseTopics: [], allowAchievementDrafts: false })
const topicsText = ref(''), reportOpen = ref(false)
let loadEpoch = 0

const requestedTab = () => {
  const value = String(route.query.tab || 'posts')
  legacyPanel.value = value === 'topics' || value === 'following' ? value : null
  return value === 'answers' ? 'replies' : ['posts', 'replies', 'media', 'liked', 'resources', 'collections'].includes(value) ? value as ProfileTab : 'posts'
}
const syncResult = (result: Awaited<ReturnType<typeof communityApi.updateProfile>>) => {
  auth.user = result.user
  profile.value = result.profile
  store.syncAuthors([result.profile])
  sessionStorage.setItem('student-user', JSON.stringify(result.user))
  if (editOpen.value) {
    form.value.expectedUserRevision = result.profile.userRevision
    form.value.expectedProfileRevision = result.profile.revision
  }
}
const loadTimeline = async (append = false) => {
  if (!profile.value || legacyPanel.value) return
  if (tab.value === 'resources' || tab.value === 'collections') {
    const epoch = loadEpoch, currentTab = tab.value, currentKind = resourceKind.value
    const result = await resourceHubApi.creator(profile.value.id, { kind: resourceKind.value, ...(append && cursor.value ? currentTab === 'collections' ? { collectionsCursor: cursor.value } : { cursor: cursor.value } : {}) })
    if (epoch !== loadEpoch || currentTab !== tab.value || currentKind !== resourceKind.value) return
    resourceItems.value = append && currentTab === 'resources' ? [...new Map([...resourceItems.value, ...result.items].map((item) => [item.id, item])).values()] : result.items
    resourceCollections.value = append && currentTab === 'collections' ? [...new Map([...resourceCollections.value, ...result.collections].map((item) => [item.id, item])).values()] : result.collections
    posts.value = []; replies.value = []; cursor.value = currentTab === 'collections' ? result.collectionsNextCursor : result.nextCursor
    return
  }
  const result = await communityApi.timeline(profile.value.id, tab.value, append ? cursor.value || undefined : undefined)
  posts.value = append ? [...posts.value, ...result.posts] : result.posts
  replies.value = append ? [...replies.value, ...result.replies] : result.replies
  cursor.value = result.nextCursor
}
const load = async () => {
  const epoch = ++loadEpoch
  loading.value = true; error.value = ''; profile.value = null; posts.value = []; replies.value = []; cursor.value = null; relationPeople.value = []
  try {
    const next = route.params.userId ? await communityApi.profileById(String(route.params.userId)) : await communityApi.profile(String(route.params.username))
    if (epoch !== loadEpoch) return
    profile.value = next
    store.syncAuthors([next])
    tab.value = requestedTab()
    if (tab.value === 'liked' && !next.isSelf) tab.value = 'posts'
    if (legacyPanel.value === 'following') relationPeople.value = (await communityApi.relations(next.id, 'following')).items
    else await loadTimeline()
    if (epoch === loadEpoch) void communityApi.signals({ eventType: 'community_profile_visit', targetType: 'user', targetId: next.id }).catch(() => undefined)
    if (route.query.settings === '1' && next.isSelf) openEditor()
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '个人主页读取失败' }
  finally { if (epoch === loadEpoch) loading.value = false }
}
const selectTab = (value: ProfileTab) => {
  void router.replace({ query: value === 'posts' ? {} : { tab: value } })
}
const loadMore = async () => {
  if (!cursor.value || moreLoading.value) return
  moreLoading.value = true
  try { await loadTimeline(true) } catch (cause) { error.value = cause instanceof Error ? cause.message : '加载失败' }
  finally { moreLoading.value = false }
}
const follow = async () => {
  if (!profile.value) return
  try { await store.follow(profile.value.id, false, !profile.value.following, profile.value); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '关注失败' }
}
const relationship = async (kind: 'mute' | 'block') => {
  if (!profile.value || !requireWrite('read')) return
  const active = kind === 'mute' ? profile.value.muted : profile.value.blocked
  try { await communityApi.feedback(profile.value.id, kind, !active); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
}
const share = async () => {
  if (!profile.value) return
  const data = { title: `${profile.value.displayName}的社区主页`, url: window.location.href }
  try {
    if (navigator.share) await navigator.share(data)
    else { await navigator.clipboard.writeText(data.url); notice.value = '主页链接已复制' }
  } catch (cause) {
    if (!(cause instanceof DOMException && cause.name === 'AbortError')) error.value = '分享主页失败'
  }
}
const openRelations = async (kind: 'followers' | 'following') => {
  if (!profile.value) return
  relationOpen.value = kind; relationPeople.value = []; relationCursor.value = null; error.value = ''
  try {
    const result = await communityApi.relations(profile.value.id, kind)
    relationPeople.value = result.items; relationCursor.value = result.nextCursor
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '关注列表读取失败' }
}
const moreRelations = async () => {
  if (!profile.value || !relationOpen.value || !relationCursor.value) return
  const result = await communityApi.relations(profile.value.id, relationOpen.value, relationCursor.value)
  relationPeople.value.push(...result.items); relationCursor.value = result.nextCursor
}
const openEditor = () => {
  if (!profile.value?.isSelf || !requireWrite('profile')) return
  const text = { ...profile.value, ...profile.value.pendingChanges }
  form.value = {
    expectedUserRevision: profile.value.userRevision,
    expectedProfileRevision: profile.value.revision,
    displayName: text.displayName,
    bio: text.bio,
    headline: text.headline,
    location: text.location || '',
    websiteUrl: text.websiteUrl || '',
    expertiseTopics: [...text.expertiseTopics],
    allowAchievementDrafts: !!profile.value.allowAchievementDrafts,
  }
  topicsText.value = text.expertiseTopics.join('、')
  username.value = text.username
  avatarFile.value = null; bannerFile.value = null; editOpen.value = true
}
const crop = (file: File, canvas: HTMLCanvasElement | undefined, kind: 'avatar' | 'banner') => new Promise<File>((resolve, reject) => {
  const limit = kind === 'avatar' ? 5 : 8
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > limit * 1024 * 1024) return reject(new Error(`请选择不超过 ${limit}MB 的 PNG、JPEG 或 WebP 图片`))
  const image = new Image(), url = URL.createObjectURL(file)
  image.onload = () => {
    if (!canvas) { URL.revokeObjectURL(url); reject(new Error('图片预览尚未就绪')); return }
    const width = kind === 'avatar' ? 512 : 1500, height = kind === 'avatar' ? 512 : 500
    const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight)
    const sourceWidth = width / ratio, sourceHeight = height / ratio
    canvas.width = width; canvas.height = height
    canvas.getContext('2d')?.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height)
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url)
      if (blob) resolve(new File([blob], `community-${kind}.webp`, { type: 'image/webp' }))
      else reject(new Error('图片裁切失败'))
    }, 'image/webp', .88)
  }
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取')) }
  image.src = url
})
const chooseImage = async (event: Event, kind: 'avatar' | 'banner') => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const result = await crop(file, kind === 'avatar' ? avatarCanvas.value : bannerCanvas.value, kind)
    if (kind === 'avatar') avatarFile.value = result
    else bannerFile.value = result
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '图片处理失败' }
}
const save = async () => {
  if (!profile.value || saving.value || !requireWrite('profile')) return
  if ((avatarFile.value || bannerFile.value) && !requireWrite('upload')) return
  saving.value = true; error.value = ''
  try {
    form.value.expertiseTopics = [...new Set(topicsText.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))]
    let result = await communityApi.updateProfile(form.value)
    syncResult(result)
    if (avatarFile.value) { result = await communityApi.profileImage(avatarFile.value, 'avatar', result.profile.userRevision, result.profile.revision); syncResult(result) }
    if (bannerFile.value) { result = await communityApi.profileImage(bannerFile.value, 'banner', result.profile.userRevision, result.profile.revision); syncResult(result) }
    editOpen.value = false
    await loadTimeline()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '资料保存失败' }
  finally { saving.value = false }
}
const removeImage = async (kind: 'avatar' | 'banner') => {
  if (!profile.value || saving.value || !requireWrite('read')) return
  saving.value = true
  try {
    const result = await communityApi.removeProfileImage(kind, profile.value.userRevision, profile.value.revision)
    syncResult(result)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '图片移除失败' }
  finally { saving.value = false }
}
const changeUsername = async () => {
  if (!requireWrite('profile')) return
  try {
    auth.user = await communityApi.username(username.value)
    sessionStorage.setItem('student-user', JSON.stringify(auth.user))
    await router.replace(`/community/user/${auth.user.username}?settings=1`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '用户名修改失败' }
}
const pin = async (id: string | null) => {
  if (!profile.value || !requireWrite(id ? 'profile' : 'read')) return
  try { profile.value = await communityApi.pin(id, profile.value.revision); await loadTimeline() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '置顶设置失败' }
}
const joined = computed(() => profile.value ? new Date(profile.value.joinedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : '')
const filteredResourceItems = computed(() => resourceKind.value === 'all' ? resourceItems.value : resourceItems.value.filter((item) => item.kind === resourceKind.value))
watch(resourceKind, () => { if (tab.value === 'resources') { cursor.value = null; void loadTimeline().catch((cause) => { error.value = cause instanceof Error ? cause.message : '资源读取失败' }) } })
watch(() => route.fullPath, load, { immediate: true })
onBeforeUnmount(() => { loadEpoch++ })
</script>

<template>
  <RouterLink v-if="profile?.isSelf" class="button secondary small" to="/account/security">账号安全</RouterLink>
  <section class="community-profile-page">
    <RouterLink class="community-profile-back" to="/community">返回社区发现</RouterLink>
    <CommunitySkeleton v-if="loading && !profile" />
    <p v-if="error" class="community-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="community-notice" role="status">{{ notice }}</p>
    <template v-if="profile">
      <p v-if="profile.isSelf && contentDetectionNotice(profile.detection)" class="community-notice" role="status">{{ contentDetectionNotice(profile.detection) }}<template v-if="profile.pendingChanges"> 当前对外仍展示原公开资料；打开编辑可继续修改待审内容。</template></p>
      <article class="community-profile-header">
        <div class="community-profile-banner" :class="{ empty: !profile.bannerUrl }" :style="profile.bannerUrl ? { backgroundImage: `url(${profile.bannerUrl})` } : undefined" />
        <div class="community-profile-identity">
          <CommunityAvatar class="community-profile-avatar" :src="profile.avatar" :username="profile.username" :name="profile.displayName" size="lg" />
          <div class="community-profile-actions">
            <template v-if="profile.isSelf"><RouterLink class="button secondary small" to="/community/governance">处理与申诉</RouterLink><RouterLink class="button secondary small" to="/community/drafts">草稿箱</RouterLink><button class="button secondary small" type="button" @click="openEditor">编辑资料</button></template>
            <template v-else>
              <FollowButton v-if="!profile.blocked" :active="profile.following" :pending="store.operations[`follow:user:${profile.id}`]" @click="follow" />
              <CommunityPostMenu label="个人主页操作"><button type="button" role="menuitem" @click="requireWrite('report') && (reportOpen = true)">举报账号资料</button><button type="button" role="menuitem" @click="relationship('mute')">{{ profile.muted ? '取消静音' : '静音该用户' }}</button><button type="button" role="menuitem" @click="relationship('block')">{{ profile.blocked ? '取消拉黑' : '拉黑该用户' }}</button></CommunityPostMenu>
            </template>
            <button class="button secondary small" type="button" @click="share">分享主页</button>
          </div>
          <div class="community-profile-copy">
            <div class="community-profile-name"><h1>{{ profile.displayName }}</h1><CommunityUserBadges :badges="profile.badges" :verified-type="profile.verifiedType" /></div>
            <p class="community-profile-username">@{{ profile.username }}</p>
            <strong v-if="profile.headline">{{ profile.headline }}</strong>
            <p>{{ profile.bio || '还没有填写个人介绍。' }}</p>
            <div class="community-profile-meta">
              <span v-if="profile.school || profile.major"><AppIcon name="course" :size="15" />{{ [profile.school, profile.major].filter(Boolean).join(' · ') }}</span>
              <span v-if="profile.location"><AppIcon name="target" :size="15" />{{ profile.location }}</span>
              <a v-if="profile.websiteUrl" :href="profile.websiteUrl" target="_blank" rel="noopener noreferrer"><AppIcon name="arrow-up-right" :size="15" />个人网站</a>
              <span><AppIcon name="clock" :size="15" />{{ joined }} 加入</span>
            </div>
            <div v-if="profile.expertiseTopics.length" class="community-profile-expertise"><span v-for="topic in profile.expertiseTopics" :key="topic"># {{ topic }}</span></div>
            <div class="community-profile-stats">
              <span><strong>{{ profile.postCount }}</strong> 动态</span>
              <span><strong>{{ profile.replyCount }}</strong> 回复</span>
              <span><strong>{{ profile.likesReceived }}</strong> 获赞</span>
              <button type="button" @click="openRelations('followers')"><strong>{{ profile.followerCount }}</strong> 关注者</button>
              <button type="button" @click="openRelations('following')"><strong>{{ profile.followingCount }}</strong> 正在关注</button>
            </div>
          </div>
        </div>
      </article>

      <nav class="community-feed-tabs community-profile-tabs" aria-label="个人主页内容">
        <button v-for="item in ([['posts', '动态'], ['resources', '作品'], ['collections', '合集'], ['replies', '回复'], ['media', '媒体'], ...(profile.isSelf ? [['liked', '赞过']] : [])] as Array<[ProfileTab, string]>)" :key="item[0]" :aria-selected="!legacyPanel && tab === item[0]" @click="selectTab(item[0])">{{ item[1] }}</button>
      </nav>

      <section v-if="legacyPanel === 'topics'" class="community-collection">
        <RouterLink v-for="topic in profile.topics" :key="topic.id" class="community-binding" :to="`/community/topic/${topic.slug}`"># {{ topic.name }} · {{ topic.postCount }} 条讨论</RouterLink>
        <CommunityEmptyState v-if="!profile.topics.length" title="还没有关注学习话题" description="从社区发现感兴趣的学习方向。"><RouterLink class="button secondary" to="/community">探索社区</RouterLink></CommunityEmptyState>
      </section>
      <section v-else-if="legacyPanel === 'following'" class="community-collection">
        <RouterLink v-for="person in relationPeople" :key="person.id" class="community-binding" :to="`/community/user/${person.username}`"><CommunityAvatar :src="person.avatar" :username="person.username" :name="person.displayName" size="sm" />{{ person.displayName }}</RouterLink>
        <CommunityEmptyState v-if="!relationPeople.length" title="还没有关注其他学习者" description="从社区发现值得关注的学习伙伴。"><RouterLink class="button secondary" to="/community">探索社区</RouterLink></CommunityEmptyState>
      </section>
      <template v-else>
        <section v-if="tab === 'resources'">
          <nav class="resource-kind-tabs community-profile-resource-kinds" aria-label="资源作品类型">
            <button v-for="item in ([['all', '全部'], ['video', '视频'], ['article', '图文'], ['document', '资料']] as const)" :key="item[0]" type="button" :class="{ active: resourceKind === item[0] }" @click="resourceKind = item[0]">{{ item[1] }}</button>
          </nav>
          <div class="resource-hub-grid three community-profile-resources"><ResourceHubCard v-for="item in filteredResourceItems" :key="item.id" :item="item" /><CommunityEmptyState v-if="!filteredResourceItems.length" :title="resourceItems.length ? '没有该类型的资源作品' : '还没有资源作品'" description="视频、图文和资料投稿会集中显示在这里。" /></div>
        </section>
        <div v-else-if="tab === 'collections'" class="resource-studio-collections community-profile-resources"><RouterLink v-for="item in resourceCollections" :key="item.id" :to="`/resources/collections/${item.systemKind === 'watch_later' ? 'watch-later' : item.id}`"><AppIcon name="folder" /><span><strong>{{ item.name }}</strong><small>{{ item.itemCount }} 项 · {{ item.visibility === 'private' ? '私有' : '社区可见' }}</small></span></RouterLink><CommunityEmptyState v-if="!resourceCollections.length" title="还没有公开学习合集" description="将作品整理成有顺序的学习清单。" /></div>
        <template v-else>
        <section v-if="profile.pinnedPost && tab === 'posts'" class="community-profile-pinned"><h2><AppIcon name="bookmark" :size="17" />置顶动态</h2><CommunityPostCard :post="profile.pinnedPost" :show-pin="profile.isSelf" pinned @pin="pin" @changed="load" @hidden="load" /></section>
        <div v-if="tab === 'replies'" class="community-profile-replies">
          <article v-for="reply in replies" :key="reply.id"><RouterLink :to="`/community/post/${reply.postId}#comment-${reply.id}`"><small>回复了 {{ reply.postTitle || '一条社区动态' }}</small><p>{{ reply.bodyPreview }}</p><span>{{ new Date(reply.createdAt).toLocaleString('zh-CN') }} · {{ reply.likes }} 赞<span v-if="reply.accepted"> · 已采纳</span></span></RouterLink></article>
        </div>
        <CommunityPostCard v-for="post in posts" v-else :key="post.id" :post="post" :show-pin="profile.isSelf && post.author.id === profile.id" @pin="pin" @changed="load" @hidden="load" />
        <CommunityEmptyState v-if="!loading && !posts.length && !replies.length" :title="tab === 'liked' ? '还没有赞过的动态' : tab === 'media' ? '还没有发布媒体动态' : tab === 'replies' ? '还没有参与回复' : '还没有公开动态'" description="这里仅展示当前有权查看的公开社区内容。"><RouterLink class="button secondary" to="/community">探索社区</RouterLink></CommunityEmptyState>
        <div v-if="cursor" class="community-load-more"><button class="button secondary small" :disabled="moreLoading" @click="loadMore">{{ moreLoading ? '加载中…' : '加载更多' }}</button></div>
        </template>
      </template>
    </template>

    <AppDialog :model-value="!!relationOpen" :title="relationOpen === 'followers' ? '关注者' : '正在关注'" @update:model-value="(open) => { if (!open) relationOpen = null }">
      <div class="community-profile-relations"><div v-for="person in relationPeople" :key="person.id"><RouterLink :to="`/community/user/${person.username}`" @click="relationOpen = null"><CommunityAvatar :src="person.avatar" :username="person.username" :name="person.displayName" size="sm" /><span><strong>{{ person.displayName }}</strong><CommunityUserBadges :badges="person.badges" :verified-type="person.verifiedType" /><small>@{{ person.username }}</small></span></RouterLink><FollowButton v-if="person.id !== auth.user?.id" :active="person.following" :pending="store.operations[`follow:user:${person.id}`]" @click="store.follow(person.id, false, !person.following, person)" /></div><p v-if="!relationPeople.length">暂无可见用户。</p><button v-if="relationCursor" class="button secondary small" @click="moreRelations">加载更多</button></div>
    </AppDialog>

    <AppDialog v-model="editOpen" title="编辑社区资料" class="community-profile-edit-dialog">
      <form class="dialog-form community-profile-editor" @submit.prevent="save">
        <div class="community-profile-image-fields">
          <label>主页封面<input type="file" accept="image/png,image/jpeg,image/webp" @change="chooseImage($event, 'banner')" /><canvas v-show="bannerFile" ref="bannerCanvas" class="profile-banner-preview" /><button v-if="profile?.bannerUrl" class="text-link" type="button" @click="removeImage('banner')">移除封面</button></label>
          <label>头像<input type="file" accept="image/png,image/jpeg,image/webp" @change="chooseImage($event, 'avatar')" /><canvas v-show="avatarFile" ref="avatarCanvas" class="profile-avatar-preview" /><button v-if="profile?.avatar" class="text-link" type="button" @click="removeImage('avatar')">移除头像</button></label>
        </div>
        <label>显示名<input v-model="form.displayName" required maxlength="40" /></label>
        <label>一句话介绍<input v-model="form.headline" maxlength="120" /></label>
        <label>个人简介<textarea v-model="form.bio" rows="4" maxlength="500" /></label>
        <label>所在地<input v-model="form.location" maxlength="60" /></label>
        <label>个人网站<input v-model="form.websiteUrl" type="url" maxlength="300" placeholder="https://" /></label>
        <label>擅长话题<input v-model="topicsText" maxlength="400" placeholder="用逗号分隔，最多 10 个" /></label>
        <label class="community-checkbox"><input v-model="form.allowAchievementDrafts" type="checkbox" />允许生成学习成就草稿（不会自动发布）</label>
        <button class="button primary" :disabled="saving">{{ saving ? '保存中…' : '保存资料' }}</button>
      </form>
      <form class="dialog-form community-profile-username-form" @submit.prevent="changeUsername"><label>公开用户名（只能修改一次）<input v-model="username" required pattern="(?!_)(?!.*__)[A-Za-z0-9_]{4,24}(?<!_)" minlength="4" maxlength="24" /></label><button class="button secondary" type="submit">单独修改用户名</button></form>
    </AppDialog>
  </section>
<CommunityReportDialog v-if="profile" v-model="reportOpen" target-type="profile" :target-id="profile.id" @submitted="notice = '举报已提交。'" />
</template>
