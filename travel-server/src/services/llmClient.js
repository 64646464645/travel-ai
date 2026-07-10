import { ChatOpenAI } from "@langchain/openai"

export function createLLM() {
  const provider = process.env.PROVIDER

  let apikey, baseURL, model
  if (provider === "DEEPSEEK") {
    apikey = process.env.DEEPSEEK_API_KEY
    baseURL = process.env.DEEPSEEK_BASE_URL
    model = process.env.DEEPSEEK_MODEL
  } else if (provider === "QWEN") {
    apikey = process.env.QWEN_API_KEY
    baseURL = process.env.QWEN_BASE_URL
    model = process.env.QWEN_MODEL
  }

  if (!apikey) {
    throw new Error(`未找到 ${provider ?? '未知'} 提供商的 API Key，请检查 .env 中 PROVIDER 与对应密钥配置`)
  }

  return new ChatOpenAI({
    apiKey: apikey,
    configuration: { baseURL },
    model,
    temperature: 0.4,
    timeout: Number(process.env.LLM_TIMEOUT_MS) || 120_000,
  })
}
