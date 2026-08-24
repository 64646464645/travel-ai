import express, { type Request, type Response } from 'express'
import { RenameSessionRequestSchema } from '@travel/shared'
import {
  createSession,
  deleteSession,
  getSessionMessages,
  listSessions,
  renameSession,
} from '../services/sessionService.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()
router.use(requireAuth)

router.post('/', async (req: Request, res: Response) => {
  try {
    const session = await createSession(req.userId!)
    res.json({ success: true, data: session })
  } catch (error) {
    console.error('创建会话失败', error)
    res.status(500).json({ success: false, message: '创建会话失败', timestamp: new Date().toISOString() })
  }
})

router.get('/', async (req: Request, res: Response) => {
  try {
    const sessions = await listSessions(req.userId!)
    res.json({ success: true, data: sessions })
  } catch (error) {
    console.error('查询会话列表失败', error)
    res.status(500).json({ success: false, message: '查询会话列表失败', timestamp: new Date().toISOString() })
  }
})

router.get('/:sessionId/messages', async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const messages = await getSessionMessages(req.params.sessionId, req.userId!)
    if (!messages) {
      return res.status(404).json({ success: false, message: '会话不存在', timestamp: new Date().toISOString() })
    }
    res.json({ success: true, data: { sessionId: req.params.sessionId, messages } })
  } catch (error) {
    console.error('查询会话消息失败', error)
    res.status(500).json({ success: false, message: '查询会话消息失败', timestamp: new Date().toISOString() })
  }
})

router.patch('/:sessionId', async (req: Request<{ sessionId: string }, object, unknown>, res: Response) => {
  const parsed = RenameSessionRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? '请求参数不合法',
      timestamp: new Date().toISOString(),
    })
  }

  try {
    const session = await renameSession(req.params.sessionId, req.userId!, parsed.data.title)
    if (!session) {
      return res.status(404).json({ success: false, message: '会话不存在', timestamp: new Date().toISOString() })
    }
    res.json({ success: true, data: session })
  } catch (error) {
    console.error('重命名会话失败', error)
    res.status(500).json({ success: false, message: '重命名会话失败', timestamp: new Date().toISOString() })
  }
})

router.delete('/:sessionId', async (req: Request<{ sessionId: string }>, res: Response) => {
  try {
    const deleted = await deleteSession(req.params.sessionId, req.userId!)
    if (!deleted) {
      return res.status(404).json({ success: false, message: '会话不存在', timestamp: new Date().toISOString() })
    }
    res.json({ success: true })
  } catch (error) {
    console.error('删除会话失败', error)
    res.status(500).json({ success: false, message: '删除会话失败', timestamp: new Date().toISOString() })
  }
})

export default router
