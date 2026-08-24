import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages"
import { createLLM } from "./llmClient.js"
import { appendMessage, getRecentMessages, type MemoryMessage } from "./memoryService.js"
import { searchMemory } from "./longTermMemoryService.js"
import { enqueueMemoryWrite } from "./memoryWriteQueue.js"
import type { MemorySearchResult } from "./longTermMemoryService.js"

export type StreamCallback = (chunk: string) => void

export interface ChatResult {
  success: boolean
  reply?: string
  error?: string
}

export function buildLongTermMemoryMessage(memories: MemorySearchResult[]): SystemMessage | null {
  if (memories.length === 0) return null
  const context = memories.map((m) => m.content).join('\n---\n')
  return new SystemMessage(
    `以下是与此前对话语义相关的历史记忆，请结合其中的关键信息回答用户问题（若与当前问题无关可忽略）：\n${context}`
  )
}

/** 长期记忆滑动窗口：最近 3 轮（前 2 轮 + 当前轮）合并写入，其中前 2 轮共 4 条 */
const LONG_TERM_PREVIOUS_MESSAGES = 4

/** 检索查询拼接的近期上下文：最近 1 轮对话原文（2 条） */
const QUERY_CONTEXT_MESSAGES = 2

class ChatService {
  private llm: ReturnType<typeof createLLM>

  constructor() {
    this.llm = createLLM()
  }

  async chat(
    sessionId: string,
    userId: string,
    message: string,
    streamCallback?: StreamCallback,
  ): Promise<ChatResult> {
    const { messages: history, recentMessages } = await this.loadHistory(sessionId, userId, message)
    const messages = [
      new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'),
      ...history,
      new HumanMessage(message)
    ]

    try {
      const stream = await this.llm.stream(messages)
      let fullResponse = ''

      for await (const chunk of stream) {
        const content = (chunk.content as string) || ''
        if (content.trim() === '') {
          continue
        }
        fullResponse += content
        streamCallback?.(content)
      }

      await this.saveMessages(sessionId, message, fullResponse)
      this.enqueueLongTermMemory(sessionId, userId, message, fullResponse, recentMessages)

      return {
        success: true,
        reply: fullResponse
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      }
    }
  }

  private async loadHistory(sessionId: string, userId: string, message: string) {
    // 单次读取最近窗口内原文，供检索上下文与长期记忆快照复用
    let recentMessages: MemoryMessage[] = []
    try {
      recentMessages = await getRecentMessages(sessionId)
    } catch (error) {
      console.error('读取短期记忆失败，退化为无记忆对话', error)
    }

    const messages: (SystemMessage | HumanMessage | AIMessage)[] = []

    // 长期记忆：按当前提问语义检索相关历史，拼入上下文（置于短期原文之前）
    try {
      const queryContext = recentMessages.slice(-QUERY_CONTEXT_MESSAGES)
      const query = this.buildQuery(queryContext, message)
      const memories = await searchMemory(userId, query)
      const memoryMessage = buildLongTermMemoryMessage(memories)
      if (memoryMessage) messages.push(memoryMessage)
    } catch (error) {
      console.error('检索长期记忆失败，退化为无长期记忆', error)
    }

    // 短期记忆：最近若干条原文
    messages.push(
      ...recentMessages.map((msg) =>
        msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
      )
    )

    return { messages, recentMessages }
  }

  private buildQuery(recent: MemoryMessage[], currentMessage: string): string {
    const parts = recent.map((msg) => `${msg.role === 'user' ? '用户' : '助手'}：${msg.content}`)
    parts.push(`用户：${currentMessage}`)
    return parts.join('\n')
  }

  private async saveMessages(sessionId: string, userMessage: string, aiReply: string) {
    try {
      await appendMessage(sessionId, 'user', userMessage)
      await appendMessage(sessionId, 'assistant', aiReply)
    } catch (error) {
      console.error('保存短期记忆失败', error)
    }
  }

  private enqueueLongTermMemory(
    sessionId: string,
    userId: string,
    message: string,
    fullResponse: string,
    recentMessages: MemoryMessage[],
  ): void {
    // 前 2 轮原文 + 当前轮（用户 + 助手）组成最近 3 轮快照，入队异步写入
    const previous = recentMessages.slice(-LONG_TERM_PREVIOUS_MESSAGES)
    const snapshot: MemoryMessage[] = [
      ...previous,
      { role: 'user', content: message },
      { role: 'assistant', content: fullResponse },
    ]
    enqueueMemoryWrite({ userId, sessionId, recentMessages: snapshot })
  }
}

export default new ChatService()
