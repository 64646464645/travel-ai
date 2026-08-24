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

/** 首次创建会话记录，title 由首条用户消息截断生成；已存在且为默认/空标题时更新 */
export async function ensureSession(
  sessionId: string,
  userId: string,
  firstMessage: string,
): Promise<boolean> {
  const title = firstMessage.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX_LENGTH)
  await pool.query(
    `INSERT IGNORE INTO sessions (session_id, user_id, title, summary) VALUES (?, ?, ?, '')`,
    [sessionId, userId, title],
  )
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT user_id FROM sessions WHERE session_id = ?',
    [sessionId],
  )
  if (rows[0]?.user_id !== userId) return false

  await pool.query(
    `UPDATE sessions SET title = IF(title = '' OR title = ?, ?, title)
     WHERE session_id = ? AND user_id = ?`,
    [DEFAULT_SESSION_TITLE, title, sessionId, userId],
  )
  return true
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
