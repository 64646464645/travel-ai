import { z } from 'zod'
import { DailyActivitySchema, TravelPlanSchema } from './travel.js'

/** Agent 需求槽位：允许为 null，由运行时判断是否追问 */
export const AgentRequirementSchema = z.object({
  city: z.string().trim().min(1).nullable().default(null),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').nullable().default(null),
  days: z.number().int().min(1).max(7).nullable().default(null),
  budget: z.number().finite().min(0).nullable().default(null),
  travelers: z
    .object({
      adults: z.number().int().min(1).max(10).default(1),
      children: z.number().int().min(0).max(10).default(0),
    })
    .default({ adults: 1, children: 0 }),
  preferences: z.array(z.string().trim().min(1)).max(10).default([]),
  constraints: z.array(z.string().trim().min(1)).max(10).default([]),
  pace: z.enum(['relaxed', 'balanced', 'packed']).default('balanced'),
  assumptions: z.array(z.string().trim().min(1)).max(5).default([]),
})

export type AgentRequirement = z.infer<typeof AgentRequirementSchema>

export const AgentRequirementEnvelopeSchema = z.object({
  requirement: AgentRequirementSchema,
})

export const AgentSourceSchema = z.object({
  provider: z.literal('amap'),
  poiId: z.string(),
  fetchedAt: z.string(),
})

export const AgentActivitySchema = DailyActivitySchema.extend({
  poiId: z.string().optional(),
  location: z.object({ lng: z.number(), lat: z.number() }).optional(),
  source: AgentSourceSchema.optional(),
  durationMin: z.number().int().min(0).max(720).optional(),
  indoor: z.boolean().optional(),
  travelFromPrevious: z
    .object({
      mode: z.enum(['walking', 'transit', 'driving']),
      durationMin: z.number().min(0),
      distanceKm: z.number().min(0),
      estimated: z.boolean().optional(),
    })
    .optional(),
})

export type AgentActivity = z.infer<typeof AgentActivitySchema>

export const AgentDailyItinerarySchema = z.object({
  day: z.number().int().min(1),
  date: z.string(),
  morning: AgentActivitySchema,
  afternoon: AgentActivitySchema,
  evening: AgentActivitySchema,
})

export type AgentDailyItinerary = z.infer<typeof AgentDailyItinerarySchema>

export const AgentPlanSchema = TravelPlanSchema.extend({
  // success 是旧 recommend 接口的产物，Agent 计划里没有意义；
  // 模型通常不会输出它，这里给默认值避免整份计划因为这个字段被判无效
  success: z.literal(true).default(true),
  dailyItinerary: z.array(AgentDailyItinerarySchema),
  rationale: z.string().default(''),
  citations: z.array(AgentSourceSchema).default([]),
  unverified: z.array(z.string()).default([]),
})

export type AgentPlan = z.infer<typeof AgentPlanSchema>

export const AgentPlanEnvelopeSchema = z.object({
  plan: AgentPlanSchema,
})

export const AgentValidationIssueSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['error', 'warning']),
  path: z.string(),
  message: z.string(),
  suggestion: z.string().optional(),
})

export type AgentValidationIssue = z.infer<typeof AgentValidationIssueSchema>

export const AgentValidationResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(AgentValidationIssueSchema),
})

export type AgentValidationResult = z.infer<typeof AgentValidationResultSchema>

export const AgentRunStatusSchema = z.enum([
  'running',
  'waiting_input',
  'completed',
  'failed',
  'cancelled',
])

export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>

export const AgentUsageSchema = z.object({
  promptTokens: z.number().int().min(0).default(0),
  completionTokens: z.number().int().min(0).default(0),
  costMicros: z.number().int().min(0).default(0),
})

export type AgentUsage = z.infer<typeof AgentUsageSchema>

export const AgentRunRequestSchema = z.object({
  message: z.string().trim().min(1, '消息不能为空').max(2000, '消息过长'),
  sessionId: z.string().trim().max(64).optional(),
})

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>

export type AgentNode =
  | 'understand'
  | 'research'
  | 'draft'
  | 'validate'
  | 'repair'
  | 'finalize'

export type AgentToolName =
  | 'resolve_city'
  | 'search_poi'
  | 'get_poi_detail'
  | 'get_weather'
  | 'plan_route'

export type AgentEvent =
  | { type: 'run_started'; runId: string; sessionId: string }
  | { type: 'node_started'; node: AgentNode; seq: number; at: number }
  | { type: 'node_finished'; node: AgentNode; seq: number; status: 'done' | 'failed'; latencyMs: number }
  | { type: 'tool_call'; callId: string; name: string; args: Record<string, unknown>; at: number }
  | { type: 'tool_result'; callId: string; name: string; ok: boolean; summary: string; latencyMs: number }
  | { type: 'message_delta'; content: string }
  | { type: 'plan'; plan: AgentPlan }
  | { type: 'validation'; passed: boolean; issues: AgentValidationIssue[] }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  /** itineraryId：本次运行产出的计划已自动落库为草稿，前端据此把「保存」变成「确认」 */
  | { type: 'done'; runId: string; status: AgentRunStatus; usage: AgentUsage; itineraryId?: string }
  | { type: 'heartbeat'; ts: number }
