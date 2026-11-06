import express, { type Request, type Response } from 'express'
import { ItineraryListQuerySchema, ItinerarySaveRequestSchema } from '@travel/shared'
import { requireAuth } from '../middleware/auth.js'
import {
  confirmItinerary,
  deleteItinerary,
  getItinerary,
  getLatestItinerary,
  listItineraries,
  saveItinerary,
} from '../services/itineraryService.js'

const router = express.Router()
router.use(requireAuth)

function fail(res: Response, status: number, message: string): Response {
  return res.status(status).json({ success: false, message, timestamp: new Date().toISOString() })
}

router.post('/', async (req: Request<object, object, unknown>, res: Response) => {
  const parsed = ItinerarySaveRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 400, parsed.error.issues[0]?.message ?? '行程数据不合法')
  }

  try {
    const saved = await saveItinerary(req.userId!, parsed.data)
    return res.status(201).json({ success: true, data: saved })
  } catch (error) {
    console.error('保存行程失败', error)
    return fail(res, 500, '保存行程失败')
  }
})

router.get('/', async (req: Request, res: Response) => {
  const parsed = ItineraryListQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return fail(res, 400, parsed.error.issues[0]?.message ?? '查询参数不合法')
  }

  try {
    const data = await listItineraries(req.userId!, parsed.data.limit, parsed.data.offset, parsed.data.status)
    return res.json({ success: true, data })
  } catch (error) {
    console.error('查询行程列表失败', error)
    return fail(res, 500, '查询行程列表失败')
  }
})

// 必须排在 /:id 之前，否则 latest 会被当成 id
router.get('/latest', async (req: Request, res: Response) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined
  try {
    const detail = await getLatestItinerary(req.userId!, sessionId)
    if (!detail) return fail(res, 404, '还没有保存或生成过行程')
    return res.json({ success: true, data: detail })
  } catch (error) {
    console.error('查询最近行程失败', error)
    return fail(res, 500, '查询最近行程失败')
  }
})

router.patch('/:id/confirm', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const detail = await confirmItinerary(req.params.id, req.userId!)
    if (!detail) return fail(res, 404, '行程不存在')
    return res.json({ success: true, data: detail })
  } catch (error) {
    console.error('确认行程失败', error)
    return fail(res, 500, '确认行程失败')
  }
})

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const detail = await getItinerary(req.params.id, req.userId!)
    if (!detail) return fail(res, 404, '行程不存在')
    return res.json({ success: true, data: detail })
  } catch (error) {
    console.error('查询行程详情失败', error)
    return fail(res, 500, '查询行程详情失败')
  }
})

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const removed = await deleteItinerary(req.params.id, req.userId!)
    if (!removed) return fail(res, 404, '行程不存在')
    return res.json({ success: true })
  } catch (error) {
    console.error('删除行程失败', error)
    return fail(res, 500, '删除行程失败')
  }
})

export default router
