<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CommunityProfileDto, CommunityProfileInput, CommunityProfileRelationDto, CommunityProfileTab, CommunityReplySummaryDto } from '@ai-learning-hub/contracts'
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
import CommunitySkeleton from './CommunitySkeleton.vue'
import { badgeLabels } from './labels'

const route = useRoute(), router = useRouter(), auth = useAuthStore(), store = useCommunityStore()
const profile = ref<CommunityProfileDto | null>(null)
const posts = ref<NonNullable<CommunityProfileDto['pinnedPost']>[]>([])
const replies = ref<CommunityReplySummaryDto[]>([])
const cursor = ref<string | null>(null)
const tab = ref<CommunityProfileTab>('posts')
const legacyPanel = ref<'topics' | 'following' | null>(null)
const legacyPeople = ref<CommunityProfileRelationDto[]>([])
const loading = ref(false), moreLoading = ref(false), error = ref(''), notice = ref(''), editOpen = ref(false), saving = ref(false)
const relationOpen = ref<'followers' | 'following' | null>(null), relationPeople = ref<CommunityProfileRelationDto[]>([]), relationCursor = ref<string | null>(null)
const avatarCanvas = ref<HTMLCanvasElement>(), bannerCanvas = ref<HTMLCanvasElement>()
const avatarFile = ref<File | null>(null), bannerFile = ref<File | null>(null), username = ref('')
const form = ref<CommunityProfileInput>({ expectedUserRevision: 1, expectedProfileRevision: 1, displayName: '', bio: '', headline: '', location: '', websiteUrl: '', expertiseTopics: [], allowAchievementDrafts: false })
const topicsText = ref('')
let loadEpoch = 0

const requestedTab = () => {
  const value = String(route.query.tab || 'posts')
  legacyPanel.value = value === 'topics' || value === 'following' ? value : null
  return value === 'answers' ? 'replies' : ['posts', 'replies', 'media', 'liked'].includes(value) ? value as CommunityProfileTab : 'posts'
}
const syncResult = (result: Awaited<ReturnType<typeof communityApi.updateProfile>>) => {
  auth.user = result.user
  profile.value = result.profile
  sessionStorage.setItem('student-user', JSON.stringify(result.user))
  for (const post of store.postCopies()) if (post.author.id === result.user.id) Object.assign(post.author, { displayName: result.user.displayName, username: result.user.username, avatar: result.user.avatarUrl })
  if (editOpen.value) {
    form.value.expectedUserRevision = result.profile.userRevision
    form.value.expectedProfileRevision = result.profile.revision
  }
}
const loadTimeline = async (append = false) => {
  if (!profile.value || legacyPanel.value) return
  const result = await communityApi.timeline(profile.value.id, tab.value, append ? cursor.value || undefined : undefined)
  posts.value = append ? [...posts.value, ...result.posts] : result.posts
  replies.value = append ? [...replies.value, ...result.replies] : result.replies
  cursor.value = result.nextCursor
}
const load = async () => {
  const epoch = ++loadEpoch
  loading.value = true; error.value = ''; profile.value = null; posts.value = []; replies.value = []; cursor.value = null; legacyPeople.value = []
  try {
    const next = await communityApi.profile(String(route.params.username))
    if (epoch !== loadEpoch) return
    profile.value = next
    tab.value = requestedTab()
    if (tab.value === 'liked' && !next.isSelf) tab.value = 'posts'
    if (legacyPanel.value === 'following') legacyPeople.value = (await communityApi.relations(next.id, 'following')).items
    else await loadTimeline()
    if (epoch === loadEpoch) void communityApi.signals({ eventType: 'community_profile_visit', targetType: 'user', targetId: next.id }).catch(() => undefined)
    if (route.query.settings === '1' && next.isSelf) openEditor()
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '个人主页读取失败' }
  finally { if (epoch === loadEpoch) loading.value = false }
}
const selectTab = (value: CommunityProfileTab) => {
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
  if (!profile.value) return
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
const followPerson = async (person: CommunityProfileRelationDto) => {
  await store.follow(person.id, false, !person.following, person)
}
const openEditor = () => {
  if (!profile.value?.isSelf) return
  form.value = {
    expectedUserRevision: profile.value.userRevision,
    expectedProfileRevision: profile.value.revision,
    displayName: profile.value.displayName,
    bio: profile.value.bio,
    headline: profile.value.headline,
    location: profile.value.location || '',
    websiteUrl: profile.value.websiteUrl || '',
    expertiseTopics: [...profile.value.expertiseTopics],
    allowAchievementDrafts: !!profile.value.allowAchievementDrafts,
  }
  topicsText.value = profile.value.expertiseTopics.join('、')
  username.value = profile.value.username
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
  if (!profile.value || saving.value) return
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
  if (!profile.value || saving.value) return
  saving.value = true
  try {
    const result = await communityApi.removeProfileImage(kind, profile.value.userRevision, profile.value.revision)
    syncResult(result)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '图片移除失败' }
  finally { saving.value = false }
}
const changeUsername = async () => {
  try {
    auth.user = await communityApi.username(username.value)
    sessionStorage.setItem('student-user', JSON.stringify(auth.user))
    await router.replace(`/community/user/${auth.user.username}?settings=1`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '用户名修改失败' }
}
const pin = async (id: string | null) => {
  if (!profile.value) return
  try { profile.value = await communityApi.pin(id, profile.value.revision); await loadTimeline() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '置顶设置失败' }
}
const joined = computed(() => profile.value ? new Date(profile.value.joinedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' }) : '')
watch(() => route.fullPath, load, { immediate: true })
onBeforeUnmount(() => { loadEpoch++ })
</script>

<template>
  <section class="community-profile-page">
    <RouterLink class="community-profile-back" to="/community">返回社区发现</RouterLink>
    <CommunitySkeleton v-if="loading && !profile" />
    <p v-if="error" class="community-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="community-notice" role="status">{{ notice }}</p>
    <template v-if="profile">
      <article class="community-profile-header">
        <div class="community-profile-banner" :class="{ empty: !profile.bannerUrl }" :style="profile.bannerUrl ? { backgroundImage: `url(${profile.bannerUrl})` } : undefined" />
        <div class="community-profile-identity">
          <CommunityAvatar class="community-profile-avatar" :src="profile.avatar" :username="profile.username" :name="profile.displayName" size="lg" :verified="profile.verifiedType !== 'none'" />
          <div class="community-profile-actions">
            <template v-if="profile.isSelf"><RouterLink class="button secondary small" to="/community/drafts">草稿箱</RouterLink><button class="button secondary small" type="button" @click="openEditor">编辑资料</button></template>
            <template v-else>
              <FollowButton v-if="!profile.blocked" :active="profile.following" :pending="store.operations[`follow:user:${profile.id}`]" @click="follow" />
              <CommunityPostMenu label="个人主页操作"><button type="button" role="menuitem" @click="relationship('mute')">{{ profile.muted ? '取消静音' : '静音该用户' }}</button><button type="button" role="menuitem" @click="relationship('block')">{{ profile.blocked ? '取消拉黑' : '拉黑该用户' }}</button></CommunityPostMenu>
            </template>
            <button class="button secondary small" type="button" @click="share">分享主页</button>
          </div>
          <div class="community-profile-copy">
            <div class="community-profile-name"><h1>{{ profile.displayName }}</h1><span v-if="profile.verifiedType !== 'none'" class="community-badge">{{ badgeLabels[profile.verifiedType] }}</span></div>
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
        <button v-for="item in ([['posts', '动态'], ['replies', '回复'], ['media', '媒体'], ...(profile.isSelf ? [['liked', '赞过']] : [])] as Array<[CommunityProfileTab, string]>)" :key="item[0]" :aria-selected="!legacyPanel && tab === item[0]" @click="selectTab(item[0])">{{ item[1] }}</button>
      </nav>

      <section v-if="legacyPanel === 'topics'" class="community-collection">
        <RouterLink v-for="topic in profile.topics" :key="topic.id" class="community-binding" :to="`/community/topic/${topic.slug}`"># {{ topic.name }} · {{ topic.postCount }} 条讨论</RouterLink>
        <CommunityEmptyState v-if="!profile.topics.length" title="还没有关注学习话题" description="从社区发现感兴趣的学习方向。"><RouterLink class="button secondary" to="/community">探索社区</RouterLink></CommunityEmptyState>
      </section>
      <section v-else-if="legacyPanel === 'following'" class="community-collection">
        <RouterLink v-for="person in legacyPeople" :key="person.id" class="community-binding" :to="`/community/user/${person.username}`"><CommunityAvatar :src="person.avatar" :username="person.username" :name="person.displayName" size="sm" />{{ person.displayName }}</RouterLink>
        <CommunityEmptyState v-if="!legacyPeople.length" title="还没有关注其他学习者" description="从社区发现值得关注的学习伙伴。"><RouterLink class="button secondary" to="/community">探索社区</RouterLink></CommunityEmptyState>
      </section>
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

    <AppDialog :model-value="!!relationOpen" :title="relationOpen === 'followers' ? '关注者' : '正在关注'" @update:model-value="(open) => { if (!open) relationOpen = null }">
      <div class="community-profile-relations"><div v-for="person in relationPeople" :key="person.id"><RouterLink :to="`/community/user/${person.username}`" @click="relationOpen = null"><CommunityAvatar :src="person.avatar" :username="person.username" :name="person.displayName" size="sm" /><span><strong>{{ person.displayName }}</strong><small>@{{ person.username }}</small></span></RouterLink><FollowButton v-if="person.id !== auth.user?.id" :active="person.following" :pending="store.operations[`follow:user:${person.id}`]" @click="followPerson(person)" /></div><p v-if="!relationPeople.length">暂无可见用户。</p><button v-if="relationCursor" class="button secondary small" @click="moreRelations">加载更多</button></div>
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
      <form class="dialog-form community-profile-username-form" @submit.prevent="changeUsername"><label>公开用户名（只能修改一次）<input v-model="username" required pattern="[a-z][a-z0-9_]{3,29}" maxlength="30" /></label><button class="button secondary" type="submit">单独修改用户名</button></form>
    </AppDialog>
  </section>
</template>
