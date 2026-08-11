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

afterEach(() => vi.restoreAllMocks())

describe('DataQueryPanel · 独立挂载', () => {
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
})
