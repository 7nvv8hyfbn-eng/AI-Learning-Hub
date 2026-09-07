<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { CommunityAdminInspectionDto, CommunityAdminReportDto, CommunityAdminSummaryDto, CommunityAuthorDto, CommunityFeedPolicyDto, CommunityModerationInput, CommunityPostDetailDto, CommunityTopicDto, CommunityContentBlock } from '@ai-learning-hub/contracts'
import { sanitizeCommunityHtml } from '@ai-learning-hub/contracts'
import { communityAdminApi, type AdminCommunityComment } from '../services/community'
import { useSessionStore } from '../stores/session'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import AdminKpiCard from '../components/AdminKpiCard.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminPagination from '../components/AdminPagination.vue'
const session = useSessionStore(), can = (permission: string) => !!session.user?.permissions.includes(permission)
const safeHtml = (block: CommunityContentBlock) => sanitizeCommunityHtml(block.type === 'html' ? block.html : '')
const route = useRoute()
const tabs = [{ key: 'posts', label: '动态内容', permission: 'community.read' }, { key: 'questions', label: '学习问答', permission: 'community.read' }, { key: 'comments', label: '评论管理', permission: 'community.read' }, { key: 'topics', label: '话题管理', permission: 'community.topic.manage' }, { key: 'reports', label: '举报处理', permission: 'community.report.manage' }, { key: 'official', label: '官方账号', permission: 'community.official.publish' }, { key: 'policy', label: '推荐策略', permission: 'community.feed.manage' }]
const tab = ref('posts'), keyword = ref(''), page = ref(1), loading = ref(false), error = ref(''), selected = ref<CommunityAdminInspectionDto | null>(null)
const total = ref(0)
const filters = reactive({ status: '', authorId: '', schoolId: '', topicId: '', postType: '' as '' | CommunityPostDetailDto['type'], visibility: '' as '' | 'public' | 'school', hasMedia: undefined as boolean | undefined, reported: undefined as boolean | undefined, createdFrom: '', createdTo: '', sortBy: 'createdAt' as 'createdAt' | 'publishedAt' | 'editedAt', sortOrder: 'desc' as 'asc' | 'desc' })
let loadEpoch = 0, detailEpoch = 0
const summary = ref<CommunityAdminSummaryDto | null>(null), posts = ref<CommunityPostDetailDto[]>([]), comments = ref<AdminCommunityComment[]>([]), topics = ref<CommunityTopicDto[]>([]), reports = ref<CommunityAdminReportDto[]>([]), officials = ref<Array<CommunityAuthorDto & { expertiseTopics: string[]; revision: number }>>([]), policy = ref<CommunityFeedPolicyDto | null>(null)
const typeLabels: Record<string, string> = { question: '学习问答', note: '学习笔记', lab_result: '实训成果', project: '创客项目', frontier_discussion: '前沿讨论', general: '官方指导 / 交流', achievement: '学习成就' }
const statusLabels: Record<string, string> = { published: '已发布', limited: '限制展示', hidden: '已隐藏', removed: '已删除', draft: '草稿', pending: '待处理', reviewing: '复核中', resolved: '已处理', rejected: '已驳回' }
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
    if (tab.value === 'reports') { const r = await communityAdminApi.reports(query); if (epoch === loadEpoch) { reports.value = r.items; total.value = r.total } }
    if (tab.value === 'official') { const r = await communityAdminApi.officials(query); if (epoch === loadEpoch) { officials.value = r.items; total.value = r.total } }
    if (tab.value === 'policy') { const r = await communityAdminApi.policy(); if (epoch === loadEpoch) policy.value = r }
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '社区运营数据读取失败' } finally { if (epoch === loadEpoch) loading.value = false }
}
const inspect = async (id: string) => { const epoch = ++detailEpoch; selected.value = null; try { const value = await communityAdminApi.inspection(id); if (epoch === detailEpoch) selected.value = value } catch (cause) { if (epoch === detailEpoch) error.value = cause instanceof Error ? cause.message : '读取详情失败' } }
const moderationOpen = ref(false), target = ref<{ type: 'post' | 'comment' | 'report'; id: string }>({ type: 'post', id: '' })
const moderation = reactive<CommunityModerationInput>({ action: 'limit', reason: '', label: '' })
const openModeration = (type: 'post' | 'comment' | 'report', id: string) => { target.value = { type, id }; moderation.action = type === 'comment' ? 'hide' : 'limit'; moderation.reason = ''; moderation.label = ''; error.value = ''; moderationOpen.value = true }
const handle = async () => {
  loading.value = true
  try {
    if (target.value.type === 'report') await communityAdminApi.handle(target.value.id, moderation)
    else await communityAdminApi.moderate(target.value.type, target.value.id, moderation)
    moderationOpen.value = false; await load(); if (selected.value) await inspect(selected.value.post.id)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '处理失败' } finally { loading.value = false }
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
const postOpen = ref(false), postTarget = ref(''), editingPost = ref(false), postForm = reactive({ title: '', text: '', reason: '' })
const editingSnapshot = ref<CommunityPostDetailDto | null>(null)
const openPost = (authorId?: string) => {
  if (!authorId && !selected.value) return
  editingSnapshot.value = !authorId && selected.value ? JSON.parse(JSON.stringify(selected.value.post)) : null
  editingPost.value = !authorId; postTarget.value = authorId || selected.value?.post.id || ''
  Object.assign(postForm, { title: authorId ? '' : selected.value?.post.title || '', text: authorId ? '' : selected.value?.post.contentBlocks.filter((b) => b.type === 'paragraph').map((b) => b.text).join('\n\n') || '', reason: '' }); postOpen.value = true
}
const savePost = async (publish = false) => {
  try {
    const original = editingSnapshot.value
    const input = { type: original?.type || 'general' as const, title: postForm.title, contentBlocks: [{ type: 'paragraph' as const, text: postForm.text }, ...(original?.contentBlocks.filter((b) => b.type !== 'paragraph') || [])], bindings: original?.bindings.filter((b) => b.status !== 'unavailable').map((b) => ({ type: b.type, id: b.id })) || [], topicIds: original?.topics.map((t) => t.id) || [], visibility: original?.visibility || 'public' as const, status: publish ? 'published' as const : original?.status === 'draft' ? 'draft' as const : 'published' as const, reason: postForm.reason }
    if (editingPost.value) await communityAdminApi.editPost(postTarget.value, { ...input, expectedRevision: original?.revision }); else await communityAdminApi.officialPost(postTarget.value, input)
    postOpen.value = false; await load(); if (editingPost.value) await inspect(postTarget.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
}
const images = ref<Record<string, string>>({}); let imageEpoch = 0
const clearImages = () => { imageEpoch++; Object.values(images.value).forEach(URL.revokeObjectURL); images.value = {} }
watch(selected, async (value) => {
  clearImages(); const epoch = imageEpoch
  for (const block of value?.post.contentBlocks || []) if (block.type === 'image') {
    try { const url = await communityAdminApi.image(block.fileId); if (epoch === imageEpoch) images.value[block.fileId] = url; else URL.revokeObjectURL(url) } catch { /* 不可用图片显示替代说明。 */ }
  }
})
onUnmounted(() => { detailEpoch++; clearImages() })
watch(tab, () => { detailEpoch++; postOpen.value = false; editingSnapshot.value = null; page.value = 1; filters.status = ''; selected.value = null; void load() })
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
  <form v-if="tab !== 'policy'" class="panel community-admin-filter" @submit.prevent="page = 1; load()">
    <input v-model="keyword" aria-label="搜索社区内容" placeholder="关键词" maxlength="120" />
    <input v-model="filters.status" aria-label="状态" placeholder="状态：published / draft / pending" />
    <input v-model="filters.authorId" aria-label="作者ID" placeholder="作者 ID" /><input v-model="filters.schoolId" aria-label="学校ID" placeholder="学校 ID" />
    <template v-if="['posts','questions'].includes(tab)"><input v-model="filters.topicId" aria-label="话题ID" placeholder="话题 ID" /><select v-model="filters.postType" aria-label="动态类型"><option value="">全部类型</option><option v-for="(label,key) in typeLabels" :key="key" :value="key">{{ label }}</option></select><select v-model="filters.visibility" aria-label="可见范围"><option value="">全部范围</option><option value="public">公开</option><option value="school">同校</option></select><select v-model="filters.hasMedia" aria-label="图片筛选"><option :value="undefined">全部图片</option><option :value="true">有图片</option><option :value="false">无图片</option></select><select v-model="filters.reported" aria-label="举报筛选"><option :value="undefined">全部举报</option><option :value="true">有举报</option><option :value="false">无举报</option></select></template>
    <input v-model="filters.createdFrom" aria-label="创建起始日期" type="date" /><input v-model="filters.createdTo" aria-label="创建截止日期" type="date" />
    <select v-model="filters.sortBy" aria-label="排序字段"><option value="createdAt">创建时间</option><option v-if="['posts','questions'].includes(tab)" value="publishedAt">发布时间</option><option v-if="['posts','questions'].includes(tab)" value="editedAt">更新时间</option></select><select v-model="filters.sortOrder" aria-label="排序方向"><option value="desc">降序</option><option value="asc">升序</option></select><button class="admin-secondary">筛选</button>
  </form>
  <section class="panel community-admin-workspace"><nav class="community-admin-tabs" aria-label="社区运营分类"><button v-for="item in tabs.filter((t) => can(t.permission))" :key="item.key" :class="{ active: tab === item.key }" @click="tab = item.key">{{ item.label }}</button></nav>
    <div v-if="['posts', 'questions'].includes(tab)" class="community-admin-split">
      <div class="community-admin-list"><form class="community-admin-filter" @submit.prevent="page = 1; load()"><input v-model="keyword" placeholder="搜索正文或学习问题" maxlength="120" /><button class="admin-secondary">查询</button></form><div class="community-admin-table"><table><thead><tr><th>作者 / 内容</th><th>学习关联</th><th>{{ tab === 'questions' ? '回答状态' : '互动' }}</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="post in posts" :key="post.id" :class="{ selected: selected?.post.id === post.id }"><td><small>{{ post.author.displayName }} · {{ typeLabels[post.type] }}</small><strong>{{ post.title || post.bodyPreview }}</strong><p>{{ post.bodyPreview }}</p><small>{{ post.topics.map(t => t.name).join(' / ') }} · {{ post.mediaCount || 0 }} 图片 · {{ post.reportCount || 0 }} 举报</small></td><td><span v-for="binding in post.bindings.slice(0, 2)" :key="binding.id">{{ binding.title }}</span></td><td><template v-if="post.question">{{ post.question.status === 'solved' ? '已解决' : '待回答' }}<small>{{ post.stats.comments }} 回答 · {{ post.question.teacherAnswered ? '教师已参与' : '等待讨论' }}</small></template><template v-else>{{ post.stats.likes }} 赞 · {{ post.stats.useful }} 有帮助<small>{{ post.stats.bookmarks }} 收藏 · {{ post.stats.comments }} 评论</small></template></td><td><span class="community-admin-status" :class="post.status">{{ statusLabels[post.status] }}</span><small>{{ post.visibility === 'school' ? '同校' : '公开' }}</small><small v-if="post.editedAt">编辑 {{ new Date(post.editedAt).toLocaleString('zh-CN') }}</small><small>{{ new Date(post.publishedAt).toLocaleDateString('zh-CN') }}</small></td><td><button class="admin-text" @click="inspect(post.id)">详情</button></td></tr></tbody></table></div><p v-if="!posts.length && !loading" class="admin-empty">没有匹配的动态</p><AdminPagination :page="page" :page-size="20" :total="total" @change="page = $event" /></div>
      <aside class="community-admin-detail">
        <template v-if="selected">
          <header><h2>{{ selected.post.title || '动态详情' }}</h2><small>{{ selected.post.author.displayName }} · {{ statusLabels[selected.post.status] }}</small></header>
          <div class="community-admin-body">
            <template v-for="(block, index) in selected.post.contentBlocks" :key="index">
              <pre v-if="block.type === 'code'"><code>{{ block.code }}</code></pre>
              <figure v-else-if="block.type === 'image'"><img v-if="images[block.fileId]" :src="images[block.fileId]" :alt="block.alt || '学习图片'" /><figcaption v-else>图片不可用或正在读取</figcaption></figure>
              <blockquote v-else-if="block.type === 'quote'">{{ block.text }}</blockquote><div v-else-if="block.type === 'html'" class="community-admin-html" v-html="safeHtml(block)"></div><p v-else>{{ block.text }}</p>
            </template>
            <h3>关联学习内容</h3><p v-for="binding in selected.post.bindings" :key="binding.id">{{ binding.title }}</p>
            <h3>话题与图片关联</h3><p>{{ selected.post.topics.map(t => `#${t.name}`).join('、') || '未关联话题' }}</p><p v-for="file in selected.files || []" :key="file.id">{{ file.originalName }} · {{ file.mimeType }} · {{ file.exists ? '文件有效' : '文件缺失' }}</p>
            <h3>版本时间线</h3><details v-for="version in selected.revisions || []" :key="version.id"><summary>版本 {{ version.revisionNo }} · {{ version.editorType }} · {{ new Date(version.createdAt).toLocaleString('zh-CN') }}</summary><p>{{ version.reason }}</p><p>{{ version.titleSnapshot }}</p><pre>{{ JSON.stringify(version.contentBlocksSnapshot, null, 2) }}</pre></details>
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
    <div v-else-if="tab === 'reports'" class="community-admin-section"><article v-for="report in reports" :key="report.id" class="community-admin-row"><div><strong>{{ report.reason }}</strong><p>{{ report.description || '未补充说明' }}</p><small>{{ statusLabels[report.status] }} · {{ new Date(report.createdAt).toLocaleString('zh-CN') }}</small></div><button v-if="can('community.moderate')" class="admin-primary" @click="openModeration('report', report.id)">处理举报</button></article><p v-if="!reports.length" class="admin-empty">暂无待处理举报</p><AdminPagination :page="page" :page-size="20" :total="total" @change="page = $event" /></div>
    <div v-else-if="tab === 'official'" class="community-admin-section"><p class="community-admin-note">认证与发布沿用统一用户和 RBAC。认证字段由服务端校验，学生不能自行申领教师或官方身份。</p><article v-for="user in officials" :key="user.id" class="community-admin-row"><div><strong>{{ user.displayName }}</strong><p>{{ user.username }} · {{ user.school }}</p><small>{{ user.verifiedType === 'none' ? '普通学习者' : user.verifiedType }}</small></div><button class="admin-secondary" @click="editOfficial(user)">管理认证</button></article><AdminPagination :page="page" :page-size="20" :total="total" @change="page = $event" /></div>
    <div v-else-if="tab === 'policy' && policy" class="community-admin-section"><div class="community-policy-heading"><div><span class="community-admin-status">当前生效</span><h2>{{ policy.version }}</h2><p>优先学习价值，不以停留时长作为唯一目标。</p></div></div><div class="community-policy-grid"><section><h3>候选来源与上限</h3><dl><template v-for="(limit, key) in policy.candidateLimits" :key="key"><dt>{{ key }}</dt><dd>{{ limit }} 条</dd></template></dl></section><section><h3>归一化打分维度</h3><dl><template v-for="(weight, key) in policy.weights" :key="key"><dt>{{ key }}</dt><dd>{{ (weight * 100).toFixed(1) }}%</dd></template></dl></section><section><h3>多样性约束</h3><p>每 {{ policy.diversity.authorWindowSize }} 条最多 {{ policy.diversity.maxSameAuthorInWindow }} 条同作者内容</p><p>连续同类型不超过 {{ policy.diversity.maxSameTypeConsecutive }} 条</p><p>每窗口最多 {{ policy.diversity.maxOfficialInWindow }} 条普通官方推荐</p><p>不可见内容统一过滤，失败退回可见时间流。</p></section></div><form class="admin-form community-policy-form" @submit.prevent="savePolicy"><h3>安全命名参数</h3><label>参数<select v-model="policyForm.parameter"><option value="learningWeight">学习相关权重</option><option value="qualityWeight">内容质量权重</option><option value="explorationWeight">探索权重</option><option value="limitedPenalty">限制展示惩罚</option></select></label><label>数值（0～40%，保存后权重重新归一化）<input v-model.number="policyForm.value" type="number" min="0" max="40" required /></label><label>调整理由<textarea v-model="policyForm.reason" required minlength="4" maxlength="500" rows="2" /></label><button class="admin-primary">保存策略参数</button></form></div>
    <AdminPagination v-if="tab === 'topics'" :page="page" :page-size="20" :total="total" @change="page = $event" />
  </section>
  <AdminDialog v-model="postOpen" :title="editingPost ? '编辑社区内容' : '发布官方学习指导'"><form class="admin-form" @submit.prevent="savePost(false)"><label>标题<input v-model="postForm.title" maxlength="160" required /></label><label>正文<textarea v-model="postForm.text" minlength="5" maxlength="20000" rows="8" required /></label><p v-if="editingPost">关联学习内容、代码、图片与引用块保持不变。</p><label>操作理由<textarea v-model="postForm.reason" minlength="4" maxlength="500" required /></label><button :class="editingSnapshot?.status === 'draft' ? 'admin-secondary' : 'admin-primary'">确认{{ editingSnapshot?.status === 'draft' ? '保存草稿' : editingPost ? '保存' : '发布' }}</button><button v-if="editingSnapshot?.status === 'draft' && editingSnapshot.id.startsWith('community-lcz-')" type="button" class="admin-primary" @click="savePost(true)">确认发布</button></form></AdminDialog>
  <AdminDialog v-model="moderationOpen" title="记录社区处理决定"><form class="admin-form" @submit.prevent="handle"><label>操作<select v-model="moderation.action"><option v-if="target.type === 'report'" value="reject">驳回举报</option><option v-if="target.type !== 'comment'" value="limit">限制展示</option><option v-if="target.type !== 'comment'" value="label">添加说明标签</option><option value="hide">隐藏内容</option><option value="remove">软删除内容</option><option value="restore">恢复展示</option><option v-if="can('platform.manage')" value="disable_author">禁用作者</option></select></label><label v-if="moderation.action === 'label'">说明标签<input v-model="moderation.label" maxlength="60" required /></label><label>处理理由<textarea v-model="moderation.reason" required minlength="4" maxlength="500" rows="4" /></label><p>操作将保留审计记录；举报人身份不向作者公开。</p><p v-if="error" class="error-banner" role="alert">{{ error }}</p><button class="admin-primary" :disabled="loading">确认处理</button></form></AdminDialog>
  <AdminDialog v-model="topicOpen" :title="topicId ? '编辑学习话题' : '创建学习话题'"><form class="admin-form" @submit.prevent="saveTopic"><label>稳定标识<input v-model="topicForm.slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></label><label>名称<input v-model="topicForm.name" required maxlength="60" /></label><label>说明<textarea v-model="topicForm.description" maxlength="500" /></label><label>关联学习主题 ID（选填）<input v-model="topicForm.themeId" /></label><label>色彩<select v-model="topicForm.accent"><option v-for="color in ['purple', 'green', 'blue', 'yellow', 'teal', 'orange']" :key="color">{{ color }}</option></select></label><label>状态<select v-model="topicForm.status"><option value="active">开放</option><option value="closed">关闭</option></select></label><label><input v-model="topicForm.recommended" type="checkbox" />推荐话题</label><label>排序<input v-model.number="topicForm.sortOrder" type="number" min="0" max="9999" /></label><label>操作理由<textarea v-model="topicForm.reason" required minlength="4" maxlength="500" /></label><button class="admin-primary">保存话题</button></form></AdminDialog>
  <AdminDialog v-model="officialOpen" title="管理统一用户认证"><form class="admin-form" @submit.prevent="saveOfficial"><label>认证身份<select v-model="officialForm.verifiedType"><option value="none">普通学习者</option><option value="teacher">认证教师</option><option value="mentor">学习导师</option><option value="official">官方账号</option></select></label><label>专业话题 ID（逗号分隔）<input v-model="officialForm.expertise" /></label><label>认证理由<textarea v-model="officialForm.reason" required minlength="4" maxlength="500" /></label><button class="admin-primary">保存认证与角色</button></form></AdminDialog>
</div></template>
