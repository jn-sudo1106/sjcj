// 0904 I01（Z1）：反查源的弹窗退役，算法抽成纯函数。
// 这些用例是从 BackTraceSourcesDialog.test.ts 迁过来的——**弹窗可以拆，但 09-04 六轮修复
// 换来的这套算法一个字都不能丢**，尤其是"把网站的源写进查询条件"那条。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backTraceSources, DISTINCT_LIMIT } from './backTraceSources'
import { dataApi, type RowQuery } from '@/api'

const QUERY = { tableId: '900', sql: "K1 LIKE '%金融%'" } as RowQuery

afterEach(() => vi.restoreAllMocks())

describe('backTraceSources · 有网站范围（把源写进查询条件）', () => {
  it('把网站的源拼成 SOURCE_ID IN 追加到 sql，并按 SOURCE_ID 分组统计命中数', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: 's1', CNT: 3 }, { SOURCE_ID: 's2', CNT: 7 },
    ] as never)

    const r = await backTraceSources(QUERY, ['s1', 's2', 's3'])

    expect(r.sourceIds).toEqual(['s1', 's2'])
    expect(r.hitCountBySource.get('s2')).toBe(7)
    const [passedQuery, fields] = summary.mock.calls[0]
    // 原条件要被括起来再 AND，否则 `a OR b` 会被 IN 条件改变优先级
    expect((passedQuery as RowQuery).sql).toBe("(K1 LIKE '%金融%') AND SOURCE_ID IN ('s1','s2','s3')")
    expect(fields).toEqual(['SOURCE_ID'])
  })

  // 2026-09-09 生产实测：末尾分号必须在**包括号之前**削掉。包成 `(条件) AND IN(...)` 之后
  // 末尾字符已经是 `)`，API 层 buildLegacyMore 里那道清理就够不着，分号会被裹在中间
  // （`LOWER(TRIM(k23));) AND SOURCE_ID IN (…)`），后端报「传到的条件含有非法注入风险」。
  // 普通查询没有这层包装，所以同一条件在数据列表里查得好好的，只有反查报错。
  it('用户条件末尾的分号在包进括号前就削掉，不会变成 `;)`', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([] as never)

    await backTraceSources({ tableId: '900', sql: "K1 IS NULL;" } as RowQuery, ['s1'])

    const passed = (summary.mock.calls[0][0] as RowQuery).sql ?? ''
    expect(passed).toBe("(K1 IS NULL) AND SOURCE_ID IN ('s1')")
    expect(passed).not.toContain(';')
  })

  it('字符串字面量里的分号照常保留，只削末尾', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([] as never)

    await backTraceSources({ tableId: '900', sql: "K2 LIKE '%;%';" } as RowQuery, ['s1'])

    expect((summary.mock.calls[0][0] as RowQuery).sql).toBe("(K2 LIKE '%;%') AND SOURCE_ID IN ('s1')")
  })

  it('没有原始 sql 时只下 IN 子句，不产生 "() AND"', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([] as never)
    await backTraceSources({ tableId: '900' } as RowQuery, ['s1'])
    expect((summary.mock.calls[0][0] as RowQuery).sql).toBe("SOURCE_ID IN ('s1')")
  })

  it('源清单超过 200 个按 200 一组切（整串要拼进 SQL，太长会被截断）', async () => {
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([] as never)
    const ids = Array.from({ length: 450 }, (_, i) => `s${i}`)
    await backTraceSources(QUERY, ids)
    expect(summary).toHaveBeenCalledTimes(3)
  })

  it('分组列回 null 的行要丢掉，不能变成一个名为 "null" 的源', async () => {
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: null, CNT: 5 }, { SOURCE_ID: 's1', CNT: 1 },
    ] as never)
    const r = await backTraceSources(QUERY, ['s1'])
    expect(r.sourceIds).toEqual(['s1'])
  })

  it('有网站范围时不碰 distinctSource —— 那条路会跨网站漏源（09-04 踩过两次）', async () => {
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([] as never)
    const distinct = vi.spyOn(dataApi, 'distinctSource')
    await backTraceSources(QUERY, ['s1'])
    expect(distinct).not.toHaveBeenCalled()
  })
})

describe('backTraceSources · 无网站范围（兜底走全表 distinctSource）', () => {
  it('多要一条来判定截断：正好 1000 个不算截断', async () => {
    const ids = Array.from({ length: DISTINCT_LIMIT }, (_, i) => `s${i}`)
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(ids)
    const r = await backTraceSources(QUERY)
    expect(r.truncated).toBe(false)
    expect(r.sourceIds).toHaveLength(DISTINCT_LIMIT)
  })

  it('拿回 1001 个才算真截断，且只保留前 1000', async () => {
    const ids = Array.from({ length: DISTINCT_LIMIT + 1 }, (_, i) => `s${i}`)
    const distinct = vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(ids)
    const r = await backTraceSources(QUERY)
    expect(r.truncated).toBe(true)
    expect(r.sourceIds).toHaveLength(DISTINCT_LIMIT)
    // 必须显式多要一条，否则恰好 1000 个源时会误报截断
    expect((distinct.mock.calls[0][0] as RowQuery & { size?: number }).size).toBe(DISTINCT_LIMIT + 1)
  })
})
