// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElSelect } from 'element-plus'
import { dataApi, entryApi, type EntryTypeGroup } from '@/api'
import { useAuthStore } from '@/stores/auth'
import DataQueryTab from './DataQueryTab.vue'

const GROUP: EntryTypeGroup = {
  main: 'm1',
  list1: [
    { tableId: 'm1', name: '同名表', tableName: 'tb_mysql', dsKind: 'MYSQL', fields: [] },
    { tableId: 'c1', name: '同名表', tableName: 'tb_ck', dsKind: 'CK', fields: [] },
  ],
  list2: [], list3: [],
}
let wrapper: VueWrapper
beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().roles = ['read']
  // 模拟后端尚未实现筛选，完整表目录仍返回两类表。
  vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(GROUP)
  vi.spyOn(dataApi, 'tableMeta').mockImplementation(async tableId => ({
    tableId, tableName: `tb_${tableId}`,
    fields: [{ prop: 'K1', columnName: 'K1', desc: '内容', type: 'string', required: true }],
  }))
  vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([])
  vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async q => ({ total: 1, list: [{
    dataId: '501', sourceId: '', values: { K1: `${q.tableId} 数据` }, title: '', summary: '', acceptState: 'accepted',
  }] }))
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/data', component: { template: '<div />' } }] })
  await router.push('/data'); await router.isReady()
  wrapper = mount(DataQueryTab, { global: { plugins: [ElementPlus, router] } })
  await flushPromises()
}
function kindSelect() {
  return wrapper.findAllComponents(ElSelect).find(c => c.attributes('data-testid') === 'data-ds-kind-filter')!
}
function tableSelect() {
  return wrapper.findAllComponents(ElSelect).find(c => c.props('placeholder') === '选择数据表')!
}
function tableLabels() {
  return tableSelect().findAllComponents({ name: 'ElOption' }).map(option => option.props('label'))
}
async function selectKind(value: string) {
  kindSelect().vm.$emit('update:modelValue', value)
  kindSelect().vm.$emit('change', value)
  await flushPromises()
}

describe('数据查询库类型与选表联动', () => {
  it('默认全部，同名表标明 MYSQL / CK；切 CK 清空不匹配的表和旧结果，不自动查询第一张表', async () => {
    await mountPage()
    expect(kindSelect().props('modelValue')).toBe('')
    expect(tableLabels()).toContain('同名表 · MYSQL')
    expect(tableLabels()).toContain('同名表 · CK')
    expect(wrapper.text()).toContain('m1 数据')
    vi.mocked(dataApi.rowQueryPaged).mockClear()

    await selectKind('CK')
    expect(dataApi.entryTypesGroup).toHaveBeenLastCalledWith(undefined, 'CK')
    expect(tableSelect().props('modelValue')).toBe('')
    expect(tableLabels()).not.toContain('同名表 · MYSQL')
    expect(tableLabels()).toContain('同名表 · CK')
    expect(wrapper.text()).not.toContain('m1 数据')
    expect(dataApi.rowQueryPaged).not.toHaveBeenCalled()
    expect(document.querySelector('.dv-picker-dialog')).toBeNull()
  })

  it('选 CK 表后查询该表，切回全部保留符合范围的表与结果', async () => {
    await mountPage()
    await selectKind('CK')
    tableSelect().vm.$emit('update:modelValue', 'c1')
    tableSelect().vm.$emit('change', 'c1')
    await flushPromises()
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'c1', sourceId: undefined, page: 1 }))
    expect(wrapper.text()).toContain('c1 数据')
    vi.mocked(dataApi.rowQueryPaged).mockClear()
    await selectKind('')
    expect(tableSelect().props('modelValue')).toBe('c1')
    expect(wrapper.text()).toContain('c1 数据')
    expect(dataApi.rowQueryPaged).not.toHaveBeenCalled()
  })

  it('快速切换时较晚返回的 CK 目录不能覆盖当前 MYSQL 目录', async () => {
    await mountPage()
    let finishCk!: (value: EntryTypeGroup) => void
    vi.mocked(dataApi.entryTypesGroup).mockImplementation(async (_sourceId, kind) => kind === 'CK'
      ? new Promise<EntryTypeGroup>(resolve => { finishCk = resolve }) : GROUP)
    await selectKind('CK')
    await selectKind('MYSQL')
    finishCk(GROUP)
    await flushPromises()
    expect(kindSelect().props('modelValue')).toBe('MYSQL')
    expect(tableLabels()).toContain('同名表 · MYSQL')
    expect(tableLabels()).not.toContain('同名表 · CK')
  })

  it('默认最多展示 20 张表，搜索完整目录中的表名或 ID，选中首屏外的表后保留名称', async () => {
    const tables = Array.from({ length: 30 }, (_, i) => ({
      tableId: String(2101000 + i), name: `指标${i}`, tableName: `tb_metric_${i}`, dsKind: 'CK' as const, fields: [],
    }))
    vi.mocked(dataApi.entryTypesGroup).mockResolvedValue({ ...GROUP, list3: tables })
    const paged = vi.spyOn(entryApi, 'entryPaged')
    await mountPage()
    await selectKind('CK')
    expect(tableLabels()).toHaveLength(20)
    expect(tableLabels()).not.toContain('指标29 · CK')
    tableSelect().props('filterMethod')!('指标29')
    await flushPromises()
    expect(tableLabels()).toEqual(['指标29 · CK'])
    tableSelect().props('filterMethod')!('2101029')
    await flushPromises()
    expect(tableLabels()).toEqual(['指标29 · CK'])
    tableSelect().vm.$emit('update:modelValue', '2101029')
    tableSelect().vm.$emit('change', '2101029')
    await flushPromises()
    tableSelect().props('filterMethod')!('')
    await flushPromises()
    expect(tableLabels()).toHaveLength(20)
    expect(tableLabels()).toContain('指标29 · CK')
    expect(tableSelect().props('modelValue')).toBe('2101029')
    expect(paged).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="data-table-load-more"]')).toBeNull()
    expect(document.querySelector('.dv-picker-dialog')).toBeNull()
  })
})
