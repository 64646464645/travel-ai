import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDataset, memoryCategories, memoryCaseSchema } from './schema.js'
import type { MemoryEvalCase } from './schema.js'

const idPrefix: Record<string, string> = {
  fact: 'fact', paraphrase: 'paraphrase', 'cross-session': 'cross-session', 'multi-constraint': 'multi-constraint', 'preference-update': 'update', negative: 'negative', isolation: 'isolation', deletion: 'deletion',
}

function validCase(index: number, overrides: Partial<MemoryEvalCase> = {}): MemoryEvalCase {
  const category = memoryCategories[index % memoryCategories.length]
  const prefix = idPrefix[category]
  const isIsolation = category === 'isolation'
  const memories = [
    { userId: 'eval-user-a', sessionId: `${prefix}-session-${index}-a`, messages: [{ role: 'user' as const, content: `这是用户 ${index} 的一段旅行偏好记忆内容，用于评测。` }, { role: 'assistant' as const, content: '已记录该偏好。' }] },
    ...(isIsolation ? [{ userId: 'eval-user-b', sessionId: `${prefix}-session-${index}-b`, messages: [{ role: 'user' as const, content: `这是另一位用户 ${index} 的旅行偏好记忆，应被隔离。` }, { role: 'assistant' as const, content: '已记录。' }] }] : []),
  ]
  const shouldRecall = category !== 'negative'
  const expectedSessionIds = shouldRecall ? [`${prefix}-session-${index}-a`] : []
  const expectedFacts = category === 'deletion' || shouldRecall ? ['旅行偏好'] : []
  const forbiddenFacts = category === 'negative' || category === 'isolation' ? ['应被隔离'] : []
  return {
    id: `${prefix}-${String(index).padStart(3, '0')}`,
    category,
    queryUserId: 'eval-user-a',
    memories,
    query: `请回答关于旅行偏好的问题 ${index}`,
    shouldRecall,
    expectedSessionIds,
    expectedFacts,
    forbiddenFacts,
    ...overrides,
  }
}

function validDataset(): unknown {
  const cases: MemoryEvalCase[] = []
  for (let i = 0; i < 80; i++) cases.push(validCase(i))
  return { version: 'memory-eval.v1', cases }
}

test('有效数据集通过加载校验', () => {
  const dataset = loadDataset(validDataset())
  assert.equal(dataset.cases.length, 80)
})

test('普通正样本空 expectedFacts 加载即报错（禁止 vacuous pass）', () => {
  const raw = validDataset()
  ;(raw as { cases: MemoryEvalCase[] }).cases[0] = validCase(0, { category: 'fact', id: 'fact-999', expectedFacts: [] })
  assert.throws(() => loadDataset(raw), /普通正样本必须包含非空 expectedFacts/)
})

test('deletion 用例可正常解析并保留删除后验证语义', () => {
  const parsed = memoryCaseSchema.parse({
    id: 'deletion-999',
    category: 'deletion',
    queryUserId: 'eval-user-a',
    memories: [{ userId: 'eval-user-a', sessionId: 'delete-session-999', messages: [{ role: 'user', content: '请记住我想去故宫看展览。' }, { role: 'assistant', content: '已记录故宫展览计划。' }] }],
    query: '我想去哪里看展览？',
    shouldRecall: true,
    expectedSessionIds: ['delete-session-999'],
    expectedFacts: ['故宫'],
    forbiddenFacts: [],
  })
  assert.equal(parsed.category, 'deletion')
  assert.deepEqual(parsed.expectedFacts, ['故宫'])
})

test('case ID 前缀与类别不一致加载即报错', () => {
  const raw = validDataset()
  ;(raw as { cases: MemoryEvalCase[] }).cases[1] = validCase(1, { category: 'fact', id: 'paraphrase-999' })
  assert.throws(() => loadDataset(raw), /前缀与类别/)
})

test('数据集版本格式不符合预期加载即报错', () => {
  const raw = validDataset()
  ;(raw as { version: string }).version = 'v1'
  assert.throws(() => loadDataset(raw), /版本号格式须为/)
})

test('类别缺失或低于最小样本数加载即报错', () => {
  const raw = validDataset()
  const cases = (raw as { cases: MemoryEvalCase[] }).cases
  // 将 6 个 deletion 用例改为 fact（保持总数 80），使 deletion 低于最小样本数 5
  let rewritten = 0
  ;(raw as { cases: MemoryEvalCase[] }).cases = cases.map((item) => {
    if (item.category === 'deletion' && rewritten < 6) {
      rewritten += 1
      return { ...item, id: `fact-9${rewritten}`, category: 'fact' as const, forbiddenFacts: [] }
    }
    return item
  })
  assert.throws(() => loadDataset(raw), /deletion 用例数 4 少于最小样本数 5/)
})

test('缺失整个类别加载即报错', () => {
  const raw = validDataset()
  // 将所有 isolation 用例改写为 fact（保持总数 80），使 isolation 类别缺失
  let rewritten = 0
  ;(raw as { cases: MemoryEvalCase[] }).cases = (raw as { cases: MemoryEvalCase[] }).cases.map((item) => {
    if (item.category === 'isolation') {
      rewritten += 1
      return { ...item, id: `fact-8${rewritten}`, category: 'fact' as const, forbiddenFacts: [] }
    }
    return item
  })
  assert.throws(() => loadDataset(raw), /数据集缺少类别 isolation/)
})
