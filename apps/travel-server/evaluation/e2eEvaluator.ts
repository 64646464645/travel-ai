import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createLLM } from '../src/services/llmClient.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MemoryEvalDataset } from './schema.js'
import { HARNESS_VERSION, namespaceUserId } from './retrievalEvaluator.js'

export type E2EMode = 'baseline' | 'rag' | 'oracle'

export interface E2ECaseResult {
  caseId: string
  category: string
  mode: E2EMode
  status: 'passed' | 'failed' | 'error'
  passed: boolean
  failureReasons: string[]
  error?: string
  /** false 表示该模式仅作参照或执行错误，不计入任何模式分数分母 */
  includedInDenominator: boolean
  /** deletion 用例 rag 模式的可观测证据：原查询与改写查询是否均不再召回已删除事实 */
  deletionEvidence?: { originalQueryPassed: boolean; rewriteQueryPassed: boolean }
}

export interface E2EEvaluationResult {
  harnessVersion: string
  datasetVersion: string
  executedAt: string
  modes: Record<E2EMode, number>
  ragRelativeImprovement: number
  ragOracleGap: number
  cases: E2ECaseResult[]
  passed: boolean
  failures: string[]
  executionErrors: string[]
}

function assertEmbeddingKey() {
  if (!process.env.QWEN_API_KEY) throw new Error('缺少 QWEN_API_KEY，无法执行 E2E 长期记忆评测')
}

function textContainsAny(text: string, facts: string[]): boolean {
  return facts.some((fact) => text.includes(fact))
}

/** deletion 用例仅 rag 模式计入判定分母（真实遗忘验证），baseline/oracle 仅作参照 */
function isIncluded(mode: E2EMode, category: string): boolean {
  return category !== 'deletion' || mode === 'rag'
}

export async function runE2EEvaluation(dataset: MemoryEvalDataset): Promise<E2EEvaluationResult> {
  assertEmbeddingKey()
  const indexDir = await mkdtemp(join(tmpdir(), 'travel-memory-e2e-'))
  const previous = process.env.VECTOR_INDEX_DIR
  process.env.VECTOR_INDEX_DIR = indexDir
  const { buildLongTermMemoryMessage } = await import('../src/services/chatService.js')
  const { deleteBySession, indexMemory, searchMemory, resetMemoryIndexInstance } = await import('../src/services/longTermMemoryService.js')
  // 每次运行绑定独立索引实例，避免复用指向已删除目录的旧索引
  resetMemoryIndexInstance()
  const llm = createLLM()
  const cases: E2ECaseResult[] = []
  const executionErrors: string[] = []
  try {
    for (const item of dataset.cases) {
      const namespacedUserId = namespaceUserId(item.queryUserId, item.id)
      // 用例级隔离：写入使用命名空间 userId
      let writeFailed = false
      for (const memory of item.memories) {
        const result = await indexMemory(namespaceUserId(memory.userId, item.id), memory.sessionId, memory.messages)
        if (result.status !== 'indexed') {
          writeFailed = true
          executionErrors.push(`${item.id}: 写入失败 ${result.errorCode ?? result.status}`)
          break
        }
      }
      if (writeFailed) continue

      const oracle = item.memories.filter((memory) => item.expectedSessionIds.includes(memory.sessionId)).flatMap((memory) => memory.messages.map((message) => ({ content: `${message.role === 'user' ? '用户' : '助手'}：${message.content}`, score: 1, sessionId: memory.sessionId })))
      const oracleMessage = buildLongTermMemoryMessage(oracle)
      // deletion 用例：先真实执行删除，再验证不再依赖已删除事实
      if (item.category === 'deletion') {
        for (const sessionId of item.expectedSessionIds) await deleteBySession(sessionId)
      }
      const ragMessage = buildLongTermMemoryMessage(await searchMemory(namespacedUserId, item.query))

      for (const mode of ['baseline', 'rag', 'oracle'] as const) {
        const context = mode === 'oracle' ? oracleMessage : mode === 'rag' ? ragMessage : null
        const included = isIncluded(mode, item.category)
        const base: E2ECaseResult = { caseId: item.id, category: item.category, mode, status: 'passed', passed: false, failureReasons: [], includedInDenominator: included }
        try {
          if (item.category === 'deletion' && mode === 'rag') {
            // 原查询 + 改写查询两种判定：回答与注入上下文均不再包含已删除事实
            const originalResponse = await llm.invoke([new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'), ...(context ? [context] : []), new HumanMessage(item.query)])
            const rewriteResponse = await llm.invoke([new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'), ...(context ? [context] : []), new HumanMessage(`${item.query} 请换一种说法说明`)])
            const originalText = String(originalResponse.content)
            const rewriteText = String(rewriteResponse.content)
            const ragText = ragMessage?.toString() ?? ''
            const originalQueryPassed = !textContainsAny(originalText, item.expectedFacts) && !textContainsAny(ragText, item.expectedFacts)
            const rewriteQueryPassed = !textContainsAny(rewriteText, item.expectedFacts) && !textContainsAny(ragText, item.expectedFacts)
            base.passed = originalQueryPassed && rewriteQueryPassed
            base.failureReasons = [...(!originalQueryPassed ? ['原查询仍依赖已删除事实'] : []), ...(!rewriteQueryPassed ? ['改写查询仍依赖已删除事实'] : [])]
            base.deletionEvidence = { originalQueryPassed, rewriteQueryPassed }
          } else if (item.category === 'deletion') {
            // baseline / oracle：仅作参照（oracle 注入删除前完整记忆，预期可回忆已删除事实）
            const text = String((await llm.invoke([new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'), ...(context ? [context] : []), new HumanMessage(item.query)])).content)
            base.passed = !textContainsAny(text, item.expectedFacts)
            base.failureReasons = textContainsAny(text, item.expectedFacts) ? ['回答包含已删除事实（oracle 参照注入完整记忆，预期如此）'] : []
          } else if (item.category === 'negative') {
            // negative：不再空集合恒真，验证回答与注入上下文不包含任何禁止事实
            const text = String((await llm.invoke([new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'), ...(context ? [context] : []), new HumanMessage(item.query)])).content)
            const contextForbidden = mode === 'rag' && textContainsAny(ragMessage?.toString() ?? '', item.forbiddenFacts)
            base.passed = !textContainsAny(text, item.forbiddenFacts) && !contextForbidden
            base.failureReasons = [...(textContainsAny(text, item.forbiddenFacts) ? ['回答出现禁止事实'] : []), ...(contextForbidden ? ['注入上下文包含禁止事实'] : [])]
          } else {
            // 普通正样本：回答包含全部期望事实
            const text = String((await llm.invoke([new SystemMessage('你是一个友好的旅游助手，请用中文回答用户关于旅游的问题'), ...(context ? [context] : []), new HumanMessage(item.query)])).content)
            base.passed = item.expectedFacts.every((fact) => text.includes(fact))
            base.failureReasons = item.expectedFacts.filter((fact) => !text.includes(fact)).map((fact) => `回答缺少期望事实: ${fact}`)
          }
          base.status = base.passed ? 'passed' : 'failed'
        } catch (error) {
          // LLM 调用失败 / 限流 / 输出无法解析：标为执行错误，不计 0 分也不计入分母
          base.status = 'error'
          base.error = error instanceof Error ? error.message : String(error)
          base.passed = false
          base.includedInDenominator = false
          executionErrors.push(`${item.id}(${mode}): ${base.error}`)
        }
        cases.push(base)
      }

      // 每个用例结束后执行可观测清理（与检索评测一致），失败即阻断后续
      const deleteErrors: string[] = []
      for (const memory of item.memories) {
        const result = await deleteBySession(memory.sessionId)
        if (result.errorCode) deleteErrors.push(`${memory.sessionId}:${result.errorCode}`)
        else if (result.deletedCount === 0 && !(item.category === 'deletion' && item.expectedSessionIds.includes(memory.sessionId))) deleteErrors.push(`${memory.sessionId}:unconfirmed`)
      }
      if (deleteErrors.length > 0) {
        throw new Error(`E2E 用例 ${item.id} 清理失败: ${deleteErrors.join('; ')}`)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.VECTOR_INDEX_DIR
    else process.env.VECTOR_INDEX_DIR = previous
    resetMemoryIndexInstance()
    await rm(indexDir, { recursive: true, force: true })
  }
  const included = cases.filter((item) => item.includedInDenominator)
  const modes = (['baseline', 'rag', 'oracle'] as const).reduce((acc, mode) => {
    const selected = included.filter((item) => item.mode === mode)
    acc[mode] = selected.length ? selected.filter((item) => item.status === 'passed').length / selected.length : 0
    return acc
  }, {} as Record<E2EMode, number>)
  const failures = cases.filter((item) => item.status === 'failed').map((item) => `${item.caseId}(${item.mode}): ${item.failureReasons.join('、')}`)
  return { harnessVersion: HARNESS_VERSION, datasetVersion: dataset.version, executedAt: new Date().toISOString(), modes, ragRelativeImprovement: modes.rag - modes.baseline, ragOracleGap: modes.oracle - modes.rag, cases, passed: executionErrors.length === 0, failures, executionErrors }
}
