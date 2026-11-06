import type { AgentPlan, AgentRequirement, AgentValidationResult } from '@travel/shared'
import { agentConfig } from './config.js'
import { todayInShanghai } from './prompts.js'

/**
 * 需求槽位的缺失判定。
 * 只把「没有就无法规划」的三项算缺失；出发日期、人数、偏好都能由运行时兜底。
 */
export function missingSlots(requirement: AgentRequirement): string[] {
  const missing: string[] = []
  if (!requirement.city) missing.push('city')
  if (!requirement.days) missing.push('days')
  if (requirement.budget === null) missing.push('budget')
  return missing
}

const SLOT_LABELS: Record<string, string> = {
  city: '目的地城市',
  days: '出行天数',
  budget: '总预算',
}

export function missingQuestion(missing: string[]): string {
  return `开始规划前还需要确认：${missing.map((item) => SLOT_LABELS[item] ?? item).join('、')}。可以一次告诉我吗？`
}

/**
 * 运行前把需求收敛到可执行范围：
 * - 天数超限截断并记录假设
 * - 未指定出发日期按今天排，避免产出「第1天」这种没有日期锚点的行程
 * - 顶掉模型写的「未提及出行日期」类假设，否则会和运行时的决定自相矛盾
 */
export function normalizeRequirement(requirement: AgentRequirement): AgentRequirement {
  const normalized: AgentRequirement = { ...requirement, assumptions: [...requirement.assumptions] }

  if (normalized.days !== null && normalized.days > agentConfig.maxPlanDays) {
    normalized.assumptions.push(
      `行程超过 ${agentConfig.maxPlanDays} 天，按 ${agentConfig.maxPlanDays} 天规划`,
    )
    normalized.days = agentConfig.maxPlanDays
  }

  if (!normalized.startDate) {
    normalized.startDate = todayInShanghai()
    normalized.assumptions = normalized.assumptions.filter(
      (item) => !(/日期|出发/.test(item) && /未|不|没/.test(item)),
    )
    normalized.assumptions.push('未指定出发日期，按今天开始规划')
  }

  return normalized
}

/**
 * 交付文案。
 * 修复轮用完仍有硬伤时必须说出来，不能让用户以为这是一份合规计划。
 */
export function summarizePlan(plan: AgentPlan, validation: AgentValidationResult): string {
  const errors = validation.issues.filter((item) => item.severity === 'error')
  const warnings = validation.issues.filter((item) => item.severity === 'warning')

  if (errors.length > 0) {
    const top = errors
      .slice(0, 3)
      .map((item) => `[${item.ruleId}] ${item.message}`)
      .join('；')
    return `${plan.city} ${plan.days} 天行程已生成，但有 ${errors.length} 项硬性约束没满足：${top}。建议按提示调整后再出行。`
  }

  const base = `${plan.city} ${plan.days} 天行程已生成，预算约 ${plan.totalBudget} 元，共 ${plan.days * 3} 个活动。`
  if (warnings.length === 0) return base
  return `${base} 有 ${warnings.length} 项需要留意，已在计划中标注。`
}
