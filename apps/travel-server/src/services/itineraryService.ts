import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  AgentPlanSchema,
  AgentRequirementSchema,
  AgentValidationIssueSchema,
  type AgentPlan,
  type AgentRequirement,
  type AgentValidationIssue,
  type ItineraryDetail,
  type ItineraryListResponse,
  type ItinerarySaveRequest,
  type ItinerarySummary,
} from '@travel/shared'
import { pool } from '../db/mysql.js'

/** 快照版本：plan schema 发生不兼容变化时递增，读取端据此决定是否降级渲染 */
export const ITINERARY_SCHEMA_VERSION = 1

function toIsoString(value: unknown): string {
  if (value == null) return ''
  const date = value instanceof Date ? value : new Date(value as string)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function toDateOnly(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

/** JSON 列在 mysql2 里可能已经是对象，也可能是字符串，统一成对象 */
function parseJsonColumn<T>(value: unknown, parse: (input: unknown) => T): T | null {
  if (value == null) return null
  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value
    return parse(raw)
  } catch {
    return null
  }
}

function mapSummary(row: RowDataPacket): ItinerarySummary {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    status: (row.status as ItinerarySummary['status']) ?? 'saved',
    city: String(row.city ?? ''),
    startDate: toDateOnly(row.start_date),
    days: Number(row.days ?? 0),
    totalBudget: Number(row.total_budget ?? 0),
    activityCount: Number(row.activity_count ?? 0),
    unverifiedCount: Number(row.unverified_count ?? 0),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

function mapDetail(row: RowDataPacket): ItineraryDetail | null {
  const plan = parseJsonColumn<AgentPlan>(row.plan, (input) => AgentPlanSchema.parse(input))
  if (!plan) return null
  const requirement = parseJsonColumn<AgentRequirement | null>(row.requirement, (input) =>
    input == null ? null : AgentRequirementSchema.parse(input),
  )
  const issues = parseJsonColumn<AgentValidationIssue[]>(row.issues, (input) =>
    AgentValidationIssueSchema.array().parse(input ?? []),
  )

  return {
    ...mapSummary(row),
    plan,
    requirement: requirement ?? null,
    issues: issues ?? [],
    sessionId: (row.session_id as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    sourceMessage: (row.source_message as string | null) ?? null,
    schemaVersion: Number(row.schema_version ?? 1),
  }
}

function defaultTitle(plan: AgentPlan): string {
  return `${plan.city} ${plan.days} 天行程`.slice(0, 64)
}

interface SaveOptions {
  status?: 'draft' | 'saved'
  sourceMessage?: string | null
}

async function insertItinerary(
  userId: string,
  input: ItinerarySaveRequest,
  options: SaveOptions,
): Promise<string> {
  const { plan } = input
  const id = randomUUID()
  const activityCount = plan.dailyItinerary.length * 3
  const firstDate = plan.dailyItinerary[0]?.date ?? ''
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(firstDate) ? firstDate : null

  await pool.query<ResultSetHeader>(
    `INSERT INTO itineraries
      (id, user_id, session_id, run_id, title, status, source_message, city, start_date, days, total_budget,
       activity_count, unverified_count, schema_version, plan, requirement, issues)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.sessionId ?? null,
      input.runId ?? null,
      (input.title?.trim() || defaultTitle(plan)).slice(0, 64),
      options.status ?? 'saved',
      options.sourceMessage ? options.sourceMessage.slice(0, 500) : null,
      plan.city.slice(0, 64),
      startDate,
      plan.days,
      plan.totalBudget,
      activityCount,
      plan.unverified.length,
      ITINERARY_SCHEMA_VERSION,
      JSON.stringify(plan),
      input.requirement ? JSON.stringify(input.requirement) : null,
      JSON.stringify(input.issues ?? []),
    ],
  )

  return id
}

export async function saveItinerary(
  userId: string,
  input: ItinerarySaveRequest,
): Promise<ItineraryDetail> {
  const id = await insertItinerary(userId, input, { status: 'saved' })
  const saved = await getItinerary(id, userId)
  if (!saved) throw new Error('行程保存后读取失败')
  return saved
}

/**
 * 运行结束就落草稿：刷新页面不该让已经花掉的 LLM 产出消失。
 * 同一个会话只保留最新一条草稿，避免反复调试时堆垃圾。
 */
export async function saveDraft(
  userId: string,
  input: ItinerarySaveRequest & { sourceMessage?: string },
): Promise<ItineraryDetail> {
  if (input.sessionId) {
    await pool.query(
      "DELETE FROM itineraries WHERE user_id = ? AND session_id = ? AND status = 'draft'",
      [userId, input.sessionId],
    )
  }
  // 顺手清掉长期没确认的草稿，避免每次调试都留一条永不展示的记录
  await pool.query(
    "DELETE FROM itineraries WHERE user_id = ? AND status = 'draft' AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)",
    [userId],
  )
  const id = await insertItinerary(userId, input, {
    status: 'draft',
    sourceMessage: input.sourceMessage,
  })
  const saved = await getItinerary(id, userId)
  if (!saved) throw new Error('草稿保存后读取失败')
  return saved
}

export async function confirmItinerary(id: string, userId: string): Promise<ItineraryDetail | null> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE itineraries SET status = 'saved' WHERE id = ? AND user_id = ?",
    [id, userId],
  )
  if (result.affectedRows === 0) return null
  return getItinerary(id, userId)
}

export async function listItineraries(
  userId: string,
  limit: number,
  offset: number,
  status?: 'draft' | 'saved',
): Promise<ItineraryListResponse> {
  const where = status ? 'user_id = ? AND status = ?' : 'user_id = ?'
  const params = status ? [userId, status] : [userId]
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, status, city, start_date, days, total_budget, activity_count, unverified_count, created_at, updated_at
     FROM itineraries WHERE ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM itineraries WHERE ${where}`,
    params,
  )
  return {
    items: rows.map(mapSummary),
    total: Number(countRows[0]?.total ?? 0),
  }
}

/** 恢复用：取该用户（或该会话）最近一条行程，草稿优先即可满足「刷新后还在」 */
export async function getLatestItinerary(
  userId: string,
  sessionId?: string,
): Promise<ItineraryDetail | null> {
  const where = sessionId ? 'user_id = ? AND session_id = ?' : 'user_id = ?'
  const params = sessionId ? [userId, sessionId] : [userId]
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, status, city, start_date, days, total_budget, activity_count, unverified_count,
            created_at, updated_at, session_id, run_id, source_message, schema_version, plan, requirement, issues
     FROM itineraries WHERE ${where}
     ORDER BY created_at DESC LIMIT 1`,
    params,
  )
  return rows[0] ? mapDetail(rows[0]) : null
}

export async function getItinerary(id: string, userId: string): Promise<ItineraryDetail | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, status, city, start_date, days, total_budget, activity_count, unverified_count,
            created_at, updated_at, session_id, run_id, source_message, schema_version, plan, requirement, issues
     FROM itineraries WHERE id = ? AND user_id = ?`,
    [id, userId],
  )
  return rows[0] ? mapDetail(rows[0]) : null
}

export async function deleteItinerary(id: string, userId: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM itineraries WHERE id = ? AND user_id = ?',
    [id, userId],
  )
  return result.affectedRows > 0
}
