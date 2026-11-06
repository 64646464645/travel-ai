export type BudgetLevel = 'budget' | 'comfort' | 'luxury'

export interface BudgetEstimate {
  accommodation: number
  food: number
  transportation: number
  tickets: number
  other: number
  total: number
  perDay: number
  level: BudgetLevel
  notes: string[]
}

const CITY_TIERS: Record<string, 1 | 2 | 3 | 4> = {
  北京: 1,
  上海: 1,
  广州: 1,
  深圳: 1,
  成都: 2,
  杭州: 2,
  西安: 2,
  重庆: 2,
  南京: 2,
  武汉: 2,
  苏州: 2,
  长沙: 2,
  天津: 2,
  郑州: 2,
  青岛: 2,
  宁波: 2,
  东莞: 2,
  佛山: 2,
  合肥: 2,
  昆明: 3,
  贵阳: 3,
  南宁: 3,
  桂林: 3,
  海口: 3,
  三亚: 3,
  丽江: 3,
  大理: 3,
  厦门: 3,
  福州: 3,
  济南: 3,
  大连: 3,
  沈阳: 3,
  哈尔滨: 3,
  长春: 3,
  南昌: 3,
  太原: 3,
  石家庄: 3,
  兰州: 3,
  乌鲁木齐: 3,
  拉萨: 3,
  呼和浩特: 3,
}

const LODGING: Record<1 | 2 | 3 | 4, [number, number, number]> = {
  1: [500, 800, 1500],
  2: [400, 650, 1200],
  3: [300, 500, 900],
  4: [220, 380, 700],
}

const FOOD: Record<1 | 2 | 3 | 4, [number, number, number]> = {
  1: [150, 250, 450],
  2: [130, 220, 400],
  3: [110, 180, 320],
  4: [100, 160, 300],
}

const LOCAL_TRANSPORT: Record<1 | 2 | 3 | 4, [number, number, number]> = {
  1: [60, 100, 180],
  2: [50, 80, 150],
  3: [40, 70, 130],
  4: [35, 60, 110],
}

const TICKETS_PER_DAY: Record<1 | 2 | 3 | 4, [number, number, number]> = {
  1: [80, 140, 220],
  2: [70, 120, 200],
  3: [60, 100, 180],
  4: [50, 90, 160],
}

function tierOf(city: string): 1 | 2 | 3 | 4 {
  return CITY_TIERS[city] ?? 4
}

/**
 * 确定性预算基线：只做区间估算，不调用 LLM。
 * 结果用于 draft prompt 与校验，不作为最终报价。
 */
export function estimateBudget(
  city: string,
  days: number,
  travelers: number,
  level: BudgetLevel = 'comfort',
): BudgetEstimate {
  const tier = tierOf(city)
  const index = level === 'budget' ? 0 : level === 'luxury' ? 2 : 1
  const people = Math.max(1, travelers)
  const nights = Math.max(1, days - 1)
  const rooms = Math.max(1, Math.ceil(people / 2))

  const accommodation = LODGING[tier][index] * nights * rooms
  const food = FOOD[tier][index] * days * people
  const transportation = LOCAL_TRANSPORT[tier][index] * days * people
  const tickets = TICKETS_PER_DAY[tier][index] * days * people
  const subtotal = accommodation + food + transportation + tickets
  const other = Math.round(subtotal * 0.1)
  const total = Math.round((subtotal + other) / 10) * 10

  return {
    accommodation,
    food,
    transportation,
    tickets,
    other,
    total,
    perDay: Math.round(total / days),
    level,
    notes: [
      '按 2 人一间估算住宿',
      '门票按城市档位平均估算，未逐点核价',
      '不含往返大交通',
    ],
  }
}
