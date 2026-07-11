import express, { type Request, type Response } from 'express'
import recommendService from '../services/recommendService.js'
import chatService from '../services/chatService.js'
import { createStreamResponse } from '../utils/streamUtils.js'

const router = express.Router()

interface RecommendBody {
  city: string
  budget: number
  days: number
}

interface ChatBody {
  message: string
}

router.post('/recommend', async (req: Request<object, object, RecommendBody>, res: Response) => {
  const { city, budget, days } = req.body

  if (!city || !budget || !days) {
    return res.status(400).json({
      message: '缺少必要参数',
      timestamp: new Date().toISOString()
    })
  }

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

router.post('/chat', async (req: Request<object, object, ChatBody>, res: Response) => {
  const { message } = req.body

  if (!message) {
    return res.status(400).json({
      success: false,
      message: '缺少必要参数',
      timestamp: new Date().toISOString(),
      error: '缺少必要参数'
    })
  }

  const stream = createStreamResponse(res)

  const result = await chatService.chat(message, (chunk: string) => {
    stream.send({ type: 'chunk', content: chunk })
  })

  stream.send({ type: 'end', content: result })
  stream.end()
})

export default router
