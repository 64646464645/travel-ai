import { z } from 'zod'
import {
  AmapError,
  amapGet,
  estimateRoute,
  parseLocation,
  toNumber,
  withRetry,
  type AmapEnvelope,
} from './amapClient.js'
import { agentConfig } from './config.js'
import type {
  PoiCandidate,
  RouteLeg,
  ToolContext,
  ToolDefinition,
  WeatherDay,
  WeatherResult,
} from './types.js'

interface AmapPoiRaw {
  id?: string
  name?: string
  type?: string
  typecode?: string
  address?: unknown
  location?: string
  tel?: unknown
  biz_ext?: unknown
}

interface AmapGeocodeResponse extends AmapEnvelope {
  geocodes?: Array<{
    formatted_address?: string
    province?: string
    city?: unknown
    district?: string
    adcode?: string
    location?: string
    level?: string
  }>
}

interface AmapDistrictResponse extends AmapEnvelope {
  districts?: Array<{ name?: string; districts?: Array<{ name?: string }> }>
}

interface AmapPoiResponse extends AmapEnvelope {
  pois?: AmapPoiRaw[]
  count?: string
}

interface AmapWeatherResponse extends AmapEnvelope {
  forecasts?: Array<{ casts?: Array<Record<string, unknown>> }>
}

interface AmapRouteResponse extends AmapEnvelope {
  route?: {
    paths?: Array<{ distance?: string; duration?: string; steps?: Array<{ instruction?: string }> }>
    transits?: Array<{
      distance?: string
      duration?: string
      segments?: Array<Record<string, unknown>>
    }>
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizePoi(raw: AmapPoiRaw): PoiCandidate | null {
  const location = parseLocation(raw.location)
  if (!raw.id || !raw.name || !location) return null
  const biz = Array.isArray(raw.biz_ext)
    ? (raw.biz_ext[0] as Record<string, unknown> | undefined)
    : (raw.biz_ext as Record<string, unknown> | undefined)
  return {
    poiId: String(raw.id),
    name: String(raw.name),
    type: asString(raw.type),
    typecode: asString(raw.typecode) || undefined,
    address: asString(raw.address),
    location,
    rating: toNumber(biz?.rating),
    cost: toNumber(biz?.cost),
    openTime: asString(biz?.open_time) || null,
    tel: asString(raw.tel) || null,
  }
}

const resolveCityInput = z.object({
  name: z.string().trim().min(1),
})

const resolveCityTool: ToolDefinition = {
  name: 'resolve_city',
  description:
    '把城市名解析为高德 adcode 和中心坐标。需要查天气、公交路线或确认城市范围时先调用。',
  inputSchema: resolveCityInput,
  cacheTtlSec: 60 * 60 * 24 * 30,
  timeoutMs: agentConfig.toolTimeoutMs,
  summarize: (output) => {
    const data = output as { city?: string; adcode?: string }
    return `城市 ${data.city ?? ''}，adcode ${data.adcode ?? ''}`
  },
  execute: async (input, ctx) => {
    const { name } = resolveCityInput.parse(input)
    const geo = await withRetry(() =>
      amapGet<AmapGeocodeResponse>(
        '/v3/geocode/geo',
        { address: name, city: name },
        { signal: ctx.signal, timeoutMs: agentConfig.toolTimeoutMs, ttlSec: 60 * 60 * 24 * 30 },
      ).then((result) => result.data),
    )
    const first = geo.geocodes?.[0]
    const center = parseLocation(first?.location)
    if (!first || !center) {
      throw new AmapError('not_found', `未找到城市：${name}`, false)
    }
    const city = asString(first.city) || name
    let districts: string[] = []
    try {
      const district = await amapGet<AmapDistrictResponse>(
        '/v3/config/district',
        { keywords: city, subdistrict: 1, extensions: 'base' },
        { signal: ctx.signal, timeoutMs: agentConfig.toolTimeoutMs, ttlSec: 60 * 60 * 24 * 30 },
      )
      districts = (district.data.districts?.[0]?.districts ?? [])
        .map((item) => asString(item.name))
        .filter(Boolean)
    } catch {
      districts = []
    }
    return { city, adcode: asString(first.adcode), center, districts }
  },
}

const searchPoiInput = z.object({
  city: z.string().trim().min(1),
  query: z.string().trim().min(1),
  category: z.string().trim().optional(),
  center: z.object({ lng: z.number(), lat: z.number() }).optional(),
  radiusM: z.number().int().min(100).max(50_000).optional(),
  limit: z.number().int().min(1).max(25).optional(),
})

const searchPoiTool: ToolDefinition = {
  name: 'search_poi',
  description:
    '在指定城市搜索真实地点。query 用具体关键词（如“宽窄巷子”“博物馆”“美食街”）；center 可选，用于周边搜索。不要用它查天气或距离。',
  inputSchema: searchPoiInput,
  cacheTtlSec: 60 * 10,
  timeoutMs: agentConfig.toolTimeoutMs,
  summarize: (output) => {
    const data = output as { candidates?: PoiCandidate[] }
    const names = (data.candidates ?? []).slice(0, 3).map((item) => item.name)
    return `找到 ${data.candidates?.length ?? 0} 个地点${names.length ? `：${names.join('、')}` : ''}`
  },
  execute: async (input, ctx) => {
    const parsed = searchPoiInput.parse(input)
    const limit = parsed.limit ?? 10
    let response: AmapPoiResponse
    if (parsed.center) {
      const around = await withRetry(() =>
        amapGet<AmapPoiResponse>(
          '/v3/place/around',
          {
            location: `${parsed.center!.lng},${parsed.center!.lat}`,
            radius: parsed.radiusM ?? 3000,
            keywords: parsed.query,
            offset: limit,
            page: 1,
            extensions: 'all',
          },
          { signal: ctx.signal, timeoutMs: agentConfig.toolTimeoutMs, ttlSec: 60 * 10 },
        ).then((result) => result.data),
      )
      response = around
    } else {
      const text = await withRetry(() =>
        amapGet<AmapPoiResponse>(
          '/v3/place/text',
          {
            keywords: parsed.query,
            city: parsed.city,
            citylimit: 'true',
            types: parsed.category,
            offset: limit,
            page: 1,
            extensions: 'all',
          },
          { signal: ctx.signal, timeoutMs: agentConfig.toolTimeoutMs, ttlSec: 60 * 10 },
        ).then((result) => result.data),
      )
      response = text
    }
    const candidates = (response.pois ?? [])
      .map((item) => normalizePoi(item))
      .filter((item): item is PoiCandidate => item !== null)
    return { candidates, total: Number(response.count ?? candidates.length) }
  },
}

const getPoiDetailInput = z.object({
  poiId: z.string().trim().min(1),
})

const getPoiDetailTool: ToolDefinition = {
  name: 'get_poi_detail',
  description:
    '按 poiId 获取地点的营业时间、评分、人均、电话。只对准备写入行程的候选调用，最多 8 次。',
  inputSchema: getPoiDetailInput,
  cacheTtlSec: 60 * 60 * 24,
  timeoutMs: agentConfig.toolTimeoutMs,
  summarize: (output) => {
    const data = output as PoiCandidate
    return `${data.name}：评分 ${data.rating ?? '未知'}，营业时间 ${data.openTime ?? '未提供'}`
  },
  execute: async (input, ctx) => {
    const { poiId } = getPoiDetailInput.parse(input)
    const response = await withRetry(() =>
      amapGet<AmapPoiResponse>(
        '/v3/place/detail',
        { id: poiId, extensions: 'all' },
        { signal: ctx.signal, timeoutMs: agentConfig.toolTimeoutMs, ttlSec: 60 * 60 * 24 },
      ).then((result) => result.data),
    )
    const poi = (response.pois ?? [])[0]
    const normalized = poi ? normalizePoi(poi) : null
    if (!normalized) throw new AmapError('not_found', `未找到地点：${poiId}`, false)
    return normalized
  },
}

const getWeatherInput = z.object({
  adcode: z.string().trim().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.number().int().min(1).max(7).optional(),
})

const getWeatherTool: ToolDefinition = {
  name: 'get_weather',
  description:
    '查询城市未来 4 天天气预报。日期超出预报范围会返回 available=false，不要编造。',
  inputSchema: getWeatherInput,
  cacheTtlSec: 60 * 30,
  timeoutMs: agentConfig.toolTimeoutMs,
  summarize: (output) => {
    const data = output as WeatherResult
    if (!data.available) return `天气预报不可用：${data.reason ?? '超出预报范围'}`
    return `未来 ${data.days.length} 天天气：${data.days.map((day) => `${day.date} ${day.dayWeather}`).join('；')}`
  },
  execute: async (input, ctx) => {
    const parsed = getWeatherInput.parse(input)
    const response = await withRetry(() =>
      amapGet<AmapWeatherResponse>(
        '/v3/weather/weatherInfo',
        { city: parsed.adcode, extensions: 'all' },
        { signal: ctx.signal, timeoutMs: agentConfig.toolTimeoutMs, ttlSec: 60 * 30 },
      ).then((result) => result.data),
    )
    const casts = response.forecasts?.[0]?.casts ?? []
    const allDays: WeatherDay[] = casts.map((cast) => ({
      date: asString(cast.date),
      dayWeather: asString(cast.dayweather),
      nightWeather: asString(cast.nightweather),
      dayTemp: Number.isFinite(Number(cast.daytemp)) ? Number(cast.daytemp) : null,
      nightTemp: Number.isFinite(Number(cast.nighttemp)) ? Number(cast.nighttemp) : null,
      dayWind: asString(cast.daywind),
      dayPower: asString(cast.daypower),
    }))
    const latestDate = allDays.at(-1)?.date
    if (allDays.length === 0) {
      return { available: false, reason: 'provider_empty', days: [], latestDate } satisfies WeatherResult
    }
    if (parsed.startDate && !allDays.some((day) => day.date >= parsed.startDate!)) {
      return {
        available: false,
        reason: 'forecast_horizon',
        days: [],
        latestDate,
      } satisfies WeatherResult
    }
    const days = parsed.startDate
      ? allDays.filter((day) => day.date >= parsed.startDate!)
      : allDays
    return {
      available: true,
      days: parsed.days ? days.slice(0, parsed.days) : days,
      latestDate,
    } satisfies WeatherResult
  },
}

const planRouteInput = z.object({
  origin: z.object({ lng: z.number(), lat: z.number() }),
  destination: z.object({ lng: z.number(), lat: z.number() }),
  mode: z.enum(['walking', 'transit', 'driving']).default('driving'),
  city: z.string().trim().optional(),
})

const planRouteTool: ToolDefinition = {
  name: 'plan_route',
  description:
    '计算两点之间步行/驾车/公交的距离与耗时。origin/destination 用 {lng,lat}；公交需要 city（adcode）。',
  inputSchema: planRouteInput,
  cacheTtlSec: 60 * 10,
  timeoutMs: agentConfig.toolTimeoutMs,
  summarize: (output) => {
    const data = output as RouteLeg
    return `${data.mode} 约 ${Math.round(data.durationSec / 60)} 分钟 / ${(data.distanceM / 1000).toFixed(1)} 公里${data.estimated ? '（估算）' : ''}`
  },
  execute: async (input, ctx) => {
    const parsed = planRouteInput.parse(input)
    const mode = parsed.mode
    const endpoint =
      mode === 'walking'
        ? '/v3/direction/walking'
        : mode === 'transit'
          ? '/v3/direction/transit/integrated'
          : '/v3/direction/driving'
    const params: Record<string, string | number | undefined> = {
      origin: `${parsed.origin.lng},${parsed.origin.lat}`,
      destination: `${parsed.destination.lng},${parsed.destination.lat}`,
    }
    if (mode === 'transit') {
      params.city = parsed.city
      params.cityd = parsed.city
    }
    try {
      const response = await withRetry(() =>
        amapGet<AmapRouteResponse>(endpoint, params, {
          signal: ctx.signal,
          timeoutMs: agentConfig.toolTimeoutMs,
          ttlSec: 60 * 10,
        }).then((result) => result.data),
      )
      const path = response.route?.paths?.[0]
      const transit = response.route?.transits?.[0]
      const distanceM = Number(path?.distance ?? transit?.distance ?? 0)
      const durationSec = Number(path?.duration ?? transit?.duration ?? 0)
      if (!distanceM || !durationSec) {
        throw new AmapError('provider_error', '高德未返回可用路线', true)
      }
      const summary =
        path?.steps?.[0]?.instruction ??
        (mode === 'transit' ? '公交/地铁方案' : `${mode === 'walking' ? '步行' : '驾车'}路线`)
      return {
        mode,
        distanceM,
        durationSec,
        summary,
      } satisfies RouteLeg
    } catch (error) {
      if (error instanceof AmapError && error.code === 'invalid_input') throw error
      const estimated = estimateRoute(parsed.origin, parsed.destination, mode)
      return {
        mode,
        ...estimated,
        summary: '路线服务不可用，按直线距离估算',
        estimated: true,
      } satisfies RouteLeg
    }
  },
}

const tools: ToolDefinition[] = [
  resolveCityTool,
  searchPoiTool,
  getPoiDetailTool,
  getWeatherTool,
  planRouteTool,
]

export const toolRegistry = new Map(tools.map((tool) => [tool.name, tool]))

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name as ToolDefinition['name'])
}

export function listModelTools(): ToolDefinition[] {
  return tools
}
