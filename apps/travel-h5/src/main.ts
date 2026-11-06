import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import './styles/common.css'
// 函数式调用的样式必须显式引入：模板里的 van-* 组件由 VantResolver 自动带样式，
// 但 showToast 是运行时创建的组件，解析器管不到，漏了就只剩文字没有样式。
import 'vant/es/toast/style/index'
import { pinia } from './stores'

const app = createApp(App)
app.use(pinia)
app.use(router)
app.mount('#app')
