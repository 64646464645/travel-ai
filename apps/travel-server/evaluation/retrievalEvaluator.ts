import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDataset, type MemoryEvalCase, type MemoryEvalDataset } from './schema.js'
import { calculateMetrics, calculateDeletionMetrics, detectCrossUserLeak, foldSessions, passesQualityGate, type DeletionMetricsInput, type MetricsInput, type RankedChunk, type SessionRank } from './metrics.js'
import { writeReport } from './report.js'

export const HARNESS_VERSION = 'v2'

export interface RetrievalConfig {
  topK: number
  scoreThreshold: number
  datasetVersion: string
}

export interface CaseEvalRecord {
  id: string
  category: string
  shouldRecall: boolean
  status: 'passed' | 'failed' | 'error'
  passed: boolean
  /** false 表示执行错误，不计入任何指标分母 */
  executed: boolean
  failureReasons: string[]
  error?: string
  latencyMs: number
  chunks: RankedChunk[]
  sessions: SessionRank[]
  duplicateChunks: number
  expectedSessionIds: string[]
  expectedFacts: string[]
  forbiddenFacts: string[]
  contents: string[]
  newValueRank: number | null
  oldValueRanks: number[]
  /** 检索使用的内部命名空间 userId（用例级隔离后缀） */
  namespaceUserId: string
  deletionBeforeRecall: boolean
  deletionRewriteHit: boolean
  deleteAttempted: boolean
  deleteSucceeded: boolean
  deleteError?: string
  residualSessionIds: string[]
  crossUserLeak: boolean
  crossUserLeakSessionCount: number
  unknownSessionIds: string[]
}

interface CaseServices {
  indexMemory: (userId: string, sessionId: string, messages: MemoryEvalCase['memories'][number]['messages']) => Promise<{ status: string; chunkCount: number; errorCode?: string }>
  searchMemory: (userId: string, query: string) => Promise<RankedChunk[]>
  deleteBySession: (sessionId: string) => Promise<{ sessionId: string; deletedCount: number; errorCode?: string }>
}

function assertEmbeddingKey() {
  if (!process.env.QWEN_API_KEY) throw new Error('缺少 QWEN_API_KEY，无法执行离线长期记忆评测')
}

function contentMatches(contents: string[], facts: string[]) {
  return facts.every((fact) => contents.some((content) => content.includes(fact)))
}

/** 用例级命名空间：userId 追加用例唯一后缀，使 searchMemory 按 userId 过滤时天然隔离 */
export function namespaceUserId(userId: string, caseId: string): string {
  return `${userId}#${caseId}`
}

/** 构建 sessionId -> 内部命名空间 userId 映射，供检索/归属/泄漏判定统一使用 */
function buildSessionOwner(dataset: MemoryEvalDataset): Map<string, string> {
  const owner = new Map<string, string>()
  for (const item of dataset.cases) {
    for (const memory of item.memories) {
      owner.set(memory.sessionId, namespaceUserId(memory.userId, item.id))
    }
  }
  return owner
}

function baseRecord(item: MemoryEvalCase, namespaceUserId: string): CaseEvalRecord {
  return {
    id: item.id,
    category: item.category,
    shouldRecall: item.shouldRecall,
    status: 'passed',
    passed: false,
    executed: true,
    failureReasons: [],
    latencyMs: 0,
    chunks: [],
    sessions: [],
    duplicateChunks: 0,
    expectedSessionIds: item.expectedSessionIds,
    expectedFacts: item.expectedFacts,
    forbiddenFacts: item.forbiddenFacts,
    contents: [],
    newValueRank: null,
    oldValueRanks: [],
    namespaceUserId,
    deletionBeforeRecall: false,
    deletionRewriteHit: false,
    deleteAttempted: false,
    deleteSucceeded: false,
    residualSessionIds: [],
    crossUserLeak: false,
    crossUserLeakSessionCount: 0,
    unknownSessionIds: [],
  }
}

function errorRecord(item: MemoryEvalCase, namespaceUserId: string, error: string): CaseEvalRecord {
  return { ...baseRecord(item, namespaceUserId), status: 'error', executed: false, failureReasons: [error], error }
}

async function evaluateCase(item: MemoryEvalCase, namespacedUserId: string, sessionOwner: Map<string, string>, services: CaseServices): Promise<CaseEvalRecord> {
  const { deleteBySession, indexMemory, searchMemory } = services
  const caseId = item.id
  const record = baseRecord(item, namespacedUserId)

  // 1. 写入本用例记忆（userId 使用命名空间 ID）
  for (const memory of item.memories) {
    const write = await indexMemory(namespaceUserId(memory.userId, caseId), memory.sessionId, memory.messages)
    if (write.status === 'failed' || (write.status === 'skipped' && item.shouldRecall) || (item.shouldRecall && write.chunkCount === 0)) {
      return errorRecord(item, namespacedUserId, `写入失败: ${write.errorCode ?? write.status}`)
    }
  }

  // 2. deletion 用例：删除前验证可召回，并真实执行删除
  if (item.category === 'deletion') {
    const before = await searchMemory(namespacedUserId, item.query)
    record.deletionBeforeRecall = before.some((result) => item.expectedSessionIds.includes(result.sessionId))
    record.deleteAttempted = true
    for (const sessionId of item.expectedSessionIds) {
      const result = await deleteBySession(sessionId)
      if (result.errorCode) record.deleteError = result.errorCode
    }
  }

  // 3. 主查询（deletion 用例此时索引中已删除期望会话）
  const startedAt = Date.now()
  const chunks = await searchMemory(namespacedUserId, item.query)
  record.latencyMs = Date.now() - startedAt
  record.chunks = chunks
  record.sessions = foldSessions(chunks)
  record.contents = chunks.map((chunk) => chunk.content)
  record.duplicateChunks = chunks.length - record.sessions.length
  const hit = record.sessions.some((session) => item.expectedSessionIds.includes(session.sessionId))

  // 4. deletion 用例：同义改写查询验证删除后残留
  if (item.category === 'deletion') {
    const rewrite = await searchMemory(namespacedUserId, `${item.query} 请换一种说法说明`)
    record.deletionRewriteHit = rewrite.some((result) => item.expectedSessionIds.includes(result.sessionId))
  }

  // 5. 判定
  const forbidden = item.forbiddenFacts.filter((fact) => record.contents.some((content) => content.includes(fact)))
  const leak = detectCrossUserLeak(namespacedUserId, sessionOwner, record.sessions)
  record.crossUserLeak = leak.leaked
  record.crossUserLeakSessionCount = leak.leakedSessionIds.length
  record.unknownSessionIds = leak.unknownSessionIds

  // 未知会话归属：不得静默视为无泄漏，隔离用例直接标记为执行错误
  if (item.category === 'isolation' && leak.unknownSessionIds.length > 0) {
    return errorRecord(item, namespacedUserId, `检索结果包含无法归属的会话: ${leak.unknownSessionIds.join(', ')}`)
  }

  if (item.category === 'deletion') {
    // 删除用例：删除前可召回 && 删除后原查询/改写均不可召回
    const deletionPassed = record.deletionBeforeRecall && !hit && !record.deletionRewriteHit
    record.failureReasons = [
      !record.deletionBeforeRecall ? '删除前未验证可召回' : '',
      hit ? '删除后原查询仍可召回' : '',
      record.deletionRewriteHit ? '删除后同义改写仍可召回' : '',
      forbidden.length ? '出现禁止事实' : '',
    ].filter(Boolean)
    record.passed = deletionPassed && forbidden.length === 0
    record.status = record.passed ? 'passed' : 'failed'
    record.newValueRank = null
  } else {
    const factsOk = !item.shouldRecall || contentMatches(record.contents, item.expectedFacts)
    record.passed = (item.shouldRecall ? hit && factsOk : !hit) && forbidden.length === 0
    record.failureReasons = [
      !item.shouldRecall && hit ? '负样本误召回' : '',
      item.shouldRecall && !hit ? '未召回期望会话' : '',
      item.shouldRecall && hit && !factsOk ? '缺少期望关键事实' : '',
      forbidden.length ? '出现禁止事实' : '',
    ].filter(Boolean)
    record.status = record.passed ? 'passed' : 'failed'
    const oldSessionIds = item.category === 'preference-update' ? item.memories.filter((memory) => memory.sessionId !== item.expectedSessionIds[0]).map((memory) => memory.sessionId) : []
    record.newValueRank = record.sessions.findIndex((session) => item.expectedSessionIds.includes(session.sessionId)) + 1 || null
    record.oldValueRanks = oldSessionIds.map((sessionId) => record.sessions.findIndex((session) => session.sessionId === sessionId) + 1).filter((rank) => rank > 0)
  }

  // 6. 清理协议：删除本用例全部记忆，失败或残留未清除即阻断后续用例
  record.deleteAttempted = true
  let deleteSucceeded = true
  const deleteErrors: string[] = []
  for (const memory of item.memories) {
    const result = await deleteBySession(memory.sessionId)
    if (result.errorCode) {
      deleteSucceeded = false
      deleteErrors.push(`${memory.sessionId}:${result.errorCode}`)
    } else if (result.deletedCount === 0 && !(item.category === 'deletion' && item.expectedSessionIds.includes(memory.sessionId))) {
      // 已写入记忆在清理时无匹配：非 deletion 阶段已删除的会话视为清理未确认
      deleteSucceeded = false
      deleteErrors.push(`${memory.sessionId}:unconfirmed`)
    }
  }
  const residual = await searchMemory(namespacedUserId, item.query)
  record.residualSessionIds = residual.map((result) => result.sessionId).filter((sessionId) => item.memories.some((memory) => memory.sessionId === sessionId))
  record.deleteSucceeded = deleteSucceeded && record.residualSessionIds.length === 0
  if (!record.deleteSucceeded) {
    throw new Error(`用例 ${caseId} 清理失败: ${[...deleteErrors, ...(record.residualSessionIds.length ? [`残留 ${record.residualSessionIds.join(',')}`] : [])].join('; ')}`)
  }
  return record
}

function groupMetrics(cases: CaseEvalRecord[], dataset: MemoryEvalDataset, sessionOwner: Map<string, string>, topK: number) {
  return Object.fromEntries([...new Set(dataset.cases.map((item) => item.category))].filter((category) => category !== 'deletion').map((category) => {
    const selected = cases.filter((item) => item.category === category && item.executed)
    const input: MetricsInput[] = selected.map((item) => ({ expectedSessionIds: item.expectedSessionIds, shouldRecall: item.shouldRecall, category, sessions: item.sessions, latencyMs: item.latencyMs, forbiddenFacts: item.forbiddenFacts, contents: item.contents, queryUserId: item.namespaceUserId, sessionOwner }))
    return [category, calculateMetrics(input, topK)]
  }))
}

export async function runRetrievalEvaluation(dataset: MemoryEvalDataset, config: RetrievalConfig) {
  assertEmbeddingKey()
  const indexDir = await mkdtemp(join(tmpdir(), 'travel-memory-eval-'))
  const previous = { VECTOR_INDEX_DIR: process.env.VECTOR_INDEX_DIR, MEMORY_TOP_K: process.env.MEMORY_TOP_K, MEMORY_SCORE_THRESHOLD: process.env.MEMORY_SCORE_THRESHOLD }
  process.env.VECTOR_INDEX_DIR = indexDir
  process.env.MEMORY_TOP_K = String(config.topK)
  process.env.MEMORY_SCORE_THRESHOLD = String(config.scoreThreshold)
  try {
    const { deleteBySession, indexMemory, searchMemory, resetMemoryIndexInstance } = await import('../src/services/longTermMemoryService.js')
    // 每次运行绑定独立索引实例：若同进程此前已初始化索引（指向旧目录），先失效
    resetMemoryIndexInstance()
    const sessionOwner = buildSessionOwner(dataset)
    const cases: CaseEvalRecord[] = []
    for (const item of dataset.cases) {
      const namespacedUserId = namespaceUserId(item.queryUserId, item.id)
      cases.push(await evaluateCase(item, namespacedUserId, sessionOwner, { indexMemory, searchMemory, deleteBySession }))
    }
    const metricInput: MetricsInput[] = cases.filter((item) => item.executed).map((item) => ({ expectedSessionIds: item.expectedSessionIds, shouldRecall: item.shouldRecall, category: item.category, sessions: item.sessions, latencyMs: item.latencyMs, forbiddenFacts: item.forbiddenFacts, contents: item.contents, queryUserId: item.namespaceUserId, sessionOwner }))
    const metrics = calculateMetrics(metricInput, config.topK)
    const deletionInput: DeletionMetricsInput[] = cases.filter((item) => item.category === 'deletion').map((item) => ({ category: 'deletion', deletionBeforeRecall: item.deletionBeforeRecall, deletionAfterHit: item.sessions.some((session) => item.expectedSessionIds.includes(session.sessionId)), deletionRewriteHit: item.deletionRewriteHit, deleteFailed: Boolean(item.deleteError) || item.residualSessionIds.length > 0, writeFailed: false, executed: !item.executed }))
    const deletionMetrics = calculateDeletionMetrics(deletionInput)
    const executionErrors = cases.filter((item) => item.status === 'error').map((item) => `${item.id}: ${item.error}`)
    const report = { harnessVersion: HARNESS_VERSION, datasetVersion: config.datasetVersion, executedAt: new Date().toISOString(), config: { topK: config.topK, scoreThreshold: config.scoreThreshold, embeddingModel: process.env.EMBEDDING_MODEL ?? 'qwen3.7-text-embedding' }, caseCount: cases.length, metrics, deletionMetrics, categoryMetrics: groupMetrics(cases, dataset, sessionOwner, config.topK), passed: passesQualityGate(metrics) && cases.every((item) => !item.executed || item.passed) && executionErrors.length === 0, failures: cases.filter((item) => !item.passed).map((item) => `${item.id}: ${item.failureReasons.join('、')}`), executionErrors, cases }
    const paths = await writeReport(report)
    return { ...report, paths }
  } finally {
    if (previous.VECTOR_INDEX_DIR === undefined) delete process.env.VECTOR_INDEX_DIR
    else process.env.VECTOR_INDEX_DIR = previous.VECTOR_INDEX_DIR
    if (previous.MEMORY_TOP_K === undefined) delete process.env.MEMORY_TOP_K
    else process.env.MEMORY_TOP_K = previous.MEMORY_TOP_K
    if (previous.MEMORY_SCORE_THRESHOLD === undefined) delete process.env.MEMORY_SCORE_THRESHOLD
    else process.env.MEMORY_SCORE_THRESHOLD = previous.MEMORY_SCORE_THRESHOLD
    const { resetMemoryIndexInstance } = await import('../src/services/longTermMemoryService.js')
    // 使指向已删除目录的旧索引失效，避免同进程后续运行复用
    resetMemoryIndexInstance()
    await rm(indexDir, { recursive: true, force: true })
  }
}

export async function loadEvaluationDataset(): Promise<MemoryEvalDataset> {
  const { default: raw } = await import('./datasets/memory-eval.v1.json', { with: { type: 'json' } })
  return loadDataset(raw)
}
