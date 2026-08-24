import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { HARNESS_VERSION } from './retrievalEvaluator.js'

const topKs = [1, 2, 4, 6, 8]
const thresholds = [0.2, 0.3, 0.4, 0.5, 0.6]

export async function runMatrix() {
  const results: Array<{ topK: number; scoreThreshold: number; passed: boolean; recallAtK: number; crossUserLeakRate: number }> = []
  for (const topK of topKs) for (const scoreThreshold of thresholds) {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'evaluation/cli.ts', '--mode', 'single'], { env: { ...process.env, MEMORY_TOP_K: String(topK), MEMORY_SCORE_THRESHOLD: String(scoreThreshold) }, stdio: ['ignore', 'pipe', 'inherit'] })
      let stdout = ''
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.on('error', reject)
      // single 模式在评测不达标（passed=false）时也会输出 JSON 摘要但退出码为 1，
      // 矩阵扫描应把「已产出有效摘要」视为该组合评测完成，而非执行失败
      child.on('exit', (code) => {
        const lastLine = stdout.trim().split('\n').at(-1) ?? ''
        try {
          JSON.parse(lastLine)
          resolve(stdout)
        } catch {
          reject(new Error(`矩阵组合失败: topK=${topK}, threshold=${scoreThreshold}, exitCode=${code}`))
        }
      })
    })
    const summary = JSON.parse(output.trim().split('\n').at(-1)!) as { harnessVersion?: string; passed: boolean; metrics: { recallAtK: number; crossUserLeakRate: number } }
    // 矩阵只聚合评测口径一致的版本，跨版本输入直接拒绝
    if (summary.harnessVersion !== HARNESS_VERSION) {
      throw new Error(`矩阵拒绝混合版本输入: 期望 ${HARNESS_VERSION}，子进程返回 ${summary.harnessVersion ?? 'unknown'}`)
    }
    results.push({ topK, scoreThreshold, passed: summary.passed, recallAtK: summary.metrics.recallAtK, crossUserLeakRate: summary.metrics.crossUserLeakRate })
  }
  const eligible = results.filter((result) => result.passed && result.crossUserLeakRate === 0)
  eligible.sort((a, b) => b.recallAtK - a.recallAtK)
  const summary = { harnessVersion: HARNESS_VERSION, executedAt: new Date().toISOString(), results, recommendation: eligible[0] ?? null }
  const directory = resolve(process.cwd(), 'evaluation/reports')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, `memory-matrix-${Date.now()}.json`), JSON.stringify(summary, null, 2), 'utf8')
  return summary
}
