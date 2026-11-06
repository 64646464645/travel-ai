import type { AgentNode } from '@travel/shared'

/** 一次运行里某个节点的执行轨迹 */
export interface AgentNodeTrace {
  seq: number
  node: AgentNode
  status: 'running' | 'done' | 'failed'
  latencyMs?: number
}

/** 一次运行里某次工具调用的轨迹 */
export interface AgentToolTrace {
  callId: string
  name: string
  args?: Record<string, unknown>
  /** 归属的阶段序号，用于在时间线里缩进 */
  nodeSeq?: number
  status: 'running' | 'ok' | 'failed'
  summary?: string
  latencyMs?: number
}

export const NODE_LABELS: Record<AgentNode, string> = {
  understand: '理解需求',
  research: '查证资料',
  draft: '生成行程',
  validate: '规则校验',
  repair: '自动修复',
  finalize: '整理输出',
}

export const TOOL_LABELS: Record<string, string> = {
  resolve_city: '解析城市',
  search_poi: '搜索地点',
  get_poi_detail: '地点详情',
  get_weather: '查询天气',
  plan_route: '规划路线',
}

export function formatLatency(ms?: number): string {
  if (ms === undefined) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
