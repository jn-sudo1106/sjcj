import { describe, expect, it, vi } from 'vitest'
import type { Source } from '@/api'
import {
  CollectLimitError,
  LAUNCH_ALL_MAX,
  chunkIds,
  collectAllUnderQuery,
  describeFilters,
  partitionLaunchTargets,
  resolveScope,
  sendInBatches,
  sourceToExportRow,
} from './useSourceLaunch'

const src = (id: string, extra: Partial<Source> = {}): Source => ({
  sourceId: id, name: id, url: '', configId: '', mainTable: '', owner: '', state: 'C', ...extra,
})

describe('resolveScope', () => {
  const query = { siteIds: '1' }

  it('勾了就按勾选，命中数 = 勾选数，不看筛选总数', () => {
    expect(resolveScope(['a', 'b'], 999, query)).toEqual({ mode: 'selected', ids: ['a', 'b'], hitCount: 2 })
  })

  it('没勾就是按当前筛选条件全量发，命中数 = 筛选后总数', () => {
    expect(resolveScope([], 42, query)).toEqual({ mode: 'query', query, hitCount: 42 })
  })
})

describe('partitionLaunchTargets', () => {
  it('停用的和参数源都跳过，剩下的才发', () => {
    const { sendable, disabled, param } = partitionLaunchTargets([
      src('a'),
      src('b', { disabled: true }),
      src('c', { kind: 'param' }),
    ])
    expect(sendable.map((s) => s.sourceId)).toEqual(['a'])
    expect(disabled.map((s) => s.sourceId)).toEqual(['b'])
    expect(param.map((s) => s.sourceId)).toEqual(['c'])
  })
})

describe('chunkIds / sendInBatches', () => {
  it('按 500 切开', () => {
    const ids = Array.from({ length: 1200 }, (_, i) => String(i))
    const chunks = chunkIds(ids, 500)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(500)
    expect(chunks[2]).toHaveLength(200)
  })

  it('一批失败不回滚已发出的，继续发后面的批，失败批次单独列出', async () => {
    const send = vi.fn(async (ids: string[]) => {
      if (ids[0] === '2') throw new Error('限流')
    })
    const result = await sendInBatches(['0', '1', '2', '3', '4'], send, { batchSize: 2 })
    expect(send).toHaveBeenCalledTimes(3)
    expect(result.sent).toBe(3)
    expect(result.failed).toEqual([{ ids: ['2', '3'], error: '限流' }])
  })

  it('发出去的 send 由调用方负责，本函数不碰 all 字段——调用方必须恒传 0', async () => {
    const payloads: Array<{ ids: string[]; all: 0 | 1 }> = []
    await sendInBatches(['a', 'b'], async (ids) => {
      payloads.push({ ids, all: 0 })
    }, { batchSize: 10 })
    expect(payloads.every((p) => p.all === 0)).toBe(true)
  })
})

describe('collectAllUnderQuery', () => {
  it('第一页 total 超上限直接抛，一页都不再拉', async () => {
    const fetchPage = vi.fn(async () => ({ total: LAUNCH_ALL_MAX + 1, list: [src('a')] }))
    await expect(collectAllUnderQuery({ siteIds: '1' }, { fetchPage })).rejects.toBeInstanceOf(CollectLimitError)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
  })

  it('分页收齐，进度按已拿到的条数走', async () => {
    const fetchPage = vi.fn(async (p: { page: number; size: number }) => {
      if (p.page === 1) return { total: 3, list: [src('a'), src('b')] }
      return { total: 3, list: [src('c')] }
    })
    const progress: Array<[number, number]> = []
    const list = await collectAllUnderQuery({ siteIds: '1' }, {
      fetchPage, pageSize: 2, onProgress: (got, total) => progress.push([got, total]),
    })
    expect(list.map((s) => s.sourceId)).toEqual(['a', 'b', 'c'])
    expect(progress).toEqual([[2, 3], [3, 3]])
  })

  it('取消后抛 AbortError，不再请求下一页', async () => {
    const ctrl = new AbortController()
    const fetchPage = vi.fn(async (p: { page: number }) => {
      if (p.page === 1) {
        ctrl.abort()
        return { total: 4, list: [src('a'), src('b')] }
      }
      return { total: 4, list: [src('c'), src('d')] }
    })
    await expect(collectAllUnderQuery({ siteIds: '1' }, {
      fetchPage, pageSize: 2, signal: ctrl.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})

describe('describeFilters / 导出行', () => {
  it('没填条件就是「当前网站全部源」', () => {
    expect(describeFilters({})).toBe('当前网站全部源')
  })

  it('标签用顿号连且不带 #——导出给人看，不回写', () => {
    const row = sourceToExportRow(src('1', { tags: ['正文缺失', '内容重复'], remark: '验证正常' }))
    expect(row[4]).toBe('正文缺失、内容重复')
    expect(row[4]).not.toContain('#')
    expect(row[5]).toBe('验证正常')
  })
})
