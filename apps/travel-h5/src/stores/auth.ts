import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ApiSuccess, AuthResponse, User } from '@travel/shared'
import {
  authGet,
  authPost,
  refreshAccessTokenRequest,
  setAccessToken,
  setAuthStateListener,
} from '../utils/request'
import { tokenStorage } from '../utils/tokenStorage'

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  const user = ref<User | null>(null)
  const initialized = ref(false)
  let initializePromise: Promise<void> | null = null

  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value))

  function syncAuth(auth: AuthResponse | null): void {
    accessToken.value = auth?.accessToken ?? null
    refreshToken.value = auth?.refreshToken ?? null
    user.value = auth?.user ?? null
    setAccessToken(auth?.accessToken ?? null)
  }

  setAuthStateListener(syncAuth)

  async function applyAuth(auth: AuthResponse): Promise<void> {
    syncAuth(auth)
    await tokenStorage.setRefreshToken(auth.refreshToken)
  }

  async function register(username: string, password: string, nickname?: string): Promise<void> {
    const response = await authPost<ApiSuccess<AuthResponse>>('register', { username, password, nickname })
    await applyAuth(response.data)
  }

  async function login(username: string, password: string): Promise<void> {
    const response = await authPost<ApiSuccess<AuthResponse>>('login', { username, password })
    await applyAuth(response.data)
  }

  async function refreshAccessToken(): Promise<void> {
    await applyAuth(await refreshAccessTokenRequest())
  }

  async function fetchMe(): Promise<User> {
    const response = await authGet<ApiSuccess<User>>('me')
    user.value = response.data
    return response.data
  }

  async function logout(): Promise<void> {
    const storedRefreshToken = refreshToken.value ?? await tokenStorage.getRefreshToken()
    try {
      if (storedRefreshToken) {
        await authPost('logout', { refreshToken: storedRefreshToken })
      }
    } catch {
      // 网络异常时仍清除本地凭据，避免用户被困在失效登录态。
    } finally {
      await tokenStorage.removeRefreshToken()
      syncAuth(null)
    }
  }

  async function initialize(): Promise<void> {
    if (initialized.value) return
    if (initializePromise) return initializePromise

    initializePromise = (async () => {
      const storedRefreshToken = await tokenStorage.getRefreshToken()
      refreshToken.value = storedRefreshToken
      if (!storedRefreshToken) return

      try {
        await refreshAccessToken()
      } catch {
        await tokenStorage.removeRefreshToken()
        syncAuth(null)
      }
    })().finally(() => {
      initialized.value = true
      initializePromise = null
    })
    return initializePromise
  }

  return {
    accessToken,
    refreshToken,
    user,
    initialized,
    isAuthenticated,
    register,
    login,
    logout,
    fetchMe,
    refreshAccessToken,
    initialize,
  }
})
