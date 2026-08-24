import { resolve } from 'node:path'
import { LocalIndex, type MetadataTypes } from 'vectra'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { getEmbeddings } from './embeddingClient.js'
import { incCounter, observe } from './memoryMetrics.js'
import type { MemoryMessage } from './memoryService.js'

const DEFAULT_INDEX_DIR = 'data/vectra'
const DEFAULT_TOP_K = 4
const DEFAULT_SCORE_THRESHOLD = 0.3
const DEFAULT_CHUNK_SIZE = 800
const DEFAULT_CHUNK_OVERLAP = 80
const DEFAULT_MIN_CHUNK_LENGTH = 10
const MEMORY_TYPE_CHUNK = 'chunk'

type ChunkMetadata = Record<string, MetadataTypes>

export interface MemorySearchResult {
  content: string
  score: number
  sessionId: string
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

/** 将最近对话切块向量化写入 Vectra，失败仅记日志不阻塞主流程 */
export async function indexMemory(
  userId: string,
  sessionId: string,
  recentMessages: MemoryMessage[],
): Promise<void> {
  const startedAt = Date.now()
  incCounter('write.total')
  try {
    const merged = mergeConversation(recentMessages)
    if (!merged.trim()) {
      incCounter('write.skipped')
      return
    }

    const chunks = (await splitChunks(merged)).filter(
      (chunk) => chunk.trim().length >= DEFAULT_MIN_CHUNK_LENGTH,
    )
    if (chunks.length === 0) {
      incCounter('write.skipped')
      return
    }
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
  } catch (error) {
    incCounter('write.failed')
    console.error('写入长期记忆失败，本次跳过', error)
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

/** 删除会话时清理该会话所有向量，失败仅记日志 */
export async function deleteBySession(sessionId: string): Promise<void> {
  try {
    const index = await getIndex()
    const items = await index.listItemsByMetadata({ sessionId })
    if (items.length > 0) {
      await index.deleteItems(items.map((item) => item.id))
    }
  } catch (error) {
    console.error('清理会话长期记忆失败，忽略', error)
  }
}
