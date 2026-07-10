import { HumanMessage } from "@langchain/core/messages"
import { createLLM } from "./llmClient.js"
import { z } from "zod"

// ========== Zod 数据模型 ==========

const DailyActivitySchema = z.object({
  spot: z.string(),
  duration: z.string(),
  ticket: z.string(),
  transportation: z.string(),
  description: z.string(),
})

const DailyItinerarySchema = z.object({
  day: z.number().int().min(1),
  date: z.string(),
  morning: DailyActivitySchema,
  afternoon: DailyActivitySchema,
  evening: DailyActivitySchema,
})

const BudgetBreakdownSchema = z.object({
  accommodation: z.number(),
  food: z.number(),
  transportation: z.number(),
  tickets: z.number(),
  other: z.number(),
})

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

// ========== Zod → JSON Schema 转换 ==========

function zodToJSONSchema(zodSchema) {
  if (zodSchema instanceof z.ZodString) {
    return { type: "string" }
  }
  if (zodSchema instanceof z.ZodNumber) {
    return { type: "number" }
  }
  if (zodSchema instanceof z.ZodBoolean) {
    return { type: "boolean" }
  }
  if (zodSchema instanceof z.ZodLiteral) {
    return { type: typeof zodSchema.value, const: zodSchema.value }
  }
  if (zodSchema instanceof z.ZodArray) {
    return { type: "array", items: zodToJSONSchema(zodSchema.element) }
  }
  if (zodSchema instanceof z.ZodObject) {
    const shape = zodSchema.shape
    const properties = {}
    for (const key of Object.keys(shape)) {
      properties[key] = zodToJSONSchema(shape[key])
    }
    return { type: "object", properties, required: Object.keys(shape) }
  }
  return {}
}

// ========== Service ==========

class RecommendService {
  constructor() {
    this.llm = createLLM()
    this.travelPlanSchema = TravelPlanSchema
    this.jsonSchemaStr = JSON.stringify(zodToJSONSchema(TravelPlanSchema), null, 2)
  }

  async recommend(city, budget, days) {
    if (budget < 100 || days < 1 || days > 30) {
      throw new Error('预算不能低于100，天数必须在1到30天之间')
    }

    const message = this.getTravelPrompt(city, budget, days)

    try {
      const response = await this.llm.invoke(message)
      const fullResponse = response.content || ''
      return this.parseJSONResponse(fullResponse)
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }

  parseJSONResponse(fullResponse) {
    try {
      const jsonMatch = fullResponse.match(/```json\n([\s\S]*?)\n```/) ||
        fullResponse.match(/```\n([\s\S]*?)\n```/) ||
        fullResponse.match(/\{[\s\S]*\}/)

      const parsed = JSON.parse(jsonMatch[1])

      // Zod 校验
      const result = this.travelPlanSchema.safeParse(parsed)
      if (!result.success) {
        return {
          success: false,
          error: "数据格式校验失败",
          validationErrors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
        }
      }

      return result.data
    } catch (error) {
      return {
        success: false,
        error: "JSON解析失败",
        rawResponse: error.message
      }
    }
  }

  getTravelPrompt(city, budget, days) {
    return [
      new HumanMessage(
        `你是一个专业的旅游规划师，擅长根据用户的需求生成详细的旅行行程。

请根据以下信息为用户生成一份详细的旅游规划：
- 目的地城市：${city}
- 预算：${budget}元
- 旅行天数：${days}天

要求：
1. 每天的行程安排（上午、下午、晚上）
2. 每个景点的详细介绍
3. 交通建议
4. 预算分配明细
5. 注意事项

请严格按照以下 JSON Schema 规定的格式输出 JSON，不要添加任何多余字段：
${this.jsonSchemaStr}

请确保 JSON 格式正确，可以直接被 JSON.parse 解析。`
      ),
    ]
  }
}

export default new RecommendService()
