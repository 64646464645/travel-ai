import type { ToolErrorCode } from './types.js'

const DEFAULT_BASE_URL = 'https://restapi.amap.com'
const DEFAULT_TIMEOUT_MS = 8_000

interface CacheEntry {
  expiresAt: number
  value: unknown
}

const cache = new Map<string, CacheEntry>()

export class AmapError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'AmapError'
  }
}

export interface AmapRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  ttlSec?: number
}

function getKey(): string {
  const key = process.env.AMAP_KEY
  if (!key) {
    throw new AmapError('unsupported', '未配置 AMAP_KEY，无法调用高德 Web 服务', false)
  }
  return key
}

function buildCacheKey(path: string, params: Record<string, string | number | undefined>): string {
  const normalized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&')
  return `${path}?${normalized}`
}

function classifyAmapError(infocode: string, info: string): AmapError {
  if (infocode === '10023') {
    return new AmapError('quota_exceeded', `高德配额已用尽：${info}`, false)
  }
  if (infocode === '10001' || infocode === '10003' || infocode === '10004') {
    return new AmapError('invalid_input', `高德参数错误：${info} (${infocode})`, false)
  }
  if (infocode === '10009' || infocode === '10010' || infocode === '10012') {
    return new AmapError('not_found', `高德未找到结果：${info} (${infocode})`, false)
  }
  return new AmapError('provider_error', `高德接口失败：${info} (${infocode})`, true)
}

/** 高德所有接口共有的状态信封 */
export interface AmapEnvelope {
  status?: string
  info?: string
  infocode?: string
}

/** 统一的高德 GET 请求：超时、缓存、错误码归一化 */
export async function amapGet<T extends AmapEnvelope>(
  path: string,
  params: Record<string, string | number | undefined>,
  options: AmapRequestOptions = {},
): Promise<{ data: T; cached: boolean }> {
  const cacheKey = buildCacheKey(path, params)
  const ttlSec = options.ttlSec ?? 0
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { data: cached.value as T, cached: true }
  }

  const key = getKey()
  const baseUrl = process.env.AMAP_BASE_URL ?? DEFAULT_BASE_URL
  const url = new URL(path, baseUrl)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value))
  }
  url.searchParams.set('key', key)

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal

  let response: Response
  try {
    response = await fetch(url, { signal, headers: { accept: 'application/json' } })
  } catch (error) {
    if ((error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError') {
      throw new AmapError('timeout', `高德请求超时（${timeoutMs}ms）`, true)
    }
    throw new AmapError('provider_error', `高德请求失败：${(error as Error).message}`, true)
  }

  if (!response.ok) {
    throw new AmapError('provider_error', `高德 HTTP ${response.status}`, response.status >= 500)
  }

  const json = (await response.json()) as T
  if (json.status !== '1') {
    throw classifyAmapError(String(json.infocode ?? ''), String(json.info ?? '未知错误'))
  }

  if (ttlSec > 0) {
    cache.set(cacheKey, { expiresAt: Date.now() + ttlSec * 1000, value: json })
  }
  return { data: json, cached: false }
}

/** 读工具重试一次；配额/参数错误不重试 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!(error instanceof AmapError) || !error.retryable || attempt === retries) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
  throw lastError
}

export function parseLocation(value: string | undefined | null): { lng: number; lat: number } | null {
  if (!value) return null
  const [lng, lat] = value.split(',').map(Number)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { lng, lat }
}

export function toNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

export function haversineMeters(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const radius = 6_371_000
  const toRad = (degree: number) => (degree * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}

/** 工具失败时的粗略兜底，明确标记 estimated */
export function estimateRoute(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
  mode: 'walking' | 'transit' | 'driving',
): { distanceM: number; durationSec: number } {
  const distanceM = Math.round(haversineMeters(origin, destination) * 1.3)
  const speedMps = mode === 'walking' ? 1.2 : mode === 'transit' ? 5 : 8
  return { distanceM, durationSec: Math.round(distanceM / speedMps) }
}
