<script setup lang="ts">
import AppIcon from '../components/base/AppIcon.vue'
</script>
<template><div class="immersive-community"><nav class="immersive-nav" aria-label="实训导航"><RouterLink to="/community"><AppIcon name="back" :size="18" />返回社区</RouterLink><RouterLink to="/labs"><AppIcon name="terminal" :size="18" />实训中心</RouterLink><RouterLink to="/profile">我的成长</RouterLink></nav><main id="main-content" class="dark-page"><slot /></main></div></template>
