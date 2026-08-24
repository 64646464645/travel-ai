import express, { type Request, type Response } from 'express'
import {
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  RegisterRequestSchema,
} from '@travel/shared'
import { requireAuth } from '../middleware/auth.js'
import {
  AuthError,
  getMe,
  login,
  logout,
  refresh,
  register,
} from '../services/authService.js'

const router = express.Router()

function validationError(res: Response, message: string): Response {
  return res.status(400).json({ success: false, message, timestamp: new Date().toISOString() })
}

function authError(res: Response, error: unknown): Response {
  if (error instanceof AuthError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      timestamp: new Date().toISOString(),
    })
  }
  console.error('认证接口错误', error)
  return res.status(500).json({ success: false, message: '认证服务异常', timestamp: new Date().toISOString() })
}

router.post('/register', async (req: Request<object, object, unknown>, res: Response) => {
  const parsed = RegisterRequestSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message ?? '请求参数不合法')
  try {
    const data = await register(parsed.data.username, parsed.data.password, parsed.data.nickname)
    return res.status(201).json({ success: true, data })
  } catch (error) {
    return authError(res, error)
  }
})

router.post('/login', async (req: Request<object, object, unknown>, res: Response) => {
  const parsed = LoginRequestSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message ?? '请求参数不合法')
  try {
    return res.json({ success: true, data: await login(parsed.data.username, parsed.data.password) })
  } catch (error) {
    return authError(res, error)
  }
})

router.post('/refresh', async (req: Request<object, object, unknown>, res: Response) => {
  const parsed = RefreshTokenRequestSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message ?? '请求参数不合法')
  try {
    return res.json({ success: true, data: await refresh(parsed.data.refreshToken) })
  } catch (error) {
    return authError(res, error)
  }
})

router.post('/logout', async (req: Request<object, object, unknown>, res: Response) => {
  const parsed = RefreshTokenRequestSchema.safeParse(req.body)
  if (!parsed.success) return validationError(res, parsed.error.issues[0]?.message ?? '请求参数不合法')
  try {
    await logout(parsed.data.refreshToken)
    return res.json({ success: true })
  } catch (error) {
    return authError(res, error)
  }
})

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await getMe(req.userId!) })
  } catch (error) {
    return authError(res, error)
  }
})

export default router
