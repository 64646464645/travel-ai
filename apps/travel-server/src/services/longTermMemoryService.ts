import { resolve } from 'node:path'
import { LocalIndex, type MetadataTypes } from 'vectra'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { getEmbeddings } from './embeddingClient.js'
import { incCounter, observe } from './memoryMetrics.js'
import { extractMemoryFacts, shouldExtractMemory, type ExtractedFactDraft, type ExtractedMemoryFact } from './memoryExtraction.js'
import type { MemoryMessage } from './memoryService.js'

const DEFAULT_INDEX_DIR = 'data/vectra'
const DEFAULT_TOP_K = 4
const DEFAULT_SCORE_THRESHOLD = 0.3
const DEFAULT_CHUNK_SIZE = 800
const DEFAULT_CHUNK_OVERLAP = 80
const DEFAULT_MIN_CHUNK_LENGTH = 10
const DEFAULT_COVERAGE_THRESHOLD = 0.8
const COVERAGE_QUERY_TOP_K = 100
const MEMORY_TYPE_CHUNK = 'chunk'

type ChunkMetadata = Record<string, MetadataTypes>

export interface MemorySearchResult {
  content: string
  score: number
  sessionId: string
}

export type MemoryWriteStatus = 'indexed' | 'skipped' | 'failed'

export interface MemoryWriteResult {
  status: MemoryWriteStatus
  chunkCount: number
  durationMs: number
  errorCode?: string
}

export interface IndexMemoryOptions {
  skipGate?: boolean
  facts?: ExtractedFactDraft[]
}

function getIndexDir(): string {
  const dir = process.env.VECTOR_INDEX_DIR || DEFAULT_INDEX_DIR
  return resolve(process.cwd(), dir)
}

function getTopK(): number {
  const configured = Number(process.env.MEMORY_TOP_K)
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_TOP_K
}

function getScoreThreshold(): number {
  const configured = Number(process.env.MEMORY_SCORE_THRESHOLD)
  return Number.isFinite(configured) ? configured : DEFAULT_SCORE_THRESHOLD
}

function getCoverageThreshold(): number {
  const configured = Number(process.env.MEMORY_COVERAGE_THRESHOLD)
  return Number.isFinite(configured) ? configured : DEFAULT_COVERAGE_THRESHOLD
}

function isMemoryExtractionEnabled(): boolean {
  return process.env.MEMORY_EXTRACTION_ENABLED?.toLowerCase() !== 'false'
}

let indexPromise: Promise<LocalIndex<ChunkMetadata>> | null = null

/** 模块级单例 + 幂等初始化，避免重复加载与并发初始化冲突 */
function getIndex(): Promise<LocalIndex<ChunkMetadata>> {
  if (!indexPromise) {
    indexPromise = initIndex()
  }
  return indexPromise
}

async function initIndex(): Promise<LocalIndex<ChunkMetadata>> {
  const index = new LocalIndex<ChunkMetadata>(getIndexDir())
  if (!(await index.isIndexCreated())) {
    await index.createIndex({
      version: 1,
      metadata_config: { indexed: ['userId', 'sessionId'] },
    })
  }
  return index
}

/** 将最近 3 轮（前 2 轮 + 当前轮）的 user / assistant 原文合并为带前文上下文的对话块 */
function mergeConversation(messages: MemoryMessage[]): string {
  return messages
    .map((msg) => `${msg.role === 'user' ? '用户' : '助手'}：${msg.content}`)
    .join('\n')
}

async function splitChunks(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    separators: ['\n\n', '\n', '。', '！', '？', '；', '，', ' ', ''],
  })
  return splitter.splitText(text)
}

async function writeRawChunks(
  userId: string,
  sessionId: string,
  merged: string,
): Promise<number> {
  const chunks = (await splitChunks(merged)).filter(
    (chunk) => chunk.trim().length >= DEFAULT_MIN_CHUNK_LENGTH,
  )
  if (chunks.length === 0) return 0

  observe('write.chunkCount', chunks.length)
  const embeddings = getEmbeddings()
  const embedStartedAt = Date.now()
  const vectors = await embeddings.embedDocuments(chunks)
  observe('write.embeddingLatencyMs', Date.now() - embedStartedAt)

  const createdAt = new Date().toISOString()
  const index = await getIndex()
  await index.batchInsertItems(
    chunks.map((text, i) => ({
      vector: vectors[i],
      metadata: {
        userId,
        sessionId,
        type: MEMORY_TYPE_CHUNK,
        createdAt,
        text,
      } satisfies ChunkMetadata,
    })),
  )
  return chunks.length
}

async function writeExtractedFact(userId: string, fact: ExtractedMemoryFact): Promise<void> {
  const embeddings = getEmbeddings()
  const embedStartedAt = Date.now()
  const vector = await embeddings.embedQuery(fact.content)
  observe('write.embeddingLatencyMs', Date.now() - embedStartedAt)
  const index = await getIndex()

  let matchedIds: string[] = []
  try {
    const candidates = await index.queryItems(vector, '', COVERAGE_QUERY_TOP_K, { userId })
    matchedIds = candidates
      .filter((candidate) => candidate.score >= getCoverageThreshold())
      .filter((candidate) => candidate.item.metadata?.type === fact.type)
      .filter((candidate) => candidate.item.metadata?.type !== MEMORY_TYPE_CHUNK)
      .map((candidate) => candidate.item.id)
  } catch (error) {
    console.error('判定长期记忆覆盖范围失败，改为直接插入', error)
  }

  await index.batchInsertItems([{
    vector,
    metadata: {
      userId,
      sessionId: fact.sourceSessionId,
      type: fact.type,
      createdAt: fact.timestamp,
      text: fact.content,
    } satisfies ChunkMetadata,
  }])

  if (matchedIds.length === 0) {
    incCounter('coverage.insert')
    return
  }

  incCounter('coverage.overwrite')
  try {
    await index.deleteItems(matchedIds)
  } catch (error) {
    incCounter('coverage.overwriteFailed')
    console.error('删除已覆盖的长期记忆失败，新记忆已保留', error)
  }
}

/** 将最近对话按结构化事实或降级原文写入 Vectra，失败仅记日志不阻塞主流程 */
export async function indexMemory(
  userId: string,
  sessionId: string,
  recentMessages: MemoryMessage[],
  options: IndexMemoryOptions = {},
): Promise<MemoryWriteResult> {
  const startedAt = Date.now()
  incCounter('write.total')
  try {
    const merged = mergeConversation(recentMessages)
    if (!merged.trim()) {
      incCounter('write.skipped')
      return { status: 'skipped', chunkCount: 0, durationMs: Date.now() - startedAt }
    }

    if (!isMemoryExtractionEnabled()) {
      const chunkCount = await writeRawChunks(userId, sessionId, merged)
      if (chunkCount === 0) {
        incCounter('write.skipped')
        return { status: 'skipped', chunkCount, durationMs: Date.now() - startedAt }
      }
      incCounter('write.success')
      return { status: 'indexed', chunkCount, durationMs: Date.now() - startedAt }
    }

    let drafts = options.facts
    if (!drafts) {
      if (!options.skipGate) {
        if (!shouldExtractMemory(merged)) {
          incCounter('gate.miss')
          incCounter('write.skipped')
          return { status: 'skipped', chunkCount: 0, durationMs: Date.now() - startedAt }
        }
        incCounter('gate.hit')
      }

      incCounter('extraction.total')
      const extractionStartedAt = Date.now()
      try {
        drafts = await extractMemoryFacts(recentMessages)
        observe('extraction.latencyMs', Date.now() - extractionStartedAt)
        if (drafts.length > 0) incCounter('extraction.success')
        else incCounter('extraction.empty')
      } catch (error) {
        observe('extraction.latencyMs', Date.now() - extractionStartedAt)
        incCounter('extraction.failed')
        console.error('抽取长期记忆事实失败，改为原文切块', error)
        drafts = []
      }
    }

    if (drafts.length === 0) {
      const chunkCount = await writeRawChunks(userId, sessionId, merged)
      if (chunkCount === 0) {
        incCounter('write.skipped')
        return { status: 'skipped', chunkCount, durationMs: Date.now() - startedAt }
      }
      incCounter('write.success')
      return { status: 'indexed', chunkCount, durationMs: Date.now() - startedAt }
    }

    const timestamp = new Date().toISOString()
    const facts: ExtractedMemoryFact[] = drafts.map((draft) => ({ ...draft, timestamp, sourceSessionId: sessionId }))
    for (const fact of facts) await writeExtractedFact(userId, fact)
    observe('write.chunkCount', facts.length)
    incCounter('write.success')
    return { status: 'indexed', chunkCount: facts.length, durationMs: Date.now() - startedAt }
  } catch (error) {
    incCounter('write.failed')
    console.error('写入长期记忆失败，本次跳过', error)
    return {
      status: 'failed',
      chunkCount: 0,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error && error.message.includes('QWEN_API_KEY') ? 'missing_embedding_key' : 'embedding_or_index_error',
    }
  } finally {
    observe('write.latencyMs', Date.now() - startedAt)
  }
}

/** 按 userId 隔离做语义检索，取 topK 并按分数阈值过滤低分结果 */
export async function searchMemory(
  userId: string,
  query: string,
): Promise<MemorySearchResult[]> {
  const startedAt = Date.now()
  incCounter('retrieval.total')
  try {
    if (!query.trim()) {
      incCounter('retrieval.skipped')
      return []
    }

    const embeddings = getEmbeddings()
    const queryVector = await embeddings.embedQuery(query)

    const index = await getIndex()
    const results = await index.queryItems(queryVector, '', getTopK(), { userId })

    // 记录所有返回结果的分数（含被阈值过滤的低分），用于观察阈值裁剪效果
    for (const result of results) {
      observe('retrieval.score', result.score)
    }

    const threshold = getScoreThreshold()
    const filtered = results
      .filter((result) => result.score >= threshold)
      .map((result) => ({
        content: String(result.item.metadata?.text ?? ''),
        score: result.score,
        sessionId: String(result.item.metadata?.sessionId ?? ''),
      }))
      .filter((result) => result.content.trim().length > 0)

    if (filtered.length > 0) {
      incCounter('retrieval.hit')
      observe('retrieval.recalledCount', filtered.length)
    }

    return filtered
  } catch (error) {
    incCounter('retrieval.failed')
    console.error('检索长期记忆失败，退化为无长期记忆', error)
    return []
  } finally {
    observe('retrieval.latencyMs', Date.now() - startedAt)
  }
}

export interface DeleteBySessionResult {
  sessionId: string
  deletedCount: number
  errorCode?: string
}

/** 删除会话时清理该会话所有向量；仍捕获异常不抛出以保持生产降级语义，但返回结构化结果供调用方观测 */
export async function deleteBySession(sessionId: string): Promise<DeleteBySessionResult> {
  try {
    const index = await getIndex()
    const items = await index.listItemsByMetadata({ sessionId })
    if (items.length > 0) {
      await index.deleteItems(items.map((item) => item.id))
      return { sessionId, deletedCount: items.length }
    }
    // 索引中无匹配项：deletedCount 为 0 且无 errorCode，与删除失败明确区分
    return { sessionId, deletedCount: 0 }
  } catch (error) {
    console.error('清理会话长期记忆失败，忽略', error)
    return { sessionId, deletedCount: 0, errorCode: 'delete_failed' }
  }
}

/**
 * 评测专用：使模块级索引单例失效，下一次 getIndex 会基于当前 VECTOR_INDEX_DIR 重建。
 * 用于评测切换临时索引目录后强制绑定独立索引实例；生产调用方不应使用。
 */
export function resetMemoryIndexInstance(): void {
  indexPromise = null
}
