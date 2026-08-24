import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken } from '../utils/token.js'

declare global {
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authorization = req.header('authorization')
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '')
  if (!match) {
    res.status(401).json({ success: false, message: '请先登录', timestamp: new Date().toISOString() })
    return
  }

  try {
    req.userId = verifyAccessToken(match[1])
    next()
  } catch {
    res.status(401).json({ success: false, message: '登录已过期', timestamp: new Date().toISOString() })
  }
}

