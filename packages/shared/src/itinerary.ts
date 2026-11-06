import { z } from 'zod'
import {
  AgentPlanSchema,
  AgentRequirementSchema,
  AgentValidationIssueSchema,
} from './agent.js'

/** 保存行程：前端把最终计划连同校验结果一起提交，服务端只做校验与落库 */
export const ItinerarySaveRequestSchema = z.object({
  runId: z.string().trim().max(64).optional(),
  sessionId: z.string().trim().max(64).optional(),
  title: z.string().trim().min(1).max(64).optional(),
  plan: AgentPlanSchema,
  requirement: AgentRequirementSchema.nullable().optional(),
  issues: z.array(AgentValidationIssueSchema).max(50).optional(),
})

export type ItinerarySaveRequest = z.infer<typeof ItinerarySaveRequestSchema>

/** draft：生成后自动落库、用户还没确认；saved：用户主动收藏 */
export const ItineraryStatusSchema = z.enum(['draft', 'saved'])
export type ItineraryStatus = z.infer<typeof ItineraryStatusSchema>

/** 列表项：只带卡片需要的字段，不含完整计划，避免列表接口过大 */
export const ItinerarySummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: ItineraryStatusSchema,
  city: z.string(),
  startDate: z.string().nullable(),
  days: z.number().int().min(0),
  totalBudget: z.number(),
  activityCount: z.number().int().min(0),
  unverifiedCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ItinerarySummary = z.infer<typeof ItinerarySummarySchema>

export const ItineraryDetailSchema = ItinerarySummarySchema.extend({
  plan: AgentPlanSchema,
  requirement: AgentRequirementSchema.nullable(),
  issues: z.array(AgentValidationIssueSchema),
  sessionId: z.string().nullable(),
  runId: z.string().nullable(),
  /** 触发这次计划的用户原话，刷新恢复时用来还原对话 */
  sourceMessage: z.string().nullable(),
  /** 快照版本，schema 演进时用来判断能否直接渲染 */
  schemaVersion: z.number().int().min(1),
})

export type ItineraryDetail = z.infer<typeof ItineraryDetailSchema>

export const ItineraryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: ItineraryStatusSchema.optional(),
})

export const ItineraryListResponseSchema = z.object({
  items: z.array(ItinerarySummarySchema),
  total: z.number().int().min(0),
})

export type ItineraryListResponse = z.infer<typeof ItineraryListResponseSchema>
