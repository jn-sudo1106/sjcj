import { afterEach, describe, expect, it, vi } from 'vitest'
import { flowCenterApi, type FlowRecord } from '@/api'
import { useFlowNodeCounts } from './flowNodeCounts'

const flow = (id: string) => ({ id, name: id, updatedAt: '2026-10-31' }) as FlowRecord

describe('useFlowNodeCounts', () => {
  afterEach(() => vi.restoreAllMocks())

  // 翻页时作废上一页还没开始读的；新页里也有的那条要重新排队，不能卡在「读取中」
  it('新一次 load 作废旧队列，重叠的流程照样读出来', async () => {
    const resolvers: (() => void)[] = []
    const steps = vi.spyOn(flowCenterApi, 'steps').mockImplementation((id: string) => new Promise((resolve) => {
      resolvers.push(() => resolve(Array.from({ length: Number(id) }) as never))
    }))
    const { counts, load } = useFlowNodeCounts()
    const first = load(['1', '2', '3', '4', '5'].map(flow))
    const second = load(['5', '6'].map(flow))
    // 逐轮放行已发出的请求，worker 才会去取下一条
    for (let i = 0; i < 20; i++) {
      resolvers.splice(0).forEach((resolve) => resolve())
      await Promise.resolve()
    }
    await Promise.all([first, second])
    expect(steps.mock.calls.map((c) => c[0])).toEqual(['1', '2', '3', '5', '6'])
    expect(counts['5']).toBe(5)
    expect(counts['6']).toBe(6)
    expect('4' in counts).toBe(false)
  })
})
