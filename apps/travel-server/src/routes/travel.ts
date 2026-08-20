import express, { type Request, type Response } from 'express'
import {
  ChatRequestSchema,
  RecommendRequestSchema,
  type ChatRequest,
  type RecommendRequest,
} from '@travel/shared'
import recommendService from '../services/recommendService.js'
import chatService from '../services/chatService.js'
import { createStreamResponse } from '../utils/streamUtils.js'

const router = express.Router()

router.post('/recommend', async (req: Request<object, object, unknown>, res: Response) => {
  const parsedBody = RecommendRequestSchema.safeParse(req.body)
  if (!parsedBody.success) {
    return res.status(400).json({
      success: false,
      message: parsedBody.error.issues[0]?.message ?? '请求参数不合法',
      timestamp: new Date().toISOString(),
    })
  }

  const { city, budget, days }: RecommendRequest = parsedBody.data

  try {
    const result = await recommendService.recommend(city, budget, days)
    return res.json(result)
  } catch (err) {
    const error = err as Error
    console.error('推荐接口错误', error)
    const isValidationError = error.message?.includes('预算')
    const isTimeout = error.name === 'TimeoutError' || error.message?.includes('timed out')
    const status = isValidationError ? 400 : 502
    const message = isValidationError
      ? error.message
      : isTimeout
        ? 'AI 服务响应超时，请稍后重试或缩短行程天数'
        : (error.message ?? 'AI 服务调用失败')
    return res.status(status).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    })
  }
})

router.post('/chat', async (req: Request<object, object, unknown>, res: Response) => {
  const parsedBody = ChatRequestSchema.safeParse(req.body)
  if (!parsedBody.success) {
    return res.status(400).json({
      success: false,
      message: parsedBody.error.issues[0]?.message ?? '请求参数不合法',
      timestamp: new Date().toISOString(),
    })
  }

  const { message }: ChatRequest = parsedBody.data

  const stream = createStreamResponse(res)

  const result = await chatService.chat(message, (chunk: string) => {
    stream.send({ type: 'chunk', content: chunk })
  })

  if (!result.success) {
    stream.send({ type: 'error', error: result.error ?? '聊天服务调用失败' })
    stream.end()
    return
  }

  stream.send({ type: 'end', content: result })
  stream.end()
})

export default router
