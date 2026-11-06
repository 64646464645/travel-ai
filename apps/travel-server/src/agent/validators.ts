import type {
  AgentPlan,
  AgentRequirement,
  AgentValidationIssue,
  AgentValidationResult,
} from '@travel/shared'
import type { ResearchState } from './types.js'

interface ActivityRef {
  dayIndex: number
  day: number
  date: string
  slot: 'morning' | 'afternoon' | 'evening'
  activity: AgentPlan['dailyItinerary'][number]['morning']
}

function activitiesOf(plan: AgentPlan): ActivityRef[] {
  const refs: ActivityRef[] = []
  plan.dailyItinerary.forEach((day, dayIndex) => {
    for (const slot of ['morning', 'afternoon', 'evening'] as const) {
      refs.push({ dayIndex, day: day.day, date: day.date, slot, activity: day[slot] })
    }
  })
  return refs
}

function addDays(startDate: string, offset: number): string {
  const date = new Date(`${startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function issue(
  ruleId: string,
  severity: 'error' | 'warning',
  path: string,
  message: string,
  suggestion?: string,
): AgentValidationIssue {
  return { ruleId, severity, path, message, suggestion }
}

/** 8 条硬规则 + 软规则；纯函数，可单测 */
export function validatePlan(
  plan: AgentPlan,
  requirement: AgentRequirement,
  research: ResearchState,
): AgentValidationResult {
  const issues: AgentValidationIssue[] = []
  const refs = activitiesOf(plan)

  // V1 天数一致
  if (requirement.days !== null && plan.dailyItinerary.length !== requirement.days) {
    issues.push(
      issue(
        'V1',
        'error',
        'dailyItinerary',
        `行程天数 ${plan.dailyItinerary.length} 与需求 ${requirement.days} 不一致`,
        '补齐或删减每日行程',
      ),
    )
  }

  // V2 每天三个时段都有内容
  for (const ref of refs) {
    if (!ref.activity.spot.trim()) {
      issues.push(
        issue('V2', 'error', `dailyItinerary[${ref.dayIndex}].${ref.slot}.spot`, '活动地点为空', '补一个真实地点'),
      )
    }
  }

  // V3 预算合计与上限
  const breakdown = plan.budgetBreakdown
  const sum =
    breakdown.accommodation +
    breakdown.food +
    breakdown.transportation +
    breakdown.tickets +
    breakdown.other
  const budgetBase = Math.max(plan.totalBudget, 1)
  if (Math.abs(sum - plan.totalBudget) / budgetBase > 0.05) {
    issues.push(
      issue(
        'V3',
        'error',
        'budgetBreakdown',
        `预算分项合计 ${Math.round(sum)} 与总额 ${plan.totalBudget} 偏差超过 5%`,
        '调整分项使合计等于总额',
      ),
    )
  }
  if (requirement.budget !== null && plan.totalBudget > requirement.budget * 1.05) {
    issues.push(
      issue(
        'V3',
        'error',
        'totalBudget',
        `总额 ${plan.totalBudget} 超过用户预算 ${requirement.budget}`,
        '压缩住宿、门票或餐饮支出',
      ),
    )
  }

  // V4 地点必须来自本轮工具结果
  const knownPoiIds = new Set(research.pois.map((poi) => poi.poiId))
  for (const ref of refs) {
    const poiId = ref.activity.poiId
    if (!poiId) {
      issues.push(
        issue(
          'V4',
          'error',
          `dailyItinerary[${ref.dayIndex}].${ref.slot}.poiId`,
          `「${ref.activity.spot}」缺少 poiId`,
          '只能使用研究阶段返回的候选地点',
        ),
      )
    } else if (!knownPoiIds.has(poiId)) {
      issues.push(
        issue(
          'V4',
          'error',
          `dailyItinerary[${ref.dayIndex}].${ref.slot}.poiId`,
          `「${ref.activity.spot}」的 poiId 不在候选列表中`,
          '替换为候选列表中的真实地点',
        ),
      )
    }
  }

  // V5 相邻活动有路线且不超过 60 分钟
  for (const ref of refs) {
    if (ref.slot === 'morning') continue
    const travel = ref.activity.travelFromPrevious
    if (!travel) {
      issues.push(
        issue(
          'V5',
          'error',
          `dailyItinerary[${ref.dayIndex}].${ref.slot}.travelFromPrevious`,
          `「${ref.activity.spot}」缺少上一站交通信息`,
          '补充交通方式与耗时',
        ),
      )
    } else if (travel.durationMin > 60) {
      issues.push(
        issue(
          'V5',
          'error',
          `dailyItinerary[${ref.dayIndex}].${ref.slot}.travelFromPrevious`,
          `到「${ref.activity.spot}」耗时 ${Math.round(travel.durationMin)} 分钟，超过 60 分钟`,
          '换一个更近的地点或调整顺序',
        ),
      )
    }
  }

  // V6 日期连续且与出发日一致
  if (requirement.startDate) {
    plan.dailyItinerary.forEach((day, index) => {
      const expected = addDays(requirement.startDate!, index)
      if (day.date !== expected) {
        issues.push(
          issue(
            'V6',
            'error',
            `dailyItinerary[${index}].date`,
            `日期 ${day.date} 与预期 ${expected} 不一致`,
            '按出发日顺延',
          ),
        )
      }
    })
  }

  // V7 重复地点
  const perDay = new Map<number, Set<string>>()
  const tripCount = new Map<string, number>()
  for (const ref of refs) {
    if (!ref.activity.poiId) continue
    const set = perDay.get(ref.dayIndex) ?? new Set<string>()
    if (set.has(ref.activity.poiId)) {
      issues.push(
        issue(
          'V7',
          'error',
          `dailyItinerary[${ref.dayIndex}]`,
          `同一天重复安排「${ref.activity.spot}」`,
          '换成同区域的另一个地点',
        ),
      )
    }
    set.add(ref.activity.poiId)
    perDay.set(ref.dayIndex, set)
    tripCount.set(ref.activity.poiId, (tripCount.get(ref.activity.poiId) ?? 0) + 1)
  }
  for (const [poiId, count] of tripCount) {
    if (count > 2) {
      const poi = research.pois.find((item) => item.poiId === poiId)
      issues.push(
        issue('V7', 'error', 'dailyItinerary', `「${poi?.name ?? poiId}」全程出现 ${count} 次`, '最多保留 2 次'),
      )
    }
  }

  // V8 来源或未核验标记
  for (const ref of refs) {
    const hasSource = Boolean(ref.activity.source && ref.activity.poiId === ref.activity.source.poiId)
    const marked = plan.unverified.includes(ref.activity.spot)
    if (!hasSource && !marked) {
      issues.push(
        issue(
          'V8',
          'error',
          `dailyItinerary[${ref.dayIndex}].${ref.slot}.source`,
          `「${ref.activity.spot}」没有来源，也未标注未核验`,
          '补充高德来源或加入 unverified',
        ),
      )
    }
  }

  // 软规则：单日节奏
  plan.dailyItinerary.forEach((day, index) => {
    const total = [day.morning, day.afternoon, day.evening]
      .map((activity) => activity.durationMin ?? 0)
      .reduce((sum, value) => sum + value, 0)
    if (total > 600) {
      issues.push(
        issue('S1', 'warning', `dailyItinerary[${index}]`, `当天活动约 ${total} 分钟，节奏偏紧`, '减少一个点或缩短停留'),
      )
    }
  })

  // 软规则：雨天户外
  const weatherDays = research.weather?.available ? research.weather.days : []
  for (const ref of refs) {
    const weather = weatherDays.find((day) => day.date === ref.date)
    if (!weather) continue
    const rainy = /雨|雪|雷/.test(weather.dayWeather) || /雨|雪|雷/.test(weather.nightWeather)
    if (rainy && ref.activity.indoor !== true) {
      issues.push(
        issue(
          'S2',
          'warning',
          `dailyItinerary[${ref.dayIndex}].${ref.slot}`,
          `${weather.date} 有雨雪，但「${ref.activity.spot}」未标注室内`,
          '准备室内备选或调整顺序',
        ),
      )
    }
  }

  // 软规则：饮食约束
  const noSpicy = requirement.constraints.some((item) => item.includes('不吃辣') || item.includes('清淡'))
  if (noSpicy) {
    for (const ref of refs) {
      if (/火锅|川菜|麻辣|辣子/.test(`${ref.activity.spot}${ref.activity.description}`)) {
        issues.push(
          issue(
            'S3',
            'warning',
            `dailyItinerary[${ref.dayIndex}].${ref.slot}`,
            `「${ref.activity.spot}」可能不符合不吃辣约束`,
            '换成清淡菜系或标注可选微辣',
          ),
        )
      }
    }
  }

  return {
    passed: issues.every((item) => item.severity !== 'error'),
    issues,
  }
}

export function formatIssues(issues: AgentValidationIssue[]): string {
  return issues
    .filter((item) => item.severity === 'error')
    .map((item) => `- [${item.ruleId}] ${item.path}: ${item.message}${item.suggestion ? `（建议：${item.suggestion}）` : ''}`)
    .join('\n')
}
