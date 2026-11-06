import type { z } from 'zod'
import type {
  AgentEvent,
  AgentPlan,
  AgentRequirement,
  AgentToolName,
  AgentUsage,
  AgentValidationIssue,
} from '@travel/shared'
import type { MemoryMessage } from '../services/memoryService.js'

export interface PoiCandidate {
  poiId: string
  name: string
  type: string
  typecode?: string
  address: string
  location: { lng: number; lat: number }
  rating: number | null
  cost: number | null
  openTime: string | null
  tel: string | null
}

export interface WeatherDay {
  date: string
  dayWeather: string
  nightWeather: string
  dayTemp: number | null
  nightTemp: number | null
  dayWind: string
  dayPower: string
}

export interface WeatherResult {
  available: boolean
  reason?: string
  days: WeatherDay[]
  latestDate?: string
}

export interface RouteLeg {
  mode: 'walking' | 'transit' | 'driving'
  distanceM: number
  durationSec: number
  summary: string
  estimated?: boolean
  fromPoiId?: string
  toPoiId?: string
}

export interface ResearchState {
  city: string
  adcode: string
  center: { lng: number; lat: number } | null
  weather: WeatherResult | null
  pois: PoiCandidate[]
  routes: RouteLeg[]
  notes: string[]
  steps: number
}

export interface AgentState {
  runId: string
  userId: string
  sessionId: string
  message: string
  history: MemoryMessage[]
  requirement: AgentRequirement
  missing: string[]
  research: ResearchState
  draft?: AgentPlan
  issues: AgentValidationIssue[]
  revision: number
  finalPlan?: AgentPlan
  usage: AgentUsage
  assistantText?: string
}

export interface ToolContext {
  runId: string
  userId: string
  signal: AbortSignal
  emit: Emit
}

export type Emit = (event: AgentEvent) => void

export type ToolErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'quota_exceeded'
  | 'timeout'
  | 'provider_error'
  | 'unsupported'

export type ToolResult<T> =
  | {
      ok: true
      data: T
      meta: { provider: string; cached: boolean; latencyMs: number }
    }
  | {
      ok: false
      error: { code: ToolErrorCode; message: string; retryable: boolean }
    }

export interface ToolDefinition {
  name: AgentToolName
  description: string
  inputSchema: z.ZodTypeAny
  cacheTtlSec: number
  timeoutMs: number
  execute: (input: unknown, ctx: ToolContext) => Promise<unknown>
  summarize: (output: unknown) => string
}

export interface RunAgentInput {
  runId: string
  userId: string
  sessionId: string
  message: string
  history: MemoryMessage[]
  emit: Emit
  signal: AbortSignal
}

export interface RunAgentResult {
  status: 'waiting_input' | 'completed' | 'failed' | 'cancelled'
  plan?: AgentPlan
  issues?: AgentValidationIssue[]
  requirement?: AgentRequirement
  assistantText?: string
  usage: AgentUsage
}
