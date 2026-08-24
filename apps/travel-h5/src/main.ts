import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Vant from 'vant'
import router from './router'
import './styles/common.css'
import { pinia } from './stores'

const app = createApp(App)
app.use(Vant)
app.use(pinia)
app.use(router)
app.mount('#app')
