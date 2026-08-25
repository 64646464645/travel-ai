import { HumanMessage } from '@langchain/core/messages'
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

const extractedFactsSchema = z.array(extractedFactDraftSchema)

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

export async function extractMemoryFacts(messages: MemoryMessage[]): Promise<ExtractedFactDraft[]> {
  const llm = createLLM({ temperature: 0 }).withStructuredOutput(extractedFactsSchema, {
    method: 'functionCalling',
  })
  const result = await llm.invoke([
    new HumanMessage(`从以下对话中提取值得长期保留的用户事实。仅返回 JSON 数组，每项包含 type 和 content。type 只能是 preference、fact、itinerary、constraint。content 必须是一句简洁、可独立理解的事实；不要记录助手建议、寒暄、推测或重复内容。若没有可保留事实，返回空数组。\n\n${formatSnapshot(messages)}`),
  ])
  return extractedFactsSchema.parse(result)
}
