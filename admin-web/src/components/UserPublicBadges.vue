<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { automaticBadgeCodes, automaticBadgeLabels, userBadgeTones, type AutomaticBadgeCode, type CustomUserBadge, type UserBadgeSettingsDto } from '@ai-learning-hub/contracts'
import { usersApi } from '../services/users'
const props = defineProps<{ userId: string; userRevision: number; readonly?: boolean }>()
const settings = ref<UserBadgeSettingsDto>(), pending = ref(false), error = ref(''), notice = ref('')
const form = reactive({ customBadges: [] as CustomUserBadge[], hiddenAutomaticBadges: [] as AutomaticBadgeCode[], reason: '' })
const tones = { orange: '橙色', purple: '紫色', green: '绿色', blue: '蓝色' }
let epoch = 0
const hydrate = (value: UserBadgeSettingsDto) => { settings.value = value; form.customBadges = value.customBadges.map(badge => ({ ...badge })); form.hiddenAutomaticBadges = [...value.hiddenAutomaticBadges]; form.reason = '' }
const load = async () => {
  const current = ++epoch; pending.value = true; error.value = ''; notice.value = ''
  try { const value = await usersApi.badges(props.userId); if (current === epoch) hydrate(value) }
  catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : '公开标签读取失败' }
  finally { if (current === epoch) pending.value = false }
}
watch(() => [props.userId, props.userRevision], () => { settings.value = undefined; void load() }, { immediate: true })
onBeforeUnmount(() => { epoch++ })
const hidden = (code: AutomaticBadgeCode) => form.hiddenAutomaticBadges.includes(code)
const eligible = (code: AutomaticBadgeCode) => settings.value?.automaticBadges.some(badge => badge.code === code)
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
    <h3>公开标签</h3><p>这里只调整公开标签，不改变账号身份和管理权限。修改后请填写原因并保存。</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" class="admin-secondary" :disabled="pending" @click="load">重新读取</button></p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="settings">
      <p v-if="!settings.publicVisible">公开资料当前不可见，标签不会在前台展示。</p>
      <p>当前前台显示：<span v-for="badge in settings.badges" :key="badge.code" class="public-badge" :data-tone="badge.tone">{{ badge.label }}</span><span v-if="!settings.badges.length">无</span></p>
      <form class="admin-form" @submit.prevent="save">
        <fieldset :disabled="pending || readonly">
          <div v-for="code in automaticBadgeCodes" :key="code" class="automatic-badge-row">
            <strong>{{ automaticBadgeLabels[code] }}</strong><span>{{ code === 'moderator' ? '版主授权自动' : '身份自动' }}</span>
            <span>{{ !eligible(code) ? hidden(code) ? '已隐藏，当前资格已失效' : '尚无有效身份 / 授权' : hidden(code) ? '已隐藏' : '显示中' }}</span>
            <button v-if="eligible(code)" type="button" class="admin-secondary" @click="toggle(code)">{{ hidden(code) ? '恢复自动标签' : '移除显示' }}</button>
            <a v-else-if="code === 'moderator'" href="#frontend-moderator-grants">通过前台管理权限设置</a>
            <RouterLink v-else to="/community?tab=official">前往官方 / 指导账号认证</RouterLink>
          </div>
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
