import axios, { type InternalAxiosRequestConfig } from 'axios'
import type { ApiSuccess, AuthResponse, SSEChunk } from '@travel/shared'
import { tokenStorage } from './tokenStorage'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const API_ROOT = `${API_BASE}/api`

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

let accessToken: string | null = null
let refreshPromise: Promise<AuthResponse> | null = null
let authStateListener: ((auth: AuthResponse | null) => void) | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function setAuthStateListener(listener: (auth: AuthResponse | null) => void): void {
  authStateListener = listener
}

async function persistAuth(auth: AuthResponse): Promise<AuthResponse> {
  accessToken = auth.accessToken
  await tokenStorage.setRefreshToken(auth.refreshToken)
  authStateListener?.(auth)
  return auth
}

async function clearAuth(): Promise<void> {
  accessToken = null
  await tokenStorage.removeRefreshToken()
  authStateListener?.(null)
}

export function refreshAccessTokenRequest(): Promise<AuthResponse> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = await tokenStorage.getRefreshToken()
    if (!refreshToken) throw new Error('没有可用的 refresh token')

    try {
      const response = await axios.post<ApiSuccess<AuthResponse>>(
        `${API_ROOT}/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' }, timeout: 60000 },
      )
      return await persistAuth(response.data.data)
    } catch (error) {
      await clearAuth()
      throw error
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

const request = axios.create({
  baseURL: API_ROOT,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
})

request.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

request.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const original = error.config as RetryableConfig | undefined
    const status = error.response?.status
    const skipRefresh = /\/auth\/(login|register|refresh|logout)$/.test(original?.url ?? '')

    if (status === 401 && original && !original._retry && !skipRefresh) {
      original._retry = true
      const auth = await refreshAccessTokenRequest()
      original.headers.Authorization = `Bearer ${auth.accessToken}`
      return request(original)
    }
    return Promise.reject(error)
  },
)

function travelPath(url: string): string {
  return `/travel/${url.replace(/^\/+/, '')}`
}

function authPath(url: string): string {
  return `/auth/${url.replace(/^\/+/, '')}`
}

export function post<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request.post(travelPath(url), params) as unknown as Promise<T>
}

export function get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request.get(travelPath(url), { params }) as unknown as Promise<T>
}

export function patch<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request.patch(travelPath(url), params) as unknown as Promise<T>
}

export function del<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request.delete(travelPath(url), { params }) as unknown as Promise<T>
}

export function authPost<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request.post(authPath(url), params) as unknown as Promise<T>
}

export function authGet<T = unknown>(url: string): Promise<T> {
  return request.get(authPath(url)) as unknown as Promise<T>
}

export async function fetchStream(
  url: string,
  data: Record<string, unknown>,
  onChunk: (chunk: string) => void,
  onComplete?: (payload?: string) => void,
  onError?: (error: string) => void,
): Promise<void> {
  const performFetch = async (retry: boolean): Promise<Response> => {
    const response = await fetch(`${API_ROOT}${travelPath(url)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(data),
    })
    if (response.status === 401 && retry) {
      await refreshAccessTokenRequest()
      return performFetch(false)
    }
    return response
  }

  try {
    const response = await performFetch(true)
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null) as { message?: string } | null
      throw new Error(body?.message ?? `请求失败 (${response.status})`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const event = JSON.parse(line.slice(6)) as SSEChunk
        if (event.type === 'chunk') onChunk(event.content)
        else if (event.type === 'end') onComplete?.(event.sessionId)
        else if (event.type === 'error') onError?.(event.error)
      }

      if (done) break
    }
  } catch (error) {
    onError?.((error as Error).message)
  }
}
