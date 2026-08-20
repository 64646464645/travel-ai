import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { pool } from '../db/mysql.js'

export type MessageRole = 'user' | 'assistant'

export interface MemoryMessage {
  role: MessageRole
  content: string
}

const DEFAULT_WINDOW_SIZE = 10
const TITLE_MAX_LENGTH = 30

export const DEFAULT_SESSION_TITLE = '新会话'

export function createSessionId(): string {
  return randomUUID()
}

export function getWindowSize(): number {
  const size = Number(process.env.MEMORY_WINDOW_SIZE)
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : DEFAULT_WINDOW_SIZE
}

export function getCompressionThreshold(): number {
  const configured = Number(process.env.COMPRESSION_THRESHOLD)
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured)
  }
  return getWindowSize() * 2
}

/** 首次创建会话记录，title 由首条用户消息截断生成；已存在且为默认/空标题时更新 */
export async function ensureSession(sessionId: string, firstMessage: string): Promise<void> {
  const title = firstMessage.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX_LENGTH)
  await pool.query(
    `INSERT INTO sessions (session_id, title, summary) VALUES (?, ?, '')
     ON DUPLICATE KEY UPDATE title = IF(title = '' OR title = ?, VALUES(title), title)`,
    [sessionId, title, DEFAULT_SESSION_TITLE],
  )
}

export async function getSummary(sessionId: string): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT summary FROM sessions WHERE session_id = ?',
    [sessionId],
  )
  return rows[0]?.summary ?? ''
}

export async function updateSummary(sessionId: string, summary: string): Promise<void> {
  await pool.query(
    'UPDATE sessions SET summary = ? WHERE session_id = ?',
    [summary, sessionId],
  )
}

export async function appendMessage(
  sessionId: string,
  role: MessageRole,
  content: string,
): Promise<void> {
  await pool.query(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)',
    [sessionId, role, content],
  )
  await pool.query(
    'UPDATE sessions SET updated_at = CURRENT_TIMESTAMP(3) WHERE session_id = ?',
    [sessionId],
  )
}

/** 统计会话中 user / assistant 原文数量 */
export async function getMessageCount(sessionId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ? AND role IN (?, ?)',
    [sessionId, 'user', 'assistant'],
  )
  return Number(rows[0]?.cnt ?? 0)
}

export async function getRecentMessages(
  sessionId: string,
  limit?: number,
): Promise<MemoryMessage[]> {
  const size = limit ?? getWindowSize()
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?',
    [sessionId, size],
  )

  return rows
    .map((row) => ({
      role: row.role as MessageRole,
      content: row.content as string,
    }))
    .reverse()
}

/** 取会话中最早的 N 条原文（按时间正序） */
export async function getEarliestMessages(
  sessionId: string,
  limit: number,
): Promise<MemoryMessage[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?',
    [sessionId, limit],
  )

  return rows.map((row) => ({
    role: row.role as MessageRole,
    content: row.content as string,
  }))
}
