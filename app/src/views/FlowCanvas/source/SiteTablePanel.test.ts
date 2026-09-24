// 网站数据视图左栏的数据表列表（0924-10）
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteTablePanel from './SiteTablePanel.vue'
import { siteApi, type UsedTable } from '@/api'

const t = (tableId: string, name: string, sourceCnt: number, role: 'MAIN' | 'STEP' = 'MAIN'): UsedTable => ({
  tableId, name, tableName: `sense_data.${tableId}`, sourceIds: Array.from({ length: sourceCnt }, (_, i) => `s${i}`), sourceCnt, role,
})
const TABLES = [t('900', '通用新闻表', 1368), t('6200020', '附件表', 118, 'STEP'), t('6200023', 'source_code', 1)]

async function mountPanel(props: Record<string, unknown> = {}, result = { tables: TABLES, noFlowSourceCnt: 0, failedFlowIds: [] as string[] }) {
  const spy = vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue(result)
  const wrapper = mount(SiteTablePanel, { props: { siteId: '89', activeTableId: '', ...props } })
  await flushPromises()
  return { wrapper, spy }
}

describe('SiteTablePanel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('列出本站用到的表：名称、表 ID、涉及源数；子节点表带标记', async () => {
    const { wrapper } = await mountPanel({ activeTableId: '900' })
    const rows = wrapper.findAll('[data-testid="site-table-row"]')
    expect(rows.map((r) => r.find('.stp-row-name').text())).toEqual(['通用新闻表', '附件表', 'source_code'])
    expect(rows[0]!.find('.stp-count').text()).toBe('1368')
    expect(rows[1]!.text()).toContain('子节点')
    expect(rows[0]!.classes()).toContain('active')
  })

  it('地址栏没带表：自动选第一张（涉及源最多的）', async () => {
    const { wrapper } = await mountPanel()
    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({ tableId: '900' })
  })

  it('地址栏没带表但有上次看的表：选上次那张', async () => {
    const { wrapper } = await mountPanel({ preferredTableId: '6200023' })
    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({ tableId: '6200023' })
  })

  it('地址栏的表就在列表里：不改选', async () => {
    const { wrapper } = await mountPanel({ activeTableId: '6200020' })
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('点表发 pick', async () => {
    const { wrapper } = await mountPanel({ activeTableId: '900' })
    await wrapper.findAll('[data-testid="site-table-row"]')[2]!.trigger('click')
    expect(wrapper.emitted('pick')?.at(-1)?.[0]).toMatchObject({ tableId: '6200023' })
  })

  it('按表名 / 表 ID / 物理表名搜索', async () => {
    const { wrapper } = await mountPanel({ activeTableId: '900' })
    await wrapper.get('[data-testid="site-table-search"]').setValue('6200020')
    expect(wrapper.findAll('[data-testid="site-table-row"]').map((r) => r.find('.stp-row-name').text())).toEqual(['附件表'])
    await wrapper.get('[data-testid="site-table-search"]').setValue('source_')
    expect(wrapper.findAll('[data-testid="site-table-row"]').map((r) => r.find('.stp-row-name').text())).toEqual(['source_code'])
  })

  it('统计可能不全时底部说明原因，并可重试', async () => {
    const { wrapper, spy } = await mountPanel({ activeTableId: '900' }, { tables: TABLES, noFlowSourceCnt: 3, failedFlowIds: ['f1'] })
    const hint = wrapper.get('[data-testid="site-table-partial"]').text()
    expect(hint).toContain('3 个源未关联流程')
    expect(hint).toContain('1 个流程的节点没查到')
    await wrapper.get('[data-testid="site-table-partial"] button').trigger('click')
    expect(spy).toHaveBeenLastCalledWith('89', { force: true })
  })

  it('加载失败：给重试入口', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockRejectedValueOnce(new Error('502'))
    const wrapper = mount(SiteTablePanel, { props: { siteId: '89', activeTableId: '' } })
    await flushPromises()
    expect(wrapper.text()).toContain('表列表加载失败')
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: TABLES, noFlowSourceCnt: 0, failedFlowIds: [] })
    await wrapper.get('[data-testid="site-table-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="site-table-row"]')).toHaveLength(3)
  })
})
