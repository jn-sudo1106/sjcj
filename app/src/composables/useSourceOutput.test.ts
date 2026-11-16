import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sourceApi } from '@/api'
import { clearSourceOutputCache, fetchSourceOutput, runPool, SOURCE_OUTPUT_CACHE_MS } from './useSourceOutput'

describe('fetchSourceOutput', () => {
  beforeEach(() => clearSourceOutputCache())
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('并发请求合并、2 分钟内复用、过期或 force 重取、失败不缓存', async () => {
    vi.useFakeTimers()
    const api = vi.spyOn(sourceApi, 'queryStepDetail').mockResolvedValue([])
    await Promise.all([fetchSourceOutput('1'), fetchSourceOutput('1')])
    expect(api).toHaveBeenCalledTimes(1)
    await fetchSourceOutput('1')
    expect(api).toHaveBeenCalledTimes(1)
    await fetchSourceOutput('1', { force: true })
    expect(api).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(SOURCE_OUTPUT_CACHE_MS + 1)
    await fetchSourceOutput('1')
    expect(api).toHaveBeenCalledTimes(3)

    api.mockRejectedValueOnce(new Error('x'))
    await expect(fetchSourceOutput('2')).rejects.toThrow('x')
    await fetchSourceOutput('2')
    expect(api).toHaveBeenCalledTimes(5)
  })

  it('runPool 并发不超过上限且全部跑完', async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 1))
      running--
      done.push(n)
    })
    expect(peak).toBe(3)
    expect(done.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
