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
        res.write('event: end\ndata:{"done: true}"\n\n')
        res.end()
      } catch (e) {
        console.error('流式数据结束失败', e)
      }
    },
    error: (message: string) => {
      try {
        res.write(`data: ${JSON.stringify(message)}`)
        res.end()
      } catch (e) {
        console.error('流式数据错误', e)
      }
    }
  }
}
