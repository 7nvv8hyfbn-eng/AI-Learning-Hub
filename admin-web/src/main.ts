import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElDialog, ElDropdown, ElDropdownItem, ElDropdownMenu, ElSwitch } from 'element-plus'
import 'element-plus/dist/index.css'
import './styles.css'
import './community.css'
import '../../packages/catalog-assets/icons/iconfont.js'
import App from './App.vue'
import router from './router'

createApp(App)
  .use(createPinia())
  .use(router)
  .use(ElDialog)
  .use(ElDropdown)
  .use(ElDropdownItem)
  .use(ElDropdownMenu)
  .use(ElSwitch)
  .mount('#app')
