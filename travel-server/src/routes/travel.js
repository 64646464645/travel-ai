import express from 'express';
import travelService from '../services/travelService.js';
import { createStreamResponse } from '../utils/streamUtils.js';
const router = express.Router();

router.post('/recommend', async (req, res) => {

  const {city, budget, days} = req.body

  if (!city || !budget || !days) {
    return res.status(400).json({
      message: '缺少必要参数',
      timestamp: new Date().toISOString()
    })
  }

  try {
    const result = await travelService.recommend(city, budget, days)
    return res.json(result)
  } catch (err) {
    console.error('推荐接口错误', err)
    const isValidationError = err.message?.includes('预算')
    const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timed out')
    const status = isValidationError ? 400 : 502
    const message = isValidationError
      ? err.message
      : isTimeout
        ? 'AI 服务响应超时，请稍后重试或缩短行程天数'
        : (err.message ?? 'AI 服务调用失败')
    return res.status(status).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    })
  }
})
router.post('/chat', async (req, res) => {
  const { message } = req.body
  if (!message) {
    return res.status(400).json({
      success: false,
      message: '缺少必要参数',
      timestamp: new Date().toISOString(),
      error: '缺少必要参数'
    })
  }
  // 对SSE流式接口返回结果进行处理
  const stream = createStreamResponse(res)


  const result = await travelService.chat(message, (chunk) => {
    stream.send({ type: 'chunk', content: chunk})
  })
  stream.send({ type: 'end', content: result})
  stream.end()
})

export default router;