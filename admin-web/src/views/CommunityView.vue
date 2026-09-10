<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { CommunityAdminInspectionDto, CommunityAdminSummaryDto, CommunityAuthorDto, CommunityEligibilityPolicyDto, CommunityFeedPolicyDto, CommunityOperation, CommunityOperationRestrictionDto, CommunityPostDetailDto, CommunityTopicDto } from '@ai-learning-hub/contracts'
import { communityAdminApi, type AdminCommunityComment } from '../services/community'
import { useSessionStore } from '../stores/session'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import AdminKpiCard from '../components/AdminKpiCard.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminPagination from '../components/AdminPagination.vue'
import CommunityGovernanceWorkbench from '../components/CommunityGovernanceWorkbench.vue'
import { contentDetectionFields, type ContentDetectionField, type ContentDetectionPolicy, type ContentDetectionResult, type ContentDetectionRule, type ContentReviewDto } from '@ai-learning-hub/contracts'
const session = useSessionStore(), can = (permission: string) => !!session.user?.permissions.includes(permission)
const route = useRoute()
const tabs = [{ key: 'posts', label: '动态内容', permission: 'community.read' }, { key: 'questions', label: '学习问答', permission: 'community.read' }, { key: 'comments', label: '评论管理', permission: 'community.read' }, { key: 'topics', label: '话题管理', permission: 'community.topic.manage' }, { key: 'reports', label: '治理工作台', permission: 'community.report.manage' }, { key: 'official', label: '官方账号', permission: 'community.official.publish' }, { key: 'eligibility', label: '操作资格', permission: 'community.moderate' }, { key: 'content', label: '内容检测与复核', permission: 'community.moderate' }, { key: 'policy', label: '推荐策略', permission: 'community.feed.manage' }]
const tab = ref('posts'), keyword = ref(''), page = ref(1), loading = ref(false), error = ref(''), selected = ref<CommunityAdminInspectionDto | null>(null)
const total = ref(0)
const filters = reactive({ status: '', authorId: '', schoolId: '', topicId: '', postType: '' as '' | CommunityPostDetailDto['type'], visibility: '' as '' | 'public' | 'school', hasMedia: undefined as boolean | undefined, reported: undefined as boolean | undefined, createdFrom: '', createdTo: '', sortBy: 'createdAt' as 'createdAt' | 'publishedAt' | 'editedAt', sortOrder: 'desc' as 'asc' | 'desc' })
let loadEpoch = 0, detailEpoch = 0
const summary = ref<CommunityAdminSummaryDto | null>(null), posts = ref<CommunityPostDetailDto[]>([]), comments = ref<AdminCommunityComment[]>([]), topics = ref<CommunityTopicDto[]>([]), officials = ref<Array<CommunityAuthorDto & { expertiseTopics: string[]; revision: number }>>([]), policy = ref<CommunityFeedPolicyDto | null>(null)
const restrictions = ref<CommunityOperationRestrictionDto[]>([]), eligibilityPolicy = ref<CommunityEligibilityPolicyDto | null>(null)
type RestrictableOperation = Exclude<CommunityOperation, 'read'>
const operationLabels: Record<RestrictableOperation, string> = { post: '发帖', comment: '评论与回复', upload: '文件上传', interaction: '点赞与关注', profile: '公开资料', collection: '公开合集', report: '举报' }
const quotaLabels: Record<keyof CommunityEligibilityPolicyDto['quotas'], string> = { post: '发帖', comment: '评论与回复', upload: '文件上传', interaction: '点赞与关注', report: '举报' }
const typeLabels: Record<string, string> = { question: '学习问答', note: '学习笔记', lab_result: '实训成果', project: '创客项目', frontier_discussion: '前沿讨论', general: '官方指导 / 交流', achievement: '学习成就' }
const statusLabels: Record<string, string> = { published: '已发布', limited: '限制展示', hidden: '已隐藏', removed: '已删除', draft: '草稿', pending: '待处理', pending_review: '待复核（未公开）', reviewing: '复核中', resolved: '已处理', rejected: '已驳回', approved: '复核通过', superseded: '已有新修订', not_required: '无需复核' }
const contentPolicy = ref<ContentDetectionPolicy | null>(null), contentHistory = ref<ContentDetectionPolicy[]>([]), contentReviews = ref<ContentReviewDto[]>([])
const reviewStatus = ref('pending'), contentSaving = ref(false), contentNotice = ref(''), ruleOpen = ref(false), reviewOpen = ref(false)
const ruleForm = ref<ContentDetectionRule | null>(null), editingRuleId = ref(''), ruleReason = ref(''), rollbackVersion = ref(0), rollbackReason = ref('')
const editingRuleVersion = ref(0), deletingRule = ref(false)
const trialField = ref<ContentDetectionField>('postBody'), trialText = ref(''), trialResult = ref<ContentDetectionResult | null>(null)
const selectedReview = ref<ContentReviewDto | null>(null), reviewReason = ref('')
const canDecideReview = computed(() => !!selectedReview.value?.contentAvailable && selectedReview.value.status === 'pending' && selectedReview.value.ruleVersion === contentPolicy.value?.version && can('community.moderate') && (selectedReview.value.targetType !== 'resource' || can('resource.publish')) && !contentSaving.value && reviewReason.value.trim().length >= 4)
const fieldLabels: Record<ContentDetectionField, string> = { username: '用户名', displayName: '昵称', bio: '简介', headline: '个人签名', location: '所在地', websiteUrl: '个人网址', expertiseTopics: '专业话题', postTitle: '帖子标题', postBody: '帖子正文', postLabels: '帖子标签', commentBody: '评论正文', resourceTitle: '资源标题', resourceDescription: '资源说明与来源', resourceTags: '资源标签', collectionName: '合集名称', collectionDescription: '合集简介', collectionGoal: '合集学习目标', mediaCaption: '图片说明与代码语言' }
const actionLabels = { allow: '放行', warn: '提醒', review: '转人工复核', reject: '拒绝发布' }
const methodLabels = { literal: '包含短语', token: '英文完整词边界', exact: '全文精确匹配', detector: '内置格式检测' }
const categoryLabels = { spam: '垃圾广告', scam: '诈骗风险', harassment: '骚扰', privacy: '个人隐私', credential: '凭据泄露', school: '学校确认的限制' }
const targetLabels = { post: '帖子与资源投稿', comment: '评论', profile: '公开资料', collection: '学习合集', resource: '后台资源' }
const load = async () => {
  const epoch = ++loadEpoch
  loading.value = true; error.value = ''
  try {
    const stats = await communityAdminApi.summary()
    if (epoch !== loadEpoch) return
    summary.value = stats
    const query = { ...filters, postType: tab.value === 'questions' ? 'question' as const : filters.postType || undefined, visibility: filters.visibility || undefined, page: page.value, pageSize: 20, keyword: keyword.value }
    if (['posts', 'questions'].includes(tab.value)) { const r = await communityAdminApi.posts(query); if (epoch === loadEpoch) { posts.value = r.items; total.value = r.total } }
    if (tab.value === 'comments') { const r = await communityAdminApi.comments(query); if (epoch === loadEpoch) { comments.value = r.items; total.value = r.total } }
    if (tab.value === 'topics') { const r = await communityAdminApi.topics(query); if (epoch === loadEpoch) { topics.value = r.items; total.value = r.total } }
    if (tab.value === 'official') { const r = await communityAdminApi.officials(query); if (epoch === loadEpoch) { officials.value = r.items; total.value = r.total } }
    if (tab.value === 'eligibility') {
      const [restrictionRows, quotaPolicy, users] = await Promise.all([communityAdminApi.restrictions(), communityAdminApi.eligibilityPolicy(), communityAdminApi.officials({ page: 1, pageSize: 100 })])
      if (epoch === loadEpoch) { restrictions.value = restrictionRows; eligibilityPolicy.value = quotaPolicy; officials.value = users.items; total.value = restrictionRows.length }
    }
    if (tab.value === 'policy') { const r = await communityAdminApi.policy(); if (epoch === loadEpoch) policy.value = r }
    if (tab.value === 'content') {
      const [current, history, reviews] = await Promise.all([communityAdminApi.contentPolicy(), communityAdminApi.contentPolicyHistory(), communityAdminApi.contentReviews(page.value, reviewStatus.value)])
      if (epoch === loadEpoch) { contentPolicy.value = current; contentHistory.value = history; contentReviews.value = reviews.items; total.value = reviews.total }
    }
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '社区运营数据读取失败' } finally { if (epoch === loadEpoch) loading.value = false }
}
const editRule = (rule?: ContentDetectionRule, remove = false) => {
  deletingRule.value = remove
  editingRuleId.value = rule?.id || ''; ruleReason.value = ''; error.value = ''
  editingRuleVersion.value = contentPolicy.value?.version || 0
  ruleForm.value = rule ? { ...rule, fields: [...rule.fields] } : { id: '', content: '', method: 'literal', fields: ['postBody'], category: 'school', action: 'review', enabled: true, explanation: '' }
  ruleOpen.value = true
}
const saveContentPolicy = async (input: { rules?: ContentDetectionRule[]; rollbackVersion?: number; reason: string }) => {
  if (!contentPolicy.value || contentSaving.value) return
  contentSaving.value = true; error.value = ''; contentNotice.value = ''
  try {
    contentPolicy.value = await communityAdminApi.configureContentPolicy({ ...input, expectedVersion: contentPolicy.value.version })
    ruleOpen.value = false; trialResult.value = null; rollbackReason.value = ''; rollbackVersion.value = 0
    contentNotice.value = `已保存规则版本 ${contentPolicy.value.version}，历史版本保留。`
    contentHistory.value = await communityAdminApi.contentPolicyHistory()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '检测规则保存失败；当前输入已保留' }
  finally { contentSaving.value = false }
}
const saveRule = () => {
  if (!ruleForm.value || !contentPolicy.value) return
  if (editingRuleVersion.value !== contentPolicy.value.version) { error.value = '规则已有新版本，当前输入已保留；请核对后重新打开编辑。'; return }
  if (deletingRule.value) return saveContentPolicy({ rules: contentPolicy.value.rules.filter((rule) => rule.id !== editingRuleId.value), reason: ruleReason.value })
  const rules = [...contentPolicy.value.rules], index = rules.findIndex((rule) => rule.id === editingRuleId.value)
  if (index >= 0) rules[index] = { ...ruleForm.value, fields: [...ruleForm.value.fields] }
  else rules.push({ ...ruleForm.value, fields: [...ruleForm.value.fields] })
  return saveContentPolicy({ rules, reason: ruleReason.value })
}
const trialContent = async () => {
  if (contentSaving.value) return
  contentSaving.value = true; trialResult.value = null; error.value = ''
  try { trialResult.value = await communityAdminApi.trialContent({ [trialField.value]: trialText.value }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '文本试跑失败' }
  finally { contentSaving.value = false }
}
const openReview = async (id: string) => {
  const epoch = ++detailEpoch
  selectedReview.value = null; reviewReason.value = ''; error.value = ''; reviewOpen.value = true
  try { const row = await communityAdminApi.contentReview(id); if (epoch === detailEpoch && reviewOpen.value) selectedReview.value = row }
  catch (cause) { if (epoch === detailEpoch) error.value = cause instanceof Error ? cause.message : '复核内容读取失败' }
}
const decideReview = async (action: 'approve' | 'reject') => {
  const row = selectedReview.value
  if (!row || !canDecideReview.value) return
  contentSaving.value = true; error.value = ''; contentNotice.value = ''
  try {
    await communityAdminApi.decideContent(row.id, { expectedRevision: row.contentRevision, ruleVersion: row.ruleVersion, action, reason: reviewReason.value })
    reviewOpen.value = false; contentNotice.value = action === 'approve' ? '本修订已通过复核；不构成用户永久免检。' : '本修订已驳回，内容仍未公开。'
    await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '复核失败，请刷新确认当前版本' }
  finally { contentSaving.value = false }
}
const inspect = async (id: string) => { const epoch = ++detailEpoch; selected.value = null; try { const value = await communityAdminApi.inspection(id); if (epoch === detailEpoch) selected.value = value } catch (cause) { if (epoch === detailEpoch) error.value = cause instanceof Error ? cause.message : '读取详情失败' } }
const governanceTarget = ref<{ type: 'post' | 'comment'; id: string; revision: number; title: string } | null>(null)
const openModeration = (type: 'post' | 'comment', id: string) => {
  const post = selected.value?.post.id === id ? selected.value.post : posts.value.find((row) => row.id === id)
  const comment = comments.value.find((row) => row.id === id) || selected.value?.comments.find((row) => row.id === id)
  governanceTarget.value = { type, id, revision: (type === 'post' ? post?.revision : comment?.revision) || 1, title: type === 'post' ? post?.title || post?.bodyPreview || id : comment?.body || id }
  tab.value = 'reports'
}
const topicOpen = ref(false), topicId = ref<string | undefined>()
const topicForm = reactive({ slug: '', name: '', description: '', accent: 'purple', themeId: '', status: 'active', recommended: false, sortOrder: 0, reason: '' })
const editTopic = (topic?: CommunityTopicDto) => { topicId.value = topic?.id; Object.assign(topicForm, { slug: topic?.slug || '', name: topic?.name || '', description: topic?.description || '', accent: topic?.accent || 'purple', themeId: topic?.themeId || '', status: topic?.status || 'active', recommended: topic?.recommended || false, sortOrder: topic?.sortOrder || 0, reason: '' }); topicOpen.value = true }
const saveTopic = async () => { try { await communityAdminApi.saveTopic({ ...topicForm }, topicId.value); topicOpen.value = false; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '话题保存失败' } }
const officialOpen = ref(false), officialId = ref(''), officialForm = reactive({ verifiedType: 'none', expertise: '', reason: '', revision: 1 })
const editOfficial = (user: CommunityAuthorDto & { expertiseTopics: string[]; revision: number }) => { officialId.value = user.id; Object.assign(officialForm, { verifiedType: user.verifiedType, expertise: user.expertiseTopics.join(','), reason: '', revision: user.revision }); officialOpen.value = true }
const saveOfficial = async () => { try { await communityAdminApi.verify(officialId.value, officialForm.verifiedType, officialForm.expertise.split(',').map((t) => t.trim()).filter(Boolean), officialForm.reason, officialForm.revision); officialOpen.value = false; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '认证保存失败' } }
const policyForm = reactive({ parameter: 'learningWeight', value: 28, reason: '' })
const savePolicy = async () => { try { await communityAdminApi.updatePolicy(policyForm.parameter, policyForm.value, policyForm.reason, policy.value?.revision); policyForm.reason = ''; await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '策略保存失败' } }
const restrictionOpen = ref(false)
const restrictionForm = reactive({ id: '', userId: '', operations: [] as RestrictableOperation[], startsAt: '', endsAt: '', reason: '', ruleCode: '', revision: 1 })
const localDateTime = (value: string) => new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const editRestriction = (row?: CommunityOperationRestrictionDto) => {
  restrictionForm.ruleCode = ''
  Object.assign(restrictionForm, row
    ? { id: row.id, userId: row.userId, operations: [...row.operations], startsAt: localDateTime(row.startsAt), endsAt: localDateTime(row.endsAt), reason: row.reason, revision: row.revision }
    : { id: '', userId: '', operations: [] as RestrictableOperation[], startsAt: localDateTime(new Date().toISOString()), endsAt: localDateTime(new Date(Date.now() + 86400000).toISOString()), reason: '', revision: 1 })
  restrictionOpen.value = true
}
const saveRestriction = async () => {
  try {
    const input = { operations: restrictionForm.operations, startsAt: new Date(restrictionForm.startsAt).toISOString(), endsAt: new Date(restrictionForm.endsAt).toISOString(), reason: restrictionForm.reason, ruleCode: restrictionForm.ruleCode }
    if (restrictionForm.id) await communityAdminApi.updateRestriction(restrictionForm.id, { ...input, expectedRevision: restrictionForm.revision })
    else await communityAdminApi.createRestriction({ ...input, userId: restrictionForm.userId })
    restrictionOpen.value = false; await load()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作限制保存失败' }
}
const revokeRestriction = async (row: CommunityOperationRestrictionDto) => {
  const reason = window.prompt('请输入撤销理由（至少4个字符）')?.trim()
  if (!reason || reason.length < 4) return
  try { await communityAdminApi.revokeRestriction(row.id, row.revision, reason); await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '操作限制撤销失败' }
}
const quotaForm = reactive({ operation: 'post' as keyof CommunityEligibilityPolicyDto['quotas'], limit: 5, windowSeconds: 60, reason: '' })
const editQuota = (operation: keyof CommunityEligibilityPolicyDto['quotas']) => { const quota = eligibilityPolicy.value?.quotas[operation]; quotaForm.operation = operation; quotaForm.limit = quota?.limit || 1; quotaForm.windowSeconds = quota?.windowSeconds || 60; quotaForm.reason = '' }
const saveQuota = async () => {
  if (!eligibilityPolicy.value) return
  try { eligibilityPolicy.value = await communityAdminApi.updateEligibilityPolicy({ expectedRevision: eligibilityPolicy.value.revision, ...quotaForm }); quotaForm.reason = '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '频率策略保存失败' }
}
const postOpen = ref(false), postTarget = ref(''), editingPost = ref(false), postSaving = ref(false), postRequestKey = ref(''), postRequestBody = ref(''), postForm = reactive({ title: '', text: '', reason: '' })
const editingSnapshot = ref<CommunityPostDetailDto | null>(null)
const openPost = (authorId?: string) => {
  if (!authorId && !selected.value) return
  editingSnapshot.value = !authorId && selected.value ? JSON.parse(JSON.stringify(selected.value.post)) : null
  editingPost.value = !authorId; postTarget.value = authorId || selected.value?.post.id || ''
  postRequestKey.value = ''; postRequestBody.value = ''
  Object.assign(postForm, { title: authorId ? '' : selected.value?.post.title || '', text: authorId ? '' : selected.value?.post.contentBlocks.filter((b) => b.type === 'paragraph').map((b) => b.text).join('\n\n') || '', reason: '' }); postOpen.value = true
}
const savePost = async (publish = false) => {
  if (postSaving.value) return
  postSaving.value = true
  try {
    const original = editingSnapshot.value
    const input = { type: original?.type || 'general' as const, title: postForm.title, contentBlocks: [...(postForm.text.trim() ? [{ type: 'paragraph' as const, text: postForm.text }] : []), ...(original?.contentBlocks.filter((b) => b.type !== 'paragraph') || [])], bindings: original?.bindings.filter((b) => b.status !== 'unavailable').map((b) => ({ type: b.type, id: b.id })) || [], inlineReferences: original?.inlineReferences?.map(({ kind, text, id }) => ({ kind, text, id })), quotedPostId: original?.quotedPostId, topicIds: original?.manualTopicIds || original?.topics.map((t) => t.id) || [], visibility: original?.visibility || 'public' as const, status: publish ? 'published' as const : original?.status === 'draft' ? 'draft' as const : 'published' as const, reason: postForm.reason }
    const body = JSON.stringify(input)
    if (body !== postRequestBody.value) { postRequestBody.value = body; postRequestKey.value = crypto.randomUUID() }
    const saved = editingPost.value ? await communityAdminApi.editPost(postTarget.value, { ...input, expectedRevision: original?.revision }, postRequestKey.value) : await communityAdminApi.officialPost(postTarget.value, input, postRequestKey.value)
    contentNotice.value = saved?.status === 'pending_review' ? '内容已保存，等待人工复核，尚未公开。请在内容检测与复核中查看。' : saved?.detection?.action === 'warn' ? `内容已保存。提醒：${[...new Set(saved.detection.hits.map(hit => hit.explanation))].join('；')}` : '内容已保存。'
    postOpen.value = false; await load(); if (editingPost.value) await inspect(postTarget.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' } finally { postSaving.value = false }
}
const images = ref<Record<string, string>>({}); let imageEpoch = 0
const selectedCoverId = computed(() => selected.value?.post.coverFileId || selected.value?.post.contribution?.coverFileId)
const clearImages = () => { imageEpoch++; Object.values(images.value).forEach(URL.revokeObjectURL); images.value = {} }
watch(selected, async (value) => {
  clearImages(); const epoch = imageEpoch
  const ids = new Set([...(value?.post.contentBlocks || []).flatMap((block) => block.type === 'image' ? [block.fileId] : []), ...(selectedCoverId.value ? [selectedCoverId.value] : [])])
  for (const id of ids) {
    try { const url = await communityAdminApi.image(id); if (epoch === imageEpoch) images.value[id] = url; else URL.revokeObjectURL(url) } catch { /* 不可用图片显示替代说明。 */ }
  }
})
onUnmounted(() => { detailEpoch++; clearImages() })
watch(tab, () => { detailEpoch++; postOpen.value = false; ruleOpen.value = false; reviewOpen.value = false; selectedReview.value = null; editingSnapshot.value = null; page.value = 1; filters.status = ''; selected.value = null; void load() })
watch(page, () => { void load() })
onMounted(async () => {
  await load()
  if (typeof route?.query?.postId === 'string') await inspect(route.query.postId)
})
</script>
<template><div class="community-admin-page">
  <AdminPageHeader title="社区运营" description="围绕真实学习内容，维护有帮助、可追溯的校园交流。"><template #actions><button v-if="selected && can('community.write') && ['draft', 'published'].includes(selected.post.status)" class="admin-secondary" @click="openPost()">编辑所选内容</button><template v-if="tab === 'official' && can('community.official.publish')"><select v-model="postTarget" aria-label="选择发布账号"><option value="">选择认证账号</option><option v-for="user in officials.filter((u) => u.verifiedType !== 'none')" :key="user.id" :value="user.id">{{ user.displayName }}</option></select><button class="admin-primary" :disabled="!postTarget" @click="openPost(postTarget)">发布官方学习指导</button></template><button class="admin-secondary" :disabled="loading" @click="load"><AdminIcon name="refresh" :size="16" />刷新数据</button></template></AdminPageHeader>
  <section class="kpi-grid community-admin-kpis"><AdminKpiCard icon="article" label="今日发布" :value="summary?.todayPosts ?? '—'" /><AdminKpiCard icon="course" label="待回答问题" :value="summary?.unanswered ?? '—'" color="#9b72db" /><AdminKpiCard icon="shield" label="待处理举报" :value="summary?.pendingReports ?? '—'" color="#e9a651" /><AdminKpiCard icon="growth-user" label="今日活跃用户" :value="summary?.activeUsers ?? '—'" color="#42a87d" /></section>
  <div v-if="error" class="error-banner" role="alert">{{ error }} <button @click="load">重试</button></div>
  <p v-if="contentNotice" class="community-admin-note" role="status">{{ contentNotice }}</p>
  <form v-if="!['policy', 'eligibility', 'content', 'reports'].includes(tab)" class="panel community-admin-filter" @submit.prevent="page = 1; load()">
    <input v-model="keyword" aria-label="搜索社区内容" placeholder="关键词" maxlength="120" />
    <input v-model="filters.status" aria-label="状态" placeholder="状态：published / draft / pending" />
    <input v-model="filters.authorId" aria-label="作者ID" placeholder="作者 ID" /><input v-model="filters.schoolId" aria-label="学校ID" placeholder="学校 ID" />
    <template v-if="['posts','questions'].includes(tab)"><input v-model="filters.topicId" aria-label="话题ID" placeholder="话题 ID" /><select v-model="filters.postType" aria-label="动态类型"><option value="">全部类型</option><option v-for="(label,key) in typeLabels" :key="key" :value="key">{{ label }}</option></select><select v-model="filters.visibility" aria-label="可见范围"><option value="">全部范围</option><option value="public">社区内公开</option><option value="school">同校</option></select><select v-model="filters.hasMedia" aria-label="图片筛选"><option :value="undefined">全部图片</option><option :value="true">有图片</option><option :value="false">无图片</option></select><select v-model="filters.reported" aria-label="举报筛选"><option :value="undefined">全部举报</option><option :value="true">有举报</option><option :value="false">无举报</option></select></template>
    <input v-model="filters.createdFrom" aria-label="创建起始日期" type="date" /><input v-model="filters.createdTo" aria-label="创建截止日期" type="date" />
    <select v-model="filters.sortBy" aria-label="排序字段"><option value="createdAt">创建时间</option><option v-if="['posts','questions'].includes(tab)" value="publishedAt">发布时间</option><option v-if="['posts','questions'].includes(tab)" value="editedAt">更新时间</option></select><select v-model="filters.sortOrder" aria-label="排序方向"><option value="desc">降序</option><option value="asc">升序</option></select><button class="admin-secondary">筛选</button>
  </form>
  <section class="panel community-admin-workspace"><nav class="community-admin-tabs" aria-label="社区运营分类"><button v-for="item in tabs.filter((t) => can(t.permission))" :key="item.key" :class="{ active: tab === item.key }" @click="tab = item.key">{{ item.label }}</button></nav>
    <div v-if="['posts', 'questions'].includes(tab)" class="community-admin-split">
      <div class="community-admin-list"><form class="community-admin-filter" @submit.prevent="page = 1; load()"><input v-model="keyword" placeholder="搜索正文或学习问题" maxlength="120" /><button class="admin-secondary">查询</button></form><div class="community-admin-table"><table><thead><tr><th>作者 / 内容</th><th>学习关联</th><th>{{ tab === 'questions' ? '回答状态' : '互动' }}</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="post in posts" :key="post.id" :class="{ selected: selected?.post.id === post.id }"><td><small>{{ post.author.displayName }} · {{ typeLabels[post.type] }}</small><strong>{{ post.title || post.bodyPreview }}</strong><p>{{ post.bodyPreview }}</p><small>{{ post.topics.map(t => t.name).join(' / ') }} · {{ post.mediaCount || 0 }} 图片 · {{ post.reportCount || 0 }} 举报</small></td><td><span v-for="binding in post.bindings.slice(0, 2)" :key="binding.id">{{ binding.title }}</span></td><td><template v-if="post.question">{{ post.question.status === 'solved' ? '已解决' : '待回答' }}<small>{{ post.stats.comments }} 回答 · {{ post.question.teacherAnswered ? '教师已参与' : '等待讨论' }}</small></template><template v-else>{{ post.stats.likes }} 赞 · {{ post.stats.useful }} 有帮助<small>{{ post.stats.bookmarks }} 收藏 · {{ post.stats.comments }} 评论</small></template></td><td><span class="community-admin-status" :class="post.status">{{ statusLabels[post.status] }}</span><small>{{ post.visibility === 'school' ? '同校' : '社区内公开' }}</small><small>{{ post.portalConsent ? '作者已授权门户展示' : '未授权门户展示' }}</small><small v-if="post.editedAt">编辑 {{ new Date(post.editedAt).toLocaleString('zh-CN') }}</small><small>{{ new Date(post.publishedAt).toLocaleDateString('zh-CN') }}</small></td><td><button class="admin-text" @click="inspect(post.id)">详情</button></td></tr></tbody></table></div><p v-if="!posts.length && !loading" class="admin-empty">没有匹配的动态</p><AdminPagination :page="page" :page-size="20" :total="total" @change="page = $event" /></div>
      <aside class="community-admin-detail">
        <template v-if="selected">
          <header><h2>{{ selected.post.title || '动态详情' }}</h2><small>{{ selected.post.author.displayName }} · {{ statusLabels[selected.post.status] }}</small></header>
          <div class="community-admin-body">
            <figure v-if="selectedCoverId"><img v-if="images[selectedCoverId]" :src="images[selectedCoverId]" alt="作品封面" /><figcaption>{{ images[selectedCoverId] ? '作品封面' : '封面不可用或正在读取' }}</figcaption></figure>
            <template v-for="(block, index) in selected.post.contentBlocks" :key="index">
              <pre v-if="block.type === 'code'"><code>{{ block.code }}</code></pre>
              <figure v-else-if="block.type === 'image'"><img v-if="images[block.fileId]" :src="images[block.fileId]" :alt="block.alt || '学习图片'" /><figcaption v-else>图片不可用或正在读取</figcaption></figure>
              <!-- rich_text 仅接受经 API 白名单净化、无图片和样式的正文。 -->
              <div v-else-if="block.type === 'rich_text'" v-html="block.text" />
              <ul v-else-if="block.type === 'list'"><li v-for="(item, i) in block.items" :key="i">{{ item }}</li></ul>
              <blockquote v-else-if="block.type === 'quote'">{{ block.text }}</blockquote><p v-else>{{ block.text }}</p>
            </template>
            <section v-if="selected.post.quotedPostId"><h3>引用原帖</h3><p>对象 ID：{{ selected.post.quotedPostId }}</p><template v-if="selected.post.quotedPost?.available"><p>{{ selected.post.quotedPost.author.displayName }} · {{ selected.post.quotedPost.title }}</p><p>{{ selected.post.quotedPost.contentBlocks.filter(b => b.type === 'paragraph').map(b => b.text).join('\n') }}</p></template><p v-else>原内容已不可用</p></section>
            <h3>关联学习内容</h3><p v-for="binding in selected.post.bindings" :key="binding.id">{{ binding.title }}</p>
            <h3>话题与图片关联</h3><p>{{ selected.post.topics.map(t => `#${t.name}`).join('、') || '未关联话题' }}</p><p v-for="file in selected.files || []" :key="file.id">{{ file.originalName }} · {{ file.mimeType }} · {{ file.exists ? '文件有效' : '文件缺失' }}</p>
            <h3>版本时间线</h3><details v-for="version in selected.revisions || []" :key="version.id"><summary>版本 {{ version.revisionNo }} · {{ version.editorType }} · {{ new Date(version.createdAt).toLocaleString('zh-CN') }}</summary><p>{{ version.reason }}</p><p>{{ version.titleSnapshot }}</p><p v-if="version.quotedPostIdSnapshot">引用原帖 ID：{{ version.quotedPostIdSnapshot }}</p><pre>{{ JSON.stringify(version.contentBlocksSnapshot, null, 2) }}</pre></details>
            <h3>处理记录</h3><p v-for="action in selected.moderation || []" :key="action.id">{{ action.action }} · {{ action.reason }}</p>
            <h3>行为时间线</h3><p v-for="action in selected.actions || []" :key="action.id">{{ new Date(action.occurredAt).toLocaleString('zh-CN') }} · {{ action.eventType }}</p>
            <h3>评论摘要</h3><p v-for="comment in selected.comments.slice(0, 5)" :key="comment.id"><strong>{{ comment.author.displayName }}：</strong>{{ comment.body }}</p>
            <template v-if="can('community.report.manage')"><h3>举报记录</h3><p v-for="report in selected.reports" :key="report.id">{{ report.reason }} · {{ statusLabels[report.status] }}<small>{{ report.description }}</small></p><p v-if="!selected.reports.length">暂无举报</p></template>
            <template v-if="selected.recommendation"><h3>推荐来源与解释</h3><p>{{ selected.recommendation.candidateSources.join('、') }}</p><p>总分 {{ selected.recommendation.total.toFixed(3) }} · {{ selected.recommendation.policyVersion }} · {{ selected.recommendation.filter }}</p><dl><template v-for="(score, dimension) in selected.recommendation.dimensions" :key="dimension"><dt>{{ dimension }}</dt><dd>{{ score.toFixed(3) }}</dd></template></dl></template>
          </div>
          <footer><button v-if="can('community.moderate')" class="admin-primary" @click="openModeration('post', selected.post.id)">处理内容</button></footer>
        </template>
        <div v-else class="admin-empty"><AdminIcon name="article" :size="30" /><strong>选择动态查看完整详情</strong><small>内容、关联、讨论与处理记录</small></div>
      </aside>
    </div>
    <div v-else-if="tab === 'comments'" class="community-admin-section"><article v-for="comment in comments" :key="comment.id" class="community-admin-row"><div><strong>{{ comment.author.displayName }}</strong><p>{{ comment.body }}</p><small>{{ statusLabels[comment.status] }} · {{ new Date(comment.createdAt).toLocaleString('zh-CN') }}</small></div><button v-if="can('community.moderate')" class="admin-secondary" @click="openModeration('comment', comment.id)">处理评论</button></article><AdminPagination :page="page" :page-size="20" :total="total" @change="page = $event" /></div>
    <div v-else-if="tab === 'topics'" class="community-admin-section"><div class="community-admin-filter"><h2>学习话题</h2><button class="admin-primary" @click="editTopic()">创建话题</button></div><div class="community-admin-topic-grid"><article v-for="topic in topics" :key="topic.id"><span class="community-admin-status">{{ topic.status === 'active' ? '开放' : '已关闭' }}{{ topic.recommended ? ' · 推荐' : '' }}</span><h3># {{ topic.name }}</h3><p>{{ topic.description }}</p><small>{{ topic.postCount }} 条内容 · {{ topic.followerCount }} 人关注 · 排序 {{ topic.sortOrder }}</small><button class="admin-text" @click="editTopic(topic)">编辑话题</button></article></div></div>
    <CommunityGovernanceWorkbench v-else-if="tab === 'reports'" :target="governanceTarget" @closed="governanceTarget = null" @review="openReview" @inspect="tab = 'posts'; inspect($event)" />
    <div v-else-if="tab === 'official'" class="community-admin-section"><p class="community-admin-note">认证与发布沿用统一用户和 RBAC。认证字段由服务端校验，学生不能自行申领教师或官方身份。</p><article v-for="user in officials" :key="user.id" class="community-admin-row"><div><strong>{{ user.displayName }}</strong><p>{{ user.username }} · {{ user.school }}</p><small>{{ user.verifiedType === 'none' ? '普通学习者' : user.verifiedType }}</small></div><button class="admin-secondary" @click="editOfficial(user)">管理认证</button></article><AdminPagination :page="page" :page-size="20" :total="total" @change="page = $event" /></div>
    <div v-else-if="tab === 'content' && contentPolicy" class="community-admin-section">
      <p class="community-admin-note">检测只处理文字与媒体说明，不代表图片或视频画面已审查。命中不等于违规，反诈引用、技术教程等应结合上下文复核；媒体风险继续使用举报处理。</p>
      <details>
        <summary>检测规则 · 版本 {{ contentPolicy.version }} · {{ contentPolicy.rules.length }} 条</summary>
        <div class="community-admin-filter"><h2>小型规则库</h2><button class="admin-primary" :disabled="contentSaving" @click="editRule()">新增规则</button></div>
        <article v-for="rule in contentPolicy.rules" :key="rule.id" class="community-admin-row"><div><strong>{{ rule.content }}</strong><small>{{ rule.id }} · {{ rule.enabled ? '启用' : '停用' }} · {{ categoryLabels[rule.category] }} · {{ methodLabels[rule.method] }} · {{ actionLabels[rule.action] }}</small><p>{{ rule.explanation }}</p><small>适用：{{ rule.fields.map(field => fieldLabels[field]).join('、') }}</small></div><div class="community-admin-row-actions"><button class="admin-secondary" :disabled="contentSaving" @click="editRule(rule)">编辑</button><button class="admin-text" :disabled="contentSaving" @click="editRule(rule, true)">删除</button></div></article>
        <p v-if="!contentPolicy.rules.length" class="admin-empty">当前没有检测规则；所有文字将不因规则命中受限。</p>
        <form class="admin-form community-policy-form" @submit.prevent="saveContentPolicy({ rollbackVersion, reason: rollbackReason })"><h3>回退历史规则</h3><p>回退会生成递增的新版本，不覆盖历史记录。原规则版本的待审内容须重新提交检测。</p><label>历史版本<select v-model.number="rollbackVersion" required><option :value="0" disabled>选择历史版本</option><option v-for="version in contentHistory.filter(item => item.version < contentPolicy!.version)" :key="version.version" :value="version.version">版本 {{ version.version }} · {{ version.rules.length }} 条规则</option></select></label><label>回退理由<textarea v-model="rollbackReason" rows="2" minlength="4" maxlength="500" required /></label><button class="admin-secondary" :disabled="contentSaving || !rollbackVersion">确认回退并创建新版本</button></form>
      </details>
      <details>
        <summary>文本试跑（仅检测，不保存投稿）</summary>
        <form class="admin-form community-policy-form" @submit.prevent="trialContent"><label>检测字段<select v-model="trialField"><option v-for="field in contentDetectionFields" :key="field" :value="field">{{ fieldLabels[field] }}</option></select></label><label>合成测试文本<textarea v-model="trialText" rows="5" maxlength="30000" required placeholder="使用合成案例；不要粘贴真实密钥或个人资料。" /></label><button class="admin-secondary" :disabled="contentSaving">用当前已保存规则试跑</button></form>
        <div v-if="trialResult" class="community-admin-note" role="status"><strong>结果：{{ actionLabels[trialResult.action] }} · 规则版本 {{ trialResult.ruleVersion }}</strong><p>试跑未创建投稿或复核记录；未审查媒体画面。</p><p v-for="(hit, index) in trialResult.hits" :key="index">{{ fieldLabels[hit.field] }} · {{ categoryLabels[hit.category] }} · {{ actionLabels[hit.action] }}：{{ hit.explanation }}（{{ hit.ruleId }}）</p><p v-if="!trialResult.hits.length">未命中当前规则，不代表已经人工核实所有事实。</p></div>
      </details>
      <form class="community-admin-filter" @submit.prevent="page = 1; load()"><h2>修订复核</h2><label>状态<select v-model="reviewStatus"><option value="pending">待复核</option><option value="approved">已通过</option><option value="rejected">已驳回</option><option value="superseded">已被新修订替代</option></select></label><button class="admin-secondary" :disabled="loading">查询</button></form>
      <article v-for="row in contentReviews" :key="row.id" class="community-admin-row"><div><strong>{{ targetLabels[row.targetType] }} · {{ statusLabels[row.status] }}</strong><small>内容 {{ row.targetId }} · 修订 {{ row.contentRevision }} · 规则 {{ row.ruleVersion }} · {{ new Date(row.createdAt).toLocaleString('zh-CN') }}</small><p v-for="(hit, index) in row.findings.hits" :key="index">{{ fieldLabels[hit.field] }}：{{ hit.explanation }}</p><p v-if="row.reason">复核理由：{{ row.reason }}</p></div><button class="admin-secondary" :disabled="contentSaving" @click="openReview(row.id)">查看{{ row.status === 'pending' ? '并复核' : '记录' }}</button></article>
      <p v-if="!contentReviews.length && !loading" class="admin-empty">没有符合当前状态的复核记录。</p>
      <AdminPagination :page="page" :page-size="20" :total="total" @change="page = $event" />
    </div>
    <div v-else-if="tab === 'eligibility' && eligibilityPolicy" class="community-admin-section">
      <div class="community-admin-filter"><div><h2>临时操作限制</h2><p class="community-admin-note">仅限制选中的公开操作；阅读、保存私人草稿及撤销已有公开状态不受影响。</p></div><button class="admin-primary" @click="editRestriction()">新增限制</button></div>
      <article v-for="row in restrictions" :key="row.id" class="community-admin-row"><div><strong>{{ row.displayName }}（{{ row.username }}）</strong><p>{{ row.operations.map((operation) => operationLabels[operation]).join('、') }} · {{ row.reason }}</p><small>{{ row.active ? '当前生效' : row.revokedAt ? '已撤销' : new Date(row.startsAt) > new Date() ? '尚未开始' : '已到期' }} · 至 {{ new Date(row.endsAt).toLocaleString('zh-CN') }} · 由 {{ row.createdBy }} 设置</small></div><div v-if="!row.revokedAt" class="community-admin-row-actions"><button class="admin-secondary" @click="editRestriction(row)">调整</button><button class="admin-text" @click="revokeRestriction(row)">撤销</button></div></article>
      <p v-if="!restrictions.length" class="admin-empty">暂无操作限制记录</p>
      <div class="community-policy-heading"><h2>数据库限流策略</h2><p>账号阈值优先，IP 仅作为共享出口下的辅助保护；修改会保留审计记录。</p></div>
      <div class="community-policy-grid"><section v-for="(quota, operation) in eligibilityPolicy.quotas" :key="operation"><h3>{{ quotaLabels[operation] }}</h3><p>{{ quota.windowSeconds }} 秒内最多 {{ quota.limit }} 次</p><button class="admin-secondary" @click="editQuota(operation)">载入参数</button></section></div>
      <form class="admin-form community-policy-form" @submit.prevent="saveQuota"><label>操作<select v-model="quotaForm.operation" @change="editQuota(quotaForm.operation)"><option v-for="(label, operation) in quotaLabels" :key="operation" :value="operation">{{ label }}</option></select></label><label>窗口内次数<input v-model.number="quotaForm.limit" type="number" min="1" max="1000" required /></label><label>时间窗（秒）<input v-model.number="quotaForm.windowSeconds" type="number" min="10" max="86400" required /></label><label>调整理由<textarea v-model="quotaForm.reason" required minlength="4" maxlength="500" rows="2" /></label><button class="admin-primary">保存频率策略</button></form>
    </div>
    <div v-else-if="tab === 'policy' && policy" class="community-admin-section"><div class="community-policy-heading"><div><span class="community-admin-status">当前生效</span><h2>{{ policy.version }}</h2><p>优先学习价值，不以停留时长作为唯一目标。</p></div></div><div class="community-policy-grid"><section><h3>候选来源与上限</h3><dl><template v-for="(limit, key) in policy.candidateLimits" :key="key"><dt>{{ key }}</dt><dd>{{ limit }} 条</dd></template></dl></section><section><h3>归一化打分维度</h3><dl><template v-for="(weight, key) in policy.weights" :key="key"><dt>{{ key }}</dt><dd>{{ (weight * 100).toFixed(1) }}%</dd></template></dl></section><section><h3>多样性约束</h3><p>每 {{ policy.diversity.authorWindowSize }} 条最多 {{ policy.diversity.maxSameAuthorInWindow }} 条同作者内容</p><p>连续同类型不超过 {{ policy.diversity.maxSameTypeConsecutive }} 条</p><p>每窗口最多 {{ policy.diversity.maxOfficialInWindow }} 条普通官方推荐</p><p>不可见内容统一过滤，失败退回可见时间流。</p></section></div><form class="admin-form community-policy-form" @submit.prevent="savePolicy"><h3>安全命名参数</h3><label>参数<select v-model="policyForm.parameter"><option value="learningWeight">学习相关权重</option><option value="qualityWeight">内容质量权重</option><option value="explorationWeight">探索权重</option><option value="limitedPenalty">限制展示惩罚</option></select></label><label>数值（0～40%，保存后权重重新归一化）<input v-model.number="policyForm.value" type="number" min="0" max="40" required /></label><label>调整理由<textarea v-model="policyForm.reason" required minlength="4" maxlength="500" rows="2" /></label><button class="admin-primary">保存策略参数</button></form></div>
    <AdminPagination v-if="tab === 'topics'" :page="page" :page-size="20" :total="total" @change="page = $event" />
  </section>
  <AdminDialog v-model="postOpen" :title="editingPost ? '编辑社区内容' : '发布官方学习指导'"><form class="admin-form" @submit.prevent="savePost(false)"><label>标题<input v-model="postForm.title" maxlength="160" required /></label><label>正文<textarea v-model="postForm.text" minlength="5" maxlength="20000" rows="8" required /></label><p v-if="editingPost">关联学习内容、代码、图片与引用块保持不变。</p><label>操作理由<textarea v-model="postForm.reason" minlength="4" maxlength="500" required /></label><button :class="editingSnapshot?.status === 'draft' ? 'admin-secondary' : 'admin-primary'" :disabled="postSaving">确认{{ editingSnapshot?.status === 'draft' ? '保存草稿' : editingPost ? '保存' : '发布' }}</button><button v-if="editingSnapshot?.status === 'draft' && editingSnapshot.id.startsWith('community-lcz-')" type="button" class="admin-primary" :disabled="postSaving" @click="savePost(true)">确认发布</button></form></AdminDialog>

  <AdminDialog v-model="topicOpen" :title="topicId ? '编辑学习话题' : '创建学习话题'"><form class="admin-form" @submit.prevent="saveTopic"><label>稳定标识<input v-model="topicForm.slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></label><label>名称<input v-model="topicForm.name" required maxlength="60" /></label><label>说明<textarea v-model="topicForm.description" maxlength="500" /></label><label>关联通识基础 ID（选填）<input v-model="topicForm.themeId" /></label><label>色彩<select v-model="topicForm.accent"><option v-for="color in ['purple', 'green', 'blue', 'yellow', 'teal', 'orange']" :key="color">{{ color }}</option></select></label><label>状态<select v-model="topicForm.status"><option value="active">开放</option><option value="closed">关闭</option></select></label><label><input v-model="topicForm.recommended" type="checkbox" />推荐话题</label><label>排序<input v-model.number="topicForm.sortOrder" type="number" min="0" max="9999" /></label><label>操作理由<textarea v-model="topicForm.reason" required minlength="4" maxlength="500" /></label><button class="admin-primary">保存话题</button></form></AdminDialog>
  <AdminDialog v-model="officialOpen" title="管理统一用户认证"><form class="admin-form" @submit.prevent="saveOfficial"><label>认证身份<select v-model="officialForm.verifiedType"><option value="none">普通学习者</option><option value="teacher">认证教师</option><option value="mentor">学习导师</option><option value="official">官方账号</option></select></label><label>专业话题 ID（逗号分隔）<input v-model="officialForm.expertise" /></label><label>认证理由<textarea v-model="officialForm.reason" required minlength="4" maxlength="500" /></label><button class="admin-primary">保存认证与角色</button></form></AdminDialog>
  <AdminDialog v-model="restrictionOpen" :title="restrictionForm.id ? '调整操作限制' : '新增操作限制'"><form class="admin-form" @submit.prevent="saveRestriction"><label>用户<select v-model="restrictionForm.userId" required :disabled="!!restrictionForm.id"><option value="">选择统一用户</option><option v-for="user in officials" :key="user.id" :value="user.id">{{ user.displayName }}（{{ user.username }}）</option></select></label><fieldset><legend>限制的操作</legend><label v-for="(label, operation) in operationLabels" :key="operation"><input v-model="restrictionForm.operations" type="checkbox" :value="operation" />{{ label }}</label></fieldset><label>开始时间<input v-model="restrictionForm.startsAt" type="datetime-local" required /></label><label>结束时间<input v-model="restrictionForm.endsAt" type="datetime-local" required /></label><label>规则依据<input v-model="restrictionForm.ruleCode" required minlength="2" maxlength="100" /></label><label>限制理由<textarea v-model="restrictionForm.reason" required minlength="4" maxlength="500" rows="3" /></label><button class="admin-primary" :disabled="!restrictionForm.operations.length">保存操作限制</button></form></AdminDialog>
  <AdminDialog v-model="ruleOpen" :title="deletingRule ? '删除检测规则' : editingRuleId ? '编辑检测规则' : '新增检测规则'">
    <form v-if="ruleForm" class="admin-form community-content-form" @submit.prevent="saveRule">
      <p v-if="deletingRule">将删除当前规则“{{ ruleForm.content }}”（{{ editingRuleId }}）。此次操作生成新版本，原规则保留在历史版本中，可回退恢复。</p>
      <template v-else>
      <label>稳定标识<input v-model="ruleForm.id" required pattern="[a-z][a-z0-9-]{0,63}" maxlength="64" :disabled="!!editingRuleId" /></label>
      <label>匹配方式<select v-model="ruleForm.method" @change="ruleForm.content = ''"><option v-for="(label, key) in methodLabels" :key="key" :value="key">{{ label }}</option></select></label>
      <label>规则内容<select v-if="ruleForm.method === 'detector'" v-model="ruleForm.content" required><option disabled value="">选择固定格式检测器</option><option value="credential">疑似凭据格式</option><option value="personal_data">带上下文的个人号码</option></select><input v-else v-model="ruleForm.content" required maxlength="200" /></label>
      <fieldset><legend>适用字段（至少一项）</legend><label v-for="field in contentDetectionFields" :key="field"><input v-model="ruleForm.fields" type="checkbox" :value="field" />{{ fieldLabels[field] }}</label></fieldset>
      <label>风险分类<select v-model="ruleForm.category"><option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option></select></label>
      <label>处理动作<select v-model="ruleForm.action"><option v-for="(label, key) in actionLabels" :key="key" :value="key">{{ label }}</option></select></label>
      <label>是否启用<select v-model="ruleForm.enabled"><option :value="true">启用</option><option :value="false">停用</option></select></label><label>向用户解释的说明<textarea v-model="ruleForm.explanation" required maxlength="500" rows="2" /></label>
      </template>
      <label>修改理由<textarea v-model="ruleReason" required minlength="4" maxlength="500" rows="2" /></label><p class="community-admin-note">放行规则不能覆盖其他高风险命中。学校类规则须有明确依据；不要导入未经验证的大词库。</p>
      <p v-if="error" class="error-banner" role="alert">{{ error }}</p><button class="admin-primary" :disabled="contentSaving || !ruleForm.fields.length">{{ deletingRule ? '确认删除并创建新版本' : '保存为新规则版本' }}</button>
    </form>
  </AdminDialog>
  <AdminDialog v-model="reviewOpen" title="复核指定内容修订">
    <div v-if="selectedReview" class="admin-form">
      <p>{{ targetLabels[selectedReview.targetType] }} · {{ selectedReview.targetId }} · 修订 {{ selectedReview.contentRevision }} · 规则版本 {{ selectedReview.ruleVersion }}</p>
      <p v-if="selectedReview.ruleVersion !== contentPolicy?.version" class="error-banner">规则已有新版本，不能按旧规则放行；请作者编辑后重新提交检测。</p>
      <p v-if="!selectedReview.contentAvailable" class="error-banner">此内容已有新修订，当前无法读取该复核对应的完整内容。请使用最新复核记录。</p>
      <details v-else open class="community-admin-body"><summary>对应修订的原始文字（仅审核人员可见）</summary><pre>{{ JSON.stringify(selectedReview.payload, null, 2) }}</pre></details>
      <p v-for="(hit, index) in selectedReview.findings.hits" :key="index">{{ fieldLabels[hit.field] }} · {{ actionLabels[hit.action] }}：{{ hit.explanation }}</p>
      <p class="community-admin-note">仅决定本次文字修订，不授予用户永久免检；未检查媒体画面。图片与视频风险请继续通过举报和人工复核处理。</p>
      <form v-if="selectedReview.status === 'pending'" class="admin-form" @submit.prevent="decideReview('approve')"><label>复核理由<textarea v-model="reviewReason" minlength="4" maxlength="500" rows="3" required /></label><button class="admin-primary" :disabled="!canDecideReview">确认本修订通过</button><button type="button" class="admin-secondary" :disabled="!canDecideReview" @click="decideReview('reject')">驳回并保留原文</button><p v-if="selectedReview.targetType === 'resource' && !can('resource.publish')">后台资源复核还需要资源发布权限。</p></form>
      <p v-else>处理状态：{{ statusLabels[selectedReview.status] }}。{{ selectedReview.reason }}</p>
    </div><p v-else>正在读取指定修订…</p><p v-if="error" class="error-banner" role="alert">{{ error }}</p>
  </AdminDialog>
</div></template>
