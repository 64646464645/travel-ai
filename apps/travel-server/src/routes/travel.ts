import express, { type Request, type Response } from 'express'
import {
  ChatRequestSchema,
  RecommendRequestSchema,
  type ChatRequest,
  type RecommendRequest,
} from '@travel/shared'
import recommendService from '../services/recommendService.js'
import chatService from '../services/chatService.js'
import { createSessionId } from '../services/memoryService.js'
import { createStreamResponse } from '../utils/streamUtils.js'
import { requireAuth } from '../middleware/auth.js'
import { ensureSession } from '../services/memoryService.js'

const router = express.Router()
router.use(requireAuth)

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
    if (!result.success) {
      console.error('推荐接口降级失败', result.error)
      return res.status(502).json({
        success: false,
        message: 'AI 服务调用失败',
        timestamp: new Date().toISOString(),
      })
    }
    return res.json({ success: true, data: result })
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
        : 'AI 服务调用失败'
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

  const { message, sessionId }: ChatRequest = parsedBody.data

  const resolvedSessionId = sessionId?.trim() || createSessionId()

  try {
    const owned = await ensureSession(resolvedSessionId, req.userId!, message)
    if (!owned) {
      return res.status(404).json({ success: false, message: '会话不存在', timestamp: new Date().toISOString() })
    }
  } catch (error) {
    console.error('初始化会话失败', error)
    return res.status(500).json({ success: false, message: '初始化会话失败', timestamp: new Date().toISOString() })
  }

  const stream = createStreamResponse(res)

  const result = await chatService.chat(resolvedSessionId, req.userId!, message, (chunk: string) => {
    stream.send({ type: 'chunk', content: chunk })
  })

  if (!result.success) {
    stream.send({ type: 'error', error: result.error ?? '聊天服务调用失败' })
    stream.end()
    return
  }

  stream.send({ type: 'end', sessionId: resolvedSessionId })
  stream.end()
})

export default router
