import { HumanMessage } from "@langchain/core/messages"
import { createLLM } from "./llmClient.js"
import { z } from "zod"
import { jsonrepair } from "jsonrepair"

// ========== Zod 数据模型 ==========

/** 单日活动（上午/下午/晚上） */
const DailyActivitySchema = z.object({
  spot: z.string(),
  duration: z.string(),
  ticket: z.string(),
  transportation: z.string(),
  description: z.string(),
})

/** 一天的完整行程（早/中/晚 + 日期） */
const DailyItinerarySchema = z.object({
  day: z.number().int().min(1),
  date: z.string(),
  morning: DailyActivitySchema,
  afternoon: DailyActivitySchema,
  evening: DailyActivitySchema,
})

/** 预算分类明细 */
const BudgetBreakdownSchema = z.object({
  accommodation: z.number(),
  food: z.number(),
  transportation: z.number(),
  tickets: z.number(),
  other: z.number(),
})

/** 旅行计划顶层结构 */
const TravelPlanSchema = z.object({
  success: z.literal(true),
  city: z.string(),
  days: z.number().int().min(1).max(30),
  totalBudget: z.number(),
  dailyItinerary: z.array(DailyItinerarySchema),
  budgetBreakdown: BudgetBreakdownSchema,
  tips: z.array(z.string()),
  warnings: z.array(z.string()),
})

// ========== 导出类型 ==========

export type TravelPlan = z.infer<typeof TravelPlanSchema>
export type DailyItinerary = z.infer<typeof DailyItinerarySchema>
export type DailyActivity = z.infer<typeof DailyActivitySchema>
export type BudgetBreakdown = z.infer<typeof BudgetBreakdownSchema>

// ========== Service ==========

class RecommendService {
  private llm: ReturnType<ReturnType<typeof createLLM>['withStructuredOutput']>

  /** 降级 LLM：不带结构化输出，用于 jsonrepair 容错链路 */
  private fallbackLLM: ReturnType<typeof createLLM>

  constructor() {
    this.llm = createLLM().withStructuredOutput(TravelPlanSchema, {
      method: "functionCalling",
    })
    this.fallbackLLM = createLLM()
  }

  /**
   * 生成旅行推荐
   */
  async recommend(city: string, budget: number, days: number): Promise<TravelPlan | { success: false; error: string }> {
    if (budget < 100 || days < 1 || days > 30) {
      throw new Error('预算不能低于100，天数必须在1到30天之间')
    }

    const messages = this.getTravelPrompt(city, budget, days)

    // 主链路：function calling 结构化输出
    try {
      const result = await this.llm.invoke(messages)
      return result as TravelPlan
    } catch {
      // 结构化输出失败，走 jsonrepair 容错降级
      return this.fallbackRecommend(messages)
    }
  }

  /**
   * 降级链路：原始 LLM 输出 → jsonrepair 修复 → Zod 解析
   */
  private async fallbackRecommend(
    messages: HumanMessage[],
  ): Promise<TravelPlan | { success: false; error: string }> {
    try {
      const raw = await this.fallbackLLM.invoke(messages)
      const rawText = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content)

      // 提取 JSON（去除 markdown 代码块标记）
      const jsonText = this.extractJSON(rawText)

      // jsonrepair 修复常见格式错误
      const repaired = jsonrepair(jsonText)

      // Zod 校验
      const parsed = TravelPlanSchema.parse(JSON.parse(repaired))
      return parsed
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      }
    }
  }

  /** 从 LLM 原始输出中提取 JSON（去除 ```json ... ``` 包裹） */
  private extractJSON(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (match) return match[1]
    // 尝试截取第一个 { 到最后一个 } 之间的内容
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      return text.slice(start, end + 1)
    }
    return text
  }

  /** 构造给 LLM 的 prompt */
  private getTravelPrompt(city: string, budget: number, days: number): HumanMessage[] {
    return [
      new HumanMessage(
        `你是一个专业的旅游规划师，请根据以下信息生成一份详细的${days}天${city}旅行规划：

- 预算：${budget}元
- 天数：${days}天

请严格按照以下 JSON 结构返回（字段名不可更改）：

{
  "success": true,
  "city": "${city}",
  "days": ${days},
  "totalBudget": ${budget},
  "dailyItinerary": [
    {
      "day": 1,
      "date": "日期",
      "morning": { "spot": "景点", "duration": "时长", "ticket": "票价", "transportation": "交通", "description": "描述" },
      "afternoon": { "spot": "...", "duration": "...", "ticket": "...", "transportation": "...", "description": "..." },
      "evening": { "spot": "...", "duration": "...", "ticket": "...", "transportation": "...", "description": "..." }
    }
  ],
  "budgetBreakdown": {
    "accommodation": 0,
    "food": 0,
    "transportation": 0,
    "tickets": 0,
    "other": 0
  },
  "tips": ["贴士1", "贴士2"],
  "warnings": ["注意事项1", "注意事项2"]
}

请以 JSON 格式返回，不要包含 markdown 代码块标记。`
      ),
    ]
  }
}

export default new RecommendService()
