import { HumanMessage } from '@langchain/core/messages'
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import { createLLM } from './llmClient.js'
import type { MemoryMessage } from './memoryService.js'

const DEFAULT_MEMORY_EXTRACTION_KEYWORDS = ['喜欢', '不喜欢', '偏好', '预算', '计划', '去过', '不吃', '禁忌']

export const extractedFactDraftSchema = z.object({
  type: z.enum(['preference', 'fact', 'itinerary', 'constraint']),
  content: z.string().trim().min(1),
})

export type ExtractedFactDraft = z.infer<typeof extractedFactDraftSchema>

export interface ExtractedMemoryFact extends ExtractedFactDraft {
  timestamp: string
  sourceSessionId: string
}

/**
 * 结构化输出统一用带 facts 字段的信封。
 * 直接要求顶层数组时，部分模型（如 DeepSeek function calling）会把单个数组元素当成根对象返回，
 * 触发 `expected array, received object`，因此改用对象包裹数组。
 */
const extractedFactsEnvelopeSchema = z.object({
  facts: z.array(extractedFactDraftSchema),
})

/** 兜底解析可接受三种形状：信封、裸数组、单个事实对象 */
const factsPayloadSchema = z.union([
  extractedFactsEnvelopeSchema,
  z.array(extractedFactDraftSchema),
  extractedFactDraftSchema,
])

type FactsPayload = z.infer<typeof factsPayloadSchema>

const EXTRACTION_INSTRUCTION = `从以下对话中提取值得长期保留的用户事实。仅返回 JSON，形状必须是 {"facts":[...]}，每个元素包含 type 和 content。type 只能是 preference、fact、itinerary、constraint。content 必须是一句简洁、可独立理解的事实；不要记录助手建议、寒暄、推测或重复内容。若没有可保留事实，返回 {"facts":[]}。`

function getKeywords(): string[] {
  const configured = process.env.MEMORY_EXTRACTION_KEYWORDS
  if (configured === undefined) return DEFAULT_MEMORY_EXTRACTION_KEYWORDS
  return configured.split(',').map((keyword) => keyword.trim()).filter(Boolean)
}

export function shouldExtractMemory(snapshotText: string): boolean {
  const lowerSnapshot = snapshotText.toLowerCase()
  return getKeywords().some((keyword) => lowerSnapshot.includes(keyword.toLowerCase()))
}

function formatSnapshot(messages: MemoryMessage[]): string {
  return messages.map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`).join('\n')
}

function normalizeFacts(payload: FactsPayload): ExtractedFactDraft[] {
  if (Array.isArray(payload)) return payload
  if ('facts' in payload) return payload.facts
  return [payload]
}

/** 去掉 markdown 代码块与前后解释文字，尽量截出完整 JSON */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) return fenced[1]

  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')

  // 形如 "以下是结果：[...]"：数组比对象更外层时优先取数组
  if (arrayStart !== -1 && arrayEnd > arrayStart && (objectStart === -1 || arrayStart < objectStart)) {
    return text.slice(arrayStart, arrayEnd + 1)
  }
  if (objectStart !== -1 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1)
  }
  return text
}

function parseFactsPayload(text: string): ExtractedFactDraft[] {
  const repaired = jsonrepair(extractJson(text))
  const parsed = factsPayloadSchema.parse(JSON.parse(repaired))
  return normalizeFacts(parsed)
}

/** 结构化输出失败时的降级链路：原始输出 → jsonrepair → Zod */
async function extractFactsFromRawOutput(messages: MemoryMessage[]): Promise<ExtractedFactDraft[]> {
  const llm = createLLM({ temperature: 0 })
  const response = await llm.invoke([
    new HumanMessage(`${EXTRACTION_INSTRUCTION}\n\n${formatSnapshot(messages)}`),
  ])
  const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
  return parseFactsPayload(text)
}

export async function extractMemoryFacts(messages: MemoryMessage[]): Promise<ExtractedFactDraft[]> {
  try {
    const llm = createLLM({ temperature: 0 }).withStructuredOutput(extractedFactsEnvelopeSchema, {
      method: 'functionCalling',
    })
    const result = await llm.invoke([
      new HumanMessage(`${EXTRACTION_INSTRUCTION}\n\n${formatSnapshot(messages)}`),
    ])
    return result.facts
  } catch (error) {
    console.error('结构化抽取长期记忆失败，改用原始输出解析', error)
    return extractFactsFromRawOutput(messages)
  }
}
