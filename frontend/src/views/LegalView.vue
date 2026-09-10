<script setup lang="ts">
import AppIcon from '../components/base/AppIcon.vue'
import { useRoute } from 'vue-router'
import { onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
const route = useRoute()
const version = ref('2026-08-30')
onMounted(async () => { try { version.value = (await useAuthStore().loadRegistrationConfig()).agreementVersion } catch { version.value = '当前版本暂不可读取，请刷新后再确认协议' } })
</script>
<template><article class="section-container legal-page"><span class="eyebrow">AI MAKER CAMPUS</span><h1>{{ route.meta.title }}</h1><p>协议版本：{{ version }}</p><template v-if="route.path === '/terms'"><h2>学习与社区使用</h2><p>请使用本人账号，遵守法律和学校规定。实训为受控模拟环境，不提供真实服务器权限。</p><h2>内容与责任</h2><p>仅发布你拥有分享权利的内容，不发布他人隐私、凭据、侵权或违法内容。社区内容可由管理员按审核规则处理。</p><h2>账号管理</h2><p>请妥善保管密码。可通过邮箱重置密码；账号问题可联系部署本平台的管理员。</p></template><template v-else><h2>使用的数据</h2><p>平台使用邮箱和加密密码管理登录，使用学校、专业、兴趣及学习互动记录提供学习和推荐服务。</p><h2>公开范围</h2><p>公开社区只展示昵称、用户名、学校与专业等社区资料；邮箱、私人笔记、完整成绩和实训日志不会自动公开。</p><h2>保存与权利</h2><p>学习数据保存在部署方管理的数据库。需要查询、更正或删除个人数据时，请联系平台管理员。找回密码令牌仅保存哈希并有使用期限。</p></template><RouterLink class="back-button" to="/welcome" aria-label="返回门户" title="返回门户"><AppIcon name="back" /></RouterLink></article></template>
<style scoped>.legal-page{max-width:800px;margin:56px auto;padding:24px;line-height:1.9}h1{font-size:36px}h2{margin-top:30px}</style>
