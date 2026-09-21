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

  // Y4-1：signal 三态。**能拦住的只有"还没提交的批次"**——已提交的不回滚，
  // 服务端一侧没有 stop/cancel 端点（服务端级停止是 H3，未答复）。
  it('中止：剩余批次不发，未提交的 ID 单独报出来', async () => {
    const signal = { paused: false, aborted: false }
    const send = vi.fn(async (ids: string[]) => {
      if (ids[0] === '2') signal.aborted = true // 第 2 批发完就中止
    })
    const result = await sendInBatches(['0', '1', '2', '3', '4', '5'], send, { batchSize: 2, signal, pollMs: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(result.sent).toBe(4)
    expect(result.skipped).toEqual(['4', '5'])
  })

  it('暂停：卡在下一批之前，恢复后接着发完', async () => {
    const signal = { paused: false, aborted: false }
    const send = vi.fn(async (ids: string[]) => {
      if (ids[0] === '0') signal.paused = true
    })
    const running = sendInBatches(['0', '1', '2', '3'], send, { batchSize: 2, signal, pollMs: 0 })
    // 让暂停的等待循环转几圈，确认它**没有**偷偷把第 2 批发出去
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0))
    expect(send).toHaveBeenCalledTimes(1)

    signal.paused = false
    const result = await running
    expect(send).toHaveBeenCalledTimes(2)
    expect(result.sent).toBe(4)
    expect(result.skipped).toEqual([])
  })

  // 暂停中点「结束」必须停得下来，否则循环永远卡在等待里
  it('暂停中被中止能退出，不会卡死在等待里', async () => {
    const signal = { paused: true, aborted: false }
    const running = sendInBatches(['0', '1'], vi.fn(), { batchSize: 1, signal, pollMs: 0 })
    signal.aborted = true
    signal.paused = false
    const result = await running
    expect(result.sent).toBe(0)
    expect(result.skipped).toEqual(['0', '1'])
  })

  it('不传 signal 时行为不变，skipped 恒为空', async () => {
    const result = await sendInBatches(['0', '1', '2'], vi.fn(), { batchSize: 2 })
    expect(result.skipped).toEqual([])
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

  // 源 URL 是独立于名称的条件，「按条件发任务」的确认文案必须带上它，
  // 否则用户以为只按名称筛，实际发出去的范围是两者取交集
  it('名称与 URL 是两个条件，都列进人话描述', () => {
    expect(describeFilters({ name: '盛科', sourceUrl: 'centec' })).toBe('名称含「盛科」，URL 含「centec」')
  })

  // `%` / `NULL` 是后端认的空值标记（0920-07），照字面写成「备注含「%」」没人看得懂
  it('备注的空值标记翻译成人话，不照字面写', () => {
    expect(describeFilters({ remark: '%' })).toBe('有备注')
    expect(describeFilters({ remark: 'NULL' })).toBe('没有备注')
    expect(describeFilters({ remark: '超时' })).toBe('备注含「超时」')
  })

  // 数据量筛选能把范围从几千收窄到几百，确认弹窗里看不见就等于没确认
  it('数据量上限也要进人话描述，0 不能被当成没填', () => {
    expect(describeFilters({ count: 5 })).toBe('数据量 ≤ 5')
    expect(describeFilters({ count: 0 })).toBe('数据量 ≤ 0')
  })

  it('标签用顿号连且不带 #——导出给人看，不回写', () => {
    const row = sourceToExportRow(src('1', { tags: ['正文缺失', '内容重复'], remark: '验证正常' }))
    expect(row[4]).toBe('正文缺失、内容重复')
    expect(row[4]).not.toContain('#')
    expect(row[5]).toBe('验证正常')
  })
})
