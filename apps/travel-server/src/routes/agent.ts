import { randomUUID } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import { AgentRunRequestSchema, type AgentRunStatus } from '@travel/shared'
import { runAgent } from '../agent/runtime.js'
import { requireAuth } from '../middleware/auth.js'
import {
  appendMessage,
  createSessionId,
  ensureSession,
  getRecentMessages,
} from '../services/memoryService.js'
import { saveDraft } from '../services/itineraryService.js'
import { createStreamResponse } from '../utils/streamUtils.js'

const router = express.Router()

interface RunHandle {
  userId: string
  controller: AbortController
  status: AgentRunStatus
  startedAt: number
}

const runs = new Map<string, RunHandle>()

router.use(requireAuth)

router.post('/runs', async (req: Request<object, object, unknown>, res: Response) => {
  const parsed = AgentRunRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? '请求参数不合法',
      timestamp: new Date().toISOString(),
    })
  }

  const { message } = parsed.data
  const sessionId = parsed.data.sessionId?.trim() || createSessionId()

  try {
    const owned = await ensureSession(sessionId, req.userId!, message)
    if (!owned) {
      return res.status(404).json({ success: false, message: '会话不存在', timestamp: new Date().toISOString() })
    }
  } catch (error) {
    console.error('初始化 Agent 会话失败', error)
    return res.status(500).json({ success: false, message: '初始化会话失败', timestamp: new Date().toISOString() })
  }

  const history = await getRecentMessages(sessionId, 6).catch(() => [])
  const runId = randomUUID()
  const controller = new AbortController()
  runs.set(runId, { userId: req.userId!, controller, status: 'running', startedAt: Date.now() })

  const stream = createStreamResponse(res)
  const heartbeat = setInterval(() => {
    stream.send({ type: 'heartbeat', ts: Date.now() })
  }, 15_000)

  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  try {
    await appendMessage(sessionId, 'user', message)
    const result = await runAgent({
      runId,
      userId: req.userId!,
      sessionId,
      message,
      history,
      emit: stream.send,
      signal: controller.signal,
    })

    if (result.assistantText) {
      await appendMessage(sessionId, 'assistant', result.assistantText)
    }

    // 计划一生成就落草稿：LLM 的产出已经花掉成本了，不能因为用户没点「保存」
    // 或者刷新了页面就消失。前端拿到 itineraryId 后，「保存」只是把草稿转正。
    let itineraryId: string | undefined
    if (result.plan) {
      try {
        const draft = await saveDraft(req.userId!, {
          sessionId,
          runId,
          plan: result.plan,
          issues: result.issues,
          requirement: result.requirement ?? null,
          sourceMessage: message,
        })
        itineraryId = draft.id
      } catch (error) {
        // 落草稿失败不该让整次运行失败：计划已经发给前端，用户还能手动保存
        console.error('自动保存行程草稿失败', error)
      }
    }

    stream.send({ type: 'done', runId, status: result.status, usage: result.usage, itineraryId })
    stream.end()
  } catch (error) {
    const aborted =
      controller.signal.aborted ||
      (error as Error).name === 'AbortError' ||
      (error as Error).name === 'TimeoutError'
    if (aborted) {
      stream.send({
        type: 'done',
        runId,
        status: 'cancelled',
        usage: { promptTokens: 0, completionTokens: 0, costMicros: 0 },
      })
    } else {
      console.error('Agent 运行失败', error)
      stream.send({
        type: 'error',
        code: 'agent_error',
        message: (error as Error).message || 'Agent 运行失败',
        retryable: true,
      })
      stream.send({
        type: 'done',
        runId,
        status: 'failed',
        usage: { promptTokens: 0, completionTokens: 0, costMicros: 0 },
      })
    }
    stream.end()
  } finally {
    clearInterval(heartbeat)
    runs.delete(runId)
  }
})

router.post('/runs/:runId/cancel', (req: Request<{ runId: string }>, res: Response) => {
  const run = runs.get(req.params.runId)
  if (!run || run.userId !== req.userId) {
    return res.status(404).json({ success: false, message: '运行不存在或已结束' })
  }
  run.controller.abort()
  run.status = 'cancelled'
  return res.json({ success: true })
})

router.get('/runs/:runId', (req: Request<{ runId: string }>, res: Response) => {
  const run = runs.get(req.params.runId)
  if (!run || run.userId !== req.userId) {
    return res.status(404).json({ success: false, message: '运行不存在或已结束' })
  }
  return res.json({
    success: true,
    data: { runId: req.params.runId, status: run.status, startedAt: run.startedAt },
  })
})

export default router
