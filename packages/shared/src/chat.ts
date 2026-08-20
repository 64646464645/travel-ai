import { z } from 'zod'

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, '消息不能为空'),
})

export type ChatRequest = z.infer<typeof ChatRequestSchema>

export interface ChatMessage {
  id: number
  role: 'user' | 'ai'
  content: string
  timestamp: string
}

export interface SSEChunk {
  type: 'chunk' | 'end'
  content: string
}
