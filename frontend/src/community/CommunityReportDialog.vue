<script setup lang="ts">
import { ref, watch } from 'vue'
import { reportCategories, type GovernanceTarget, type ReportCategory } from '@ai-learning-hub/contracts'
import AppDialog from '../components/base/AppDialog.vue'
import { communityApi } from '../services/api/community'
import { useCommunityAccess } from './composables/useCommunityAccess'
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ targetType: GovernanceTarget; targetId: string }>()
const emit = defineEmits<{ submitted: [] }>()
const { requireWrite } = useCommunityAccess()
const category = ref<ReportCategory>('other'), description = ref(''), evidence = ref(''), error = ref(''), pending = ref(false)
watch(open, () => { error.value = '' })
const submit = async () => {
  if (pending.value || !requireWrite('report')) return
  pending.value = true; error.value = ''
  try {
    await communityApi.reportTarget(props.targetType, props.targetId, { category: category.value, reason: reportCategories[category.value], description: description.value.trim(), evidence: evidence.value.split('\n').map((x) => x.trim()).filter(Boolean) })
    description.value = ''; evidence.value = ''; open.value = false; emit('submitted')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '举报提交失败，请重试' }
  finally { pending.value = false }
}
</script>
<template><AppDialog v-model="open" title="举报内容"><form class="dialog-form" @submit.prevent="submit">
  <label>举报分类<select v-model="category"><option v-for="(label, key) in reportCategories" :key="key" :value="key">{{ label }}</option></select></label>
  <label>简短说明<textarea v-model="description" maxlength="1000" rows="3" /></label>
  <label>证据链接（选填，最多3条）<textarea v-model="evidence" maxlength="1502" rows="3" placeholder="每行一个 HTTPS 链接；请勿包含密码或身份材料" /></label>
  <p>举报人身份不向被举报人公开。请提供必要事实，可在“处理与申诉”查看进度。</p>
  <p v-if="error" class="community-error" role="alert">{{ error }}</p><button class="button primary" :disabled="pending">提交举报</button>
</form></AppDialog></template>
