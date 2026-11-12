import { describe, expect, it } from 'vitest'
import { drainQueue } from './concurrency'

describe('drainQueue', () => {
  it('同时最多 limit 个在跑，全部跑完（含 0 这类假值）', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await drainQueue([0, 1, 2, 3, 4, 5], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 1))
      done.push(n)
      running--
    })
    expect(peak).toBe(2)
    expect(done.sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('任务失败后剩下的不再执行，错误抛给调用方', async () => {
    const started: number[] = []
    await expect(drainQueue([1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n)
      if (n === 1) throw new Error('失败')
      await new Promise((r) => setTimeout(r, 1))
    })).rejects.toThrow('失败')
    expect(started).toEqual([1, 2])
  })

  it('调用方清空队列即可作废还没开始的任务', async () => {
    const queue = [1, 2, 3, 4]
    const started: number[] = []
    await drainQueue(queue, 1, async (n) => {
      started.push(n)
      if (n === 2) queue.length = 0
    })
    expect(started).toEqual([1, 2])
  })
})
