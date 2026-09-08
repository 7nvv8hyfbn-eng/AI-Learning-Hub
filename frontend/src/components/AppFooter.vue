<script setup lang="ts">
import { dataMode } from '../services/api/client'
</script>

<template>
  <footer class="app-footer">
    <div class="page-container footer-grid">
      <div>
        <div class="brand footer-brand"><span class="brand-mark">A</span><strong>AI MAKER CAMPUS</strong></div>
        <small>高校 AI 创客学习平台</small>
        <p>让 AI 学习更简单，让创新触手可及。</p>
      </div>
      <div><strong>学习</strong><RouterLink to="/topics">通识基础</RouterLink><RouterLink to="/labs">实训项目</RouterLink></div>
      <div><strong>资源</strong><RouterLink to="/resources">教程中心</RouterLink><RouterLink to="/frontier">AI 前沿</RouterLink></div>
      <div><strong>成长</strong><RouterLink to="/assessments">挑战与测评</RouterLink><RouterLink to="/profile">个人中心</RouterLink></div>
    </div>
    <p class="copyright">© 2026 AI MAKER CAMPUS · {{ dataMode === 'api' ? '内容来自已发布数据' : '当前内容为演示数据' }}</p>
  </footer>
</template>
