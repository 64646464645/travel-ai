import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function writeReport(report: Record<string, unknown>, prefix = `memory-eval-${Date.now()}`) {
  const directory = resolve(process.cwd(), 'evaluation/reports')
  await mkdir(directory, { recursive: true })
  const jsonPath = resolve(directory, `${prefix}.json`)
  const markdownPath = resolve(directory, `${prefix}.md`)
  const metrics = report.metrics as Record<string, unknown>
  const deletionMetrics = report.deletionMetrics as Record<string, number> | undefined
  const categoryMetrics = report.categoryMetrics as Record<string, unknown>
  const rows: string[] = ['# RAG 长期记忆评测报告', '', `- 数据集：${report.datasetVersion}`, `- 评测口径：${report.harnessVersion}`, `- 参数：topK=${(report.config as Record<string, unknown>).topK}，threshold=${(report.config as Record<string, unknown>).scoreThreshold}`, `- 样本数：${report.caseCount}`, '', '## 总体指标', '', '| 指标 | 值 |', '| --- | --- |', ...Object.entries(metrics).filter(([, value]) => typeof value !== 'object').map(([key, value]) => `| ${key} | ${value} |`)]
  if (deletionMetrics) {
    rows.push('', '## 删除专项指标', '', '| 指标 | 值 |', '| --- | --- |', `| deletion 用例数 | ${deletionMetrics.deletionCaseCount} |`, `| 删除前可召回率 | ${deletionMetrics.deletionBeforeRecallRate} |`, `| 删除通过率 | ${deletionMetrics.deletionPassRate} |`, `| 删除后同义改写残留率 | ${deletionMetrics.deletionRewriteResidualRate} |`, `| 删除操作失败率 | ${deletionMetrics.deletionOperationFailureRate} |`)
  }
  rows.push('', '## 分类指标', '', '| 分类 | Recall@K | HitRate@K | MRR |', '| --- | ---: | ---: | ---: |', ...Object.entries(categoryMetrics).map(([category, value]) => { const item = value as Record<string, number>; return `| ${category} | ${item.recallAtK} | ${item.hitRateAtK} | ${item.mrr} |` }), '', '## 门槛', '', `通过：${report.passed ? '是' : '否'}`, '', '## 失败样本', '', ...((report.failures as string[]).length ? (report.failures as string[]).map((failure) => `- ${failure}`) : ['- 无']))
  const executionErrors = report.executionErrors as string[] | undefined
  if (executionErrors?.length) {
    rows.push('', '## 执行错误', '', ...executionErrors.map((error) => `- ${error}`))
  }
  const markdown = rows.join('\n')
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  await writeFile(markdownPath, markdown, 'utf8')
  return { jsonPath, markdownPath }
}
