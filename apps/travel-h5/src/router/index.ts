import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { pinia } from '../stores'
import { useAuthStore } from '../stores/auth'

const routes = [
  { path: '/', name: 'home', component: () => import('@/views/Home.vue') },
  { path: '/chat', name: 'chat', component: () => import('@/views/Chat.vue'), meta: { requiresAuth: true } },
  { path: '/sessions', name: 'sessions', component: () => import('@/views/Sessions.vue'), meta: { requiresAuth: true } },
  { path: '/profile', name: 'profile', component: () => import('@/views/Profile.vue'), meta: { requiresAuth: true } },
  { path: '/detail', name: 'detail', component: () => import('@/views/Detail.vue'), meta: { requiresAuth: true } },
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { guestOnly: true, hideTabbar: true } },
  { path: '/register', name: 'register', component: () => import('@/views/Register.vue'), meta: { guestOnly: true, hideTabbar: true } },
]

const router = createRouter({ history: createWebHistory(), routes })

function redirectPath(route: RouteLocationNormalized): string {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') ? value : '/'
}

router.beforeEach(async (to) => {
  const auth = useAuthStore(pinia)
  await auth.initialize()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return redirectPath(to)
  }
  return true
})

export default router
