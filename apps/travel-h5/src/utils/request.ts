import axios, { type InternalAxiosRequestConfig } from 'axios'
import type {
  AgentEvent,
  ApiSuccess,
  AuthResponse,
  ItineraryDetail,
  ItineraryListResponse,
  ItinerarySaveRequest,
  SSEChunk,
} from '@travel/shared'
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

export interface AgentStreamOptions {
  signal?: AbortSignal
  onEvent: (event: AgentEvent) => void
}

/**
 * Agent 运行流：服务端按 `data: {...}\n\n` 推送结构化事件。
 * 与 fetchStream 的区别是要解析事件对象而不是纯文本增量，
 * 因此这里自己拆帧，并把单帧解析失败视为可忽略噪声。
 */
export async function fetchAgentStream(
  body: { message: string; sessionId?: string },
  options: AgentStreamOptions,
): Promise<void> {
  const performFetch = async (retry: boolean): Promise<Response> => {
    const response = await fetch(`${API_ROOT}/agent/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    })
    if (response.status === 401 && retry) {
      await refreshAccessTokenRequest()
      return performFetch(false)
    }
    return response
  }

  const response = await performFetch(true)
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? `请求失败 (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split('\n\n')
    buffer = done ? '' : (frames.pop() ?? '')

    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          options.onEvent(JSON.parse(line.slice(6)) as AgentEvent)
        } catch {
          // 忽略心跳等非 JSON 帧
        }
      }
    }

    if (done) break
  }
}

export function cancelAgentRun(runId: string): Promise<unknown> {
  return request.post(`/agent/runs/${runId}/cancel`) as unknown as Promise<unknown>
}

/** 统一响应信封：这些接口直接挂在 /api 下，不走 travelPath 前缀 */
export interface ApiEnvelope<T> {
  success: true
  data: T
}

export function saveItineraryApi(payload: ItinerarySaveRequest): Promise<ApiEnvelope<ItineraryDetail>> {
  return request.post('/itineraries', payload) as unknown as Promise<ApiEnvelope<ItineraryDetail>>
}

export function listItinerariesApi(params?: {
  limit?: number
  offset?: number
  status?: 'draft' | 'saved'
}): Promise<ApiEnvelope<ItineraryListResponse>> {
  return request.get('/itineraries', { params }) as unknown as Promise<ApiEnvelope<ItineraryListResponse>>
}

export function getItineraryApi(id: string): Promise<ApiEnvelope<ItineraryDetail>> {
  return request.get(`/itineraries/${id}`) as unknown as Promise<ApiEnvelope<ItineraryDetail>>
}

export function deleteItineraryApi(id: string): Promise<ApiEnvelope<unknown>> {
  return request.delete(`/itineraries/${id}`) as unknown as Promise<ApiEnvelope<unknown>>
}

/** 把自动落库的草稿转成正式收藏 */
export function confirmItineraryApi(id: string): Promise<ApiEnvelope<ItineraryDetail>> {
  return request.patch(`/itineraries/${id}/confirm`) as unknown as Promise<ApiEnvelope<ItineraryDetail>>
}

/** 刷新恢复：取最近一条行程（草稿或已保存） */
export function getLatestItineraryApi(sessionId?: string): Promise<ApiEnvelope<ItineraryDetail>> {
  return request.get('/itineraries/latest', {
    params: sessionId ? { sessionId } : undefined,
  }) as unknown as Promise<ApiEnvelope<ItineraryDetail>>
}
