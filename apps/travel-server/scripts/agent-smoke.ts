/**
 * M1 冒烟：跑一次完整 Agent 闭环。
 *
 * 默认用本地 mock 高德，验证链路而不消耗真实配额；
 * 加 `--real` 则直接打真实高德（读 .env 的 AMAP_KEY），用于验收数据真实性。
 *
 * 运行：
 *   npm run smoke:agent -w travel-server                 # mock
 *   npm run smoke:agent -w travel-server -- --real       # 真实高德
 */
import 'dotenv/config'
import type { Server } from 'node:http'
import type { AgentEvent } from '@travel/shared'
import { startMockAmap } from './mockAmap.js'

function describe(event: AgentEvent): string {
  switch (event.type) {
    case 'node_started':
    case 'node_finished':
      return `${event.type} ${event.node}`
    case 'tool_call':
      return `tool_call ${event.name} ${JSON.stringify(event.args).slice(0, 80)}`
    case 'tool_result':
      return `tool_result ${event.name} ${event.ok ? 'ok' : 'FAIL'} ${event.summary.slice(0, 60)}`
    case 'validation':
      return `validation passed=${event.passed} issues=${event.issues
        .map((item) => `${item.ruleId}/${item.severity}${item.severity === 'error' ? `(${item.path}: ${item.message})` : ''}`)
        .join(' · ')}`
    case 'error':
      return `error ${event.message}`
    default:
      return event.type
  }
}

async function main() {
  const args = process.argv.slice(2)
  const useReal = args.includes('--real')
  const message = args.find((item) => !item.startsWith('--')) ?? '成都三天，预算 3000，不吃辣'

  let mock: Server | undefined
  if (useReal) {
    if (!process.env.AMAP_KEY) throw new Error('未配置 AMAP_KEY，无法使用 --real 模式')
    console.log('使用真实高德接口')
  } else {
    const started = await startMockAmap()
    mock = started.server
    process.env.AMAP_KEY = 'mock-key'
    process.env.AMAP_BASE_URL = started.baseUrl
    console.log('使用 mock 高德接口')
  }

  const { runAgent } = await import('../src/agent/runtime.js')

  const events: AgentEvent[] = []
  const startedAt = Date.now()

  try {
    const result = await runAgent({
      runId: 'smoke-run',
      userId: 'smoke-user',
      sessionId: 'smoke-session',
      message,
      history: [],
      emit: (event) => {
        events.push(event)
        console.log(`  [event] ${describe(event)}`)
      },
      signal: new AbortController().signal,
    })

    console.log('\n=== 结果 ===')
    console.log('status:', result.status)
    console.log('assistantText:', result.assistantText)
    console.log('usage:', result.usage)

    if (result.plan) {
      console.log(`plan: ${result.plan.city} ${result.plan.days} 天 ${result.plan.totalBudget} 元`)
      for (const day of result.plan.dailyItinerary) {
        console.log(`  第${day.day}天 ${day.date}`)
        for (const slot of ['morning', 'afternoon', 'evening'] as const) {
          const activity = day[slot]
          const travel = activity.travelFromPrevious
            ? ` ← ${activity.travelFromPrevious.mode} ${activity.travelFromPrevious.durationMin}min`
            : ''
          console.log(`    ${slot}: ${activity.spot} [${activity.poiId ?? '无 id'}]${travel}`)
        }
      }
      console.log('citations:', result.plan.citations.length, 'unverified:', result.plan.unverified)
      console.log('tips:', result.plan.tips)
    }

    const counts = events.reduce<Record<string, number>>((acc, event) => {
      acc[event.type] = (acc[event.type] ?? 0) + 1
      return acc
    }, {})
    console.log('事件统计:', counts)
    console.log(`耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

    if (events.some((event) => event.type === 'error')) {
      console.error('运行中出现错误事件')
      process.exitCode = 1
    }
    if (result.status !== 'completed' || !result.plan) {
      console.error('未产出完整计划')
      process.exitCode = 1
    }
  } finally {
    mock?.close()
  }
}

main().catch((error) => {
  console.error('冒烟失败', error)
  process.exitCode = 1
})
