<script setup lang="ts">
import { BRAND_NAME, BRAND_MARK, BRAND_SLOGAN_LINES } from '@ai-learning-hub/contracts'
import { dataMode } from '../services/api/client'
import { appVersion } from '../version'
</script>

<template>
  <footer class="app-footer">
    <div class="page-container footer-grid">
      <div>
        <div class="brand footer-brand"><span class="brand-mark">{{ BRAND_MARK }}</span><strong>{{ BRAND_NAME }}</strong></div>
        <small class="brand-slogan-lines">{{ BRAND_SLOGAN_LINES.join('\n') }}</small>
      </div>
      <div><strong>学习</strong><RouterLink to="/topics">通识基础</RouterLink><RouterLink to="/labs">实训项目</RouterLink></div>
      <div><strong>资源</strong><RouterLink to="/resources">教程中心</RouterLink><RouterLink to="/frontier">AI 前沿</RouterLink></div>
      <div><strong>成长</strong><RouterLink to="/assessments">挑战与测评</RouterLink><RouterLink to="/profile">个人中心</RouterLink></div>
    </div>
    <p class="copyright">© 2026 {{ BRAND_NAME }} · {{ dataMode === 'api' ? '内容来自已发布数据' : '当前内容为演示数据' }} · <span class="app-version" aria-label="应用版本">{{ appVersion }}</span></p>
  </footer>
</template>
