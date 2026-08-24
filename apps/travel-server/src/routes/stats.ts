import express, { type Request, type Response } from 'express'
import { getSnapshot } from '../services/memoryMetrics.js'
import { getPendingCount } from '../services/memoryWriteQueue.js'

const router = express.Router()

/** 只读指标快照：含检索 / 写入计数与分桶直方图，及当前队列积压 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      ...getSnapshot(),
      queue: { pending: getPendingCount() },
    },
  })
})

export default router
