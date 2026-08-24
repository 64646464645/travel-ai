import type { RowDataPacket } from 'mysql2/promise'
import { pool } from '../db/mysql.js'
import { createSessionId, DEFAULT_SESSION_TITLE } from './memoryService.js'
import { deleteBySession } from './longTermMemoryService.js'

export interface SessionRow {
  sessionId: string
  title: string
  messageCount: number
  lastMessagePreview: string
  createdAt: string
  updatedAt: string
}

export interface SessionMessageRow {
  id: number
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

function toIsoString(value: unknown): string {
  if (value == null) return ''
  const date = value instanceof Date ? value : new Date(value as string)
  return date.toISOString()
}

function mapSessionRow(row?: RowDataPacket): SessionRow {
  return {
    sessionId: row?.session_id as string,
    title: (row?.title as string) ?? '',
    messageCount: Number(row?.message_count ?? 0),
    lastMessagePreview: (row?.last_message as string) ?? '',
    createdAt: toIsoString(row?.created_at),
    updatedAt: toIsoString(row?.updated_at),
  }
}

export async function createSession(userId: string): Promise<SessionRow> {
  const sessionId = createSessionId()
  await pool.query(
    'INSERT INTO sessions (session_id, user_id, title, summary) VALUES (?, ?, ?, ?)',
    [sessionId, userId, DEFAULT_SESSION_TITLE, ''],
  )
  return (await getSessionById(sessionId, userId))!
}

export async function getSessionById(sessionId: string, userId: string): Promise<SessionRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.session_id, s.title, s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) AS message_count,
       (SELECT m2.content FROM messages m2 WHERE m2.session_id = s.session_id ORDER BY m2.id DESC LIMIT 1) AS last_message
     FROM sessions s WHERE s.session_id = ? AND s.user_id = ?`,
    [sessionId, userId],
  )
  return rows[0] ? mapSessionRow(rows[0]) : null
}

export async function listSessions(userId: string): Promise<SessionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.session_id, s.title, s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) AS message_count,
       (SELECT m2.content FROM messages m2 WHERE m2.session_id = s.session_id ORDER BY m2.id DESC LIMIT 1) AS last_message
     FROM sessions s WHERE s.user_id = ?
     ORDER BY s.updated_at DESC`,
    [userId],
  )
  return rows.map(mapSessionRow)
}

export async function getSessionMessages(sessionId: string, userId: string): Promise<SessionMessageRow[] | null> {
  if (!(await getSessionById(sessionId, userId))) return null
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC',
    [sessionId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    role: row.role as 'user' | 'assistant',
    content: row.content as string,
    timestamp: toIsoString(row.created_at),
  }))
}

export async function renameSession(sessionId: string, userId: string, title: string): Promise<SessionRow | null> {
  const [result] = await pool.query(
    'UPDATE sessions SET title = ? WHERE session_id = ? AND user_id = ?',
    [title, sessionId, userId],
  )
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0
  if (affected === 0) return null
  return getSessionById(sessionId, userId)
}

export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [ownedRows] = await conn.query<RowDataPacket[]>(
      'SELECT session_id FROM sessions WHERE session_id = ? AND user_id = ? FOR UPDATE',
      [sessionId, userId],
    )
    if (!ownedRows[0]) {
      await conn.rollback()
      return false
    }
    await conn.query('DELETE FROM messages WHERE session_id = ?', [sessionId])
    const [result] = await conn.query(
      'DELETE FROM sessions WHERE session_id = ? AND user_id = ?',
      [sessionId, userId],
    )
    await conn.commit()
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0
    if (affected > 0) {
      // 数据库删除成功后联动清理该会话向量，失败仅记日志（deleteBySession 内部已降级）
      await deleteBySession(sessionId)
    }
    return affected > 0
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}
