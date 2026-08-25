import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldExtractMemory } from '../src/services/memoryExtraction.js'

test('默认关键词命中时通过记忆抽取 gate', () => {
  assert.equal(shouldExtractMemory('我喜欢安静的街区。'), true)
  assert.equal(shouldExtractMemory('今天天气不错。'), false)
})

test('自定义关键词完全覆盖默认关键词', () => {
  const previous = process.env.MEMORY_EXTRACTION_KEYWORDS
  process.env.MEMORY_EXTRACTION_KEYWORDS = 'coffee,Trip'
  try {
    assert.equal(shouldExtractMemory('我喜欢安静的街区。'), false)
    assert.equal(shouldExtractMemory('COFFEE nearby'), true)
    assert.equal(shouldExtractMemory('准备 Trip 计划'), true)
  } finally {
    if (previous === undefined) delete process.env.MEMORY_EXTRACTION_KEYWORDS
    else process.env.MEMORY_EXTRACTION_KEYWORDS = previous
  }
})
