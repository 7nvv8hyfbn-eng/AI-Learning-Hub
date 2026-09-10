<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { automaticBadgeCodes, automaticBadgeLabels, userBadgeTones, type AutomaticBadgeCode, type CustomUserBadge, type UserBadgeSettingsDto } from '@ai-learning-hub/contracts'
import { usersApi } from '../services/users'
import { communityAdminApi } from '../services/community'
import AdminDialog from './AdminDialog.vue'
const props = defineProps<{ userId: string; userRevision: number; username?: string; expertiseTopics?: string[]; permissions?: string[]; readonly?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const settings = ref<UserBadgeSettingsDto>(), pending = ref(false), error = ref(''), notice = ref('')
const deleting = ref<AutomaticBadgeCode>(), deleteReason = ref('')
const form = reactive({ customBadges: [] as CustomUserBadge[], hiddenAutomaticBadges: [] as AutomaticBadgeCode[], reason: '' })
const tones = { orange: '橙色', purple: '紫色', green: '绿色', blue: '蓝色' }
let epoch = 0, deleteKey = ''
const hydrate = (value: UserBadgeSettingsDto) => { settings.value = value; form.customBadges = value.customBadges.map(badge => ({ ...badge })); form.hiddenAutomaticBadges = [...value.hiddenAutomaticBadges]; form.reason = '' }
const load = async () => {
  const current = ++epoch; pending.value = true; error.value = ''; notice.value = ''
  try { const value = await usersApi.badges(props.userId); if (current === epoch) hydrate(value) }
  catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : '公开标签读取失败' }
  finally { if (current === epoch) pending.value = false }
}
watch(() => [props.userId, props.userRevision], () => { settings.value = undefined; deleting.value = undefined; void load() }, { immediate: true })
onBeforeUnmount(() => { epoch++ })
const hidden = (code: AutomaticBadgeCode) => form.hiddenAutomaticBadges.includes(code)
const eligible = (code: AutomaticBadgeCode) => settings.value?.automaticBadges.some(badge => badge.code === code)
const assignedCodes = computed(() => automaticBadgeCodes.filter(eligible))
const unsaved = computed(() => JSON.stringify([form.customBadges, form.hiddenAutomaticBadges]) !== JSON.stringify([settings.value?.customBadges, settings.value?.hiddenAutomaticBadges]))
const canRevoke = (code: AutomaticBadgeCode) => (code === 'moderator' ? ['user.moderator.manage'] : ['community.official.publish', 'platform.manage']).every(permission => props.permissions?.includes(permission))
const requestDelete = (code: AutomaticBadgeCode) => {
  if (pending.value || props.readonly || unsaved.value || !eligible(code) || !canRevoke(code)) return
  deleting.value = code; deleteReason.value = ''; error.value = ''
  deleteKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
}
const deleteBadge = async () => {
  const code = deleting.value
  if (!code || !settings.value || pending.value || props.readonly || !canRevoke(code)) return
  const reason = deleteReason.value.trim()
  if (reason.length < 4 || reason.length > 500) { error.value = '请填写 4～500 字的删除原因'; return }
  const current = epoch; pending.value = true; error.value = ''
  try {
    if (code === 'moderator') await usersApi.moderatorGrants(props.userId, { enabled: false, scopes: [], canDelete: false, canMute: false, canBan: false, reason, expectedRevision: props.userRevision }, deleteKey)
    else await communityAdminApi.verify(props.userId, 'none', props.expertiseTopics || [], reason, settings.value.revision)
    if (current === epoch) { deleting.value = undefined; emit('saved') }
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : '删除失败，请重新读取后重试' }
  finally { if (current === epoch) pending.value = false }
}
const toggle = (code: AutomaticBadgeCode) => { form.hiddenAutomaticBadges = hidden(code) ? form.hiddenAutomaticBadges.filter(value => value !== code) : [...form.hiddenAutomaticBadges, code]; notice.value = '显示修改尚未保存' }
const preview = computed(() => settings.value?.publicVisible ? [...settings.value.automaticBadges.filter(badge => !hidden(badge.code as AutomaticBadgeCode)), ...form.customBadges.filter(badge => badge.label.trim()).map(badge => ({ ...badge, code: `custom:${badge.label}` }))] : [])
const save = async () => {
  if (!settings.value || pending.value || props.readonly) return
  const current = epoch; pending.value = true; error.value = ''; notice.value = ''
  try {
    const value = await usersApi.updateBadges(props.userId, { ...form, expectedRevision: settings.value.revision })
    if (current === epoch) { hydrate(value); notice.value = '公开标签已保存，身份与管理权限未改变' }
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : '保存失败，请重新读取后修改' }
  finally { if (current === epoch) pending.value = false }
}
</script>
<template>
  <section class="public-badges-settings" aria-label="公开标签">
    <h3>公开标签 <small v-if="username">@{{ username }}</small></h3><p>隐藏只影响展示；删除身份标签会同步撤销对应身份与权限。普通文字标签不授予权限。</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" class="admin-secondary" :disabled="pending" @click="load">重新读取</button></p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="settings">
      <p v-if="!settings.publicVisible">公开资料当前不可见，标签不会在前台展示。</p>
      <p>当前前台显示：<span v-for="badge in settings.badges" :key="badge.code" class="public-badge" :data-tone="badge.tone">{{ badge.label }}</span><span v-if="!settings.badges.length">无</span></p>
      <form class="admin-form" @submit.prevent="save">
        <fieldset :disabled="pending || readonly">
          <div v-for="code in assignedCodes" :key="code" class="automatic-badge-row">
            <strong>{{ automaticBadgeLabels[code] }}</strong><span>{{ code === 'moderator' ? '版主授权自动' : '身份自动' }}</span>
            <span>{{ hidden(code) ? '已隐藏' : '显示中' }}</span>
            <button type="button" class="admin-secondary" @click="toggle(code)">{{ hidden(code) ? '恢复自动标签' : '隐藏标签' }}</button>
            <button v-if="canRevoke(code)" type="button" class="admin-secondary" :disabled="unsaved" @click="requestDelete(code)">删除标签并撤销权限</button>
          </div>
          <p v-if="!assignedCodes.length">当前没有有效身份标签。</p>
          <p v-if="unsaved && assignedCodes.length">请先保存当前标签修改，再删除身份标签。</p>
          <p><RouterLink to="/community?tab=official">设置官方 / 指导账号身份</RouterLink> · <a href="#frontend-moderator-grants">设置前台版主授权</a></p>
          <h4>普通文字标签 · 手动添加</h4>
          <div v-for="(badge, index) in form.customBadges" :key="index" class="custom-badge-row">
            <label>标签文字<input v-model="badge.label" maxlength="12" required placeholder="例如：优秀贡献者" /></label>
            <label>颜色<select v-model="badge.tone"><option v-for="tone in userBadgeTones" :key="tone" :value="tone">{{ tones[tone] }}</option></select></label>
            <button type="button" class="admin-secondary" @click="form.customBadges.splice(index, 1)">删除普通标签</button>
          </div>
          <button type="button" class="admin-secondary" :disabled="form.customBadges.length >= 3" @click="form.customBadges.push({ label: '', tone: 'green' })">添加普通标签</button>
          <p>最多 3 个，每个 1～12 字；保留身份名称只能通过上述认证或授权流程设置。</p>
          <div class="badge-preview"><strong>前台展示预览</strong><span>用户昵称</span><span v-for="badge in preview.slice(0, 2)" :key="badge.code" class="public-badge" :data-tone="badge.tone">{{ badge.label }}</span><span v-if="preview.length > 2" :title="preview.slice(2).map(badge => badge.label).join('、')">+{{ preview.length - 2 }}</span></div>
          <label>操作原因<textarea v-model="form.reason" required minlength="4" maxlength="500" rows="2" /></label>
          <button class="admin-primary">保存公开标签</button>
        </fieldset>
      </form>
    </template>
    <p v-else-if="pending">正在读取公开标签…</p>
    <AdminDialog :model-value="!!deleting" :title="`删除${deleting ? automaticBadgeLabels[deleting] : ''}标签并撤销权限`" @update:model-value="value => { if (!value && !pending) deleting = undefined }">
      <form class="admin-form" @submit.prevent="deleteBadge">
        <p>目标账号：@{{ username || userId }}</p>
        <p>{{ deleting === 'moderator' ? '将撤销该账号全部前台版主授权，并删除版主标签。' : '将撤销该账号的认证身份及对应角色权限，并删除身份标签。' }}以后需要通过认证或授权流程重新授予。</p>
        <label>删除原因<textarea v-model="deleteReason" required minlength="4" maxlength="500" :disabled="pending" /></label>
        <p v-if="error" role="alert">{{ error }}</p>
        <button class="admin-primary" :disabled="pending">确认删除并撤销权限</button>
      </form>
    </AdminDialog>
  </section>
</template>
<style scoped>
.public-badges-settings { margin-top:24px; padding-top:16px; border-top:1px solid var(--amc-border, #ece5de); }
fieldset { border:0; padding:0; display:grid; gap:12px; }
.automatic-badge-row,.custom-badge-row,.badge-preview { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.automatic-badge-row { padding:9px 0; border-bottom:1px solid #ece5de; font-size:13px; }
.automatic-badge-row > strong { min-width:64px; }
.custom-badge-row label { display:grid; gap:5px; }
.badge-preview { padding:12px; border:1px solid #ece5de; border-radius:8px; background:#fbfaf7; }
.public-badge { display:inline-block; margin:2px 4px; padding:1px 5px; border:1px solid currentColor; border-radius:6px; font-size:12px; white-space:nowrap; }
.public-badge[data-tone="orange"] { color:#b63814; background:#fff0e9; }.public-badge[data-tone="purple"] { color:#6745af; background:#f3edff; }.public-badge[data-tone="green"] { color:#257650; background:#eaf7ef; }.public-badge[data-tone="blue"] { color:#286590; background:#eaf4fb; }
</style>
