import { randomUUID } from 'node:crypto'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { AuthResponse, User } from '@travel/shared'
import { pool } from '../db/mysql.js'
import { hashPassword, verifyPassword } from '../utils/password.js'
import {
  generateRefreshToken,
  getRefreshTokenExpiresAt,
  hashRefreshToken,
  signAccessToken,
} from '../utils/token.js'

interface UserRow extends RowDataPacket {
  id: string
  username: string
  password_hash: string
  nickname: string | null
  avatar_url: string | null
  created_at: Date
  updated_at: Date
}

interface RefreshTokenRow extends UserRow {
  token_id: string
  expires_at: Date
  revoked_at: Date | null
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

function toIsoString(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

async function issueTokens(connection: PoolConnection, user: User): Promise<AuthResponse> {
  const accessToken = signAccessToken(user.id)
  const refreshToken = generateRefreshToken()
  await connection.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [randomUUID(), user.id, hashRefreshToken(refreshToken), getRefreshTokenExpiresAt()],
  )
  return { accessToken, refreshToken, user }
}

export async function register(
  username: string,
  password: string,
  nickname?: string,
): Promise<AuthResponse> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const userId = randomUUID()
    const passwordHash = await hashPassword(password)

    try {
      await connection.query(
        'INSERT INTO users (id, username, password_hash, nickname) VALUES (?, ?, ?, ?)',
        [userId, username, passwordHash, nickname ?? null],
      )
    } catch (error) {
      if ((error as { errno?: number }).errno === 1062) {
        throw new AuthError('用户名已存在', 409)
      }
      throw error
    }

    const [rows] = await connection.query<UserRow[]>(
      'SELECT * FROM users WHERE id = ?',
      [userId],
    )
    const response = await issueTokens(connection, mapUser(rows[0]))
    await connection.commit()
    return response
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const [rows] = await pool.query<UserRow[]>(
    'SELECT * FROM users WHERE username = ? LIMIT 1',
    [username],
  )
  const row = rows[0]
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new AuthError('用户名或密码错误', 401)
  }

  const connection = await pool.getConnection()
  try {
    const response = await issueTokens(connection, mapUser(row))
    return response
  } finally {
    connection.release()
  }
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [rows] = await connection.query<RefreshTokenRow[]>(
      `SELECT rt.id AS token_id, rt.expires_at, rt.revoked_at,
              u.id, u.username, u.password_hash, u.nickname, u.avatar_url, u.created_at, u.updated_at
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ?
       FOR UPDATE`,
      [hashRefreshToken(refreshToken)],
    )
    const row = rows[0]
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new AuthError('refresh token 无效或已过期', 401)
    }

    const response = await issueTokens(connection, mapUser(row))
    await connection.query(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
      [row.token_id],
    )
    await connection.commit()
    return response
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function logout(refreshToken: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP(3)
     WHERE token_hash = ? AND revoked_at IS NULL`,
    [hashRefreshToken(refreshToken)],
  )
}

export async function getMe(userId: string): Promise<User> {
  const [rows] = await pool.query<UserRow[]>('SELECT * FROM users WHERE id = ?', [userId])
  if (!rows[0]) {
    throw new AuthError('用户不存在', 401)
  }
  return mapUser(rows[0])
}

