export interface RankedChunk {
  content: string
  score: number
  sessionId: string
}

export interface SessionRank {
  sessionId: string
  firstRank: number
  score: number
  chunkCount: number
}

export function foldSessions(chunks: RankedChunk[]): SessionRank[] {
  const folded = new Map<string, SessionRank>()
  chunks.forEach((chunk, index) => {
    const rank = index + 1
    const current = folded.get(chunk.sessionId)
    if (current) current.chunkCount += 1
    else folded.set(chunk.sessionId, { sessionId: chunk.sessionId, firstRank: rank, score: chunk.score, chunkCount: 1 })
  })
  return [...folded.values()]
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

/** 指标输入：deletion 用例由 calculateDeletionMetrics 单独处理，不进入本函数的正/负样本池 */
export interface MetricsInput {
  expectedSessionIds: string[]
  shouldRecall: boolean
  category: string
  sessions: SessionRank[]
  latencyMs: number
  forbiddenFacts: string[]
  contents: string[]
  /** 检索使用的内部命名空间 userId（用例级隔离后缀） */
  queryUserId?: string
  /** sessionId -> 内部命名空间 userId 映射，用于跨用户泄漏判定 */
  sessionOwner?: Map<string, string>
}

export interface CrossUserLeakDetection {
  leaked: boolean
  leakedSessionIds: string[]
  unknownSessionIds: string[]
}

/** case-level 跨用户泄漏判定：检索结果中出现不属于 queryUserId 的会话即为泄漏；无法归属的会话单列 */
export function detectCrossUserLeak(
  queryUserId: string | undefined,
  sessionOwner: Map<string, string> | undefined,
  sessions: SessionRank[],
): CrossUserLeakDetection {
  const leakedSessionIds: string[] = []
  const unknownSessionIds: string[] = []
  for (const session of sessions) {
    const owner = sessionOwner?.get(session.sessionId)
    if (owner === undefined) {
      unknownSessionIds.push(session.sessionId)
      continue
    }
    if (owner !== queryUserId) leakedSessionIds.push(session.sessionId)
  }
  return { leaked: leakedSessionIds.length > 0, leakedSessionIds, unknownSessionIds }
}

export interface MetricsResult {
  recallAtK: number
  precisionAtK: number
  hitRateAtK: number
  mrr: number
  falsePositiveRate: number
  crossUserLeakRate: number
  crossUserLeakSessionCount: number
  unknownSessionCount: number
  latencyMs: { p50: number; p95: number; p99: number }
  topK: number
}

export function calculateMetrics(results: MetricsInput[], topK: number): MetricsResult {
  // deletion 用例不进入 Recall@K / HitRate@K / MRR / Precision@K 的正负样本池
  const included = results.filter((r) => r.category !== 'deletion')
  const positive = included.filter((r) => r.shouldRecall)
  const negative = included.filter((r) => !r.shouldRecall)
  const relevant = included.reduce((sum, r) => sum + r.expectedSessionIds.length, 0)
  const recalled = included.reduce((sum, r) => sum + r.sessions.filter((s) => r.expectedSessionIds.includes(s.sessionId)).length, 0)
  const precisionDenominator = included.reduce((sum, r) => sum + r.sessions.length, 0)
  const hits = positive.filter((r) => r.sessions.some((s) => r.expectedSessionIds.includes(s.sessionId))).length
  const reciprocal = positive.map((r) => {
    const rank = r.sessions.findIndex((s) => r.expectedSessionIds.includes(s.sessionId))
    return rank < 0 ? 0 : 1 / (rank + 1)
  })
  const falsePositives = negative.filter((r) => r.sessions.length > 0).length
  const isolation = included.filter((r) => r.category === 'isolation')
  const leakDetections = isolation.map((r) => detectCrossUserLeak(r.queryUserId, r.sessionOwner, r.sessions))
  const leakedCases = leakDetections.filter((d) => d.leaked).length
  const crossUserLeakSessionCount = leakDetections.reduce((sum, d) => sum + d.leakedSessionIds.length, 0)
  const unknownSessionCount = included.reduce(
    (sum, r) => sum + detectCrossUserLeak(r.queryUserId, r.sessionOwner, r.sessions).unknownSessionIds.length,
    0,
  )
  return { recallAtK: relevant ? recalled / relevant : 0, precisionAtK: precisionDenominator ? recalled / precisionDenominator : 0, hitRateAtK: positive.length ? hits / positive.length : 0, mrr: reciprocal.length ? reciprocal.reduce((a, b) => a + b, 0) / reciprocal.length : 0, falsePositiveRate: negative.length ? falsePositives / negative.length : 0, crossUserLeakRate: isolation.length ? leakedCases / isolation.length : 0, crossUserLeakSessionCount, unknownSessionCount, latencyMs: { p50: percentile(included.map((r) => r.latencyMs), 50), p95: percentile(included.map((r) => r.latencyMs), 95), p99: percentile(included.map((r) => r.latencyMs), 99) }, topK }
}

export interface DeletionMetricsInput {
  category: 'deletion'
  /** 删除前原查询可召回期望会话 */
  deletionBeforeRecall: boolean
  /** 删除后原查询仍召回期望会话 */
  deletionAfterHit: boolean
  /** 删除后同义改写查询仍召回期望会话 */
  deletionRewriteHit: boolean
  /** 删除操作失败：deleteBySession 返回 errorCode 或删除后索引仍残留 */
  deleteFailed: boolean
  /** 写入失败：该用例不计入删除专项指标分母 */
  writeFailed: boolean
  /** 执行错误：该用例不计入删除专项指标分母 */
  executed: boolean
}

export interface DeletionMetrics {
  deletionCaseCount: number
  deletionBeforeRecallRate: number
  deletionPassRate: number
  deletionRewriteResidualRate: number
  deletionOperationFailureRate: number
}

/**
 * 删除专项指标。分母口径（全部排除写入失败与执行错误）：
 * - 删除前可召回率：删除前可召回期望会话数 / deletion 用例数
 * - 删除通过率：删除前可召回 && 删除后原查询/改写均不可召回的用例数 / deletion 用例数
 * - 删除后同义改写残留率：删除后改写查询仍召回期望会话数 / deletion 用例数
 * - 删除操作失败率：deleteBySession 返回 errorCode 或删除后索引仍残留数 / deletion 用例数
 */
export function calculateDeletionMetrics(results: DeletionMetricsInput[]): DeletionMetrics {
  const pool = results.filter((r) => !r.writeFailed && !r.executed)
  const beforeCount = pool.filter((r) => r.deletionBeforeRecall).length
  const passCount = pool.filter((r) => r.deletionBeforeRecall && !r.deletionAfterHit && !r.deletionRewriteHit).length
  const rewriteResidualCount = pool.filter((r) => r.deletionRewriteHit).length
  const opFailureCount = pool.filter((r) => r.deleteFailed).length
  return { deletionCaseCount: results.length, deletionBeforeRecallRate: pool.length ? beforeCount / pool.length : 0, deletionPassRate: pool.length ? passCount / pool.length : 0, deletionRewriteResidualRate: pool.length ? rewriteResidualCount / pool.length : 0, deletionOperationFailureRate: pool.length ? opFailureCount / pool.length : 0 }
}

export function passesQualityGate(metrics: MetricsResult): boolean {
  return metrics.hitRateAtK >= 0.9 && metrics.recallAtK >= 0.85 && metrics.mrr >= 0.75 && metrics.falsePositiveRate <= 0.05 && metrics.crossUserLeakRate === 0
}
