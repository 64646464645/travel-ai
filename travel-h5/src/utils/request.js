import axios from "axios";

const request = axios.create({
  baseURL: "http://127.0.0.1:3300/api/travel",
  timeout: 60000,
  headers: {
    "Content-Type": "application/json"
  }
})

request.interceptors.response.use(
  response => {
    return response.data
  },
  error => {
    return Promise.reject(error)
  }
)

export function post (url, params) {
  return request.post(url, params)
}

export function get (url, params) {
  return request.get(url, { params })
}

export async function fetchStream(url, data, onChunk, onComplete, onError) {
  const controller = new AbortController()
  try {
    const response = await fetch(`http://127.0.0.1:3300/api/travel/${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      signal: controller.signal
    })
    const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) { 
    const { done, value } = await reader.read()

    if (done) {
      onComplete?.()
      break
    }
    const chunk = decoder.decode(value, { stream: true })

    const lines = chunk.split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6)
          const jsonData = JSON.parse(jsonStr)
          // 后端 SSE：{ type: 'chunk'|'end', content: string }
          const payload = jsonData.content ?? jsonData.data ?? ''
          if (jsonData.type === 'chunk') {
            if (payload) onChunk(payload)
          } else if (jsonData.type === 'end' || jsonData.done) {
            onComplete?.(payload)
          } else if (jsonData.error) {
            onError(jsonData.error)
          }
        }
      } catch (error) {
        onError(error.message)
      }
    }
  }
  } catch (error) {
    onError(error.message)
  }
  
}
