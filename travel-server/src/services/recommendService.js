import { HumanMessage } from "@langchain/core/messages"
import { createLLM } from "./llmClient.js"
import { z } from "zod"

// ========== Zod 数据模型 ==========

/** 单日活动（上午/下午/晚上） */
const DailyActivitySchema = z.object({
  spot: z.string(),           // 景点名称
  duration: z.string(),       // 游玩时长（如 "3小时"）
  ticket: z.string(),         // 门票价格
  transportation: z.string(), // 交通方式建议
  description: z.string(),    // 景点描述
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

/** 旅行计划顶层结构 —— 也是 withStructuredOutput 的约束 schema */
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

// ========== Service ==========

class RecommendService {
  constructor() {
    // jsonMode：使用 response_format: json_object 而非 json_schema（DeepSeek / Qwen 仅支持前者）
    this.llm = createLLM().withStructuredOutput(TravelPlanSchema, {
      method: "jsonMode",
    })
  }

  /**
   * 生成旅行推荐
   * @param {string} city   - 目的地城市
   * @param {number} budget - 总预算（元）
   * @param {number} days   - 旅行天数
   */
  async recommend(city, budget, days) {
    if (budget < 100 || days < 1 || days > 30) {
      throw new Error('预算不能低于100，天数必须在1到30天之间')
    }

    const messages = this.getTravelPrompt(city, budget, days)

    try {
      // invoke 返回的结构已由 withStructuredOutput 完成解析和 Zod 校验
      const result = await this.llm.invoke(messages)
      return result
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  /** 构造给 LLM 的 prompt */
  getTravelPrompt(city, budget, days) {
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
