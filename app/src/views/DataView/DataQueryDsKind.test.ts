// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { dataApi, entryApi, favoriteApi, logReportApi, type EntryTypeGroup, type DataTableMeta } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { favoriteEntryIds } from '@/utils/entryFavorites'
import DataQueryTab from './DataQueryTab.vue'
const GROUP: EntryTypeGroup = { main: 'm1', list1: [
  { tableId: 'm1', name: '同名表', tableName: 'tb_mysql', dsKind: 'MYSQL', fields: [] },
  { tableId: 'c1', name: '同名表', tableName: 'tb_ck', dsKind: 'CK', fields: [] },
], list2: [], list3: [] }
let wrapper: VueWrapper
beforeEach(() => {
  setActivePinia(createPinia()); useAuthStore().roles = ['read']; favoriteEntryIds.value = new Set()
  vi.spyOn(favoriteApi, 'listIds').mockResolvedValue([])
  vi.spyOn(logReportApi, 'recentRaw').mockResolvedValue({ success: true, code: '0', msg: '', data: [] })
  vi.spyOn(logReportApi, 'report').mockResolvedValue({ success: true, code: '0', msg: '', data: {} })
  vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(GROUP)
  vi.spyOn(dataApi, 'tableMeta').mockImplementation(async tableId => ({ tableId, tableName: `tb_${tableId}`, fields: [{ prop: 'K1', columnName: 'K1', desc: '内容', type: 'string', required: true }] }))
  vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([])
  vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async q => ({ total: 1, list: [{ dataId: '501', sourceId: '', values: { K1: `${q.tableId} 数据` }, title: '', summary: '', acceptState: 'accepted' }] }))
})
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/data', component: { template: '<div />' } }] })
  await router.push('/data'); await router.isReady()
  wrapper = mount(DataQueryTab, { global: { plugins: [ElementPlus, router] } }); await flushPromises()
}
async function choose(id: string) { await wrapper.findAll(`[data-table-id="${id}"]`)[0]!.trigger('click'); await flushPromises() }
describe('数据查询左侧库与表导航', () => {
  it('默认完整目录，展开 CK 不改查询，点击 CK 表才切表；同名表显示类型与 ID', async () => {
    await mountPage()
    expect(dataApi.entryTypesGroup).toHaveBeenLastCalledWith(undefined)
    expect(wrapper.get('.dv-table-context').text()).toContain('MYSQL')
    expect(wrapper.text()).toContain('m1 数据')
    vi.mocked(dataApi.rowQueryPaged).mockClear()
    await wrapper.get('[data-group="CK"]').trigger('click')
    expect(dataApi.rowQueryPaged).not.toHaveBeenCalled()
    expect(wrapper.get('[data-table-id="c1"]').attributes('title')).toContain('CK')
    await choose('c1')
    expect(wrapper.get('.dv-table-context').text()).toContain('CK')
    expect(wrapper.text()).toContain('c1 数据'); expect(wrapper.text()).not.toContain('m1 数据')
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'c1', page: 1 }))
  })
  it('搜索完整目录中的表名、物理表名或 ID，无分页截断和选表弹窗；收起保留搜索', async () => {
    const tables = Array.from({ length: 30 }, (_, i) => ({ tableId: String(2101000 + i), name: `指标${i}`, tableName: `tb_metric_${i}`, dsKind: 'CK' as const, fields: [] }))
    vi.mocked(dataApi.entryTypesGroup).mockResolvedValue({ ...GROUP, list3: tables })
    const paged = vi.spyOn(entryApi, 'entryPaged')
    await mountPage()
    for (const keyword of ['指标29', 'tb_metric_29', '2101029']) {
      await wrapper.get('input[data-testid="data-table-search"]').setValue(keyword)
      expect(wrapper.findAll('[data-table-id]')).toHaveLength(1)
      expect(wrapper.get('[data-table-id="2101029"]').text()).toContain('指标29')
    }
    await choose('2101029')
    expect(wrapper.get('.dv-table-context').text()).toContain('指标29')
    expect(paged).not.toHaveBeenCalled(); expect(document.querySelector('.dv-picker-dialog')).toBeNull()
    await wrapper.get('button[aria-label="收起数据表导航"]').trigger('click')
    expect(wrapper.get('[data-testid="data-table-sidebar"]').isVisible()).toBe(false)
    await wrapper.get('button[aria-label="展开数据表导航"]').trigger('click')
    expect(wrapper.get('input[data-testid="data-table-search"]').element).toHaveProperty('value', '2101029')
  })
  it('收藏复用 ENTRY_TYPE 接口，最近查看按 CLICK 读取记录，同一张表统一高亮', async () => {
    vi.mocked(favoriteApi.listIds).mockResolvedValue(['c1'])
    vi.mocked(logReportApi.recentRaw).mockResolvedValue({ success: true, code: '0', msg: '', data: [{ contentId: 'c1', contentTitle: '同名表', createDt: '2026-10-27' }] })
    vi.spyOn(favoriteApi, 'remove').mockResolvedValue({ ok: true, message: '' })
    await mountPage()
    expect(favoriteApi.listIds).toHaveBeenCalledWith('ENTRY_TYPE')
    expect(logReportApi.recentRaw).toHaveBeenCalledWith({ contentType: 'ENTRY_TYPE', action: 'CLICK', limit: 10 })
    await choose('c1')
    expect(logReportApi.report).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'CLICK', contentType: 'ENTRY_TYPE', contentId: 'c1' }))
    expect(wrapper.findAll('[data-table-id="c1"]').every(node => node.attributes('aria-current') === 'true')).toBe(true)
    await wrapper.get('button[aria-label="取消收藏当前表"]').trigger('click'); await flushPromises()
    expect(favoriteApi.remove).toHaveBeenCalledWith('ENTRY_TYPE', 'c1'); expect(favoriteEntryIds.value.has('c1')).toBe(false)
  })
  it('快速切表：迟到的 CK 表结构不能覆盖 MYSQL，也不能触发 CK 查询', async () => {
    await mountPage()
    let finishCk!: (meta: DataTableMeta) => void
    vi.mocked(dataApi.tableMeta).mockImplementation(async tableId => tableId === 'c1' ? new Promise(resolve => { finishCk = resolve }) : ({ tableId, tableName: 'tb_mysql', fields: [{ prop: 'K1', columnName: 'K1', desc: '内容', type: 'string', required: true }] }))
    await wrapper.get('[data-group="CK"]').trigger('click'); await choose('c1')
    expect(wrapper.text()).not.toContain('m1 数据')
    await choose('m1'); vi.mocked(dataApi.rowQueryPaged).mockClear()
    finishCk({ tableId: 'c1', tableName: 'tb_ck', fields: [] }); await flushPromises()
    expect(wrapper.get('.dv-table-context').text()).toContain('MYSQL'); expect(wrapper.text()).toContain('m1 数据')
    expect(dataApi.rowQueryPaged).not.toHaveBeenCalled()
  })
  it('目录加载失败提供重试，恢复后加载默认表与数据', async () => {
    vi.mocked(dataApi.entryTypesGroup).mockRejectedValueOnce(new Error('网络中断'))
    await mountPage(); expect(wrapper.get('[role="alert"]').text()).toContain('网络中断')
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('m1 数据')
  })
})
