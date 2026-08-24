import type { MemoryMessage } from './memoryService.js'
import { indexMemory } from './longTermMemoryService.js'
import { incCounter } from './memoryMetrics.js'

/** 长期记忆异步写入任务：入队前数据已快照化，队列执行时仅写向量不再读库 */
export interface MemoryWriteTask {
  userId: string
  sessionId: string
  recentMessages: MemoryMessage[]
}

let queue: MemoryWriteTask[] = []
let consuming: Promise<void> | null = null

/** 非阻塞入队：立即返回，由单消费者串行消费 */
export function enqueueMemoryWrite(task: MemoryWriteTask): void {
  queue.push(task)
  if (!consuming) {
    consuming = consume()
  }
}

async function consume(): Promise<void> {
  while (queue.length > 0) {
    const task = queue.shift()!
    try {
      await indexMemory(task.userId, task.sessionId, task.recentMessages)
    } catch (error) {
      // indexMemory 内部已吞异常并计数，此处仅作为未预期异常的兜底防御
      incCounter('write.failed')
      console.error('长期记忆异步写入失败', error)
    }
  }
  consuming = null
}

/** 当前待处理任务数（供观测） */
export function getPendingCount(): number {
  return queue.length
}

/** 排空队列：等待所有已入队任务消费完成（供进程退出时调用） */
export async function drain(): Promise<void> {
  while (queue.length > 0 || consuming) {
    if (consuming) {
      await consuming
    } else {
      consuming = consume()
      await consuming
    }
  }
}
