import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateDeletionMetrics, calculateMetrics, detectCrossUserLeak, foldSessions } from './metrics.js'
import type { DeletionMetricsInput, MetricsInput } from './metrics.js'

const owner = new Map<string, string>([
  ['s-a', 'user-a#isolation-001'],
  ['s-b', 'user-b#isolation-001'],
  ['s-a2', 'user-a#isolation-002'],
  ['s-b2', 'user-b#isolation-002'],
])

function sessionsOf(...ids: string[]) {
  return ids.map((sessionId, index) => ({ sessionId, firstRank: index + 1, score: 0.9, chunkCount: 1 }))
}

test('deletion 用例不进入 Recall/HitRate/MRR 分母', () => {
  const input: MetricsInput[] = [
    { expectedSessionIds: ['s-a'], shouldRecall: true, category: 'fact', sessions: sessionsOf('s-a'), latencyMs: 1, forbiddenFacts: [], contents: ['x'] },
    // deletion 用例删除后未命中，若混入正样本池会拉低 recall/hitRate
    { expectedSessionIds: ['s-a2'], shouldRecall: true, category: 'deletion', sessions: [], latencyMs: 1, forbiddenFacts: [], contents: [] },
  ]
  const metrics = calculateMetrics(input, 4)
  assert.equal(metrics.recallAtK, 1)
  assert.equal(metrics.hitRateAtK, 1)
  assert.equal(metrics.mrr, 1)
})

test('detectCrossUserLeak 按会话归属判定，未知会话单列', () => {
  assert.equal(detectCrossUserLeak('user-a#isolation-001', owner, sessionsOf('s-a')).leaked, false)
  const leak = detectCrossUserLeak('user-a#isolation-001', owner, sessionsOf('s-a', 's-b'))
  assert.equal(leak.leaked, true)
  assert.deepEqual(leak.leakedSessionIds, ['s-b'])
  const unknown = detectCrossUserLeak('user-a#isolation-001', owner, sessionsOf('unknown-session'))
  assert.deepEqual(unknown.unknownSessionIds, ['unknown-session'])
  assert.equal(unknown.leaked, false)
})

test('crossUserLeakRate 为 case-level，同一用例多外部会话不重复计数', () => {
  const ownerFor = new Map<string, string>([
    ['a-own', 'user-a#isolation-001'],
    ['b-own', 'user-b#isolation-001'],
    ['b-own2', 'user-b#isolation-001'],
  ])
  const input: MetricsInput[] = [
    // 隔离用例返回 2 个外部会话：case-level 只计 1 个泄漏用例，但 sessionCount 计 2
    { expectedSessionIds: ['a-own'], shouldRecall: true, category: 'isolation', sessions: sessionsOf('a-own', 'b-own', 'b-own2'), latencyMs: 1, forbiddenFacts: [], contents: [], queryUserId: 'user-a#isolation-001', sessionOwner: ownerFor },
    { expectedSessionIds: ['a-own'], shouldRecall: true, category: 'isolation', sessions: sessionsOf('a-own'), latencyMs: 1, forbiddenFacts: [], contents: [], queryUserId: 'user-a#isolation-001', sessionOwner: ownerFor },
  ]
  const metrics = calculateMetrics(input, 4)
  assert.equal(metrics.crossUserLeakRate, 0.5)
  assert.equal(metrics.crossUserLeakSessionCount, 2)
})

test('未知 session 归属计入 unknownSessionCount 不静默视为无泄漏', () => {
  const input: MetricsInput[] = [
    { expectedSessionIds: ['s-a'], shouldRecall: true, category: 'isolation', sessions: sessionsOf('s-a', 'ghost'), latencyMs: 1, forbiddenFacts: [], contents: [], queryUserId: 'user-a#isolation-001', sessionOwner: owner },
  ]
  const metrics = calculateMetrics(input, 4)
  assert.equal(metrics.unknownSessionCount, 1)
  // 未知会话不计为跨用户泄漏
  assert.equal(metrics.crossUserLeakRate, 0)
})

test('calculateDeletionMetrics 按定义分母输出四个删除专项指标', () => {
  const input: DeletionMetricsInput[] = [
    { category: 'deletion', deletionBeforeRecall: true, deletionAfterHit: false, deletionRewriteHit: false, deleteFailed: false, writeFailed: false, executed: false },
    { category: 'deletion', deletionBeforeRecall: true, deletionAfterHit: true, deletionRewriteHit: false, deleteFailed: false, writeFailed: false, executed: false },
    { category: 'deletion', deletionBeforeRecall: false, deletionAfterHit: false, deletionRewriteHit: false, deleteFailed: false, writeFailed: false, executed: false },
    { category: 'deletion', deletionBeforeRecall: true, deletionAfterHit: false, deletionRewriteHit: true, deleteFailed: false, writeFailed: false, executed: false },
    { category: 'deletion', deletionBeforeRecall: true, deletionAfterHit: false, deletionRewriteHit: false, deleteFailed: true, writeFailed: false, executed: false },
  ]
  const metrics = calculateDeletionMetrics(input)
  assert.equal(metrics.deletionCaseCount, 5)
  // 删除前可召回：4/5（d1/d2/d4/d5）
  assert.equal(metrics.deletionBeforeRecallRate, 4 / 5)
  // 删除通过：d1 与 d5（删除后原查询/改写均不可召回；d5 删除操作失败由失败率单独衡量）→ 2/5
  assert.equal(metrics.deletionPassRate, 2 / 5)
  // 改写残留：用例 4 → 1/5
  assert.equal(metrics.deletionRewriteResidualRate, 1 / 5)
  // 删除操作失败：用例 5 → 1/5
  assert.equal(metrics.deletionOperationFailureRate, 1 / 5)
})

test('calculateDeletionMetrics 排除执行错误与写入失败用例', () => {
  const input: DeletionMetricsInput[] = [
    { category: 'deletion', deletionBeforeRecall: true, deletionAfterHit: false, deletionRewriteHit: false, deleteFailed: false, writeFailed: false, executed: false },
    { category: 'deletion', deletionBeforeRecall: false, deletionAfterHit: false, deletionRewriteHit: false, deleteFailed: false, writeFailed: false, executed: true },
    { category: 'deletion', deletionBeforeRecall: false, deletionAfterHit: false, deletionRewriteHit: false, deleteFailed: false, writeFailed: true, executed: false },
  ]
  const metrics = calculateDeletionMetrics(input)
  // 分母为 1（排除写入失败与执行错误）
  assert.equal(metrics.deletionBeforeRecallRate, 1)
  assert.equal(metrics.deletionPassRate, 1)
  assert.equal(metrics.deletionOperationFailureRate, 0)
})

test('foldSessions 按会话折叠并保留首个排名', () => {
  const folded = foldSessions([
    { content: 'a', score: 0.9, sessionId: 's1' },
    { content: 'b', score: 0.8, sessionId: 's2' },
    { content: 'c', score: 0.7, sessionId: 's1' },
  ])
  const s1 = folded.find((session) => session.sessionId === 's1')
  assert.equal(s1?.firstRank, 1)
  assert.equal(s1?.chunkCount, 2)
  assert.equal(folded.length, 2)
})
