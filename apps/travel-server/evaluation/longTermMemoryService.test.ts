import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteBySession, resetMemoryIndexInstance } from '../src/services/longTermMemoryService.js'

async function withTempIndexDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'mem-lifecycle-test-'))
  const previous = process.env.VECTOR_INDEX_DIR
  process.env.VECTOR_INDEX_DIR = dir
  resetMemoryIndexInstance()
  try {
    await run(dir)
  } finally {
    if (previous === undefined) delete process.env.VECTOR_INDEX_DIR
    else process.env.VECTOR_INDEX_DIR = previous
    resetMemoryIndexInstance()
    await rm(dir, { recursive: true, force: true })
  }
}

test('deleteBySession 无匹配时返回结构化结果且不抛异常', async () => {
  await withTempIndexDir(async () => {
    const result = await deleteBySession('no-such-session')
    assert.equal(result.sessionId, 'no-such-session')
    assert.equal(result.deletedCount, 0)
    assert.equal(result.errorCode, undefined)
  })
})

test('同进程切换 VECTOR_INDEX_DIR 并 reset 后绑定独立索引实例', async () => {
  await withTempIndexDir(async (dirA) => {
    // 触发基于 dirA 的索引初始化
    await deleteBySession('case-a')
    await access(join(dirA, 'index.json'))
  })
  await withTempIndexDir(async (dirB) => {
    // 同进程内切换新目录并 reset 后，应基于 dirB 重建索引而非复用指向 dirA 的旧实例
    await deleteBySession('case-b')
    await access(join(dirB, 'index.json'))
  })
})
