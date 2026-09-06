import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles.css'
import '@ai-learning-hub/catalog-assets/icons/iconfont.js'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@xterm/xterm/css/xterm.css'

const app = createApp(App).use(createPinia()).use(router)
void router.isReady().then(() => app.mount('#app'))
