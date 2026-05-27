export const createStreamResponse = (res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  return {
    send: (data) => {
      try {
        // console.log(`data: ${JSON.stringify(data)}\n\n`)
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
    error: (message) => {
      try {
        res.write(`data: ${JSON.stringify(message)}`)
        res.end()
      } catch (e) {
        console.error('流式数据错误', e)
      }
    }
  }
}