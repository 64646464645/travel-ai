import axios from "axios";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

const request = axios.create({
  baseURL: `${API_BASE}/api/travel`,
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

export function post<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request.post(url, params)
}

export function get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request.get(url, { params })
}

export async function fetchStream(
  url: string,
  data: Record<string, unknown>,
  onChunk: (chunk: string) => void,
  onComplete?: (payload?: string) => void,
  onError?: (error: string) => void
): Promise<void> {
  const controller = new AbortController()
  try {
    const response = await fetch(`${API_BASE}/api/travel/${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      signal: controller.signal
    })
    const reader = response.body!.getReader()
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
            const payload: string = jsonData.content ?? jsonData.data ?? ''
            if (jsonData.type === 'chunk') {
              if (payload) onChunk(payload)
            } else if (jsonData.type === 'end' || jsonData.done) {
              onComplete?.(payload)
            } else if (jsonData.error) {
              onError?.(jsonData.error)
            }
          }
        } catch (error) {
          onError?.((error as Error).message)
        }
      }
    }
  } catch (error) {
    onError?.((error as Error).message)
  }
}
