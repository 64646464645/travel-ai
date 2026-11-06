import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentRequirementSchema, type AgentPlan, type AgentValidationResult } from '@travel/shared'
import { agentConfig } from './config.js'
import { missingQuestion, missingSlots, normalizeRequirement, summarizePlan } from './stateMachine.js'
import { todayInShanghai } from './prompts.js'

function requirement(overrides: Record<string, unknown> = {}) {
  return AgentRequirementSchema.parse({
    city: '成都',
    days: 3,
    budget: 3000,
    startDate: '2026-05-01',
    ...overrides,
  })
}

test('三项必填齐全时没有缺失槽位', () => {
  assert.deepEqual(missingSlots(requirement()), [])
})

test('缺城市/天数/预算时按固定顺序报缺失', () => {
  assert.deepEqual(missingSlots(requirement({ city: null, days: null, budget: null })), [
    'city',
    'days',
    'budget',
  ])
})

test('预算为 0 不算缺失（穷游也是有效预算）', () => {
  assert.deepEqual(missingSlots(requirement({ budget: 0 })), [])
})

test('追问文案把槽位翻译成中文', () => {
  const question = missingQuestion(['city', 'budget'])
  assert.ok(question.includes('目的地城市'))
  assert.ok(question.includes('总预算'))
  assert.ok(!question.includes('city'))
})

test('天数超限时截断并记录假设', () => {
  // schema 本身限制 1–7 天，这里直接改字段模拟模型/上游给出越界值
  const normalized = normalizeRequirement({ ...requirement(), days: agentConfig.maxPlanDays + 5 })
  assert.equal(normalized.days, agentConfig.maxPlanDays)
  assert.ok(normalized.assumptions.some((item) => item.includes('超过')))
})

test('未指定出发日期时补成今天并记录假设', () => {
  const normalized = normalizeRequirement(requirement({ startDate: null }))
  assert.equal(normalized.startDate, todayInShanghai())
  assert.ok(normalized.assumptions.includes('未指定出发日期，按今天开始规划'))
})

test('补齐日期后顶掉模型写的「未提及出行日期」类假设，避免自相矛盾', () => {
  const normalized = normalizeRequirement(
    requirement({ startDate: null, assumptions: ['未提及出行日期，暂不设定开始日期', '预算视为总预算'] }),
  )
  assert.deepEqual(normalized.assumptions, ['预算视为总预算', '未指定出发日期，按今天开始规划'])
})

test('已指定出发日期时不动 assumptions，也不补日期假设', () => {
  const normalized = normalizeRequirement(requirement({ assumptions: ['预算视为总预算'] }))
  assert.equal(normalized.startDate, '2026-05-01')
  assert.deepEqual(normalized.assumptions, ['预算视为总预算'])
})

test('normalizeRequirement 返回新对象，不污染入参', () => {
  const input = { ...requirement({ startDate: null }), days: agentConfig.maxPlanDays + 1 }
  const originalDays = input.days
  normalizeRequirement(input)
  assert.equal(input.days, originalDays)
  assert.equal(input.startDate, null)
})

// summarizePlan 只读 city/days/totalBudget，用最小桩对象即可
const planStub = { city: '成都', days: 3, totalBudget: 2400 } as AgentPlan

function validation(issues: AgentValidationResult['issues']): AgentValidationResult {
  return { passed: issues.every((item) => item.severity !== 'error'), issues }
}

test('校验未通过时文案明确说没满足硬性约束', () => {
  const text = summarizePlan(
    planStub,
    validation([
      { ruleId: 'V5', severity: 'error', path: 'dailyItinerary[2].evening', message: '到「东郊记忆」耗时 74 分钟，超过 60 分钟' },
    ]),
  )
  assert.ok(text.includes('硬性约束没满足'), text)
  assert.ok(text.includes('[V5]'), text)
  assert.ok(text.includes('74 分钟'), text)
  // 不能出现「预算约」这种看起来一切正常的措辞
  assert.ok(!text.includes('预算约'), text)
})

test('多条错误只列前 3 条，避免文案失控', () => {
  const issues = ['V1', 'V3', 'V5', 'V7', 'V8'].map((ruleId) => ({
    ruleId,
    severity: 'error' as const,
    path: 'x',
    message: `${ruleId} 的问题`,
  }))
  const text = summarizePlan(planStub, validation(issues))
  assert.ok(text.includes('5 项'), text)
  assert.ok(text.includes('[V1]') && text.includes('[V5]'), text)
  assert.ok(!text.includes('[V7]'), text)
})

test('只有 warning 时按提醒口径描述', () => {
  const text = summarizePlan(
    planStub,
    validation([{ ruleId: 'S2', severity: 'warning', path: 'x', message: '雨雪天户外' }]),
  )
  assert.ok(text.includes('需要留意'), text)
  assert.ok(!text.includes('没满足'), text)
})

test('完全通过时只报城市天数预算与活动数', () => {
  const text = summarizePlan(planStub, validation([]))
  assert.ok(text.includes('成都 3 天'), text)
  assert.ok(text.includes('2400 元'), text)
  assert.ok(text.includes('9 个活动'), text)
  assert.ok(!text.includes('留意'), text)
})
