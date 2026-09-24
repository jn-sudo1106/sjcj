// 数据视图左栏选「全部」时的各表汇总（2026-09-24）
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteTablesOverview from './SiteTablesOverview.vue'
import { dataApi, siteApi, type Source, type UsedTable } from '@/api'

const t = (tableId: string, name: string, sourceIds: string[], role: 'MAIN' | 'STEP' = 'MAIN'): UsedTable => ({
  tableId, name, tableName: `sense_data.${tableId}`, sourceIds, sourceCnt: sourceIds.length, role,
})
const TABLES = [t('900', '通用新闻表', ['a', 'b']), t('6200020', '附件表', ['a'], 'STEP')]

describe('SiteTablesOverview', () => {
  afterEach(() => vi.restoreAllMocks())

  it('列出各表的名称、表 ID、物理表名、类型、涉及源数；数据量逐张补齐', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: TABLES, noFlowSourceCnt: 0, failedFlowIds: [] })
    const summary = vi.spyOn(dataApi, 'summaryData').mockImplementation(async (q) => (
      q.tableId === '900' ? [{ SOURCE_ID: 'a', CNT: 1000 }, { SOURCE_ID: 'b', CNT: 234 }] : [{ SOURCE_ID: 'a', CNT: 7 }]
    ) as never)
    const wrapper = mount(SiteTablesOverview, { props: { siteId: '89' } })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="site-tables-overview-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('通用新闻表')
    expect(rows[0]!.text()).toContain('主表')
    expect(rows[1]!.text()).toContain('子节点')
    expect(wrapper.findAll('[data-testid="site-tables-overview-count"]').map((c) => c.text())).toEqual(['1,234', '7'])
    // 只在用到这张表的源里算
    expect(summary.mock.calls[0]![0].sql).toContain("SOURCE_ID IN ('a','b')")
    expect(summary.mock.calls[1]![0].sql).toContain("SOURCE_ID IN ('a')")
  })

  it('统计可能不全（有源未关联流程）时，数据量按全站源算', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: [TABLES[1]!], noFlowSourceCnt: 1, failedFlowIds: [] })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([{ sourceId: 'a' }, { sourceId: 'z' }] as Source[])
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([] as never)
    const wrapper = mount(SiteTablesOverview, { props: { siteId: '89' } })
    await flushPromises()
    expect(summary.mock.calls[0]![0].sql).toContain("SOURCE_ID IN ('a','z')")
    expect(wrapper.text()).toContain('1 个源未关联流程')
  })

  it('某张表统计失败：显示「统计失败」，其余照常', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: TABLES, noFlowSourceCnt: 0, failedFlowIds: [] })
    vi.spyOn(dataApi, 'summaryData').mockImplementation(async (q) => {
      if (q.tableId === '900') throw new Error('502')
      return [{ SOURCE_ID: 'a', CNT: 7 }] as never
    })
    const wrapper = mount(SiteTablesOverview, { props: { siteId: '89' } })
    await flushPromises()
    expect(wrapper.findAll('[data-testid="site-tables-overview-count"]').map((c) => c.text())).toEqual(['统计失败', '7'])
  })

  it('点一行发 pick', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: TABLES, noFlowSourceCnt: 0, failedFlowIds: [] })
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([] as never)
    const wrapper = mount(SiteTablesOverview, { props: { siteId: '89' } })
    await flushPromises()
    await wrapper.findAll('[data-testid="site-tables-overview-row"]')[1]!.trigger('click')
    expect(wrapper.emitted('pick')?.[0]).toEqual(['6200020'])
  })
})
