import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Response } from 'express'
import type { AgentEvent } from '@travel/shared'
import { createStreamResponse } from '../utils/streamUtils.js'

interface FakeResponse {
  res: Response
  headers: Record<string, string>
  body: () => string
  ended: () => boolean
}

function createFakeResponse(): FakeResponse {
  const headers: Record<string, string> = {}
  let body = ''
  let ended = false
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value
    },
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      body += chunk
      return true
    },
    end: () => {
      ended = true
    },
  }
  return {
    res: res as unknown as Response,
    headers,
    body: () => body,
    ended: () => ended,
  }
}

/** 按前端 fetchAgentStream 的方式拆帧，验证编码/解码能对上 */
function decodeFrames(body: string): unknown[] {
  return body
    .split('\n\n')
    .filter(Boolean)
    .flatMap((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6))),
    )
}

test('SSE 响应头包含禁止代理缓冲与立即 flush', () => {
  const fake = createFakeResponse()
  createStreamResponse(fake.res)
  assert.equal(fake.headers['Content-Type'], 'text/event-stream')
  assert.equal(fake.headers['Cache-Control'], 'no-cache')
  assert.equal(fake.headers['X-Accel-Buffering'], 'no')
})

test('单个事件编码为 `data: {...}\\n\\n`', () => {
  const fake = createFakeResponse()
  const stream = createStreamResponse(fake.res)
  stream.send({ type: 'heartbeat', ts: 123 })
  assert.equal(fake.body(), 'data: {"type":"heartbeat","ts":123}\n\n')
})

test('多个事件按帧分隔，可被前端逐条解析', () => {
  const fake = createFakeResponse()
  const stream = createStreamResponse(fake.res)
  const events: AgentEvent[] = [
    { type: 'run_started', runId: 'r1', sessionId: 's1' },
    { type: 'node_started', node: 'understand', seq: 1, at: 1000 },
    { type: 'tool_call', callId: 'c1', name: 'search_poi', args: { city: '成都' }, at: 1001 },
    { type: 'done', runId: 'r1', status: 'completed', usage: { promptTokens: 1, completionTokens: 2, costMicros: 0 } },
  ]
  for (const event of events) stream.send(event)
  assert.deepEqual(decodeFrames(fake.body()), events)
})

test('结束时不自动写 done，由调用方决定', () => {
  const fake = createFakeResponse()
  const stream = createStreamResponse(fake.res)
  stream.send({ type: 'heartbeat', ts: 1 })
  stream.end()
  assert.equal(fake.ended(), true)
  assert.equal(decodeFrames(fake.body()).length, 1)
})

test('error 写一帧后立即结束', () => {
  const fake = createFakeResponse()
  const stream = createStreamResponse(fake.res)
  stream.error('连接中断')
  assert.deepEqual(decodeFrames(fake.body()), [{ type: 'error', error: '连接中断' }])
  assert.equal(fake.ended(), true)
})
