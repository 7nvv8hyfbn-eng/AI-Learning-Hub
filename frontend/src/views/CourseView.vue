<script setup lang="ts">
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import FollowButton from '../components/base/FollowButton.vue'
import type { CourseDetailDto } from '@ai-learning-hub/contracts'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CourseCard from '../components/CourseCard.vue'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import NotFoundState from '../components/NotFoundState.vue'
import ProgressBar from '../components/ProgressBar.vue'
import CategoryCover from '../components/base/CategoryCover.vue'
import { dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
import { mapCourse, useCoursesStore } from '../stores/content/courses'
import { useLearningStore } from '../stores/learning'
import { useCommunityStore } from '../stores/community'
import { ensureAuth } from '../composables/useRequireAuth'
import { behaviorApi } from '../services/api/behavior'

const route = useRoute()
const router = useRouter()
const store = useLearningStore()
const auth = useAuthStore()
const courseStore = useCoursesStore()
const { items: courses } = storeToRefs(courseStore)
const course = computed(() => {
  const listed = courses.value.find((item) => item.id === route.params.courseId)
  if (listed || courseStore.selected?.slug !== route.params.courseId) return listed
  return mapCourse(courseStore.selected)
})
const courseId = computed(() => String(route.params.courseId))
const currentLesson = ref(Math.min(5, Math.max(1, Number(route.query.lesson) || 2)))
const expanded = ref(true)
const selectedAnswer = ref('')
const submitted = ref(false)
const copyMessage = ref('复制代码')
const followed = ref(false)
const noteOpen = ref(false)
const noteDraft = ref(store.notes[courseId.value] || '')
const courseDetail = ref<CourseDetailDto | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const videoMessage = ref('12:40 · 课程演示视频')
const liked = ref(false)
const questionSent = ref(false)
const lessons = ['AI 与语言模型', 'Transformer 核心结构', '训练与微调', '推理与应用', '安全与伦理']
const apiLessons = computed(() => courseDetail.value?.chapters.flatMap((chapter) => chapter.lessons) || [])
const displayLessons = computed(() => dataMode === 'api' ? apiLessons.value.map((lesson) => lesson.title) : lessons)
const currentApiLesson = computed(() => apiLessons.value[currentLesson.value - 1])
const noteKey = computed(() => currentApiLesson.value ? `${courseId.value}:${currentApiLesson.value.id}` : courseId.value)
const chapterCount = computed(() => dataMode === 'api' ? (courseDetail.value?.chapters.length || 0) : 5)
const accountDataReady = computed(() => dataMode === 'mock' || store.accountSyncState === 'synced')
const accountDataMessage = computed(() => {
  if (!auth.user) return '登录后查看课程进度。'
  return store.accountSyncState === 'sync-error' ? '账号课程进度暂不可用。' : '正在同步账号课程进度…'
})
const code = `from transformers import pipeline\n\nassistant = pipeline("text-generation")\nresult = assistant("解释注意力机制：", max_new_tokens=80)\nprint(result[0]["generated_text"])`

const submitQuiz = () => {
  if (!ensureAuth('登录后可参与课程知识小测', submitQuiz)) return
  if (selectedAnswer.value) submitted.value = true
}
const startLearning = async (next = false) => {
  if (!ensureAuth('登录后可开始课程并记录学习进度', () => startLearning(next))) return
  try { if (dataMode === 'api') await behaviorApi.enroll(courseId.value); if (next) currentLesson.value++; document.querySelector('.lesson-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  catch (error) { window.dispatchEvent(new CustomEvent('api-error', { detail: { message: error instanceof Error ? error.message : '暂时无法开始课程' } })) }
}
const copyCode = async () => {
  try {
    await navigator.clipboard.writeText(code)
    copyMessage.value = '已复制'
  } catch {
    copyMessage.value = '复制失败，请手动选择代码'
  }
  window.setTimeout(() => { copyMessage.value = '复制代码' }, 1800)
}
const saveNote = async () => {
  if (await store.saveNote(courseId.value, noteDraft.value, dataMode === 'api' ? currentApiLesson.value?.id : undefined)) noteOpen.value = false
}
const shareNote = () => { if (!ensureAuth('登录后可主动分享学习笔记', shareNote)) return; useCommunityStore().openComposer({ type: 'note', title: `${course.value?.title || '课程'}学习笔记`, contentBlocks: [{ type: 'paragraph', text: store.notes[noteKey.value] || noteDraft.value }], bindings: [{ type: 'course', id: courseId.value }, ...(currentApiLesson.value ? [{ type: 'lesson' as const, id: currentApiLesson.value.id }] : [])] }) }
const completeCurrentLesson = () => {
  const lessonId = dataMode === 'api' ? currentApiLesson.value?.id : currentLesson.value
  if (lessonId) void store.completeCourseStep(courseId.value, lessonId, displayLessons.value.length)
}
const recommendations = computed(() => courses.value.filter((item) => item.id !== courseId.value).slice(0, 4))
watch(currentLesson, (lesson) => {
  router.replace({ query: { ...route.query, lesson: String(lesson) } })
  noteDraft.value = store.notes[noteKey.value] || ''
})
watch(courseId, async () => {
  currentLesson.value = Math.min(5, Math.max(1, Number(route.query.lesson) || 1))
  noteDraft.value = store.notes[noteKey.value] || ''
  if (dataMode !== 'api') {
    await courseStore.load()
    return
  }
  detailLoading.value = true
  detailError.value = ''
  courseDetail.value = null
  try {
    await courseStore.load()
    courseDetail.value = await courseStore.detail(courseId.value)
    currentLesson.value = Math.min(Math.max(1, currentLesson.value), Math.max(1, apiLessons.value.length))
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : '课程详情加载失败'
  } finally {
    detailLoading.value = false
  }
}, { immediate: true })
</script>

<template>
  <NotFoundState v-if="!course" title="没有找到这门课程" description="未知 courseId 不会回退到其他课程，请返回学习主题重新选择。" back-to="/topics" back-label="返回学习主题" />
  <div v-else class="page-container">
    <section class="course-hero">
      <div class="hero-copy"><span class="tag purple">{{ course.category }}</span><h1>{{ course.title }}</h1><p>{{ course.description }}{{ dataMode === 'mock' ? ' 从核心概念出发，逐步走向受控实践。' : '' }}</p><div class="meta"><span>{{ course.level }}</span><span>{{ chapterCount }} 章 · {{ displayLessons.length }} 节</span><span>{{ course.learners === undefined ? '学习人数 —' : `${course.learners.toLocaleString()} 人学习` }}</span><span>{{ dataMode === 'api' ? (courseDetail?.data.rating ? `${courseDetail.data.rating} 分` : '评分 —') : '4.9 分' }}</span></div><div class="teacher"><CommunityAvatar :name="courseDetail?.data.instructor?.name || '讲师'" :avatar-key="dataMode === 'mock' ? 'official-teacher' : undefined" /><div><strong>{{ courseDetail?.data.instructor?.name || (dataMode === 'api' ? '讲师待配置' : '林知远老师') }}</strong><small>{{ courseDetail?.data.instructor?.title || (dataMode === 'api' ? '信息待配置' : '高校 AI 应用课程讲师') }}</small></div><FollowButton v-if="dataMode === 'mock'" :active="followed" @click="followed = !followed" /></div></div>
      <CategoryCover :title="course.title" :media="course" eager />
      <aside class="hero-progress"><ProgressBar v-if="accountDataReady" :value="store.courseProgress[course.id] ?? course.progress ?? 0" label="学习进度" /><p v-else class="notice">{{ accountDataMessage }}</p><strong>当前第 {{ currentLesson }} / {{ displayLessons.length }} 课时</strong><button class="button primary full-width" type="button" :disabled="!displayLessons.length" @click="startLearning()">{{ store.courseProgress[course.id] ? '继续学习' : '开始学习' }}</button><button class="button secondary full-width" type="button" :disabled="!displayLessons.length" @click="completeCurrentLesson">完成本节</button><button class="button secondary full-width" type="button" @click="store.toggleFavorite('course', course.id)">{{ store.isFavorite('course', course.id) ? '已收藏' : '收藏课程' }}</button></aside>
    </section>
    <RouterLink class="text-link" :to="`/community/search?bindingId=${courseId}`">查看课程相关讨论 <AppIcon name="arrow-up-right" :size="14" /></RouterLink>
    <div class="learning-layout">
      <aside class="outline-panel sticky">
        <button class="outline-title" type="button" @click="expanded = !expanded"><strong>课程大纲</strong><span>{{ expanded ? '收起' : '展开' }}</span></button>
        <div v-if="expanded && displayLessons.length" class="lesson-list"><button v-for="(lesson, index) in displayLessons" :key="lesson" type="button" :class="{ done: index < currentLesson - 1, active: index === currentLesson - 1 }" @click="currentLesson = index + 1"><span><AppIcon v-if="index < currentLesson - 1" name="check" :size="15" /><template v-else>{{ String(index + 1).padStart(2, '0') }}</template></span>{{ lesson }}</button></div>
        <p v-else-if="expanded && dataMode === 'api'">课程尚未发布结构化课时。</p>
        <div class="certificate-card">完成全部课程可获得<br /><strong>{{ courseDetail?.data.certificate || (dataMode === 'api' ? '证书待配置' : '大模型基础证书') }}</strong></div>
      </aside>
      <article class="lesson-content">
        <div class="lesson-nav"><button type="button" :disabled="currentLesson === 1" @click="currentLesson--"><AppIcon name="arrow-left" :size="16" />上一节</button><strong>第 {{ currentLesson }} 节</strong><button type="button" :disabled="currentLesson === displayLessons.length || !displayLessons.length" @click="currentLesson++">下一节<AppIcon name="arrow-right" :size="16" /></button></div>
        <div v-if="detailLoading" class="notice">正在读取已发布课程内容…</div>
        <div v-else-if="detailError" class="notice error">{{ detailError }}，未回退到演示内容。</div>
        <template v-else-if="dataMode === 'api'">
          <div v-if="currentApiLesson">
            <span class="eyebrow">结构化课时</span>
            <h2>{{ currentApiLesson.title }}</h2>
            <p>{{ currentApiLesson.summary }}</p>
            <template v-for="block in currentApiLesson.blocks" :key="block.id">
              <h2 v-if="block.blockType === 'heading'">{{ block.content.text }}</h2>
              <p v-else-if="block.blockType === 'paragraph'">{{ block.content.text }}</p>
              <div v-else-if="block.blockType === 'key_points'" class="key-grid"><article v-for="point in block.content.items || []" :key="point"><strong>{{ point }}</strong></article></div>
              <section v-else-if="block.blockType === 'code'" class="code-card"><div><span>{{ block.content.language || 'text' }}</span></div><pre><code>{{ block.content.code }}</code></pre></section>
              <div v-else-if="block.blockType === 'diagram'" class="concept-diagram"><template v-for="(node, index) in block.content.nodes || []" :key="node"><AppIcon v-if="index" name="arrow-right" :size="17" /><div>{{ node }}</div></template></div>
              <section v-else-if="block.blockType === 'quiz'" class="quiz-card"><span class="eyebrow">知识小测</span><h3>{{ block.content.question }}</h3><p>{{ block.content.answer }}</p></section>
              <RouterLink v-else-if="block.blockType === 'resource'" class="lesson-resource-link" :to="String(block.content.route || '/resources')"><AppIcon name="file" />{{ block.content.title || '配套学习资料' }}<AppIcon name="arrow-right" :size="16" /></RouterLink>
              <section v-else-if="block.blockType === 'next_lesson'" class="next-lesson-card"><span>下一节</span><strong>{{ block.content.title }}</strong></section>
              <div v-else class="notice">暂不支持的课程内容块：{{ block.blockType }}</div>
            </template>
          </div>
          <div v-else class="inline-empty"><p>该课程暂无已发布课时内容。</p></div>
        </template>
        <template v-else>
        <span class="eyebrow">核心概念</span><h2>{{ lessons[currentLesson - 1] }}</h2><p>Transformer 通过注意力机制理解序列中不同位置之间的关系。与逐步处理的传统结构相比，它能并行处理信息，并在大规模数据上形成更稳定的表示能力。</p>
        <div class="concept-diagram"><div>输入序列</div><AppIcon name="arrow-right" :size="17" /><div>注意力</div><AppIcon name="arrow-right" :size="17" /><div>前馈网络</div><AppIcon name="arrow-right" :size="17" /><div>上下文表示</div></div>
        <div class="video-placeholder"><CategoryCover :title="course.title" :media="course" /><button type="button" aria-label="播放演示视频" @click="videoMessage = '暂无真实视频，当前为课程封面预览'">{{ videoMessage }}</button></div>
        <section class="code-card"><div><span>Python</span><button type="button" @click="copyCode">{{ copyMessage }}</button></div><pre><code>{{ code }}</code></pre></section>
        <div class="key-grid"><article><strong>并行计算</strong><p>减少序列处理的依赖。</p></article><article><strong>上下文关联</strong><p>学习远距离信息关系。</p></article><article><strong>规模扩展</strong><p>支持更大数据与模型。</p></article></div>
        <section class="quiz-card"><span class="eyebrow">知识小测</span><h3>注意力机制主要解决什么问题？</h3><label v-for="answer in ['捕捉序列中不同位置的关联', '直接连接真实服务器', '替代所有数据清洗']" :key="answer" :class="{ selected: selectedAnswer === answer }"><input v-model="selectedAnswer" type="radio" name="answer" :value="answer" />{{ answer }}</label><button class="button primary" type="button" :disabled="!selectedAnswer || submitted" @click="submitQuiz">{{ submitted ? '已提交' : '提交答案' }}</button><p v-if="submitted" :class="selectedAnswer.startsWith('捕捉') ? 'answer-correct' : 'answer-wrong'"><strong>本题得分：{{ selectedAnswer.startsWith('捕捉') ? 100 : 0 }}</strong><br />{{ selectedAnswer.startsWith('捕捉') ? '回答正确。注意力会计算不同位置之间的相关程度。' : '回答不正确。请回顾“上下文关联”部分。' }}</p></section>
        </template>
        <div class="lesson-actions"><button type="button" @click="noteOpen = true">记录笔记</button><template v-if="dataMode === 'mock'"><button type="button" @click="questionSent = !questionSent">{{ questionSent ? '问题已记录' : '向老师提问' }}</button><button type="button" :class="{ active: liked }" @click="liked = !liked">{{ liked ? '已点赞' : '点赞本节' }}</button></template></div>
      </article>
      <aside class="lesson-aside sticky">
        <section><div class="panel-title"><strong>我的笔记</strong><button type="button" @click="noteOpen = true">编辑</button></div><p>{{ store.notes[noteKey] || '还没有笔记，记录一个关键想法吧。' }}</p><button class="text-link" type="button" :disabled="!store.notes[noteKey]" @click="shareNote">发布为学习笔记</button><small class="muted">仅在预览并确认后公开。</small></section>
        <section><h3>相关资料</h3><template v-if="dataMode === 'api'"><RouterLink v-for="resource in courseDetail?.relatedResources || []" :key="resource.slug" :to="{ path: '/resources', query: { preview: resource.slug } }">{{ resource.title }}</RouterLink><p v-if="!courseDetail?.relatedResources.length">尚未关联已发布资源。</p></template><template v-else><RouterLink to="/resources">Transformer 图解 · PDF</RouterLink><RouterLink to="/resources">注意力机制学习手册</RouterLink><RouterLink to="/resources">课程视频索引 · 视频</RouterLink><RouterLink to="/resources">示例代码仓库 · GitHub</RouterLink></template></section>
        <section><h3>学习进度</h3><template v-if="accountDataReady"><ProgressBar :value="store.courseProgress[course.id] || 0" /><small>完成本节会同步更新课程进度。</small></template><p v-else class="notice">{{ accountDataMessage }}</p></section>
        <section><h3>学习成就</h3><div v-if="dataMode === 'mock'" class="mini-achievements"><span><AppIcon name="layers" />模型入门</span><span><AppIcon name="check" />连续学习</span><span><AppIcon name="trophy" />小测达人</span></div><p v-else>课程成就规则尚未配置。</p></section>
        <section><h3>下一节预告</h3><strong>{{ displayLessons[Math.min(currentLesson, displayLessons.length - 1)] || '暂无下一节' }}</strong><p v-if="currentApiLesson">预计 {{ currentApiLesson.durationMinutes }} 分钟</p><button class="button primary full-width" type="button" :disabled="currentLesson === displayLessons.length || !displayLessons.length" @click="startLearning(true)">继续下一节</button></section>
      </aside>
    </div>
    <section><div class="section-heading"><h2>相关推荐课程</h2></div><div v-if="dataMode === 'mock'" class="four-grid"><CourseCard v-for="item in recommendations" :key="item.id" :course="item" compact /></div><p v-else>相关推荐尚未配置。</p></section>
  </div>
  <AppDialog v-model="noteOpen" title="本节学习笔记"><form class="dialog-form" @submit.prevent="saveNote"><textarea v-model="noteDraft" rows="7" placeholder="记录关键概念和待解决的问题…" autofocus /><button class="button primary" type="submit">{{ dataMode === 'api' ? '保存到学习账号' : '保存到本地' }}</button></form></AppDialog>
</template>
