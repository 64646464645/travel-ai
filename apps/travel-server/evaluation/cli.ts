import 'dotenv/config'
import { loadEvaluationDataset, runRetrievalEvaluation } from './retrievalEvaluator.js'
import { runMatrix } from './matrixRunner.js'
import { runE2EEvaluation } from './e2eEvaluator.js'

const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'single'
const dataset = await loadEvaluationDataset()
if (mode === 'matrix') {
  const summary = await runMatrix()
  console.log(JSON.stringify(summary))
} else if (mode === 'e2e') {
  const result = await runE2EEvaluation(dataset)
  console.log(JSON.stringify(result))
  if (!result.passed) process.exitCode = 1
} else {
  const result = await runRetrievalEvaluation(dataset, { topK: Number(process.env.MEMORY_TOP_K) || 4, scoreThreshold: Number(process.env.MEMORY_SCORE_THRESHOLD) || 0.3, datasetVersion: dataset.version })
  console.log(JSON.stringify({ harnessVersion: result.harnessVersion, passed: result.passed, metrics: result.metrics, deletionMetrics: result.deletionMetrics, executionErrors: result.executionErrors, reports: result.paths }))
  if (!result.passed) process.exitCode = 1
}
