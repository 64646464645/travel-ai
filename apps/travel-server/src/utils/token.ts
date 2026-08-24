import { createHash, randomBytes } from 'node:crypto'
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken'

const DEFAULT_ACCESS_TOKEN_TTL = '15m'
const DEFAULT_REFRESH_TOKEN_TTL = '30d'

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET 未配置')
  }
  return secret
}

export function signAccessToken(userId: string): string {
  const expiresIn = (process.env.ACCESS_TOKEN_TTL ?? DEFAULT_ACCESS_TOKEN_TTL) as SignOptions['expiresIn']
  return jwt.sign({ type: 'access' }, getJwtSecret(), {
    subject: userId,
    expiresIn,
    algorithm: 'HS256',
  })
}

export function verifyAccessToken(token: string): string {
  const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as JwtPayload
  if (payload.type !== 'access' || typeof payload.sub !== 'string') {
    throw new Error('无效的 access token')
  }
  return payload.sub
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex')
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function getRefreshTokenExpiresAt(now = new Date()): Date {
  const ttl = process.env.REFRESH_TOKEN_TTL ?? DEFAULT_REFRESH_TOKEN_TTL
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl)
  if (!match) {
    throw new Error('REFRESH_TOKEN_TTL 格式无效，请使用 30d、12h 等格式')
  }

  const amount = Number(match[1])
  const units: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }
  return new Date(now.getTime() + amount * units[match[2]])
}
