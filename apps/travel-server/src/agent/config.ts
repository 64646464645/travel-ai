function positiveInt(value: string | undefined, fallback: number): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback
}

export const agentConfig = {
  /** 研究阶段最多几步 LLM 决策 */
  maxResearchSteps: positiveInt(process.env.AGENT_MAX_RESEARCH_STEPS, 6),
  /** 校验失败后的修复轮数 */
  maxRepairRounds: positiveInt(process.env.AGENT_MAX_REPAIR_ROUNDS, 2),
  /** 单次运行硬超时 */
  runTimeoutMs: positiveInt(process.env.AGENT_RUN_TIMEOUT_MS, 180_000),
  /** 单次工具调用超时 */
  toolTimeoutMs: positiveInt(process.env.AGENT_TOOL_TIMEOUT_MS, 8_000),
  /** 单次运行 token 上限 */
  maxTokens: positiveInt(process.env.AGENT_MAX_TOKENS, 40_000),
  /** 起草/修复单次调用的最大输出 token（DeepSeek 默认仅 4096，长行程会被截断） */
  planMaxOutputTokens: positiveInt(process.env.AGENT_PLAN_MAX_OUTPUT_TOKENS, 8_000),
  /** M1 支持的行程天数上限 */
  maxPlanDays: 7,
  /** 一次行程最多计算多少段路 */
  maxRouteCalls: positiveInt(process.env.AGENT_MAX_ROUTE_CALLS, 12),
  /** 搜索工具单次运行上限 */
  toolCaps: {
    resolve_city: 1,
    get_weather: 1,
    search_poi: 3,
    get_poi_detail: 8,
    plan_route: 6,
  } satisfies Record<string, number>,
}
