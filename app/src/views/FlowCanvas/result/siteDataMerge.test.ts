import { describe, expect, it, vi } from 'vitest'
import { initMergeState, mergeLoadMore, type FetchPage } from './siteDataMerge'
import type { DataRow } from '@/api'

function row(sourceId: string, dataId: number): DataRow {
  return { dataId: String(dataId), sourceId, title: `${sourceId}-${dataId}`, summary: '', acceptState: 'pending' }
}

/** 内存版"后端"：每个源自己的全量数据（已按 dataId 降序排好，模拟真实分页源）+ 分页器。 */
function fakeBackend(data: Record<string, DataRow[]>): FetchPage {
  return async (sourceId, page, size) => {
    const all = data[sourceId] ?? []
    const start = (page - 1) * size
    return all.slice(start, start + size)
  }
}

describe('siteDataMerge：多源 top-K 归并', () => {
  it('单次合并结果按归并键全局降序，且确实是全局最大的那些行', async () => {
    const backend = fakeBackend({
      a: [50, 40, 30, 20, 10].map((id) => row('a', id)),
      b: [45, 35, 25].map((id) => row('b', id)),
      c: [48, 5].map((id) => row('c', id)),
    })
    const states = initMergeState(['a', 'b', 'c'])

    const result = await mergeLoadMore(states, 5, 3, backend)

    expect(result.rows.map((r) => r.dataId)).toEqual(['50', '48', '45', '40', '35'])
    expect(result.failedSourceIds).toEqual([])
  })

  it('分两次 load more 与一次性取相同数量结果完全一致，不重不漏', async () => {
    const data = {
      a: [50, 40, 30, 20, 10].map((id) => row('a', id)),
      b: [45, 35, 25, 15, 5].map((id) => row('b', id)),
    }
    const backendOnce = fakeBackend(data)
    const statesOnce = initMergeState(['a', 'b'])
    const once = await mergeLoadMore(statesOnce, 6, 3, backendOnce)

    const backendTwice = fakeBackend(data)
    const statesTwice = initMergeState(['a', 'b'])
    const first = await mergeLoadMore(statesTwice, 3, 3, backendTwice)
    const second = await mergeLoadMore(statesTwice, 3, 3, backendTwice)

    expect([...first.rows, ...second.rows].map((r) => r.dataId)).toEqual(once.rows.map((r) => r.dataId))
  })

  it('源数量不均、某源数据远多于其他源时仍不漏掉深页数据', async () => {
    const deep = Array.from({ length: 25 }, (_, i) => 100 - i) // 100..76，共 25 条
    const backend = fakeBackend({
      a: deep.map((id) => row('a', id)),
      b: [90, 60].map((id) => row('b', id)),
    })
    const states = initMergeState(['a', 'b'])

    // 前 5 条应该是 a 的 100..96（b 的 90 排第 6，但这里只取前 5，验证不会因为
    // a 一开始只 refill 了一页就漏掉后续更深的数据）
    const result = await mergeLoadMore(states, 5, 3, backend)
    expect(result.rows.map((r) => r.dataId)).toEqual(['100', '99', '98', '97', '96'])
  })

  it('单源失败不阻塞其他源，且不会在一次调用里反复重试同一个失败源', async () => {
    let badCallCount = 0
    const fetchPage: FetchPage = async (sourceId, page, size) => {
      if (sourceId === 'bad') {
        badCallCount += 1
        throw new Error('boom')
      }
      const all = [50, 40, 30, 20, 10].map((id) => row('ok', id))
      return all.slice((page - 1) * size, page * size)
    }
    const states = initMergeState(['ok', 'bad'])

    const result = await mergeLoadMore(states, 5, 3, fetchPage)

    expect(result.rows.map((r) => r.dataId)).toEqual(['50', '40', '30', '20', '10'])
    expect(result.failedSourceIds).toEqual(['bad'])
    // 5 条结果需要 refill 两次（size=3），但 bad 源只应该被尝试一次，不是两次
    expect(badCallCount).toBe(1)
  })

  it('失败源在下一次 load more 时会重新获得尝试机会', async () => {
    let attempt = 0
    const fetchPage: FetchPage = async (sourceId) => {
      if (sourceId === 'flaky') {
        attempt += 1
        if (attempt === 1) throw new Error('first try fails')
        return [row('flaky', 99)]
      }
      return []
    }
    const states = initMergeState(['flaky'])

    const first = await mergeLoadMore(states, 1, 5, fetchPage)
    expect(first.rows).toEqual([])
    expect(first.failedSourceIds).toEqual(['flaky'])

    const second = await mergeLoadMore(states, 1, 5, fetchPage)
    expect(second.rows.map((r) => r.dataId)).toEqual(['99'])
    expect(second.failedSourceIds).toEqual([])
  })

  it('所有源取完后 allExhausted 为 true，之后调用不再返回新数据', async () => {
    const backend = fakeBackend({ a: [20, 10].map((id) => row('a', id)) })
    const states = initMergeState(['a'])

    const first = await mergeLoadMore(states, 10, 3, backend)
    expect(first.rows.map((r) => r.dataId)).toEqual(['20', '10'])
    expect(first.allExhausted).toBe(true)

    const second = await mergeLoadMore(states, 10, 3, backend)
    expect(second.rows).toEqual([])
  })

  it('空源列表直接返回空结果，不报错', async () => {
    const fetchPage = vi.fn()
    const result = await mergeLoadMore(initMergeState([]), 10, 20, fetchPage)

    expect(result.rows).toEqual([])
    expect(result.allExhausted).toBe(true)
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('后端返回的批次未排序时，客户端二次排序兜底仍能得到正确的归并结果', async () => {
    // 模拟"后端没真的按 sortField 排"的情况（计划 §3.2 Q9 待验证）：故意打乱顺序返回。
    const fetchPage: FetchPage = async (sourceId) => {
      if (sourceId === 'a') return [10, 50, 30].map((id) => row('a', id)) // 乱序
      return [45, 5].map((id) => row('b', id))
    }
    const states = initMergeState(['a', 'b'])

    const result = await mergeLoadMore(states, 4, 3, fetchPage)

    expect(result.rows.map((r) => r.dataId)).toEqual(['50', '45', '30', '10'])
  })
})
