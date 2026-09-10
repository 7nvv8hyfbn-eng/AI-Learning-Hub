import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import type { CommunityBindingInput, CommunityContentBlock, CommunityDraftDto, CommunityPostInput, CommunityTopicDto, LearningContentType } from '@ai-learning-hub/contracts'
import { useCommunityStore } from '../../stores/community'
import { useAuthStore } from '../../stores/auth'
import { communityApi } from '../../services/api/community'
import { useCoursesStore } from '../../stores/content/courses'
import { useLabsStore } from '../../stores/content/labs'
import { useArticlesStore } from '../../stores/content/articles'
import { useResourcesStore } from '../../stores/content/resources'
import { useThemesStore } from '../../stores/content/themes'
import { useChallengesStore } from '../../stores/content/challenges'
import { ApiError } from '../../services/api/client'
import { randomId } from '../../services/api/random-id'
import { validateImageFile } from '../imageEditing'
export type PendingCommunityImage = { id: string; file?: File; fileId?: string; alt: string; position: number; total: number; prepared?: { file: File; key: string } }
export const useCommunityDraft = defineStore('community-draft', () => {
  const store = useCommunityStore(), auth = useAuthStore()
  const form = ref<CommunityPostInput>({ type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', portalConsent: false, status: 'published' })
  const body = ref(''), code = ref(''), language = ref('text'), quote = ref(''), images = ref<Array<{ fileId: string; alt: string }>>([])
  const richBlocks = ref<CommunityContentBlock[] | null>(null)
  const richError = ref('')
  const topics = ref<CommunityTopicDto[]>([]), bindingType = ref<LearningContentType>('course'), bindingId = ref(''), bindingSearch = ref(''), bindingTitles = ref<Record<string, string>>({})
  const preview = ref(false), saving = ref(false), bindingLoading = ref(false), topicsLoading = ref(false), error = ref(''), savedAt = ref(''), closePrompt = ref(false), dirty = ref(false), draftId = ref<string>()
  const conflict = ref(false), draftUnavailable = ref(false)
  let requestKey = '', requestBody = ''
  let editorSession = 0
  const pendingUploads = ref(0), uploadCancels = new Set<() => void>()
  const registerUpload = (cancel: () => void) => {
    uploadCancels.add(cancel); pendingUploads.value = uploadCancels.size
    return () => { uploadCancels.delete(cancel); pendingUploads.value = uploadCancels.size }
  }
  const cancelUploads = () => { imageRequest?.abort(); imageRequest = undefined; imageUploading.value = false; for (const cancel of uploadCancels) cancel(); uploadCancels.clear(); pendingUploads.value = 0 }
  const imageQueue = shallowRef<PendingCommunityImage[]>([]), imageUploading = ref(false), imageNotice = ref('')
  const activeImage = computed(() => imageQueue.value[0]), pendingImages = computed(() => imageQueue.value.length)
  let imageRequest: AbortController | undefined
  const clearImageQueue = () => { imageRequest?.abort(); imageRequest = undefined; imageQueue.value = []; imageUploading.value = false }
  type UnconfirmedWrite = { input: CommunityPostInput; asDraft: boolean; id?: string; key: string }
  let unconfirmed: UnconfirmedWrite | undefined
  const sources = { course: useCoursesStore(), lab: useLabsStore(), article: useArticlesStore(), resource: useResourcesStore(), theme: useThemesStore(), challenge: useChallengesStore() }
  const source = computed(() => bindingType.value in sources ? sources[bindingType.value as keyof typeof sources] : null)
  const bindingOptions = computed(() => source.value?.items.map((item) => ({ id: 'slug' in item ? String(item.slug) : item.id, title: item.title })) || [])
  const advanced = computed(() => store.composerMode !== 'quick')
  const blocks = computed<CommunityContentBlock[]>(() => richBlocks.value ?? [...(body.value.trim() ? [{ type: 'paragraph' as const, text: body.value.trim() }] : []), ...(quote.value.trim() ? [{ type: 'quote' as const, text: quote.value.trim() }] : []), ...(code.value.trim() ? [{ type: 'code' as const, language: language.value, code: code.value }] : []), ...images.value.map((image) => ({ type: 'image' as const, ...image }))])
  const input = () => ({ ...form.value, contentBlocks: blocks.value })
  const hasContent = () => {
    const contribution = form.value.contribution
    return !!(blocks.value.some((block) => block.type === 'image' || (block.type === 'rich_text' ? block.text.replace(/<[^>]*>|&nbsp;/g, '') : block.type === 'list' ? block.items.join('') : block.type === 'code' ? block.code : block.text).trim()) || form.value.title?.trim() || form.value.bindings.length || form.value.topicIds.length || form.value.coverFileId || form.value.quotedPostId || contribution && (contribution.videoAssetId || contribution.attachmentFileId || contribution.coverFileId || contribution.categoryId || contribution.tags.length || contribution.sourceName?.trim() || contribution.sourceUrl?.trim() || contribution.teachingReuseConsent))
  }
  const hasWork = computed(() => hasContent() || !!pendingImages.value || !!pendingUploads.value || saving.value)
  const keyPrefix = () => `community-draft:${auth.dataMode}:${auth.user?.id || 'anonymous'}`
  let localSnapshotKey = ''
  const key = () => localSnapshotKey || `${keyPrefix()}:post`
  let timer: ReturnType<typeof setTimeout> | undefined, remoteTimer: ReturnType<typeof setTimeout> | undefined, hydrating = false
  let pending: Promise<boolean> | null = null, pendingAsDraft = false
  const loadOptions = async () => { bindingId.value = ''; if (!source.value) return; const owner = auth.user?.id, epoch = store.epoch, session = editorSession; bindingLoading.value = true; try { await source.value.load({ page: 1, pageSize: 30, keyword: bindingSearch.value }) } catch (cause) { if (owner === auth.user?.id && epoch === store.epoch && session === editorSession) error.value = cause instanceof Error ? cause.message : '学习内容读取失败' } finally { if (owner === auth.user?.id && epoch === store.epoch && session === editorSession) bindingLoading.value = false } }
  const loadTopics = async () => {
    if (topicsLoading.value || topics.value.length) return
    const owner = auth.user?.id, epoch = store.epoch, session = editorSession
    topicsLoading.value = true
    try { const rows = await communityApi.topics(); if (owner === auth.user?.id && epoch === store.epoch && session === editorSession) topics.value = rows }
    catch (cause) { if (owner === auth.user?.id && epoch === store.epoch && session === editorSession) error.value = cause instanceof Error ? cause.message : '话题读取失败' }
    finally { if (owner === auth.user?.id && epoch === store.epoch && session === editorSession) topicsLoading.value = false }
  }
  const hydrate = (value: CommunityPostInput) => {
    clearImageQueue(); imageNotice.value = ''
    hydrating = true
    form.value = JSON.parse(JSON.stringify(value)); preview.value = false; error.value = ''; savedAt.value = ''; dirty.value = false; conflict.value = false; draftUnavailable.value = false
    richError.value = ''
    richBlocks.value = value.coverFileId || value.contribution?.kind === 'article' || value.contentBlocks.some((block) => ['rich_text', 'heading', 'list'].includes(block.type)) ? JSON.parse(JSON.stringify(value.contentBlocks)) : null
    body.value = value.contentBlocks.filter((b) => b.type === 'paragraph').map((b) => b.text).join('\n\n')
    code.value = value.contentBlocks.filter((b) => b.type === 'code').map((b) => b.code).join('\n')
    quote.value = value.contentBlocks.filter((b) => b.type === 'quote').map((b) => b.text).join('\n')
    language.value = value.contentBlocks.find((b) => b.type === 'code')?.language || 'text'
    images.value = value.contentBlocks.filter((b) => b.type === 'image').map((b) => ({ fileId: b.fileId, alt: b.alt || '' }))
    queueMicrotask(() => { hydrating = false })
  }
  const restore = (row: CommunityDraftDto) => { store.openComposer(row.input, row.id, { intent: 'restore' }) }
  const localCopies = () => {
    const rows: Array<{ key: string; input: CommunityPostInput; updatedAt: string }> = []
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i)
      if (!name || (name !== keyPrefix() && !name.startsWith(keyPrefix() + ':'))) continue
      try { const row = JSON.parse(localStorage.getItem(name) || 'null'); if (Array.isArray(row?.input?.contentBlocks)) rows.push({ key: name, input: row.input, updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '' }) } catch { /* 损坏副本不影响服务器草稿。 */ }
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  const restoreLocal = (name: string) => {
    if (name !== keyPrefix() && !name.startsWith(keyPrefix() + ':')) return
    try { const row = JSON.parse(localStorage.getItem(name) || 'null'); if (row?.input) store.openComposer(row.input, row.editingId || row.id || undefined, { intent: 'restore', localKey: name }) } catch { error.value = '本地副本无法读取，请从服务器草稿恢复' }
  }
  watch(() => store.composerSession, async () => {
    editorSession++
    cancelUploads(); clearTimeout(timer); clearTimeout(remoteTimer)
    if (!store.composerOpen || !store.draft) return
    const epoch = store.epoch, owner = auth.user?.id, session = editorSession
    const current = () => epoch === store.epoch && owner === auth.user?.id && session === editorSession
    localSnapshotKey = store.composerLocalKey || `${keyPrefix()}:${store.editingId ? `edit:${store.editingId}` : store.draft.contribution?.kind || 'post'}`
    requestKey = ''; requestBody = ''; unconfirmed = undefined; pending = null; saving.value = false; closePrompt.value = false; bindingTitles.value = {}; bindingLoading.value = false; topicsLoading.value = false
    draftId.value = store.draft.status === 'draft' ? store.editingId : undefined
    let value = store.draft
    let lostImages = false
    if (store.composerIntent === 'restore' && store.composerLocalKey) {
      try { const local = JSON.parse(localStorage.getItem(key()) || 'null') as (CommunityDraftDto & { editingId?: string; requestKey?: string; requestBody?: string; unconfirmed?: UnconfirmedWrite; pendingImages?: boolean }) | null; if (local?.input) { value = local.input; lostImages = !!local.pendingImages; draftId.value = local.id || undefined; store.editingId = local.editingId; requestKey = local.requestKey || ''; requestBody = local.requestBody || ''; unconfirmed = local.unconfirmed } } catch { error.value = '本地草稿格式异常，可从草稿箱恢复' }
    }
    hydrate(value)
    if (lostImages) imageNotice.value = '上次尚未保存的本地图片无法恢复，请重新选择；文字和已上传图片已保留。'
    if (value !== store.draft) { savedAt.value = '尚未同步到服务器'; dirty.value = true }
    try {
      for (const binding of value.bindings) { const context = await communityApi.bindingContext(binding); if (!current()) return; bindingTitles.value[`${binding.type}:${binding.id}`] = context.binding.title; if (!form.value.topicIds.length) form.value.topicIds = context.topicIds }
    } catch (cause) { if (current()) error.value = cause instanceof Error ? cause.message : '学习上下文读取失败' }
  }, { flush: 'sync' })
  watch(() => store.composerOpen, (open) => { if (!open) { editorSession++; cancelUploads(); clearImageQueue(); clearTimeout(timer); clearTimeout(remoteTimer); saving.value = false; pending = null } }, { flush: 'sync' })
  watch(() => store.composerRequest, (request) => {
    if (!request) return
    clearTimeout(timer); clearTimeout(remoteTimer)
    if (hasWork.value) { store.composerInline = false; closePrompt.value = true }
    else store.applyComposerRequest(request)
  }, { flush: 'sync' })
  watch(bindingType, () => { bindingSearch.value = ''; bindingId.value = '' })
  const addBinding = async () => {
    if (!bindingId.value.trim() || form.value.bindings.length >= (advanced.value ? 8 : 1)) return
    const value: CommunityBindingInput = { type: bindingType.value, id: bindingId.value.trim() }
    const owner = auth.user?.id, epoch = store.epoch, session = editorSession
    try { const context = await communityApi.bindingContext(value); if (owner !== auth.user?.id || epoch !== store.epoch || session !== editorSession) return; bindingTitles.value[`${value.type}:${value.id}`] = context.binding.title; if (!form.value.bindings.some((b) => b.type === value.type && b.id === value.id)) form.value.bindings.push(value); if (!form.value.topicIds.length) form.value.topicIds = context.topicIds; bindingId.value = '' }
    catch (cause) { if (owner === auth.user?.id && epoch === store.epoch && session === editorSession) error.value = cause instanceof Error ? cause.message : '关联内容不可用' }
  }
  const uploadFiles = async (files: File[]) => {
    const uploadDecision = store.eligibility?.operations.upload
    if (uploadDecision && !uploadDecision.allowed) { error.value = uploadDecision.message || '当前不能上传文件'; localSave(); return }
    if (!auth.user || !store.composerOpen || !files.length) return
    if (saving.value) { error.value = '正在保存正文，请稍后再添加图片'; return }
    const remaining = 4 - images.value.length - imageQueue.value.filter((item) => !item.fileId).length
    if (files.length > remaining) { error.value = `最多 4 张图片，含待处理图片还可添加 ${remaining} 张；本次选择了 ${files.length} 张，请重新选择。`; return }
    try { files.forEach(validateImageFile) } catch (cause) { error.value = cause instanceof Error ? cause.message : '图片不可用'; return }
    imageQueue.value = [...imageQueue.value, ...files.map((file, index) => ({ id: randomId(), file, alt: '', position: index + 1, total: files.length }))]
    error.value = ''; imageNotice.value = ''; dirty.value = true; localSave()
  }
  const upload = async (event: Event) => { const target = event.target as HTMLInputElement, files = Array.from(target.files || []); target.value = ''; await uploadFiles(files) }
  const editImage = (fileId: string) => {
    if (saving.value || !auth.user || !store.composerOpen) return
    const decision = store.eligibility?.operations.upload
    if (decision && !decision.allowed) { error.value = decision.message || '当前不能上传文件'; return }
    const image = images.value.find((item) => item.fileId === fileId)
    if (!image || imageQueue.value.some((item) => item.fileId === fileId)) return
    imageQueue.value = [...imageQueue.value, { ...image, id: randomId(), position: 1, total: 1 }]
    dirty.value = true; localSave()
  }
  const cancelImage = (id: string) => {
    if (activeImage.value?.id === id) { imageRequest?.abort(); imageRequest = undefined; imageUploading.value = false }
    imageQueue.value = imageQueue.value.filter((item) => item.id !== id)
    localSave()
  }
  const removeImage = (fileId: string) => {
    imageQueue.value.filter((item) => item.fileId === fileId).forEach((item) => cancelImage(item.id))
    images.value = images.value.filter((image) => image.fileId !== fileId)
    if (richBlocks.value) richBlocks.value = richBlocks.value.filter((block) => block.type !== 'image' || block.fileId !== fileId)
  }
  const saveEditedImage = async (id: string, file: File, alt: string): Promise<boolean> => {
    const item = activeImage.value
    if (!item || item.id !== id || imageUploading.value) return false
    validateImageFile(file)
    if (alt.length > 200) throw new Error('图片说明最多 200 字')
    const epoch = store.epoch, owner = auth.user?.id, session = editorSession, controller = new AbortController()
    const current = () => owner === auth.user?.id && epoch === store.epoch && session === editorSession && store.composerOpen && activeImage.value?.id === id && !controller.signal.aborted
    if (item.prepared?.file !== file) item.prepared = { file, key: randomId() }
    imageRequest = controller; imageUploading.value = true
    try {
      const row = await communityApi.upload(file, { key: item.prepared!.key, signal: controller.signal })
      if (!current()) return false
      const value = { fileId: row.id, alt }
      if (item.fileId) {
        const index = images.value.findIndex((image) => image.fileId === item.fileId)
        if (index < 0) return false
        images.value.splice(index, 1, value)
        if (richBlocks.value) richBlocks.value = richBlocks.value.map((block) => block.type === 'image' && block.fileId === item.fileId ? { type: 'image', ...value } : block)
      } else {
        images.value.push(value)
        if (richBlocks.value) richBlocks.value.push({ type: 'image', ...value })
      }
      imageQueue.value = imageQueue.value.slice(1); dirty.value = true; error.value = ''; localSave()
      return true
    } catch (cause) { if (current()) throw cause; return false }
    finally { if (imageRequest === controller) { imageRequest = undefined; imageUploading.value = false } }
  }
  const clearLocal = () => { try { localStorage.removeItem(key()) } catch { /* 服务端保存不依赖浏览器存储。 */ } }
  const localSave = () => {
    try {
      localStorage.setItem(key(), JSON.stringify({ id: draftId.value || '', editingId: store.editingId, input: input(), updatedAt: new Date().toISOString(), requestKey, requestBody, unconfirmed, pendingImages: pendingImages.value > 0 }))
      savedAt.value = auth.dataMode === 'api' ? '尚未同步到服务器' : '本地演示草稿已保存'
    } catch { savedAt.value = '浏览器无法保存恢复副本，请同步到服务器' }
  }
  const preserveSession = () => {
    clearTimeout(timer); clearTimeout(remoteTimer)
    if (!auth.user || !store.composerOpen || (!hasContent() && !pendingImages.value)) return
    // 被替代后仅恢复文字，不能在下次登录时自动重放未确认的发布操作。
    unconfirmed = undefined; requestKey = ''; requestBody = ''
    localSave()
  }
  const save = (asDraft = false): Promise<boolean> => {
    if (!auth.user) return Promise.resolve(false)
    if (!asDraft && (pendingImages.value || pendingUploads.value)) { error.value = '还有待处理或上传中的文件，请保存文件或取消后再发布'; return Promise.resolve(false) }
    if (pending) {
      if (asDraft === pendingAsDraft) return pending
      const owner = auth.user.id, epoch = store.epoch, session = editorSession
      return pending.then(() => owner === auth.user?.id && epoch === store.epoch && session === editorSession && store.composerOpen && !error.value ? save(asDraft) : false)
    }
    if (saving.value) return Promise.resolve(false)
    const epoch = store.epoch, owner = auth.user?.id, session = editorSession
    const current = () => owner === auth.user?.id && epoch === store.epoch && session === editorSession
    pendingAsDraft = asDraft
    const operation = Promise.resolve().then(async () => {
      if (!current()) return false
      saving.value = true; error.value = ''
      try {
        if (richError.value) throw new Error(richError.value)
        const postDecision = store.eligibility?.operations.post
        if (!asDraft && postDecision && !postDecision.allowed) throw new ApiError(postDecision.message || '当前不能发布内容', 403, postDecision.reasonCode || undefined, postDecision.availableAt || undefined, postDecision.nextAction || undefined)
        if (conflict.value || draftUnavailable.value) throw new Error(draftUnavailable.value ? '原草稿不可用，请保留当前副本后另存，或放弃修改' : '已有较新的服务端版本，请先读取服务器版本或保留当前副本')
        if (!asDraft && !blocks.value.length && (!form.value.contribution || form.value.contribution.kind === 'article')) throw new Error('请填写正文')
        if (!asDraft && form.value.contribution && !form.value.title?.trim()) throw new Error('资源作品需要标题')
        if (!asDraft && form.value.contribution?.kind === 'video' && !form.value.contribution.videoAssetId) throw new Error('请先上传视频并等待处理完成')
        if (!asDraft && form.value.contribution?.kind === 'document' && !form.value.contribution.attachmentFileId) throw new Error('请先上传资料文件')
        if (!asDraft && ['question', 'project'].includes(form.value.type) && !form.value.title?.trim()) throw new Error('问题和项目需要标题')
        if (!asDraft && !advanced.value && form.value.bindings.length > 1) throw new Error('此草稿包含更多关联，请切换高级编辑')
        if (asDraft && !hasContent() && !draftId.value && !store.editingId) { if (pendingImages.value) localSave(); else clearLocal(); dirty.value = !!pendingImages.value; savedAt.value = ''; return true }
        const send = (write: UnconfirmedWrite) => write.asDraft ? communityApi.saveDraft(write.input, write.id, write.key) : communityApi.save({ ...write.input, status: 'published' }, write.id, write.key)
        let replay: Awaited<ReturnType<typeof communityApi.save>> | undefined
        if (unconfirmed) {
          const previous = unconfirmed
          const acknowledged = await send(previous)
          if (!current()) return false
          unconfirmed = undefined; requestKey = ''; requestBody = ''
          const unchanged = previous.asDraft === asDraft && JSON.stringify(previous.input) === JSON.stringify(input())
          if (unchanged) replay = acknowledged
          else {
            hydrating = true
            if (previous.asDraft) draftId.value = acknowledged.id
            else { store.editingId = acknowledged.id; draftId.value = undefined; store.composerMode = 'advanced' }
            form.value.expectedRevision = acknowledged.revision
            queueMicrotask(() => { hydrating = false })
          }
        }
        if (asDraft && store.editingId && !draftId.value && !replay) { localSave(); savedAt.value = '仅保留本地副本，尚未同步到服务器'; return true }
        const isNew = !store.editingId || !!draftId.value
        const captured = JSON.stringify(input())
        const operationBody = `${asDraft ? 'draft' : 'publish'}:${captured}`
        if (requestBody !== operationBody) { requestBody = operationBody; requestKey = randomId() }
        if (!replay) unconfirmed = { input: JSON.parse(captured), asDraft, id: asDraft ? draftId.value : store.editingId || draftId.value, key: requestKey }
        localSave()
        const post = replay || await send(unconfirmed!)
        if (!current()) return false
        unconfirmed = undefined
        const changed = captured !== JSON.stringify(input())
        if (post.inlineReferences) {
          hydrating = true
          form.value.inlineReferences = [...new Map([...(form.value.inlineReferences || []), ...post.inlineReferences].map(({ kind, text, id }) => [`${kind}:${text.normalize('NFKC').toLowerCase()}`, { kind, text, id }])).values()]
          queueMicrotask(() => { hydrating = false })
        }
        if (asDraft) { draftId.value = post.id; hydrating = true; form.value.expectedRevision = post.revision; queueMicrotask(() => { hydrating = false }); requestKey = ''; requestBody = ''; localSave(); savedAt.value = changed ? '尚未同步到服务器' : auth.dataMode === 'api' ? '草稿已同步到服务器' : '本地演示草稿已保存'; dirty.value = changed || !!pendingImages.value }
        else {
          clearTimeout(timer); clearTimeout(remoteTimer); requestKey = ''; requestBody = ''; draftId.value = undefined; store.published(post, changed, isNew)
          if (changed) {
            hydrating = true; store.editingId = post.id; form.value.expectedRevision = post.revision; dirty.value = true
            localSave(); savedAt.value = post.status === 'pending_review' ? '提交版本已保存待复核，后续输入尚未同步' : '已发布提交版本，后续输入尚未同步'; queueMicrotask(() => { hydrating = false })
          } else { clearLocal(); hydrate({ type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', portalConsent: false, status: 'published' }) }
        }
        return !changed
      } catch (cause) { if (current()) { error.value = cause instanceof Error ? cause.message : '保存失败'; if (cause instanceof ApiError) { conflict.value = cause.status === 409; draftUnavailable.value = !!draftId.value && (cause.status === 404 || (cause.status === 400 && cause.message === '草稿不存在或无权操作')); if (cause.status >= 400 && cause.status < 500) unconfirmed = undefined }; localSave() }; return false }
      finally { if (current()) saving.value = false; if (pending === operation) pending = null }
    })
    pending = operation
    return pending
  }
  watch([form, body, code, quote, language, images, richBlocks], () => {
    if (hydrating || !store.composerOpen) return
    dirty.value = dirty.value || hasContent() || !!draftId.value || !!store.editingId; clearTimeout(timer); clearTimeout(remoteTimer)
    if (!dirty.value) return
    const owner = auth.user?.id, epoch = store.epoch, session = editorSession
    const current = () => !!owner && owner === auth.user?.id && epoch === store.epoch && session === editorSession
    timer = setTimeout(() => { if (!current()) return; try { localSave() } catch { error.value = '浏览器存储空间不足，请保存服务端草稿' } }, 2000)
    remoteTimer = setTimeout(() => { if (current() && store.composerOpen && dirty.value && !closePrompt.value && !pendingUploads.value && !conflict.value && !draftUnavailable.value) void save(true) }, 10000)
  }, { deep: true })
  watch([() => auth.user?.id, () => store.epoch], () => {
    editorSession++; cancelUploads(); clearImageQueue(); imageNotice.value = ''; localSnapshotKey = ''
    clearTimeout(timer); clearTimeout(remoteTimer); hydrating = true
    body.value = ''; code.value = ''; quote.value = ''; images.value = []; richBlocks.value = null; topics.value = []; bindingTitles.value = {}; bindingLoading.value = false; topicsLoading.value = false; draftId.value = undefined; dirty.value = false; saving.value = false; error.value = ''; closePrompt.value = false; pending = null; requestKey = ''; requestBody = ''; conflict.value = false
    savedAt.value = ''; unconfirmed = undefined; draftUnavailable.value = false
    richError.value = ''
    form.value = { type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', portalConsent: false, status: 'published' }
    queueMicrotask(() => { hydrating = false })
  }, { flush: 'sync' })
  const close = () => { clearTimeout(timer); clearTimeout(remoteTimer); if (hasWork.value) closePrompt.value = true; else store.composerOpen = false }
  const discard = () => { if (saving.value) return; clearTimeout(timer); clearTimeout(remoteTimer); clearLocal(); requestKey = ''; requestBody = ''; unconfirmed = undefined; dirty.value = false; closePrompt.value = false; store.composerOpen = false }
  const saveAndClose = async () => { const requested = closePrompt.value; cancelUploads(); if (await save(true) && (!requested || closePrompt.value)) { closePrompt.value = false; store.composerOpen = false } }
  const readServer = async () => {
    const id = store.editingId || draftId.value
    if (!id) return
    const owner = auth.user?.id, epoch = store.epoch, session = editorSession
    const current = () => owner === auth.user?.id && epoch === store.epoch && session === editorSession && store.composerOpen && id === (store.editingId || draftId.value)
    try {
      const post = await communityApi.post(id)
      if (!current()) return
      hydrate({ type: post.type, title: post.title || '', coverFileId: post.coverFileId, contentBlocks: post.contentBlocks, bindings: post.bindings.filter((b) => b.status !== 'unavailable').map((b) => ({ type: b.type, id: b.id })), inlineReferences: post.inlineReferences?.map(({ kind, text, id }) => ({ kind, text, id })), quotedPostId: post.quotedPostId, topicIds: post.manualTopicIds || post.topics.map((t) => t.id), visibility: post.visibility, portalConsent: post.portalConsent === true, status: post.status === 'draft' ? 'draft' : 'published', expectedRevision: post.revision, contribution: post.contribution ? { kind: post.contribution.kind, categoryId: post.contribution.categoryId, tags: post.contribution.tags, teachingReuseConsent: post.contribution.teachingReuseConsent, sourceName: post.contribution.sourceName, sourceUrl: post.contribution.sourceUrl, videoAssetId: post.contribution.videoAssetId, attachmentFileId: post.contribution.attachmentFileId, coverFileId: post.contribution.coverFileId } : undefined })
      requestKey = ''; requestBody = ''; unconfirmed = undefined; localSave(); savedAt.value = '已读取服务器版本'; dirty.value = false
    } catch (cause) { if (current()) { error.value = cause instanceof Error ? cause.message : '服务端版本读取失败'; if (cause instanceof ApiError && cause.status === 404 && draftId.value) draftUnavailable.value = true } }
  }
  const keepCopy = () => { store.editingId = undefined; draftId.value = undefined; form.value.expectedRevision = undefined; conflict.value = false; draftUnavailable.value = false; requestKey = ''; requestBody = ''; unconfirmed = undefined; error.value = ''; dirty.value = true; localSave() }
  onScopeDispose(() => { cancelUploads(); clearImageQueue(); clearTimeout(timer); clearTimeout(remoteTimer) })
  return { hasWork, pendingUploads, registerUpload, cancelUploads, localCopies, restoreLocal, activeImage, pendingImages, imageUploading, imageNotice, editImage, cancelImage, removeImage, saveEditedImage,
    form, body, code, language, quote, images, richBlocks, richError, topics, bindingType, bindingId, bindingSearch, bindingTitles, bindingOptions, source, preview, saving, bindingLoading, topicsLoading, error, savedAt, closePrompt, dirty, draftId, blocks, advanced, conflict, draftUnavailable, preserveSession, readServer, keepCopy, loadTopics, loadOptions, addBinding, upload, uploadFiles, save, restore, close, discard, saveAndClose }
})
