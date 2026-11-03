/**
 * 最多 `limit` 个并发地从 `queue` 头部取任务执行，直到取空。
 * - `queue` 是可变数组：调用方清空它（`queue.length = 0` / `splice(0)`）即可作废还没开始的任务；
 * - worker 抛错时清空队列（剩下的不再发），错误抛给调用方。不想中断的 worker 自己 catch。
 */
export async function drainQueue<T>(queue: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift() as T
      try {
        await worker(item)
      } catch (error) {
        queue.length = 0
        throw error
      }
    }
  }))
}
