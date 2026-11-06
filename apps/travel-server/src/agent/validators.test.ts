import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentPlanSchema, AgentRequirementSchema, type AgentPlan } from '@travel/shared'
import { validatePlan } from './validators.js'
import type { PoiCandidate, ResearchState } from './types.js'

const START_DATE = '2026-05-01'

function makePoi(poiId: string, name: string): PoiCandidate {
  return {
    poiId,
    name,
    type: '风景名胜',
    address: `${name}路 1 号`,
    location: { lng: 104.05, lat: 30.65 },
    rating: 4.5,
    cost: 60,
    openTime: '08:00-18:00',
    tel: null,
  }
}

function makeResearch(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    city: '成都',
    adcode: '510100',
    center: { lng: 104.06, lat: 30.67 },
    weather: null,
    pois: [makePoi('p1', '宽窄巷子'), makePoi('p2', '人民公园'), makePoi('p3', '锦里')],
    routes: [],
    notes: [],
    steps: 1,
    ...overrides,
  }
}

interface ActivityOptions {
  spot: string
  poiId?: string
  source?: { provider: 'amap'; poiId: string; fetchedAt: string }
  durationMin?: number
  indoor?: boolean
  travelFromPrevious?: { mode: 'walking' | 'transit' | 'driving'; durationMin: number; distanceKm: number }
  description?: string
}

function makeActivity(options: ActivityOptions) {
  return {
    spot: options.spot,
    duration: options.durationMin ? `${options.durationMin} 分钟` : '2 小时',
    ticket: '免费',
    transportation: options.travelFromPrevious ? '步行' : '未知',
    description: options.description ?? `${options.spot}的简介`,
    ...(options.poiId ? { poiId: options.poiId } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(options.durationMin !== undefined ? { durationMin: options.durationMin } : {}),
    ...(options.indoor !== undefined ? { indoor: options.indoor } : {}),
    ...(options.travelFromPrevious ? { travelFromPrevious: options.travelFromPrevious } : {}),
  }
}

function source(poiId: string) {
  return { provider: 'amap' as const, poiId, fetchedAt: '2026-04-30T00:00:00.000Z' }
}

/** 默认计划应通过全部硬规则，测试用例只改动需要触发规则的那一处 */
function makePlan(): AgentPlan {
  return AgentPlanSchema.parse({
    success: true,
    city: '成都',
    days: 1,
    totalBudget: 1000,
    dailyItinerary: [
      {
        day: 1,
        date: START_DATE,
        morning: makeActivity({ spot: '宽窄巷子', poiId: 'p1', source: source('p1'), durationMin: 120 }),
        afternoon: makeActivity({
          spot: '人民公园',
          poiId: 'p2',
          source: source('p2'),
          durationMin: 120,
          travelFromPrevious: { mode: 'walking', durationMin: 15, distanceKm: 1.1 },
        }),
        evening: makeActivity({
          spot: '锦里',
          poiId: 'p3',
          source: source('p3'),
          durationMin: 120,
          travelFromPrevious: { mode: 'transit', durationMin: 25, distanceKm: 3.2 },
        }),
      },
    ],
    budgetBreakdown: {
      accommodation: 0,
      food: 400,
      transportation: 100,
      tickets: 400,
      other: 100,
    },
    tips: ['带上身份证'],
    warnings: [],
    rationale: '按区域就近安排',
    citations: [source('p1'), source('p2'), source('p3')],
    unverified: [],
  })
}

function makeRequirement(overrides: Record<string, unknown> = {}) {
  return AgentRequirementSchema.parse({
    city: '成都',
    startDate: START_DATE,
    days: 1,
    budget: 1000,
    ...overrides,
  })
}

function ruleIds(plan: AgentPlan, requirement = makeRequirement(), research = makeResearch()) {
  const result = validatePlan(plan, requirement, research)
  return { result, issues: result.issues, ids: result.issues.map((item) => item.ruleId) }
}

test('完整计划通过全部硬规则，只剩软规则提示', () => {
  const { result, ids } = ruleIds(makePlan())
  assert.equal(result.passed, true)
  assert.deepEqual(
    ids.filter((id) => !id.startsWith('S')),
    [],
  )
})

test('V1 天数与需求不一致时报错', () => {
  const plan = makePlan()
  const { result, ids } = ruleIds(plan, makeRequirement({ days: 2 }))
  assert.equal(result.passed, false)
  assert.ok(ids.includes('V1'))
})

test('V2 时段地点为空时报错', () => {
  const plan = makePlan()
  plan.dailyItinerary[0].morning.spot = '   '
  const { ids } = ruleIds(plan)
  assert.ok(ids.includes('V2'))
})

test('V3 分项合计与总额偏差超过 5% 时报错', () => {
  const plan = makePlan()
  plan.budgetBreakdown.food = 800
  const { ids } = ruleIds(plan)
  assert.ok(ids.includes('V3'))
})

test('V3 总额超过用户预算上限时报错', () => {
  const plan = makePlan()
  const { result, ids } = ruleIds(plan, makeRequirement({ budget: 500 }))
  assert.equal(result.passed, false)
  assert.ok(ids.includes('V3'))
})

test('V4 poiId 不在本轮候选列表时按幻觉处理', () => {
  const plan = makePlan()
  plan.dailyItinerary[0].afternoon.poiId = 'fake-999'
  const { result, issues } = ruleIds(plan)
  assert.equal(result.passed, false)
  const hit = issues.find((item) => item.ruleId === 'V4')
  assert.ok(hit?.message.includes('候选列表'))
})

test('V4 缺失 poiId 时报错', () => {
  const plan = makePlan()
  delete plan.dailyItinerary[0].evening.poiId
  const { ids } = ruleIds(plan)
  assert.ok(ids.includes('V4'))
})

test('V5 缺少上一站交通信息时报错', () => {
  const plan = makePlan()
  delete plan.dailyItinerary[0].afternoon.travelFromPrevious
  const { ids } = ruleIds(plan)
  assert.ok(ids.includes('V5'))
})

test('V5 相邻交通超过 60 分钟时报错', () => {
  const plan = makePlan()
  plan.dailyItinerary[0].evening.travelFromPrevious = {
    mode: 'driving',
    durationMin: 95,
    distanceKm: 62,
  }
  const { result, ids } = ruleIds(plan)
  assert.equal(result.passed, false)
  assert.ok(ids.includes('V5'))
})

test('V6 日期与出发日顺延不一致时报错', () => {
  const plan = makePlan()
  plan.dailyItinerary[0].date = '2026-05-03'
  const { ids } = ruleIds(plan)
  assert.ok(ids.includes('V6'))
})

test('V7 同一天重复安排同一地点时报错', () => {
  const plan = makePlan()
  plan.dailyItinerary[0].evening.poiId = 'p1'
  plan.dailyItinerary[0].evening.source = source('p1')
  const { ids } = ruleIds(plan)
  assert.ok(ids.includes('V7'))
})

test('V8 既无来源也未标注未核验时报错', () => {
  const plan = makePlan()
  delete plan.dailyItinerary[0].morning.source
  const { ids } = ruleIds(plan)
  assert.ok(ids.includes('V8'))
})

test('V8 未核验地点进入 unverified 后不再报错', () => {
  const plan = makePlan()
  delete plan.dailyItinerary[0].morning.source
  plan.unverified = ['宽窄巷子']
  const { result } = ruleIds(plan)
  assert.equal(result.passed, true)
})

test('S1 单日活动超过 600 分钟时给 warning 而非 error', () => {
  const plan = makePlan()
  for (const slot of ['morning', 'afternoon', 'evening'] as const) {
    plan.dailyItinerary[0][slot].durationMin = 240
  }
  const { result, issues } = ruleIds(plan)
  assert.equal(result.passed, true)
  const hit = issues.find((item) => item.ruleId === 'S1')
  assert.equal(hit?.severity, 'warning')
})

test('S2 雨雪天安排了未标室内的活动给 warning', () => {
  const research = makeResearch({
    weather: {
      available: true,
      days: [
        {
          date: START_DATE,
          dayWeather: '中雨',
          nightWeather: '小雨',
          dayTemp: 18,
          nightTemp: 12,
          dayWind: '北',
          dayPower: '1-3',
        },
      ],
    },
  })
  const { result, issues } = ruleIds(makePlan(), makeRequirement(), research)
  assert.equal(result.passed, true)
  assert.ok(issues.some((item) => item.ruleId === 'S2' && item.severity === 'warning'))
})

test('S2 标注室内后不再提示', () => {
  const research = makeResearch({
    weather: {
      available: true,
      days: [
        {
          date: START_DATE,
          dayWeather: '中雨',
          nightWeather: '小雨',
          dayTemp: 18,
          nightTemp: 12,
          dayWind: '北',
          dayPower: '1-3',
        },
      ],
    },
  })
  const plan = makePlan()
  for (const slot of ['morning', 'afternoon', 'evening'] as const) {
    plan.dailyItinerary[0][slot].indoor = true
  }
  const { issues } = ruleIds(plan, makeRequirement(), research)
  assert.equal(issues.some((item) => item.ruleId === 'S2'), false)
})

test('S3 用户不吃辣但安排了川菜时给 warning', () => {
  const plan = makePlan()
  plan.dailyItinerary[0].evening.spot = '锦里火锅'
  const { result, issues } = ruleIds(plan, makeRequirement({ constraints: ['不吃辣'] }))
  assert.equal(result.passed, true)
  assert.ok(issues.some((item) => item.ruleId === 'S3' && item.severity === 'warning'))
})
