import type {
  AgentNode,
  AgentPlan,
  AgentUsage,
  AgentValidationResult,
} from '@travel/shared'
import { haversineMeters } from './amapClient.js'
import { estimateBudget } from './budget.js'
import { agentConfig } from './config.js'
import { draftPlan, repairPlan, runResearch, understandRequirement } from './llmNodes.js'
import {
  missingQuestion,
  missingSlots,
  normalizeRequirement,
  summarizePlan,
} from './stateMachine.js'
import { getTool } from './tools.js'
import { validatePlan } from './validators.js'
import type {
  AgentState,
  PoiCandidate,
  ResearchState,
  RouteLeg,
  RunAgentInput,
  RunAgentResult,
  ToolContext,
} from './types.js'
import type { WeatherResult } from './types.js'

function addUsage(total: AgentUsage, delta: AgentUsage): void {
  total.promptTokens += delta.promptTokens
  total.completionTokens += delta.completionTokens
  total.costMicros += delta.costMicros
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = getTool(name)
  if (!tool) throw new Error(`未注册工具：${name}`)
  const callId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  ctx.emit({ type: 'tool_call', callId, name, args, at: Date.now() })
  const startedAt = Date.now()
  try {
    const data = await tool.execute(args, ctx)
    ctx.emit({
      type: 'tool_result',
      callId,
      name,
      ok: true,
      summary: tool.summarize(data),
      latencyMs: Date.now() - startedAt,
    })
    return data
  } catch (error) {
    ctx.emit({
      type: 'tool_result',
      callId,
      name,
      ok: false,
      summary: (error as Error).message,
      latencyMs: Date.now() - startedAt,
    })
    throw error
  }
}

function addPois(research: ResearchState, candidates: PoiCandidate[]): void {
  const existing = new Set(research.pois.map((poi) => poi.poiId))
  for (const poi of candidates) {
    if (!existing.has(poi.poiId) && research.pois.length < 40) {
      research.pois.push(poi)
      existing.add(poi.poiId)
    }
  }
}

function matchPoi(research: ResearchState, spot: string): PoiCandidate | undefined {
  const exact = research.pois.find((poi) => poi.name === spot)
  if (exact) return exact
  return research.pois.find((poi) => poi.name.includes(spot) || spot.includes(poi.name))
}

function addDays(startDate: string, offset: number): string {
  const date = new Date(`${startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

async function attachPlanMetadata(
  plan: AgentPlan,
  state: AgentState,
  ctx: ToolContext,
): Promise<AgentPlan> {
  const { requirement, research } = state
  const routeBudget = { remaining: agentConfig.maxRouteCalls }
  const citations = new Map<string, AgentPlan['citations'][number]>()

  plan.days = plan.dailyItinerary.length
  plan.city = requirement.city ?? plan.city

  for (const [index, day] of plan.dailyItinerary.entries()) {
    day.day = index + 1
    day.date = requirement.startDate ? addDays(requirement.startDate, index) : `第${index + 1}天`

    const activities = [day.morning, day.afternoon, day.evening]
    for (const activity of activities) {
      if (!activity.poiId) {
        const matched = matchPoi(research, activity.spot)
        if (matched) activity.poiId = matched.poiId
      }
      if (activity.poiId) {
        const poi = research.pois.find((item) => item.poiId === activity.poiId)
        if (poi) {
          activity.location = poi.location
          activity.source = {
            provider: 'amap',
            poiId: poi.poiId,
            fetchedAt: new Date().toISOString(),
          }
          citations.set(poi.poiId, activity.source)
        }
      }
    }

    for (let slot = 1; slot < activities.length; slot++) {
      const from = activities[slot - 1]
      const to = activities[slot]
      if (!from.location || !to.location || routeBudget.remaining <= 0) continue
      const straight = haversineMeters(from.location, to.location)
      const mode = straight < 1500 ? 'walking' : 'driving'
      const leg = (await executeTool(
        'plan_route',
        {
          origin: from.location,
          destination: to.location,
          mode,
          city: research.adcode || undefined,
        },
        ctx,
      )) as RouteLeg
      routeBudget.remaining -= 1
      to.travelFromPrevious = {
        mode: leg.mode,
        durationMin: Math.max(1, Math.round(leg.durationSec / 60)),
        distanceKm: Number((leg.distanceM / 1000).toFixed(1)),
        ...(leg.estimated ? { estimated: true } : {}),
      }
      to.transportation = leg.mode === 'walking' ? '步行' : '驾车'
    }
  }

  plan.citations = [...citations.values()]
  const unverified = new Set(plan.unverified)
  for (const day of plan.dailyItinerary) {
    for (const activity of [day.morning, day.afternoon, day.evening]) {
      if (!activity.source) unverified.add(activity.spot)
    }
  }
  if (research.weather && !research.weather.available) {
    unverified.add('天气预报超出可查询范围')
  }
  plan.unverified = [...unverified]
  return plan
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const usage: AgentUsage = { promptTokens: 0, completionTokens: 0, costMicros: 0 }
  let seq = 0
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(agentConfig.runTimeoutMs)])
  const ctx: ToolContext = {
    runId: input.runId,
    userId: input.userId,
    signal,
    emit: input.emit,
  }

  input.emit({ type: 'run_started', runId: input.runId, sessionId: input.sessionId })

  async function withNode<T>(node: AgentNode, fn: () => Promise<T>): Promise<T> {
    const current = ++seq
    input.emit({ type: 'node_started', node, seq: current, at: Date.now() })
    const startedAt = Date.now()
    try {
      const result = await fn()
      input.emit({
        type: 'node_finished',
        node,
        seq: current,
        status: 'done',
        latencyMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      input.emit({
        type: 'node_finished',
        node,
        seq: current,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  const understand = await withNode('understand', async () =>
    understandRequirement(input.message, input.history, signal),
  )
  addUsage(usage, understand.usage)
  const requirement = normalizeRequirement(understand.requirement)

  const missing = missingSlots(requirement)
  if (missing.length > 0) {
    const question = missingQuestion(missing)
    input.emit({ type: 'message_delta', content: question })
    return { status: 'waiting_input', assistantText: question, usage }
  }

  const state: AgentState = {
    runId: input.runId,
    userId: input.userId,
    sessionId: input.sessionId,
    message: input.message,
    history: input.history,
    requirement,
    missing,
    research: {
      city: requirement.city!,
      adcode: '',
      center: null,
      weather: null,
      pois: [],
      routes: [],
      notes: [],
      steps: 0,
    },
    issues: [],
    revision: 0,
    usage,
  }

  await withNode('research', async () => {
    const city = (await executeTool('resolve_city', { name: requirement.city }, ctx)) as {
      city: string
      adcode: string
      center: { lng: number; lat: number }
    }
    state.research.city = city.city
    state.research.adcode = city.adcode
    state.research.center = city.center

    try {
      const weather = (await executeTool(
        'get_weather',
        {
          adcode: city.adcode,
          startDate: requirement.startDate ?? undefined,
          days: requirement.days ?? 4,
        },
        ctx,
      )) as WeatherResult
      state.research.weather = weather
    } catch {
      state.research.weather = { available: false, reason: 'provider_error', days: [] }
    }

    const budget = estimateBudget(
      state.research.city,
      requirement.days!,
      requirement.travelers.adults + requirement.travelers.children,
      'comfort',
    )

    await runResearch(
      requirement,
      state.research,
      budget,
      missing,
      ctx,
      usage,
    )

    if (state.research.pois.length < 4) {
      for (const query of ['景点', '博物馆', '公园']) {
        try {
          const result = (await executeTool(
            'search_poi',
            { city: state.research.city, query, limit: 8 },
            ctx,
          )) as { candidates: PoiCandidate[] }
          addPois(state.research, result.candidates)
        } catch {
          // 单个兜底搜索失败不影响整体，继续下一个
        }
      }
    }

    state.research.notes.push(`候选地点 ${state.research.pois.length} 个`)
  })

  const budget = estimateBudget(
    state.research.city,
    requirement.days!,
    requirement.travelers.adults + requirement.travelers.children,
    'comfort',
  )

  let plan = await withNode('draft', async () => {
    const result = await draftPlan(requirement, state.research, budget, signal)
    addUsage(usage, result.usage)
    return await attachPlanMetadata(result.plan, state, ctx)
  })

  let validation = await withNode('validate', async () => {
    const result = validatePlan(plan, requirement, state.research)
    input.emit({ type: 'validation', passed: result.passed, issues: result.issues })
    return result
  })

  while (!validation.passed && state.revision < agentConfig.maxRepairRounds) {
    state.revision += 1
    plan = await withNode('repair', async () => {
      const repaired = await repairPlan(plan, validation.issues, requirement, signal)
      addUsage(usage, repaired.usage)
      return await attachPlanMetadata(repaired.plan, state, ctx)
    })
    validation = await withNode('validate', async () => {
      const result = validatePlan(plan, requirement, state.research)
      input.emit({ type: 'validation', passed: result.passed, issues: result.issues })
      return result
    })
  }

  const finalized = await withNode('finalize', async () => {
    // 运行时替用户做的假设必须出现在计划里，否则用户看不到我们猜了什么
    if (requirement.assumptions.length > 0) {
      plan.tips = [...plan.tips, ...requirement.assumptions.map((item) => `已假设：${item}`)]
    }
    state.finalPlan = plan
    input.emit({ type: 'plan', plan })
    const text = summarizePlan(plan, validation)
    // 交付文案要通过 SSE 送到前端；只写库的话，本次对话里用户看不到「有几项没通过」
    input.emit({ type: 'message_delta', content: text })
    return { plan, text }
  })

  return {
    status: 'completed',
    plan: finalized.plan,
    issues: validation.issues,
    requirement,
    assistantText: finalized.text,
    usage,
  }
}
