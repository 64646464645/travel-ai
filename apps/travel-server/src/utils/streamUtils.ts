import type { Response } from "express"

export interface StreamResponse {
  send: (data: unknown) => void
  end: () => void
  error: (message: string) => void
}

export const createStreamResponse = (res: Response): StreamResponse => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  // 反向代理（Nginx）默认会缓冲响应，加这个头让它直接透传，
  // 否则即使服务端逐块 write，客户端也要等到缓冲区满才收到。
  res.setHeader('X-Accel-Buffering', 'no')

  // 立刻把响应头 flush 出去：客户端不必等到第一次 res.write 才拿到 200，
  // fetch 会在首 token 生成前就 resolve。注意这不改变首个数据块的时间。
  res.flushHeaders()

  return {
    send: (data: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`)
      } catch (e) {
        console.error('流式数据发送错误', e)
      }
    },
    end: () => {
      try {
        res.end()
      } catch (e) {
        console.error('流式数据结束失败', e)
      }
    },
    error: (message: string) => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`)
        res.end()
      } catch (e) {
        console.error('流式数据错误', e)
      }
    }
  }
}
