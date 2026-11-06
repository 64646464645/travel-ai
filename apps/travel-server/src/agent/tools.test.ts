import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentConfig } from './config.js'
import { getTool, listModelTools, toolRegistry } from './tools.js'

test('注册表恰好暴露 5 个模型可调用工具', () => {
  const names = listModelTools().map((tool) => tool.name).sort()
  assert.deepEqual(names, ['get_poi_detail', 'get_weather', 'plan_route', 'resolve_city', 'search_poi'])
  assert.equal(toolRegistry.size, 5)
})

test('每个工具都有描述、超时和调用上限', () => {
  for (const tool of listModelTools()) {
    assert.ok(tool.description.length > 8, `${tool.name} 缺描述`)
    assert.ok(tool.timeoutMs > 0, `${tool.name} 缺超时`)
    assert.ok(agentConfig.toolCaps[tool.name] > 0, `${tool.name} 缺调用上限`)
  }
})

test('未注册的工具返回 undefined，不抛异常', () => {
  assert.equal(getTool('drop_database'), undefined)
})

test('空参数一律被 schema 拒绝', () => {
  for (const tool of listModelTools()) {
    const result = tool.inputSchema.safeParse({})
    assert.equal(result.success, false, `${tool.name} 不该接受空参数`)
  }
})

test('search_poi 接受最小参数并给出默认值空间', () => {
  const tool = getTool('search_poi')!
  assert.equal(tool.inputSchema.safeParse({ city: '成都', query: '博物馆' }).success, true)
  assert.equal(
    tool.inputSchema.safeParse({ city: '成都', query: '博物馆', center: { lng: 104.06, lat: 30.67 }, radiusM: 3000, limit: 8 }).success,
    true,
  )
})

test('search_poi 拒绝越界 limit 与半截坐标', () => {
  const tool = getTool('search_poi')!
  assert.equal(tool.inputSchema.safeParse({ city: '成都', query: '博物馆', limit: 100 }).success, false)
  assert.equal(tool.inputSchema.safeParse({ city: '成都', query: '博物馆', center: { lng: 104 } }).success, false)
})

test('plan_route 的 mode 默认为 driving 且拒绝非法值', () => {
  const tool = getTool('plan_route')!
  const parsed = tool.inputSchema.parse({
    origin: { lng: 104.05, lat: 30.65 },
    destination: { lng: 104.07, lat: 30.67 },
  }) as { mode: string }
  assert.equal(parsed.mode, 'driving')
  assert.equal(
    tool.inputSchema.safeParse({
      origin: { lng: 104.05, lat: 30.65 },
      destination: { lng: 104.07, lat: 30.67 },
      mode: 'flying',
    }).success,
    false,
  )
})

test('get_weather 只接受 YYYY-MM-DD', () => {
  const tool = getTool('get_weather')!
  assert.equal(tool.inputSchema.safeParse({ adcode: '510100', startDate: '2026-05-01' }).success, true)
  assert.equal(tool.inputSchema.safeParse({ adcode: '510100', startDate: '2026/05/01' }).success, false)
})

test('resolve_city 拒绝空白城市名', () => {
  const tool = getTool('resolve_city')!
  assert.equal(tool.inputSchema.safeParse({ name: '  ' }).success, false)
})

test('summarize 输出可直接展示的摘要', () => {
  const searchTool = getTool('search_poi')!
  const summary = searchTool.summarize({
    candidates: [
      { poiId: 'p1', name: '宽窄巷子' },
      { poiId: 'p2', name: '人民公园' },
    ],
  })
  assert.ok(summary.includes('2 个地点'))
  assert.ok(summary.includes('宽窄巷子'))

  const routeTool = getTool('plan_route')!
  assert.ok(routeTool.summarize({ mode: 'walking', distanceM: 1200, durationSec: 900 }).includes('15 分钟'))
  assert.ok(
    routeTool.summarize({ mode: 'walking', distanceM: 1200, durationSec: 900, estimated: true }).includes('估算'),
  )

  const weatherTool = getTool('get_weather')!
  assert.ok(weatherTool.summarize({ available: false, reason: 'forecast_horizon', days: [] }).includes('不可用'))
})
