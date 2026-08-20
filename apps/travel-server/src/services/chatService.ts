import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages"
import { createLLM } from "./llmClient.js"
import {
  appendMessage,
  ensureSession,
  getCompressionThreshold,
  getEarliestMessages,
  getMessageCount,
  getRecentMessages,
  getSummary,
  getWindowSize,
  updateSummary,
  type MemoryMessage,
} from "./memoryService.js"

export type StreamCallback = (chunk: string) => void

export interface ChatResult {
  success: boolean
  reply?: string
  error?: string
}

class ChatService {
  private llm: ReturnType<typeof createLLM>

  constructor() {
    this.llm = createLLM()
  }

  async chat(sessionId: string, message: string, streamCallback?: StreamCallback): Promise<ChatResult> {
    await this.ensureSession(sessionId, message)

    const history = await this.loadHistory(sessionId)
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
      await this.maybeCompress(sessionId)

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

  private async ensureSession(sessionId: string, firstMessage: string): Promise<void> {
    try {
      await ensureSession(sessionId, firstMessage)
    } catch (error) {
      console.error('初始化会话失败', error)
    }
  }

  private async loadHistory(sessionId: string) {
    const messages: (SystemMessage | HumanMessage | AIMessage)[] = []

    try {
      const summary = await getSummary(sessionId)
      if (summary.trim()) {
        messages.push(
          new SystemMessage(`以下是此前对话的摘要，请结合其中的关键信息回答用户问题：\n${summary}`)
        )
      }
    } catch (error) {
      console.error('读取会话摘要失败，忽略摘要', error)
    }

    try {
      const history = await getRecentMessages(sessionId)
      messages.push(
        ...history.map((msg) =>
          msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
        )
      )
    } catch (error) {
      console.error('读取短期记忆失败，退化为无记忆对话', error)
    }

    return messages
  }

  private async saveMessages(sessionId: string, userMessage: string, aiReply: string) {
    try {
      await appendMessage(sessionId, 'user', userMessage)
      await appendMessage(sessionId, 'assistant', aiReply)
    } catch (error) {
      console.error('保存短期记忆失败', error)
    }
  }

  private async maybeCompress(sessionId: string): Promise<void> {
    try {
      const count = await getMessageCount(sessionId)
      if (count < getCompressionThreshold()) {
        return
      }

      const windowSize = getWindowSize()
      const toCompress = count - windowSize
      if (toCompress <= 0) {
        return
      }

      const existingSummary = await getSummary(sessionId)
      const earliest = await getEarliestMessages(sessionId, toCompress)
      if (earliest.length === 0) {
        return
      }

      const newSummary = await this.summarize(existingSummary, earliest)
      if (!newSummary) {
        return
      }

      await updateSummary(sessionId, newSummary)
    } catch (error) {
      console.error('压缩失败，本次跳过', error)
    }
  }

  private async summarize(existingSummary: string, messages: MemoryMessage[]): Promise<string> {
    const transcript = messages
      .map((msg) => `${msg.role === 'user' ? '用户' : '助手'}：${msg.content}`)
      .join('\n')

    const parts = [
      '你是一个旅游对话的摘要助手。请把下面的对话内容合并成一份简洁的中文摘要。',
      '摘要需保留目的地、预算、天数、已定行程、用户偏好等关键信息，忽略寒暄与无关内容。',
    ]

    if (existingSummary.trim()) {
      parts.push('请合并已有摘要中的关键信息，输出一份全新的完整摘要。')
      parts.push('')
      parts.push(`【已有摘要】\n${existingSummary}`)
    }

    parts.push('')
    parts.push(`【待合并对话】\n${transcript}`)
    parts.push('')
    parts.push('只输出摘要正文，不要标题、不要解释。')

    const result = await this.llm.invoke([new HumanMessage(parts.join('\n'))])
    const content = typeof result.content === 'string' ? result.content : ''
    return content.trim()
  }
}

export default new ChatService()
