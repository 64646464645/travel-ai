import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import {
  AgentPlanEnvelopeSchema,
  AgentPlanSchema,
  AgentRequirementEnvelopeSchema,
  AgentRequirementSchema,
  type AgentPlan,
  type AgentRequirement,
  type AgentUsage,
  type AgentValidationIssue,
} from '@travel/shared'
import { createLLM } from '../services/llmClient.js'
import { agentConfig } from './config.js'
import {
  buildDraftPrompt,
  buildRepairPrompt,
  buildResearchContext,
  buildResearchPrompt,
  buildUnderstandPrompt,
  formatHistory,
} from './prompts.js'
import { getTool, listModelTools } from './tools.js'
import type { BudgetEstimate } from './budget.js'
import type { PoiCandidate, ResearchState, ToolContext } from './types.js'

const planPayloadSchema = z.union([AgentPlanEnvelopeSchema, AgentPlanSchema])

function usageFromMessage(message: BaseMessage | undefined): AgentUsage {
  const usage = (message as AIMessage | undefined)?.usage_metadata
  return {
    promptTokens: usage?.input_tokens ?? 0,
    completionTokens: usage?.output_tokens ?? 0,
    costMicros: 0,
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) return fenced[1]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) return text.slice(start, end + 1)
  return text
}

function parsePlanText(text: string): AgentPlan {
  const repaired = jsonrepair(extractJson(text))
  const payload = planPayloadSchema.parse(JSON.parse(repaired))
  if ('plan' in payload) return payload.plan
  return payload
}

export async function understandRequirement(
  message: string,
  history: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): Promise<{ requirement: AgentRequirement; usage: AgentUsage }> {
  const system = new SystemMessage(buildUnderstandPrompt())
  const human = new HumanMessage(`最近对话：\n${formatHistory(history)}\n\n当前消息：${message}`)
  const llm = createLLM({ temperature: 0 })
  try {
    const chain = llm.withStructuredOutput(AgentRequirementEnvelopeSchema, {
      method: 'functionCalling',
      includeRaw: true,
    })
    const result = await chain.invoke([system, human], { signal })
    return {
      requirement: AgentRequirementSchema.parse(result.parsed?.requirement ?? {}),
      usage: usageFromMessage(result.raw),
    }
  } catch {
    const response = await llm.invoke([system, human], { signal })
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    const payload = AgentRequirementEnvelopeSchema.parse(
      JSON.parse(jsonrepair(extractJson(text))),
    )
    return { requirement: payload.requirement, usage: usageFromMessage(response) }
  }
}

function toModelView(name: string, data: unknown): unknown {
  if (name === 'search_poi') {
    const payload = data as { candidates?: PoiCandidate[] }
    return {
      candidates: (payload.candidates ?? []).slice(0, 8).map((poi) => ({
        poiId: poi.poiId,
        name: poi.name,
        type: poi.type,
        rating: poi.rating,
        cost: poi.cost,
        address: poi.address,
      })),
    }
  }
  return data
}

function truncateJson(value: unknown, maxLength = 4000): string {
  const text = JSON.stringify(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function mergeToolResult(research: ResearchState, name: string, data: unknown): void {
  if (name === 'resolve_city') {
    const payload = data as { city: string; adcode: string; center: { lng: number; lat: number } }
    research.city = payload.city
    research.adcode = payload.adcode
    research.center = payload.center
    return
  }
  if (name === 'search_poi') {
    const payload = data as { candidates: PoiCandidate[] }
    const existing = new Set(research.pois.map((poi) => poi.poiId))
    for (const poi of payload.candidates) {
      if (!existing.has(poi.poiId) && research.pois.length < 40) {
        research.pois.push(poi)
        existing.add(poi.poiId)
      }
    }
    research.notes.push(`搜索到 ${payload.candidates.length} 个地点`)
    return
  }
  if (name === 'get_poi_detail') {
    const poi = data as PoiCandidate
    const index = research.pois.findIndex((item) => item.poiId === poi.poiId)
    if (index >= 0) research.pois[index] = poi
    else if (research.pois.length < 40) research.pois.push(poi)
    return
  }
  if (name === 'get_weather') {
    research.weather = data as ResearchState['weather']
    return
  }
  if (name === 'plan_route') {
    research.notes.push('已获取一段路线')
  }
}

export async function runResearch(
  requirement: AgentRequirement,
  research: ResearchState,
  budget: BudgetEstimate,
  missing: string[],
  ctx: ToolContext,
  usage: AgentUsage,
): Promise<void> {
  const modelTools = listModelTools().map(
    (tool) =>
      new DynamicStructuredTool({
        name: tool.name,
        description: tool.description,
        schema: tool.inputSchema as unknown as z.ZodObject<z.ZodRawShape>,
        func: async () => '',
      }),
  )
  const llm = createLLM({ temperature: 0.2 }).bindTools(modelTools)
  const messages: BaseMessage[] = [
    new SystemMessage(buildResearchPrompt()),
    new HumanMessage(buildResearchContext(requirement, research, budget, missing)),
  ]
  const counts = new Map<string, number>()

  for (let step = 0; step < agentConfig.maxResearchSteps; step++) {
    if (ctx.signal.aborted) throw new Error('运行已取消')
    research.steps = step + 1
    const ai = await llm.invoke(messages, { signal: ctx.signal })
    const stepUsage = usageFromMessage(ai)
    usage.promptTokens += stepUsage.promptTokens
    usage.completionTokens += stepUsage.completionTokens
    messages.push(ai)

    const toolCalls = ai.tool_calls ?? []
    if (toolCalls.length === 0) break

    for (const call of toolCalls) {
      const callId = call.id ?? `${call.name}-${step}-${Date.now()}`
      const tool = getTool(call.name)
      const args = (call.args ?? {}) as Record<string, unknown>
      ctx.emit({ type: 'tool_call', callId, name: call.name, args, at: Date.now() })

      if (!tool) {
        const message = `未知工具：${call.name}`
        ctx.emit({ type: 'tool_result', callId, name: call.name, ok: false, summary: message, latencyMs: 0 })
        messages.push(new ToolMessage({ content: JSON.stringify({ ok: false, error: message }), tool_call_id: callId }))
        continue
      }

      const used = counts.get(call.name) ?? 0
      const cap = agentConfig.toolCaps[tool.name]
      if (used >= cap) {
        const message = `工具 ${call.name} 已达单次运行上限 ${cap} 次`
        ctx.emit({ type: 'tool_result', callId, name: call.name, ok: false, summary: message, latencyMs: 0 })
        messages.push(new ToolMessage({ content: JSON.stringify({ ok: false, error: message }), tool_call_id: callId }))
        continue
      }

      const startedAt = Date.now()
      try {
        const data = await tool.execute(args, ctx)
        counts.set(call.name, used + 1)
        mergeToolResult(research, call.name, data)
        const summary = tool.summarize(data)
        ctx.emit({
          type: 'tool_result',
          callId,
          name: call.name,
          ok: true,
          summary,
          latencyMs: Date.now() - startedAt,
        })
        messages.push(
          new ToolMessage({
            content: truncateJson({ ok: true, data: toModelView(call.name, data) }),
            tool_call_id: callId,
          }),
        )
      } catch (error) {
        const message = (error as Error).message
        ctx.emit({
          type: 'tool_result',
          callId,
          name: call.name,
          ok: false,
          summary: message,
          latencyMs: Date.now() - startedAt,
        })
        messages.push(
          new ToolMessage({
            content: truncateJson({ ok: false, error: { code: 'tool_error', message } }),
            tool_call_id: callId,
          }),
        )
      }
    }
  }
}

function messageText(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : ''))
    .join('')
}

/**
 * 生成计划的公共路径：先试 function calling 结构化输出，失败再退回纯文本 JSON。
 * 输出 token 上限必须显式给足，否则长行程的 JSON 会被提供商默认值截断，
 * 表现是「解析出一个残缺对象」，很难从报错里看出真实原因。
 */
async function generatePlan(
  prompt: string,
  temperature: number,
  signal: AbortSignal,
): Promise<{ plan: AgentPlan; usage: AgentUsage }> {
  const llm = createLLM({ temperature, maxTokens: agentConfig.planMaxOutputTokens })
  let structuredError: unknown

  try {
    const chain = llm.withStructuredOutput(AgentPlanEnvelopeSchema, {
      method: 'functionCalling',
      includeRaw: true,
    })
    const result = await chain.invoke([new SystemMessage(prompt)], { signal })
    return {
      plan: AgentPlanSchema.parse(result.parsed?.plan),
      usage: usageFromMessage(result.raw),
    }
  } catch (error) {
    structuredError = error
  }

  const response = await llm.invoke([new SystemMessage(prompt)], { signal })
  const text = messageText(response)
  // 没有正文说明这次调用本身失败了（常见于截断），抛原始错误比抛 JSON 解析错误更有诊断价值
  if (!text.trim()) throw structuredError
  return { plan: parsePlanText(text), usage: usageFromMessage(response) }
}

export async function draftPlan(
  requirement: AgentRequirement,
  research: ResearchState,
  budget: BudgetEstimate,
  signal: AbortSignal,
): Promise<{ plan: AgentPlan; usage: AgentUsage }> {
  const days = requirement.days ?? 3
  return generatePlan(buildDraftPrompt(requirement, research, budget, days), 0.3, signal)
}

export async function repairPlan(
  plan: AgentPlan,
  issues: AgentValidationIssue[],
  requirement: AgentRequirement,
  signal: AbortSignal,
): Promise<{ plan: AgentPlan; usage: AgentUsage }> {
  return generatePlan(buildRepairPrompt(plan, issues, requirement), 0.2, signal)
}
