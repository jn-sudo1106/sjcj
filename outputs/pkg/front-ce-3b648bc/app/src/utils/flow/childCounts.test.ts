import { describe, expect, it, vi, beforeEach } from 'vitest'
import { dataApi } from '@/api'
import {
  chunk,
  fetchChildCounts,
  fetchChildCountsForPage,
  parentIdInClause,
  resolveChildTargets,
  PARENT_ID_CHUNK,
  type ChildTarget,
} from './childCounts'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

function collectNode(id: string, title: string, outputTable: string): NodeConfig {
  return { id, title, kind: 'collect', collectCfg: { outputTable } } as unknown as NodeConfig
}

describe('resolveChildTargets · 后继节点与它们的输出表', () => {
  it('单后继：返回一个目标，表取后继的输出表', () => {
    const configs = {
      a: collectNode('a', '列表抓取', 'T_LIST'),
      b: collectNode('b', '抽取正文', 'T_BODY'),
    }
    expect(resolveChildTargets({ main: ['a', 'b'], configs }, 'a')).toEqual([
      { nodeId: 'b', title: '抽取正文', tableId: 'T_BODY' },
    ])
  })

  it('末节点没有后继：返回空数组（调用方据此整列不渲染，而不是显示一列 —）', () => {
    const configs = { a: collectNode('a', '列表抓取', 'T_LIST') }
    expect(resolveChildTargets({ main: ['a'], configs }, 'a')).toEqual([])
  })

  it('后继没有输出表（决策/分头这类结构节点）时跳过——它们不落数据，谈不上下级几条', () => {
    const configs = {
      a: collectNode('a', '列表抓取', 'T_LIST'),
      b: { id: 'b', title: '决策', kind: 'decision' } as unknown as NodeConfig,
    }
    expect(resolveChildTargets({ main: ['a', 'b'], configs }, 'a')).toEqual([])
  })

  it('nodeId 为空时不解析', () => {
    expect(resolveChildTargets({ main: [], configs: {} }, '')).toEqual([])
  })
})

describe('parentIdInClause / chunk', () => {
  it('拼成 PARENT_ID IN (...)，单引号按 SQL 规矩转义成两个', () => {
    expect(parentIdInClause(['1', "a'b"])).toBe("PARENT_ID IN ('1','a''b')")
  })
  it('按 200 一组切', () => {
    const ids = Array.from({ length: 450 }, (_, i) => String(i))
    const groups = chunk(ids, PARENT_ID_CHUNK)
    expect(groups.map((g) => g.length)).toEqual([200, 200, 50])
  })
})

describe('fetchChildCounts · 一次 GROUP BY 拿回整页', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('把 PARENT_ID 分组计数收成 Map；没有下级的父行不在 Map 里（GROUP BY 不给 0 的组）', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { PARENT_ID: '1', CNT: 5 },
      { PARENT_ID: '2', CNT: 2 },
    ])
    const counts = await fetchChildCounts('T_BODY', ['1', '2', '3'])

    expect(counts.get('1')).toBe(5)
    expect(counts.get('2')).toBe(2)
    expect(counts.has('3')).toBe(false)
    expect(summary).toHaveBeenCalledWith(
      { tableId: 'T_BODY', sql: "PARENT_ID IN ('1','2','3')" },
      ['PARENT_ID'],
    )
  })

  it('分组列键名大小写不保证，parent_id 也认', async () => {
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ parent_id: '7', CNT: 3 } as never])
    expect((await fetchChildCounts('T', ['7'])).get('7')).toBe(3)
  })

  it('超过 200 个父行切成多组，各组结果合并', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i))
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ PARENT_ID: '0x', CNT: 1 }])
    await fetchChildCounts('T', ids)
    expect(summary).toHaveBeenCalledTimes(2)
  })

  it('空 parentIds / 空表名不发请求', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData')
    expect((await fetchChildCounts('T', [])).size).toBe(0)
    expect((await fetchChildCounts('', ['1'])).size).toBe(0)
    expect(summary).not.toHaveBeenCalled()
  })

  it("父 ID 为 '' 或 '0'（= 没有父行）不参与查询", async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([])
    await fetchChildCounts('T', ['0', '', '9'])
    expect(summary).toHaveBeenCalledWith({ tableId: 'T', sql: "PARENT_ID IN ('9')" }, ['PARENT_ID'])
  })
})

describe('fetchChildCountsForPage · 多后继合计与失败兜底', () => {
  beforeEach(() => vi.restoreAllMocks())

  const targets: ChildTarget[] = [
    { nodeId: 'b', title: '抽取正文', tableId: 'T_BODY' },
    { nodeId: 'c', title: '图片下载', tableId: 'T_IMG' },
  ]

  it('多后继：total 是各表之和，byTarget 保留拆分供 tooltip 展示', async () => {
    vi.spyOn(dataApi, 'summaryData').mockImplementation(async (q) =>
      q.tableId === 'T_BODY' ? [{ PARENT_ID: '1', CNT: 5 }] : [{ PARENT_ID: '1', CNT: 2 }])

    const cells = await fetchChildCountsForPage(targets, ['1'])
    expect(cells!.get('1')!.total).toBe(7)
    expect(cells!.get('1')!.byTarget.map((t) => [t.title, t.count])).toEqual([['抽取正文', 5], ['图片下载', 2]])
  })

  it('某一行在所有后继表里都没有下级时 total 为 0（仍然在 Map 里，模板据此显示 —）', async () => {
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([])
    const cells = await fetchChildCountsForPage(targets, ['9'])
    expect(cells!.get('9')!.total).toBe(0)
  })

  it('统计失败返回 null，让调用方把该列显示成 ?——不抛出去中断主表渲染', async () => {
    vi.spyOn(dataApi, 'summaryData').mockRejectedValue(new Error('boom'))
    expect(await fetchChildCountsForPage(targets, ['1'])).toBeNull()
  })

  it('没有后继目标时不发请求，返回空 Map', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData')
    expect((await fetchChildCountsForPage([], ['1']))!.size).toBe(0)
    expect(summary).not.toHaveBeenCalled()
  })
})
