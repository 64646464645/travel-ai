import { z } from 'zod'

export const memoryCategories = ['fact', 'paraphrase', 'cross-session', 'multi-constraint', 'preference-update', 'negative', 'isolation', 'deletion'] as const

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1),
})

const memorySchema = z.object({
  userId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  messages: z.array(messageSchema).min(1),
})

/** 数据集版本格式：memory-eval.v<数字>，保证可预期 */
const datasetVersionSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^memory-eval\.v\d+$/, '版本号格式须为 memory-eval.v<数字>')

/** case ID 前缀与类别的一致性映射（preference-update 数据集前缀为 update） */
const categoryIdPrefix: Record<(typeof memoryCategories)[number], string> = {
  fact: 'fact',
  paraphrase: 'paraphrase',
  'cross-session': 'cross-session',
  'multi-constraint': 'multi-constraint',
  'preference-update': 'update',
  negative: 'negative',
  isolation: 'isolation',
  deletion: 'deletion',
}

/** 每个类别的最小样本数，防止删除某类后仍通过校验 */
const MIN_CASES_PER_CATEGORY = 5

export const memoryCaseSchema = z.object({
  id: z.string().trim().min(1),
  category: z.enum(memoryCategories),
  queryUserId: z.string().trim().min(1),
  memories: z.array(memorySchema).min(1),
  query: z.string().trim().min(1),
  shouldRecall: z.boolean(),
  expectedSessionIds: z.array(z.string()),
  expectedFacts: z.array(z.string()),
  forbiddenFacts: z.array(z.string()),
}).superRefine((value, ctx) => {
  const ids = new Set(value.memories.filter((m) => m.userId === value.queryUserId).map((m) => m.sessionId))
  if (value.shouldRecall && value.expectedSessionIds.length === 0) ctx.addIssue({ code: 'custom', message: '正样本必须包含 expectedSessionIds' })
  if (value.expectedSessionIds.some((id) => !ids.has(id))) ctx.addIssue({ code: 'custom', message: 'expectedSessionIds 必须属于查询用户的记忆会话' })
  if ((value.category === 'negative' || value.category === 'isolation') && value.forbiddenFacts.length === 0) ctx.addIssue({ code: 'custom', message: '负样本与隔离用例必须包含 forbiddenFacts' })
  if (value.category === 'isolation' && new Set(value.memories.map((m) => m.userId)).size < 2) ctx.addIssue({ code: 'custom', message: '隔离用例必须包含至少两个用户' })
  if (!value.memories.some((m) => m.userId === value.queryUserId)) ctx.addIssue({ code: 'custom', message: '查询用户必须拥有至少一段记忆' })
  // 普通正样本（非 deletion）必须包含非空 expectedFacts，禁止空事实导致 vacuous pass
  if (value.shouldRecall && value.category !== 'deletion' && value.expectedFacts.length === 0) ctx.addIssue({ code: 'custom', message: '普通正样本必须包含非空 expectedFacts' })
  // case ID 前缀与类别一致
  if (!value.id.startsWith(categoryIdPrefix[value.category])) ctx.addIssue({ code: 'custom', message: `case ID ${value.id} 前缀与类别 ${value.category} 不一致` })
})

export const datasetSchema = z.object({
  version: datasetVersionSchema,
  cases: z.array(memoryCaseSchema).min(80),
})

export type MemoryEvalCase = z.infer<typeof memoryCaseSchema>
export type MemoryEvalDataset = z.infer<typeof datasetSchema>

export function loadDataset(raw: unknown): MemoryEvalDataset {
  const parsed = datasetSchema.parse(raw)
  const ids = new Set<string>()
  const categoryCounts = new Map<string, number>()
  for (const item of parsed.cases) {
    if (ids.has(item.id)) throw new Error(`数据集存在重复 ID: ${item.id}`)
    ids.add(item.id)
    categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1)
    for (const memory of item.memories) {
      for (const message of memory.messages) {
        if (message.content.trim().length < 10) console.warn(`数据集警告: ${item.id} 存在短消息`)
      }
    }
  }
  // 类别覆盖完整性与最小样本数校验
  for (const category of memoryCategories) {
    const count = categoryCounts.get(category) ?? 0
    if (count === 0) throw new Error(`数据集缺少类别 ${category} 的用例`)
    if (count < MIN_CASES_PER_CATEGORY) throw new Error(`类别 ${category} 用例数 ${count} 少于最小样本数 ${MIN_CASES_PER_CATEGORY}`)
  }
  return parsed
}
