import { describe, expect, it } from 'vitest'
import type { Site, SourceCategory } from '../types'
import { buildWebsitePanorama, mockOverviewSummary, mockOverviewTrend } from './overview'
import { mockSitePaged } from './sites'
import { mockSourceCategories, mockSourcePaged } from './sources'

function site(siteId: string, categoryPath: string, sourceCount: number, errorCount = 0): Site {
  return {
    siteId,
    name: siteId,
    category: categoryPath.split('/').filter(Boolean)[0] ?? '',
    owner: 'tester',
    categoryPath,
    sourceCount,
    errorCount,
  }
}

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

  it('全景分支来自实际采集资产分类树', () => {
    const summary = mockOverviewSummary()

    expect(summary.panorama.branches.map((branch) => branch.label)).toEqual(['基金类', '股票类', '舆情类'])
    expect(summary.panorama.branches.flatMap((branch) => branch.children.map((child) => child.label))).toEqual([
      '支付宝评论',
      '天天基金',
      '雪球',
      '公告',
      '行情',
      '微博',
      '新闻',
      '未细分',
    ])
    const sites = mockSitePaged({ size: 999 }).list
    expect(summary.panorama.branches.map((branch) => branch.total)).toEqual(
      mockSourceCategories().map((category) => sites.filter((site) => site.categoryPath?.startsWith(category.id)).length),
    )
    expect(summary.panorama.total).toBe(sites.length)
    expect(summary.panorama.sourceCount).toBe(sites.reduce((sum, site) => sum + site.sourceCount, 0))
  })

  it('按分类路径聚合网站、源与异常网站并单列无法归类的网站', () => {
    const categories: SourceCategory[] = [
      {
        id: '/基金类',
        name: '基金类',
        count: 0,
        children: [{ id: '/基金类/公告', name: '公告', count: 0 }],
      },
    ]
    const panorama = buildWebsitePanorama(
      [
        site('ok', '/基金类/公告', 3),
        site('error', '/基金类/公告', 5, 2),
        site('unknown', '/未归类/其他', 4),
      ],
      categories,
    )

    expect(panorama).toMatchObject({ total: 3, sourceCount: 12, error: 1, unclassified: 1 })
    expect(panorama.branches[0]).toMatchObject({ total: 2, sourceCount: 8, error: 1 })
    expect(panorama.branches[0]?.children[0]).toMatchObject({ total: 2, sourceCount: 8, error: 1 })
  })
})
