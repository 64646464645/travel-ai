import type { RowDataPacket } from 'mysql2/promise'
import { pool } from '../db/mysql.js'
import { createSessionId, DEFAULT_SESSION_TITLE } from './memoryService.js'

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

export async function createSession(): Promise<SessionRow> {
  const sessionId = createSessionId()
  await pool.query(
    'INSERT INTO sessions (session_id, title, summary) VALUES (?, ?, ?)',
    [sessionId, DEFAULT_SESSION_TITLE, ''],
  )
  return getSessionById(sessionId)
}

export async function getSessionById(sessionId: string): Promise<SessionRow> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.session_id, s.title, s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) AS message_count,
       (SELECT m2.content FROM messages m2 WHERE m2.session_id = s.session_id ORDER BY m2.id DESC LIMIT 1) AS last_message
     FROM sessions s WHERE s.session_id = ?`,
    [sessionId],
  )
  return mapSessionRow(rows[0])
}

export async function listSessions(): Promise<SessionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.session_id, s.title, s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.session_id) AS message_count,
       (SELECT m2.content FROM messages m2 WHERE m2.session_id = s.session_id ORDER BY m2.id DESC LIMIT 1) AS last_message
     FROM sessions s
     ORDER BY s.updated_at DESC`,
  )
  return rows.map(mapSessionRow)
}

export async function getSessionMessages(sessionId: string): Promise<SessionMessageRow[]> {
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

export async function renameSession(sessionId: string, title: string): Promise<SessionRow | null> {
  const [result] = await pool.query(
    'UPDATE sessions SET title = ? WHERE session_id = ?',
    [title, sessionId],
  )
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0
  if (affected === 0) return null
  return getSessionById(sessionId)
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM messages WHERE session_id = ?', [sessionId])
    const [result] = await conn.query('DELETE FROM sessions WHERE session_id = ?', [sessionId])
    await conn.commit()
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0
    return affected > 0
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}
