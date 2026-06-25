import { describe, expect, it } from 'vitest'
import { mockOverviewSummary, mockOverviewTrend } from './overview'
import { mockSourcePaged } from './sources'

function todayLabel(): string {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('采集资产总览 mock 聚合', () => {
  it('近 7 日新增资产来自源的新入字段聚合', () => {
    const expected = mockSourcePaged({ size: 999 }).list.reduce((sum, source) => sum + (source.newInCount ?? 0), 0)

    expect(mockOverviewSummary().kpi.newAssets7).toBe(expected)
  })

  it('趋势最后一天使用当前日期', () => {
    const trend = mockOverviewTrend({ days: 7 })

    expect(trend.at(-1)?.date).toBe(todayLabel())
  })
})
