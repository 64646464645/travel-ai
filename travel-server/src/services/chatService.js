import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import { createLLM } from "./llmClient.js"

class ChatService {
  constructor() {
    this.llm = createLLM()
  }

  async chat(message, streamCallback) {
    const messages = [
      new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'),
      new HumanMessage(message)
    ]

    try {
      const stream = await this.llm.stream(messages)
      let fullResponse = ''
      for await (const chunk of stream) {
        const content = chunk.content || ''
        if (content.trim() === '') {
          continue
        }
        fullResponse += content
        if (streamCallback) {
          streamCallback(content)
        }
      }
      return {
        success: true,
        reply: fullResponse
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}

export default new ChatService()
