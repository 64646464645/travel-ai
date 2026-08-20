import { z } from 'zod'

export const RecommendRequestSchema = z.object({
  city: z.string().trim().min(1, '城市不能为空'),
  budget: z.coerce.number().finite().min(100, '预算不能低于100'),
  days: z.coerce.number().int().min(1, '天数不能少于1天').max(30, '天数不能超过30天'),
})

export const DailyActivitySchema = z.object({
  spot: z.string(),
  duration: z.string(),
  ticket: z.string(),
  transportation: z.string(),
  description: z.string(),
})

export const DailyItinerarySchema = z.object({
  day: z.number().int().min(1),
  date: z.string(),
  morning: DailyActivitySchema,
  afternoon: DailyActivitySchema,
  evening: DailyActivitySchema,
})

export const BudgetBreakdownSchema = z.object({
  accommodation: z.number(),
  food: z.number(),
  transportation: z.number(),
  tickets: z.number(),
  other: z.number(),
})

export const TravelPlanSchema = z.object({
  success: z.literal(true),
  city: z.string(),
  days: z.number().int().min(1).max(30),
  totalBudget: z.number(),
  dailyItinerary: z.array(DailyItinerarySchema),
  budgetBreakdown: BudgetBreakdownSchema,
  tips: z.array(z.string()),
  warnings: z.array(z.string()),
})

export type TravelPlan = z.infer<typeof TravelPlanSchema>
export type RecommendRequest = z.infer<typeof RecommendRequestSchema>
export type DailyItinerary = z.infer<typeof DailyItinerarySchema>
export type DailyActivity = z.infer<typeof DailyActivitySchema>
export type BudgetBreakdown = z.infer<typeof BudgetBreakdownSchema>
