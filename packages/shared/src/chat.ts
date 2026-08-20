import { z } from 'zod'

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, '消息不能为空'),
  sessionId: z.string().trim().max(64).optional(),
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

// ===== 会话管理 =====

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  messageCount: z.number().int().min(0),
  lastMessagePreview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type SessionSummary = z.infer<typeof SessionSummarySchema>

export const SessionMessageSchema = z.object({
  id: z.number(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.string(),
})

export type SessionMessage = z.infer<typeof SessionMessageSchema>

export const RenameSessionRequestSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(64, '标题不能超过64字'),
})

export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>

export interface SessionListResponse {
  success: true
  data: SessionSummary[]
}

export interface SessionResponse {
  success: true
  data: SessionSummary
}

export interface SessionMessagesResponse {
  success: true
  data: {
    sessionId: string
    messages: SessionMessage[]
  }
}
