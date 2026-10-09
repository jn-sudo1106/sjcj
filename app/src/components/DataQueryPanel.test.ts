// @vitest-environment jsdom
// S5-1（方案 §5.2）：DataQueryPanel 从 DataView/index.vue 抽出的可复用「筛选 + 结果表格」面板。
// 验收标准之一是"新组件可独立挂载"——本文件只挂载 DataQueryPanel 本身（不经由 DataView），
// 覆盖查询/勾选列/行点击/筛选条件这几条组件自身的核心契约；DataView 侧的行为无回归由
// views/DataView/index.test.ts 覆盖（S5-1 改动没有改写那份测试的断言意图，只改了一处因为
// .dv-link 类名冲突导致要按文案精确定位的选择器）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import DataQueryPanel, { type DataQueryColumn } from './DataQueryPanel.vue'
import { dataApi } from '@/api'
import type { DataRow } from '@/api'
import { readSqlConditions } from '@/utils/sqlConditionHistory'

const COLUMNS: DataQueryColumn[] = [
  { prop: 'K1', label: '标题-K1', sortable: true },
]
const ROW: DataRow = {
  dataId: '1', sourceId: 's1', state: 'C', values: { K1: '标题A' },
  title: '', summary: '', acceptState: 'accepted',
}

function mountPanel(props: Partial<InstanceType<typeof DataQueryPanel>['$props']> = {}) {
  return mount(DataQueryPanel, {
    global: { plugins: [ElementPlus] },
    props: { tableId: 't1', columns: COLUMNS, ...props },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('DataQueryPanel · 独立挂载', () => {
  it('历史只记录成功请求的快照：等待时改条件或切表不串历史，失败不记录，零行成功也记录', async () => {
    let resolve!: (result: { list: DataRow[]; total: number }) => void
    const spy = vi.spyOn(dataApi, 'rowQueryPaged').mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const wrapper = mountPanel()
    wrapper.vm.search({ sql: 'K1 IS NULL' })
    expect(readSqlConditions('t1')).toEqual([])
    await wrapper.find('button[aria-controls="data-query-advanced"]').trigger('click')
    await wrapper.find('input[placeholder="条件表达式，如 CREATE_DT > CURDATE()"]').setValue('K2 IS NULL')
    await wrapper.setProps({ tableId: 't2' })
    resolve({ list: [], total: 0 })
    await flushPromises()
    expect(readSqlConditions('t1')).toEqual(['K1 IS NULL'])
    expect(readSqlConditions('t2')).toEqual([])
    spy.mockRejectedValueOnce(new Error('SQL syntax'))
    wrapper.vm.search({ sql: 'bad sql' })
    await flushPromises()
    expect(readSqlConditions('t2')).toEqual([])
    wrapper.unmount()
  })

  it('挂载不报错，调用 expose 的 search() 触发查询', async () => {
    const spy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel()
    wrapper.vm.search()
    await flushPromises()

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1', page: 1, size: 20 }))
    expect(wrapper.text()).toContain('标题A')
  })

  it('tableId 为空时不发请求', async () => {
    const spy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mountPanel({ tableId: '' })
    wrapper.vm.search()
    await flushPromises()

    expect(spy).not.toHaveBeenCalled()
  })

  it('数据ID 输入 + 查询：带上 dataId，页码归 1，并 emit query-change', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel()

    await wrapper.find('input[placeholder="请输入数据 ID"]').setValue('88231')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ dataId: '88231', page: 1 }))
    const emitted = wrapper.emitted('query-change')
    expect(emitted).toBeTruthy()
    const last = emitted![emitted!.length - 1][0] as Record<string, unknown>
    expect(last.dataId).toBe('88231')
  })

  it('状态多选：查询按逗号拼接 state 参数，清空后不再提交', async () => {
    const spy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mountPanel({ showState: true })

    const stateSelect = wrapper.findComponent({ name: 'ElSelect' })
    await stateSelect.vm.$emit('update:modelValue', ['C', 'E'])
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'C,E' }))

    await wrapper.findAll('button').find((b) => b.text() === '清空')!.trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined }))
  })

  it('高级筛选默认收起，展开后显示高级条件', async () => {
    const wrapper = mountPanel()

    expect(wrapper.find('[data-testid="data-query-filters"]').exists()).toBe(false)
    await wrapper.find('button[aria-controls="data-query-advanced"]').trigger('click')
    expect(wrapper.find('[data-testid="data-query-filters"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="后续标识（如 -1）"]').exists()).toBe(true)
  })

  it('时间范围与高级条件只在点击查询时提交', async () => {
    const spy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mountPanel()
    const before = spy.mock.calls.length

    const datePicker = wrapper.findComponent({ name: 'ElDatePicker' })
    await datePicker.vm.$emit('update:modelValue', ['2026-08-01 00:00:00', '2026-08-02 23:59:59'])
    await wrapper.find('button[aria-controls="data-query-advanced"]').trigger('click')
    await wrapper.find('input[placeholder="后续标识（如 -1）"]').setValue('-1')
    expect(spy.mock.calls.length).toBe(before)

    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({
      startTime: '2026-08-01 00:00:00',
      endTime: '2026-08-02 23:59:59',
      nextFlag: '-1',
    }))
  })

  it('清空：清除所有筛选条件并回到第一页查询', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mountPanel()

    await wrapper.find('input[placeholder="请输入数据 ID"]').setValue('88231')
    await wrapper.find('input[placeholder="父 ID"]').setValue('p-1')
    await wrapper.findAll('button').find((b) => b.text() === '清空')!.trigger('click')
    await flushPromises()

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ dataId: undefined, parentId: undefined, page: 1 }))
  })

  it('selectable：勾选行 emit update:selectedKeys；不开启时不渲染勾选列', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel({ selectable: true, selectedKeys: [] })
    wrapper.vm.search()
    await flushPromises()

    const rowCheckbox = wrapper.findAllComponents({ name: 'ElCheckbox' }).find((c) => c.props('ariaLabel') === '选择 1')
    expect(rowCheckbox).toBeTruthy()
    await rowCheckbox!.vm.$emit('change', true)
    // 索引 0 是查询完成时"重置选择"那次 emit（[]，跟 DataView 原 loadRows 行为一致），取最后一次才是勾选
    const emitted = wrapper.emitted('update:selectedKeys')!
    expect(emitted[emitted.length - 1][0]).toEqual(['1'])

    const wrapper2 = mountPanel({ selectable: false })
    wrapper2.vm.search()
    await flushPromises()
    expect(wrapper2.find('th .el-checkbox, th input[type="checkbox"]').exists()).toBe(false)
  })

  it('刷新后保留当前结果中仍存在的勾选项，普通查询仍清空勾选', async () => {
    const spy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel({ selectable: true, selectedKeys: ['1'] })

    wrapper.vm.refresh()
    await flushPromises()

    const emitted = wrapper.emitted('update:selectedKeys')!
    expect(emitted[emitted.length - 1][0]).toEqual(['1'])

    wrapper.vm.search()
    await flushPromises()

    const afterSearch = wrapper.emitted('update:selectedKeys')!
    expect(afterSearch[afterSearch.length - 1][0]).toEqual([])
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('点击行：emit row-click 带上该行数据', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel()
    wrapper.vm.search()
    await flushPromises()

    await wrapper.find('.el-table__row').trigger('click')
    expect(wrapper.emitted('row-click')?.[0][0]).toEqual(ROW)
  })

  it('columns 渲染：表头按 label 展示，单元格取 row.values[prop]', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel()
    wrapper.vm.search()
    await flushPromises()

    expect(wrapper.text()).toContain('标题-K1')
    expect(wrapper.text()).toContain('标题A')
  })

  it('查询失败：提示错误，不抛出未捕获异常', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockRejectedValue(new Error('网络错误'))
    const wrapper = mountPanel()
    expect(() => wrapper.vm.search()).not.toThrow()
    await flushPromises()
  })

  it('列弹窗确定后隐藏动态列', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel({
      columns: [
        { prop: 'K1', label: '标题-K1', sortable: true },
        { prop: 'K17', label: '正文html路径-K17', sortable: true },
      ],
    })
    wrapper.vm.search()
    await flushPromises()
    expect(wrapper.get('[data-testid="column-picker-btn"]').text()).toBe('列 2/2')
    expect(wrapper.text()).toContain('正文html路径-K17')

    await wrapper.get('[data-testid="column-picker-btn"]').trigger('click')
    await flushPromises()
    const htmlRow = [...document.querySelectorAll('.cpk-row')].find((el) => el.textContent?.includes('正文html路径-K17'))
    expect(htmlRow).toBeTruthy()
    const box = htmlRow!.querySelector('input[type="checkbox"]') as HTMLInputElement
    box.checked = false
    box.dispatchEvent(new Event('change'))
    await flushPromises()
    const ok = [...document.querySelectorAll('[data-testid="column-picker-ok"]')].at(-1) as HTMLButtonElement
    ok.click()
    await flushPromises()

    expect(wrapper.text()).not.toContain('正文html路径-K17')
    expect(wrapper.text()).toContain('标题-K1')
    expect(wrapper.get('[data-testid="column-picker-btn"]').text()).toBe('列 1/2')
    wrapper.unmount()
  })

  it('支持 defaultSortField 与 defaultSortOrder：初次查询与清空重置均带默认排序', async () => {
    const spy = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    const wrapper = mountPanel({
      defaultSortField: 'updateDt',
      defaultSortOrder: 'descend',
    })
    wrapper.vm.search()
    await flushPromises()

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      sortField: 'updateDt',
      sortOrder: 'descend',
    }))

    wrapper.vm.clearFilters()
    await flushPromises()

    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({
      sortField: 'updateDt',
      sortOrder: 'descend',
    }))
    wrapper.unmount()
  })
})

// 2026-09-28：文件路径格与源数据视图（DataGrid）同一套判据，点了交给调用方开预览；不再直连下载。
describe('DataQueryPanel · 文件路径格', () => {
  it('.json 路径（TB_KAIPANLA 详情json）渲染成可点的文件格，点击抛出 file-click 带字段信息', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ ...ROW, values: { K1: '标题A', K3: '/xtdb/kaipan/2026-09-28/386.json' } }],
    })
    const wrapper = mountPanel({ columns: [...COLUMNS, { prop: 'K3', label: '详情json-K3', hintProp: 'result' }] })
    wrapper.vm.search()
    await flushPromises()
    const cells = wrapper.findAll('[data-testid="data-cell-file"]')
    expect(cells).toHaveLength(1)
    await cells[0].trigger('click')
    expect(wrapper.emitted('file-click')?.[0]).toEqual([
      '/xtdb/kaipan/2026-09-28/386.json',
      { prop: 'result', columnName: 'K3', desc: '详情json-K3' },
    ])
  })

  it('普通文本与 http 链接不当文件', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ ...ROW, values: { K1: '/不是路径吗', K2: 'https://x.com/a.json' } }],
    })
    const wrapper = mountPanel({ columns: [...COLUMNS, { prop: 'K2', label: '链接-K2' }] })
    wrapper.vm.search()
    await flushPromises()
    expect(wrapper.find('[data-testid="data-cell-file"]').exists()).toBe(false)
  })
})

// 1008-07：单行模式（oneRow）。数据中心把筛选与操作并成一行，其他复用方仍是默认布局，不受影响。
describe('DataQueryPanel · 单行模式（1008-07）', () => {
  const slots = {
    context: '<span data-testid="ctx">表与源</span>',
    quick: '<span data-testid="quick">快捷</span>',
    actions: '<button data-testid="act">操作</button>',
    toolbar: '<div data-testid="below">批量条</div>',
  }
  const mountWith = (props: Record<string, unknown>) => mount(DataQueryPanel, {
    global: { plugins: [ElementPlus] },
    props: { tableId: 't1', columns: COLUMNS, showState: true, ...props },
    slots,
  })
  const childOrder = (wrapper: ReturnType<typeof mountWith>) =>
    Array.from(wrapper.get('[data-testid="data-query-primary"]').element.children).map((el) => el.className.toString())

  it('默认布局不变：表 / 源在最前，列选择器在下方工具行，操作插槽不渲染', () => {
    const wrapper = mountWith({})
    const row = wrapper.get('[data-testid="data-query-primary"]')
    expect(row.classes()).not.toContain('is-one-row')
    expect(childOrder(wrapper)[0]).toContain('dqp-context')
    expect(row.find('[data-testid="act"]').exists()).toBe(false)
    expect(row.find('[data-testid="column-picker-btn"]').exists()).toBe(false)
    expect(wrapper.get('.dqp-table-tools').find('[data-testid="column-picker-btn"]').exists()).toBe(true)
    expect(wrapper.get('.dqp-table-tools').find('[data-testid="below"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('单行：表 / 源排在状态之后，查询 / 清空 / 高级筛选成一组，操作插槽和列选择器并入同一行', () => {
    const wrapper = mountWith({ oneRow: true })
    const row = wrapper.get('[data-testid="data-query-primary"]')
    expect(row.classes()).toContain('is-one-row')
    const order = childOrder(wrapper)
    const at = (name: string) => order.findIndex((c) => c.includes(name))
    expect(at('dqp-state')).toBeGreaterThanOrEqual(0)
    expect(at('dqp-context')).toBeGreaterThan(at('dqp-state'))
    expect(at('dqp-time-range')).toBeGreaterThan(at('dqp-context'))
    expect(at('dqp-query-actions')).toBeGreaterThan(at('dqp-time-range'))
    const group = wrapper.get('.dqp-query-actions')
    expect(group.findAll('button').map((b) => b.text().replace(/\s+/g, ''))).toEqual(['查询', '清空', '高级筛选⌄'])
    expect(row.find('[data-testid="act"]').exists()).toBe(true)
    expect(row.find('[data-testid="quick"]').exists()).toBe(true)
    expect(row.find('[data-testid="column-picker-btn"]').exists()).toBe(true)
    // 列选择器只出现一次；整行内容（批量条）仍在下方 toolbar 插槽
    expect(wrapper.findAll('[data-testid="column-picker-btn"]')).toHaveLength(1)
    expect(wrapper.get('.dqp-table-tools').find('[data-testid="below"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
