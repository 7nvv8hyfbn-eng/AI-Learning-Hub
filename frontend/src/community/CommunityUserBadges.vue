<script setup lang="ts">
import { computed } from 'vue'
import { automaticBadgeLabels, type CommunityUserBadge, type CommunityVerifiedType } from '@ai-learning-hub/contracts'
const props = defineProps<{ badges?: CommunityUserBadge[]; verifiedType?: CommunityVerifiedType }>()
// 仅在旧接口完全缺少 badges 时兼容；空数组表示服务端明确隐藏。
const displayed = computed<CommunityUserBadge[]>(() => props.badges ?? (props.verifiedType && props.verifiedType !== 'none' ? [{ code: props.verifiedType, label: automaticBadgeLabels[props.verifiedType], tone: props.verifiedType === 'official' ? 'orange' : props.verifiedType === 'teacher' ? 'blue' : 'green' }] : []))
const description = (badge: CommunityUserBadge) => badge.code === 'moderator' && badge.scopes?.length ? `${badge.scopes.map(scope => scope === 'community' ? '社区' : '教程中心').join('、')}版主` : badge.label
</script>
<template>
  <span v-if="displayed.length" class="community-user-badges" role="group" aria-label="公开标签">
    <span v-for="badge in displayed.slice(0, 2)" :key="badge.code" class="user-badge" :data-tone="badge.tone" :title="description(badge)">{{ badge.label }}</span>
    <span v-if="displayed.length > 2" class="user-badge-more" tabindex="0" :aria-label="displayed.slice(2).map(description).join('、')" @keydown.enter.stop @click.stop>+{{ displayed.length - 2 }}<span role="tooltip">{{ displayed.slice(2).map(description).join('、') }}</span></span>
  </span>
</template>
<style scoped>
.community-user-badges { display:inline-flex; align-items:center; gap:4px; flex:0 0 auto; max-width:100%; vertical-align:middle; font-weight:500; white-space:nowrap; }
.user-badge { padding:1px 5px; border:1px solid currentColor; border-radius:6px; font-size:12px; line-height:1.5; }
.user-badge[data-tone="orange"] { color:#b63814; background:#fff0e9; }
.user-badge[data-tone="purple"] { color:#6745af; background:#f3edff; }
.user-badge[data-tone="green"] { color:#257650; background:#eaf7ef; }
.user-badge[data-tone="blue"] { color:#286590; background:#eaf4fb; }
.user-badge-more { position:relative; font-size:12px; color:var(--amc-text-secondary); }
.user-badge-more > span { display:none; position:absolute; right:0; bottom:calc(100% + 5px); z-index:4; padding:6px 8px; border:1px solid var(--amc-border); border-radius:6px; background:var(--amc-bg-card, #fff); color:var(--amc-text-primary); white-space:normal; width:max-content; max-width:200px; }
.user-badge-more:hover > span, .user-badge-more:focus > span { display:block; }
.user-badge-more:focus-visible { outline:2px solid var(--amc-orange); outline-offset:3px; }
</style>
