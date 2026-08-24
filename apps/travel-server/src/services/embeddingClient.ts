import { OpenAIEmbeddings } from '@langchain/openai'

const DEFAULT_EMBEDDING_MODEL = 'qwen3.7-text-embedding'
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

function toPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : undefined
}

/** 创建指向 Qwen DashScope 兼容端点的 embedding 客户端，与 LLM 的 PROVIDER 无关 */
export function createEmbeddings(): OpenAIEmbeddings {
  const apiKey = process.env.QWEN_API_KEY
  if (!apiKey) {
    throw new Error('未找到 QWEN_API_KEY，RAG 长期记忆需要配置 Qwen embedding 密钥')
  }

  const model = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL
  const baseURL = process.env.QWEN_BASE_URL || DEFAULT_QWEN_BASE_URL
  const dimensions = toPositiveInt(process.env.EMBEDDING_DIMENSIONS)

  return new OpenAIEmbeddings({
    apiKey,
    model,
    configuration: { baseURL },
    ...(dimensions !== undefined ? { dimensions } : {}),
  })
}

let instance: OpenAIEmbeddings | null = null

/** 模块级单例：复用同一 embedding 客户端，保证查询与写入的向量维度一致 */
export function getEmbeddings(): OpenAIEmbeddings {
  if (!instance) {
    instance = createEmbeddings()
  }
  return instance
}
