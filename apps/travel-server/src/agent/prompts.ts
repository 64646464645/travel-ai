import type { AgentPlan, AgentRequirement, AgentValidationIssue } from '@travel/shared'
import type { BudgetEstimate } from './budget.js'
import type { PoiCandidate, ResearchState, WeatherResult } from './types.js'

export function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

export function buildUnderstandPrompt(): string {
  return `你是旅行需求解析器。今天是 ${todayInShanghai()}。
从用户消息和最近对话中提取旅行需求，只输出 JSON 对象 {"requirement": {...}}。
字段规则：
- city：目的地城市中文名；未提及填 null
- startDate：YYYY-MM-DD；相对时间按今天换算；“下个月”但没有具体日期时填 null，并在 assumptions 说明
- days：1-7 的整数；未提及填 null
- budget：总预算（元）；未提及填 null
- travelers：{ adults, children }；未提及默认 1 个成人
- preferences：偏好关键词，如“安静”“美食”“历史”“自然”“亲子”
- constraints：约束，如“不吃辣”“少走路”“带老人”“预算紧”
- pace：relaxed / balanced / packed
- assumptions：你的推断，最多 3 条
不要编造用户没说的信息。`
}

export function formatHistory(history: Array<{ role: string; content: string }>): string {
  if (history.length === 0) return '（无历史对话）'
  return history
    .slice(-4)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content.slice(0, 300)}`)
    .join('\n')
}

export function buildResearchPrompt(): string {
  return `你是旅行研究助手。根据需求调用工具收集真实地点、天气和路线。
规则：
1. 只使用工具返回的地点，禁止凭记忆编造。
2. 优先收集三类：景点/博物馆/公园、餐饮街区、住宿区域；每类 3-6 个候选。
3. 需要天气时调用 get_weather；需要比较两点距离时调用 plan_route。
4. 工具次数有限：search_poi 最多 3 次，get_poi_detail 最多 8 次，plan_route 最多 6 次。
5. 信息足够时停止调用工具，回复 READY。
6. 不要向用户提问，不要输出行程。`
}

export function formatWeather(weather: WeatherResult | null): string {
  if (!weather) return '未查询'
  if (!weather.available) return `不可用（${weather.reason ?? '超出预报范围'}）`
  return weather.days
    .map((day) => `${day.date} ${day.dayWeather}/${day.nightWeather} ${day.dayTemp ?? '?'}~${day.nightTemp ?? '?'}℃`)
    .join('；')
}

export function formatBudget(budget: BudgetEstimate): string {
  return `住宿 ${budget.accommodation}，餐饮 ${budget.food}，市内交通 ${budget.transportation}，门票 ${budget.tickets}，其他 ${budget.other}，合计约 ${budget.total} 元（${budget.level}）`
}

export function formatPoiList(pois: PoiCandidate[], limit = 20): string {
  return pois
    .slice(0, limit)
    .map((poi, index) => {
      const rating = poi.rating === null ? '无评分' : `评分 ${poi.rating}`
      const cost = poi.cost === null ? '' : `，人均 ${poi.cost}`
      const hours = poi.openTime ? `，营业 ${poi.openTime}` : '，营业时间未提供'
      return `[${index + 1}] ${poi.name} | poiId=${poi.poiId} | ${poi.type} | ${rating}${cost}${hours} | ${poi.address}`
    })
    .join('\n')
}

export function buildResearchContext(
  requirement: AgentRequirement,
  research: ResearchState,
  budget: BudgetEstimate,
  missing: string[],
): string {
  return `需求：
${JSON.stringify(requirement, null, 2)}

预取信息：
- 城市：${research.city}，adcode=${research.adcode}
- 天气：${formatWeather(research.weather)}
- 预算基线：${formatBudget(budget)}
- 缺失槽位：${missing.length ? missing.join('、') : '无'}

已收集候选（${research.pois.length} 个）：
${research.pois.length ? formatPoiList(research.pois) : '暂无'}

请判断还需要调用哪些工具；信息足够时回复 READY。`
}

export function buildDraftPrompt(
  requirement: AgentRequirement,
  research: ResearchState,
  budget: BudgetEstimate,
  days: number,
): string {
  const startDate = requirement.startDate ?? '未指定'
  return `你是旅行规划师。根据需求和候选地点生成 ${days} 天行程，只输出 JSON 对象 {"plan": {...}}。

硬性要求：
1. 恰好 ${days} 天，每天 morning / afternoon / evening 各一个活动。
2. 每个活动的 spot 必须从下方候选地点中选择，poiId 必填且必须与候选一致。
3. 日期从 ${startDate} 开始连续排列；未指定日期时写“第1天”“第2天”。
4. totalBudget 不超过 ${requirement.budget ?? '未限制'} 元；budgetBreakdown 五项之和必须等于 totalBudget（±5%）。
5. 相邻活动之间单段交通不超过 60 分钟；后两个活动需要填写 travelFromPrevious（mode/durationMin/distanceKm）。
6. durationMin 写预计停留分钟；室内活动 indoor=true。
7. 不确定的门票/营业时间写“以官方为准”，不要编造具体价格。
8. description 用一句话说明为什么值得去，控制在 40 字以内。
9. rationale 用 2-3 句说明整体思路；tips 最多 5 条，每条不超过 30 字。
10. unverified 只列确实没核实的活动名称，最多 5 条；citations 留空由系统补全。
11. 越紧凑越好：不要输出解释性文字，不要在 JSON 之外写任何内容。

预算基线（仅参考，可调整）：
${formatBudget(budget)}

天气：
${formatWeather(research.weather)}

候选地点：
${formatPoiList(research.pois, 24)}

需求：
${JSON.stringify(requirement, null, 2)}`
}

export function buildRepairPrompt(
  plan: AgentPlan,
  issues: AgentValidationIssue[],
  requirement: AgentRequirement,
): string {
  const errors = issues
    .filter((item) => item.severity === 'error')
    .map((item) => `- [${item.ruleId}] ${item.path}: ${item.message}`)
    .join('\n')
  return `上一版行程未通过校验。请修正以下错误，返回完整的新计划 JSON {"plan": {...}}，不要只返回差异。

错误列表：
${errors || '- 无'}

要求：
- 天数仍为 ${requirement.days ?? plan.days} 天
- 只能使用原候选地点
- budgetBreakdown 合计必须等于 totalBudget
- 保持日期连续
- 所有活动保留 poiId
- 交通超时（V5）必须真的换点：从候选列表里选一个离上一站更近的地点替换，不允许只改描述、改 transportation 文案或写“建议提早出发”来敷衍
- 只改有问题的那几天，其他天保持原样
- 直接输出完整 JSON，不要解释

上一版计划：
${JSON.stringify(plan)}`
}
