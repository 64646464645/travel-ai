/**
 * M2 往返验证：真实跑一次 Agent，把产出的计划存进 itineraries，再逐项核对读回结果。
 *
 * 需要一个已注册的账号（脚本不创建用户，避免污染库）：
 *   E2E_USER=xxx E2E_PASS=yyy node scripts/itinerary-e2e.mjs
 * 可用 API_BASE 覆盖地址，默认 http://127.0.0.1:3300/api
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3300/api'
const USER = process.env.E2E_USER ?? ''
const PASS = process.env.E2E_PASS ?? ''

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body }
}

async function login() {
  const res = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (res.status !== 200) throw new Error(`登录失败 ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.data.accessToken
}

async function runAgent(token) {
  const res = await fetch(`${BASE}/agent/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: '成都两天，预算 2500，想看熊猫' }),
  })
  if (!res.ok) throw new Error(`Agent 运行失败 ${res.status}`)

  const raw = await res.text()
  const events = raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => { try { return JSON.parse(line.slice(6)) } catch { return null } })
    .filter(Boolean)

  const plan = events.find((event) => event.type === 'plan')?.plan
  const validations = events.filter((event) => event.type === 'validation')
  const issues = validations.length ? validations[validations.length - 1].issues : []
  const done = events.find((event) => event.type === 'done')
  return { plan, issues, done }
}

function fields(plan) {
  return {
    city: plan.city,
    days: plan.days,
    totalBudget: plan.totalBudget,
    activities: plan.dailyItinerary.flatMap((d) => [d.morning, d.afternoon, d.evening]).map((a) => `${a.spot}|${a.poiId ?? '-'}|${a.source ? 'src' : 'no-src'}`),
    citations: plan.citations.length,
    tips: plan.tips.length,
  }
}

async function main() {
  if (!USER || !PASS) throw new Error("缺少 E2E_USER / E2E_PASS")
  const token = await login()
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  console.log('1. 登录 OK')

  const run = await runAgent(token)
  if (!run.plan) throw new Error('未拿到计划，无法继续')
  console.log(`2. Agent 运行 ${run.done?.status}，计划 ${run.plan.city} ${run.plan.days} 天 ${run.plan.totalBudget} 元，issues ${run.issues.length}`)

  const save = await api('/itineraries', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ plan: run.plan, issues: run.issues, runId: run.done?.runId }),
  })
  if (save.status !== 201) throw new Error(`保存失败 ${save.status} ${JSON.stringify(save.body).slice(0, 300)}`)
  const saved = save.body.data
  console.log(`3. 保存 OK id=${saved.id} title="${saved.title}" activityCount=${saved.activityCount} unverified=${saved.unverifiedCount}`)

  const list = await api('/itineraries?limit=5', { headers: auth })
  const hit = list.body.data.items.find((item) => item.id === saved.id)
  if (!hit) throw new Error('列表里找不到刚保存的行程')
  console.log(`4. 列表 OK total=${list.body.data.total} 首项 ${hit.title} / ${hit.days} 天 / ¥${hit.totalBudget}`)

  const detail = await api(`/itineraries/${saved.id}`, { headers: auth })
  if (detail.status !== 200) throw new Error(`详情失败 ${detail.status}`)
  const back = detail.body.data
  const before = JSON.stringify(fields(run.plan))
  const after = JSON.stringify(fields(back.plan))
  console.log(`5. 详情读回，计划一致=${before === after}，schemaVersion=${back.schemaVersion}，issues 回读 ${back.issues.length} 条`)
  if (before !== after) {
    console.log('  原:', before)
    console.log('  回:', after)
  }

  const other = await api(`/itineraries/${saved.id}`, { headers: { Authorization: 'Bearer invalid' } })
  console.log(`6. 无权限访问返回 ${other.status}（期望 401）`)

  const del = await api(`/itineraries/${saved.id}`, { method: 'DELETE', headers: auth })
  const after404 = await api(`/itineraries/${saved.id}`, { headers: auth })
  console.log(`7. 删除返回 ${del.status}，再查返回 ${after404.status}（期望 404）`)

  const finalList = await api('/itineraries?limit=5', { headers: auth })
  console.log(`8. 删除后列表 total=${finalList.body.data.total}`)
}

main().catch((error) => {
  console.error('E2E 失败:', error.message)
  process.exitCode = 1
})
