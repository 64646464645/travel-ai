import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { createLLM } from "./llmClient.js"

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

  async chat(message: string, streamCallback?: StreamCallback): Promise<ChatResult> {
    const messages = [
      new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'),
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
}

export default new ChatService()
