/** 单日活动 */
export interface DailyActivity {
  spot: string
  duration: string
  ticket: string
  transportation: string
  description: string
}

/** 一天的完整行程 */
export interface DailyItinerary {
  day: number
  date: string
  morning: DailyActivity
  afternoon: DailyActivity
  evening: DailyActivity
}

/** 预算分类明细 */
export interface BudgetBreakdown {
  accommodation: number
  food: number
  transportation: number
  tickets: number
  other: number
}

/** 旅行计划响应 */
export interface TravelPlan {
  success: boolean
  city: string
  days: number
  totalBudget: number
  dailyItinerary: DailyItinerary[]
  budgetBreakdown: BudgetBreakdown
  tips: string[]
  warnings: string[]
}

/** 聊天消息 */
export interface ChatMessage {
  id: number
  role: 'user' | 'ai'
  content: string
  timestamp: string
}

/** SSE 流式数据块 */
export interface SSEChunk {
  type: 'chunk' | 'end'
  content: string
}
