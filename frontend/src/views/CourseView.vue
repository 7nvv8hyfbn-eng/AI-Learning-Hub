<script setup lang="ts">
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import FollowButton from '../components/base/FollowButton.vue'
import type { CourseDetailDto } from '@ai-learning-hub/contracts'
import { storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
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
import { safeCoverUrl } from '../media/catalog'

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
const currentLesson = ref(Math.max(1, Number(route.query.lesson) || 1))
const lessonContent = ref<HTMLElement | null>(null)
const expanded = ref(true)
const copyMessage = ref('复制代码')
const followed = ref(false)
const noteOpen = ref(false)
const noteDraft = ref(store.notes[courseId.value] || '')
const courseDetail = ref<CourseDetailDto | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const liked = ref(false)
const questionSent = ref(false)
const apiLessons = computed(() => courseDetail.value?.chapters.flatMap((chapter) => chapter.lessons) || [])
const displayLessons = computed(() => apiLessons.value.map((lesson) => lesson.title))
const currentApiLesson = computed(() => apiLessons.value[currentLesson.value - 1])
const nextLesson = computed(() => apiLessons.value[currentLesson.value])
const lessonChapters = computed(() => {
  let number = 0
  return (courseDetail.value?.chapters || []).map((chapter) => ({ ...chapter, lessons: chapter.lessons.map((lesson) => ({ ...lesson, number: ++number })) }))
})
const noteKey = computed(() => currentApiLesson.value ? `${courseId.value}:${currentApiLesson.value.id}` : courseId.value)
const chapterCount = computed(() => courseDetail.value?.chapters.length || 0)
const accountDataReady = computed(() => dataMode === 'mock' || store.accountSyncState === 'synced')
const accountDataMessage = computed(() => {
  if (!auth.user) return '登录后查看课程进度。'
  return store.accountSyncState === 'sync-error' ? '账号课程进度暂不可用。' : '正在同步账号课程进度…'
})
const startLearning = async (next = false) => {
  if (!ensureAuth('登录后可开始课程并记录学习进度', () => startLearning(next))) return
  try {
    if (dataMode === 'api') await behaviorApi.enroll(courseId.value)
    if (next) currentLesson.value++
    else lessonContent.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  catch (error) { window.dispatchEvent(new CustomEvent('api-error', { detail: { message: error instanceof Error ? error.message : '暂时无法开始课程' } })) }
}
const copyCode = async (code: unknown) => {
  try {
    await navigator.clipboard.writeText(String(code || ''))
    copyMessage.value = '已复制'
  } catch {
    copyMessage.value = '复制失败，请手动选择代码'
  }
  window.setTimeout(() => { copyMessage.value = '复制代码' }, 1800)
}
const saveNote = async () => {
  if (await store.saveNote(courseId.value, noteDraft.value, currentApiLesson.value?.id)) noteOpen.value = false
}
const shareNote = () => { if (!ensureAuth('登录后可主动分享学习笔记', shareNote)) return; useCommunityStore().openComposer({ type: 'note', title: `${course.value?.title || '课程'}学习笔记`, contentBlocks: [{ type: 'paragraph', text: store.notes[noteKey.value] || noteDraft.value }], bindings: [{ type: 'course', id: courseId.value }, ...(currentApiLesson.value ? [{ type: 'lesson' as const, id: currentApiLesson.value.id }] : [])] }) }
const completeCurrentLesson = () => {
  const lessonId = dataMode === 'api' ? currentApiLesson.value?.id : currentLesson.value
  if (lessonId) void store.completeCourseStep(courseId.value, lessonId, displayLessons.value.length)
}
const recommendations = computed(() => courses.value.filter((item) => item.id !== courseId.value).slice(0, 4))
watch(currentLesson, async (lesson) => {
  await router.replace({ query: { ...route.query, lesson: String(lesson) } })
  await nextTick()
  if (!detailLoading.value) lessonContent.value?.scrollIntoView({ block: 'start' })
})
watch(noteKey, (key) => { noteDraft.value = store.notes[key] || '' })
watch(courseId, async () => {
  currentLesson.value = Math.max(1, Number(route.query.lesson) || 1)
  noteDraft.value = store.notes[noteKey.value] || ''
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
  <NotFoundState v-if="!course" title="没有找到这门课程" description="未知 courseId 不会回退到其他课程，请返回通识基础重新选择。" back-to="/topics" back-label="返回通识基础" />
  <div v-else class="page-container">
    <section class="course-hero">
      <div class="hero-copy"><span class="tag purple">{{ course.category }}</span><h1>{{ course.title }}</h1><p>{{ course.description }}</p><div class="meta"><span>{{ course.level }}</span><span>{{ chapterCount }} 章 · {{ displayLessons.length }} 节</span><span>{{ course.learners === undefined ? '学习人数 —' : `${course.learners.toLocaleString()} 人学习` }}</span><span>{{ courseDetail?.data.rating ? `${courseDetail.data.rating} 分` : '评分 —' }}</span></div><div class="teacher"><CommunityAvatar :name="courseDetail?.data.instructor?.name || '讲师'" :avatar-key="dataMode === 'mock' ? 'official-teacher' : undefined" /><div><strong>{{ courseDetail?.data.instructor?.name || (dataMode === 'api' ? '讲师待配置' : '林知远老师') }}</strong><small>{{ courseDetail?.data.instructor?.title || (dataMode === 'api' ? '信息待配置' : '高校 AI 应用课程讲师') }}</small></div><FollowButton v-if="dataMode === 'mock'" :active="followed" @click="followed = !followed" /></div></div>
      <CategoryCover :title="course.title" :media="course" eager />
    </section>
    <RouterLink class="text-link" :to="`/community/search?bindingId=${courseId}`">查看课程相关讨论 <AppIcon name="arrow-up-right" :size="14" /></RouterLink>
    <div class="learning-layout">
      <aside class="outline-panel sticky">
        <button class="outline-title" type="button" @click="expanded = !expanded"><strong>课程大纲</strong><span>{{ expanded ? '收起' : '展开' }}</span></button>
        <div v-if="expanded && displayLessons.length" class="lesson-list">
          <section v-for="chapter in lessonChapters" :key="chapter.id" class="lesson-chapter">
            <h3>{{ chapter.title }}</h3>
            <button v-for="lesson in chapter.lessons" :key="lesson.id" type="button" :class="{ active: lesson.number === currentLesson }" :aria-current="lesson.number === currentLesson ? 'step' : undefined" @click="currentLesson = lesson.number"><span>{{ String(lesson.number).padStart(2, '0') }}</span>{{ lesson.title }}</button>
          </section>
        </div>
        <p v-else-if="expanded">课程尚未发布结构化课时。</p>
        <div v-if="courseDetail?.data.certificate" class="certificate-card">完成全部课程可获得<br /><strong>{{ courseDetail.data.certificate }}</strong></div>
      </aside>
      <article ref="lessonContent" class="lesson-content">
        <div class="lesson-nav"><button type="button" :disabled="currentLesson === 1" @click="currentLesson--"><AppIcon name="arrow-left" :size="16" />上一节</button><strong>第 {{ currentLesson }} 节</strong><button type="button" :disabled="currentLesson === displayLessons.length || !displayLessons.length" @click="currentLesson++">下一节<AppIcon name="arrow-right" :size="16" /></button></div>
        <div v-if="detailLoading" class="notice">正在读取已发布课程内容…</div>
        <div v-else-if="detailError" class="notice error">{{ detailError }}，未回退到演示内容。</div>
        <template v-else>
          <div v-if="currentApiLesson" class="lesson-blocks">
            <h2>{{ currentApiLesson.title }}</h2>
            <template v-for="block in currentApiLesson.blocks" :key="block.id">
              <h2 v-if="block.blockType === 'heading'">{{ block.content.text }}</h2>
              <p v-else-if="block.blockType === 'paragraph'">{{ block.content.text }}</p>
              <figure v-else-if="block.blockType === 'image'" class="lesson-figure">
                <img v-if="safeCoverUrl(block.content.url)" :src="safeCoverUrl(block.content.url)" :alt="String(block.content.alt || '')" :width="Number(block.content.width) || undefined" :height="Number(block.content.height) || undefined" loading="lazy" decoding="async" />
                <p v-else class="notice">{{ block.content.alt || '课程图片暂不可用' }}</p>
                <figcaption v-if="block.content.caption">{{ block.content.caption }}</figcaption>
              </figure>
              <aside v-else-if="block.blockType === 'key_points'" class="lesson-takeaway"><strong>记住这一点</strong><ul><li v-for="point in block.content.items || []" :key="point">{{ point }}</li></ul></aside>
              <section v-else-if="block.blockType === 'code'" class="code-card"><div><span>{{ block.content.language || 'text' }}</span><button type="button" @click="copyCode(block.content.code)">{{ copyMessage }}</button></div><pre><code>{{ block.content.code }}</code></pre></section>
              <div v-else-if="block.blockType === 'diagram'" class="concept-diagram"><template v-for="(node, index) in block.content.nodes || []" :key="node"><AppIcon v-if="index" name="arrow-right" :size="17" /><div>{{ node }}</div></template></div>
              <section v-else-if="block.blockType === 'quiz'" class="quiz-card"><span class="eyebrow">动手想一想</span><h3>{{ block.content.question }}</h3><details><summary>对照参考思路</summary><p>{{ block.content.answer }}</p></details></section>
              <a v-else-if="block.blockType === 'resource' && String(block.content.sourceUrl || '').startsWith('https://') && safeCoverUrl(block.content.sourceUrl)" class="lesson-resource-link" :href="safeCoverUrl(block.content.sourceUrl)" target="_blank" rel="noopener noreferrer"><AppIcon name="file" />{{ block.content.title }}<AppIcon name="arrow-up-right" :size="16" /></a>
              <RouterLink v-else-if="block.blockType === 'resource'" class="lesson-resource-link" :to="String(block.content.route || '/resources')"><AppIcon name="file" />{{ block.content.title || '配套学习资料' }}<AppIcon name="arrow-right" :size="16" /></RouterLink>
              <section v-else-if="block.blockType === 'next_lesson'" class="next-lesson-card"><span>下一节</span><strong>{{ block.content.title }}</strong></section>
              <div v-else class="notice">暂不支持的课程内容块：{{ block.blockType }}</div>
            </template>
          </div>
          <div v-else class="inline-empty"><p>该课程暂无已发布课时内容。</p></div>
        </template>
        <div class="lesson-actions"><button type="button" @click="noteOpen = true">记录笔记</button><template v-if="dataMode === 'mock'"><button type="button" @click="questionSent = !questionSent">{{ questionSent ? '问题已记录' : '向老师提问' }}</button><button type="button" :class="{ active: liked }" @click="liked = !liked">{{ liked ? '已点赞' : '点赞本节' }}</button></template></div>
        <aside class="course-progress"><ProgressBar v-if="accountDataReady" :value="store.courseProgress[course.id] ?? course.progress ?? 0" label="学习进度" /><p v-else class="notice">{{ accountDataMessage }}</p><strong>当前第 {{ currentLesson }} / {{ displayLessons.length }} 课时</strong><button class="button primary full-width" type="button" :disabled="!displayLessons.length" @click="startLearning()">{{ store.courseProgress[course.id] ? '继续学习' : '开始学习' }}</button><button class="button secondary full-width" type="button" :disabled="!displayLessons.length" @click="completeCurrentLesson">完成本节</button><button class="button secondary full-width" type="button" @click="store.toggleFavorite('course', course.id)">{{ store.isFavorite('course', course.id) ? '已收藏' : '收藏课程' }}</button></aside>
      </article>
      <aside class="lesson-aside sticky">
        <section><div class="panel-title"><strong>我的笔记</strong><button type="button" @click="noteOpen = true">编辑</button></div><p>{{ store.notes[noteKey] || '还没有笔记，记录一个关键想法吧。' }}</p><button class="text-link" type="button" :disabled="!store.notes[noteKey]" @click="shareNote">发布为学习笔记</button><small class="muted">仅在预览并确认后公开。</small></section>
        <section><h3>相关资料</h3><RouterLink v-for="resource in courseDetail?.relatedResources || []" :key="resource.slug" :to="{ path: '/resources', query: { preview: resource.slug } }">{{ resource.title }}</RouterLink><p v-if="!courseDetail?.relatedResources.length">本课程的参考来源列在最后一节。</p></section>
        <section><h3>学习进度</h3><template v-if="accountDataReady"><ProgressBar :value="store.courseProgress[course.id] || 0" /><small>完成本节会同步更新课程进度。</small></template><p v-else class="notice">{{ accountDataMessage }}</p></section>
        <section><h3>学习成就</h3><div v-if="dataMode === 'mock'" class="mini-achievements"><span><AppIcon name="layers" />模型入门</span><span><AppIcon name="check" />连续学习</span><span><AppIcon name="trophy" />小测达人</span></div><p v-else>课程成就规则尚未配置。</p></section>
        <section><h3>下一节预告</h3><strong>{{ nextLesson?.title || '已到最后一节' }}</strong><p v-if="nextLesson">预计 {{ nextLesson.durationMinutes }} 分钟</p><button class="button primary full-width" type="button" :disabled="currentLesson === displayLessons.length || !displayLessons.length" @click="startLearning(true)">继续下一节</button></section>
      </aside>
    </div>
    <section><div class="section-heading"><h2>相关推荐课程</h2></div><div v-if="dataMode === 'mock'" class="four-grid"><CourseCard v-for="item in recommendations" :key="item.id" :course="item" compact /></div><p v-else>相关推荐尚未配置。</p></section>
  </div>
  <AppDialog v-model="noteOpen" title="本节学习笔记"><form class="dialog-form" @submit.prevent="saveNote"><textarea v-model="noteDraft" rows="7" placeholder="记录关键概念和待解决的问题…" autofocus /><button class="button primary" type="submit">{{ dataMode === 'api' ? '保存到学习账号' : '保存到本地' }}</button></form></AppDialog>
</template>
