/**
 * RAG 长期记忆观测指标：进程内存计数器 + 分桶直方图。
 * 仅观测、不改业务；所有上报内部吞异常，绝不影响调用方。
 */

export type CounterName =
  | 'retrieval.total'
  | 'retrieval.skipped'
  | 'retrieval.failed'
  | 'retrieval.hit'
  | 'write.total'
  | 'write.success'
  | 'write.skipped'
  | 'write.failed'
  | 'gate.hit'
  | 'gate.miss'
  | 'extraction.total'
  | 'extraction.success'
  | 'extraction.failed'
  | 'extraction.empty'
  | 'coverage.overwrite'
  | 'coverage.insert'
  | 'coverage.overwriteFailed'

export type HistogramName =
  | 'retrieval.recalledCount'
  | 'retrieval.score'
  | 'retrieval.latencyMs'
  | 'write.chunkCount'
  | 'write.embeddingLatencyMs'
  | 'write.latencyMs'
  | 'extraction.latencyMs'

interface HistogramDef {
  labels: string[]
  /** 上界数组，桶 i 表示 [boundaries[i-1], boundaries[i]) */
  boundaries: number[]
}

const LATENCY_LABELS = ['<50', '50-100', '100-200', '200-500', '500-1000', '1000-2000', '2000+']
const LATENCY_BOUNDARIES = [50, 100, 200, 500, 1000, 2000, Number.POSITIVE_INFINITY]
// 整数计数（条数）：桶语义为「恰好 N 条」，上界需 +1
const COUNT_LABELS = ['1', '2', '3', '4+']
const COUNT_BOUNDARIES = [2, 3, 4, Number.POSITIVE_INFINITY]

const HISTOGRAM_DEFS: Record<HistogramName, HistogramDef> = {
  'retrieval.recalledCount': { labels: COUNT_LABELS, boundaries: COUNT_BOUNDARIES },
  'retrieval.score': {
    labels: ['<0.3', '0.3-0.5', '0.5-0.7', '0.7-0.85', '0.85+'],
    boundaries: [0.3, 0.5, 0.7, 0.85, Number.POSITIVE_INFINITY],
  },
  'retrieval.latencyMs': { labels: LATENCY_LABELS, boundaries: LATENCY_BOUNDARIES },
  'write.chunkCount': { labels: COUNT_LABELS, boundaries: COUNT_BOUNDARIES },
  'write.embeddingLatencyMs': { labels: LATENCY_LABELS, boundaries: LATENCY_BOUNDARIES },
  'write.latencyMs': { labels: LATENCY_LABELS, boundaries: LATENCY_BOUNDARIES },
  'extraction.latencyMs': { labels: LATENCY_LABELS, boundaries: LATENCY_BOUNDARIES },
}

interface HistogramState extends HistogramDef {
  counts: number[]
  total: number
  sum: number
}

const counters: Partial<Record<CounterName, number>> = {}

const histograms = {} as Record<HistogramName, HistogramState>
for (const name of Object.keys(HISTOGRAM_DEFS) as HistogramName[]) {
  const def = HISTOGRAM_DEFS[name]
  histograms[name] = { ...def, counts: def.labels.map(() => 0), total: 0, sum: 0 }
}

/** 计数器自增，观测失败仅忽略 */
export function incCounter(name: CounterName, delta = 1): void {
  try {
    counters[name] = (counters[name] ?? 0) + delta
  } catch {
    // 观测失败不影响业务
  }
}

/** 按固定分桶记录一次观测值，观测失败仅忽略 */
export function observe(name: HistogramName, value: number): void {
  try {
    const h = histograms[name]
    const idx = h.boundaries.findIndex((b) => value < b)
    const safeIdx = idx === -1 ? h.boundaries.length - 1 : idx
    h.counts[safeIdx]++
    h.total++
    h.sum += value
  } catch {
    // 观测失败不影响业务
  }
}

export interface HistogramSnapshot {
  labels: string[]
  counts: number[]
  total: number
  avg: number | null
}

export interface MetricsSnapshot {
  counters: Partial<Record<CounterName, number>>
  histograms: Record<HistogramName, HistogramSnapshot>
  retrieval: { hitRate: number | null }
}

/** 输出聚合快照（队列 pending 由调用方单独读取后组装，避免循环依赖） */
export function getSnapshot(): MetricsSnapshot {
  const snapshot = {} as Record<HistogramName, HistogramSnapshot>
  for (const name of Object.keys(histograms) as HistogramName[]) {
    const h = histograms[name]
    snapshot[name] = {
      labels: h.labels,
      counts: h.counts,
      total: h.total,
      avg: h.total > 0 ? h.sum / h.total : null,
    }
  }

  const total = counters['retrieval.total'] ?? 0
  const hit = counters['retrieval.hit'] ?? 0

  return {
    counters,
    histograms: snapshot,
    retrieval: { hitRate: total > 0 ? hit / total : null },
  }
}
