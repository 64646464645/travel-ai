import { ChatOpenAI } from "@langchain/openai"

type Provider = "DEEPSEEK" | "QWEN"

export interface CreateLLMOptions {
  temperature?: number
}

export function createLLM(options: CreateLLMOptions = {}): ChatOpenAI {
  const provider = process.env.PROVIDER as Provider | undefined

  let apiKey: string | undefined
  let baseURL: string | undefined
  let model: string | undefined

  if (provider === "DEEPSEEK") {
    apiKey = process.env.DEEPSEEK_API_KEY
    baseURL = process.env.DEEPSEEK_BASE_URL
    model = process.env.DEEPSEEK_MODEL
  } else if (provider === "QWEN") {
    apiKey = process.env.QWEN_API_KEY
    baseURL = process.env.QWEN_BASE_URL
    model = process.env.QWEN_MODEL
  }

  if (!apiKey) {
    throw new Error(`未找到 ${provider ?? '未知'} 提供商的 API Key，请检查 .env 中 PROVIDER 与对应密钥配置`)
  }

  if (!model) {
    throw new Error(`未找到${provider}提供商的模型配置，请检查.env文件`)
  }

  return new ChatOpenAI({
    apiKey,
    configuration: { baseURL },
    model,
    temperature: options.temperature ?? 0.4,
    timeout: Number(process.env.LLM_TIMEOUT_MS) || 120_000,
  })
}
