// @vitest-environment jsdom
// 指标列表页（旧 page/config/MeasureList.vue → MetricCenter/indicatorsList/index.vue）接线回归。
// 与 indicatorDataset / queueCheck 的 index.test.ts 同一套思路：只验证「每个操作调到了哪条接口、
// 带了什么参数」——旧页这一列操作本来就是直连后端，迁到新平台最容易出问题的地方是接线断了。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import Page from './index.vue'
import { MEASURE_BASE } from './columns'
import { confirmDanger } from '@/utils/confirmDanger'
import type { MeasureRow } from '@/api/measure'

// Element Plus 的表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const spies = vi.hoisted(() => ({
  measurePaged: vi.fn(),
  updateMeasure: vi.fn(() => Promise.resolve({ message: '修改成功' })),
  changeMeasureEnable: vi.fn(() => Promise.resolve({ msg: '3' })),
  deleteMeasures: vi.fn(() => Promise.resolve({ msg: '2' })),
  deleteMeasurePhy: vi.fn(() => Promise.resolve({ msg: '1' })),
  copyMeasure: vi.fn(() => Promise.resolve({ msg: 'ok' })),
  openEdit: vi.fn(),
  openDetail: vi.fn(),
}))

// 只替掉 6 条请求函数（这里每条操作发哪条接口就是要验的东西）
vi.mock('@/api/measure', () => ({
  measurePaged: spies.measurePaged,
  updateMeasure: spies.updateMeasure,
  changeMeasureEnable: spies.changeMeasureEnable,
  deleteMeasures: spies.deleteMeasures,
  deleteMeasurePhy: spies.deleteMeasurePhy,
  copyMeasure: spies.copyMeasure,
}))

// 两个表格行内的弹层 / 左侧分类树用轻量替身：
// 真弹窗内部是 teleport + 过渡，jsdom 里断言不到「被打开」，而这里要验的只是
// 「父组件用哪一行、什么列集打开的它」；分类树同理，只验「filter 事件被接住了没」。
vi.mock('../shared/ColumnEditDialog.vue', async () => ({
  default: defineComponent({
    name: 'ColumnEditDialog',
    props: ['cols', 'title', 'callback'],
    setup(_props, { expose }) {
      expose({ open: spies.openEdit, close: vi.fn() })
      return () => h('div', { class: 'stub-edit' })
    },
  }),
}))

vi.mock('../shared/ColumnDetailDrawer.vue', async () => ({
  default: defineComponent({
    name: 'ColumnDetailDrawer',
    props: ['cols'],
    setup(_props, { expose }) {
      expose({ open: spies.openDetail })
      return () => h('div', { class: 'stub-detail' })
    },
  }),
}))

vi.mock('@/views/Monitor/sourceCheck/SourceCategoryTree.vue', async () => ({
  default: defineComponent({
    name: 'SourceCategoryTree',
    emits: ['filter'],
    setup() {
      return () => h('div', { class: 'stub-tree' })
    },
  }),
}))

// confirmDanger 真实实现要弹 ElMessageBox（jsdom 里点不到「确认执行」），默认直接放行动作本身
vi.mock('@/utils/confirmDanger', () => ({
  confirmDanger: vi.fn((_title: string, _body: string, run: () => unknown) => run()),
  confirmOrRun: vi.fn((_need: boolean, _t: string, _b: string, run: () => unknown) => run()),
}))

// 路由页没有 props，旧版 props/created 的入参改从 $route.query 取。
// routeState.query 是 reactive 的（见 mock 工厂），这样 `watch('$route.query.configId')` 的等价物也能测。
const routeState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  route: null as null | { query: Record<string, string> },
}))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const route = reactive({ query: routeState.query })
  routeState.route = route as unknown as { query: Record<string, string> }
  return { useRoute: () => route }
})

// el-popover 默认把内容 teleport 到 body 且懒渲染，jsdom 里点不到它内部的「编辑」图标。
// 换成一个把 reference / 内容都直接渲染在行内的替身，这样 JSON 子编辑器的入口是可点的。
const PopoverStub = defineComponent({
  name: 'ElPopover',
  props: { trigger: String, width: [Number, String], placement: String },
  setup(_props, { slots }) {
    return () => h('div', { class: 'stub-popover' }, [
      h('div', { class: 'stub-popover-ref' }, slots.reference ? slots.reference() : []),
      h('div', { class: 'stub-popover-body' }, slots.default ? slots.default() : []),
    ])
  },
})

const MOUNT_OPTIONS = {
  global: { plugins: [ElementPlus], stubs: { ElPopover: PopoverStub } },
}

function row(over: Partial<MeasureRow> = {}): MeasureRow {
  return {
    measureId: 7001,
    measureCode: 'A00011',
    measureName: '净利润同比',
    sourceId: 161725,
    measureType: '数值',
    datasetId: 1001,
    keyDef: '{"cols":"K1"}',
    dimDef: '{"cols":"K2","type":"date"}',
    val1Def: '',
    val2Def: '',
    unitDef: '{"unit":"元"}',
    isDelete: 0,
    updateDt: '2026-10-14 03:00:00',
    ...over,
  }
}

const ROWS: MeasureRow[] = [
  row(),
  row({ measureId: 7002, measureCode: 'A00012', measureName: '营业收入', isDelete: 1 }),
  row({ measureId: 7003, measureCode: 'A00013', measureName: '旧指标', isDelete: -1, val1Def: 'oops' }),
]

/** mountPage 建出来的实例，afterEach 统一卸掉。
 *  ⚠️ 这里必须卸：`route.query` 是**跨用例共享**的同一个 reactive 对象，而本页挂着
 *  `watch($route.query.configId)`。不卸的话，前一个用例留下的实例会在下一个用例改 query 时
 *  一起重查 —— `measurePaged` 的调用次数会随「前面挂过几个」而漂移，断言 `toHaveBeenCalledTimes(1)`
 *  就变成看运气（踩过一次：本条链路上最后一个用例读到了 31 次）。 */
const mounted: VueWrapper[] = []

function mountPage(query: Record<string, string> = {}, props: Record<string, unknown> = {}) {
  const route = routeState.route as unknown as { query: Record<string, string> }
  Object.keys(route.query).forEach((k) => delete route.query[k])
  Object.assign(route.query, query)
  const w = mount(Page, { ...MOUNT_OPTIONS, props })
  mounted.push(w)
  return w
}

/** 按可见文案找按钮（el-button 渲染成 <button><span>文案</span></button>） */
function btn(w: VueWrapper, text: string) {
  const hit = w.findAll('button').find((b) => b.text() === text)
  if (!hit) throw new Error(`找不到按钮：${text}`)
  return hit
}

/** 搜索栏第 i 个表单项里的输入框（0 数据集ID / 1 源ID / 2 指标编码） */
function filterInput(w: VueWrapper, index: number) {
  const item = w.findAll('.ml-filter-form .el-form-item')[index]
  const hit = item.find('input')
  if (!hit.exists()) throw new Error(`第 ${index} 个筛选框里没有 input`)
  return hit
}

/** 表格数据行的某个单元格（**必须**走 .el-table__body：el-table 还会在 .hidden-columns
 *  里用「空 row」预渲染一遍列插槽，直接 tbody tr 会命中那些幽灵节点） */
function cell(w: VueWrapper, rowIndex: number, cellIndex: number) {
  return w.findAll('.el-table__body tr')[rowIndex].findAll('td')[cellIndex]
}

/** 按 prop 取某个表格列组件（勾选列的 prop 是 ''） */
function columnByProp(w: VueWrapper, prop: string) {
  const hit = w.findAllComponents({ name: 'ElTableColumn' }).find((c) => c.props('prop') === prop)
  if (!hit) throw new Error(`找不到 prop=${prop} 的表格列`)
  return hit
}

/** 工具条上的「操作..」下拉（不是表格行里那个） */
function batchDropdown(w: VueWrapper) {
  const hit = w.findAllComponents({ name: 'ElDropdown' }).find((d) => !d.element.closest('.el-table'))
  if (!hit) throw new Error('找不到工具条下拉')
  return hit
}

/** el-tooltip 的 content（行内图标的原按钮文案） */
const tipText = (t: VueWrapper) => (t.props() as { content?: string }).content

/** 表格第 rowIndex 行的行内操作：已改成图标（el-tooltip 的 content 是原文案），原「更多」里的项也平铺出来 */
function rowTips(w: VueWrapper, rowIndex: number) {
  return w.findAll('.el-table__body tr')[rowIndex].findAllComponents({ name: 'ElTooltip' })
    .filter((t: VueWrapper) => t.find('.ml-op-icon').exists())
}
function rowOp(w: VueWrapper, rowIndex: number, text: string) {
  const tip = rowTips(w, rowIndex).find((t: VueWrapper) => tipText(t) === text)
  if (!tip) throw new Error(`第 ${rowIndex} 行找不到操作：${text}`)
  return tip.find('.ml-op-icon')
}

/** 最近一次 measurePaged 的入参 */
function lastQuery(): Record<string, unknown> {
  const calls = spies.measurePaged.mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}

/** 勾选若干行（旧版受控 rowSelection 的等价物） */
async function select(w: VueWrapper, indexes: number[]) {
  w.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', indexes.map((i) => ROWS[i]))
  await flushPromises()
}

/** 点开某个 JSON 列的「编辑」图标 */
async function clickJsonEdit(w: VueWrapper, rowIndex: number, cellIndex: number) {
  await cell(w, rowIndex, cellIndex).find('.ml-json-edit').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  Object.values(spies).forEach((fn) => fn.mockClear())
  vi.mocked(confirmDanger).mockClear()
  spies.measurePaged.mockImplementation(async () => ({ list: ROWS, total: 3 }))
})

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
})

describe('indicatorsList · 首屏', () => {
  it('按 page=1&limit=20 拉列表（旧 `:pageSize="20"`），未排序时不带 sortField/sortOrder', async () => {
    mountPage()
    await flushPromises()
    expect(spies.measurePaged).toHaveBeenCalledTimes(1)
    expect(lastQuery()).toMatchObject({ page: 1, limit: 20 })
    expect(Object.keys(lastQuery())).not.toContain('sortField')
    expect(Object.keys(lastQuery())).not.toContain('sortOrder')
  })

  it('空白条件的键也照发（datasetId/sourceId/entryTypeId/measureCode/enable/categorys/configId）', async () => {
    mountPage()
    await flushPromises()
    expect(lastQuery()).toMatchObject({
      datasetId: '', sourceId: '', entryTypeId: '', measureCode: '', enable: '', categorys: '', configId: '',
    })
  })

  it('渲染 MEASURE.base 的 13 列表头（含前面的勾选列）', async () => {
    const w = mountPage()
    await flushPromises()
    const headers = w.findAll('thead th').map((th) => th.text())
    expect(headers).toEqual(['', ...MEASURE_BASE.map((c) => c.title)])
  })

  it('「操作」列固定在右侧，其余列都不固定（横向滚动时操作仍可见）', async () => {
    const w = mountPage()
    await flushPromises()
    expect(columnByProp(w, 'action').props('fixed')).toBe('right')
    // 只固定操作列：勾选列与文本列跟着横向滚动（与 Monitor/taskList 同口径）
    expect(MEASURE_BASE.filter((c) => c.fixed).map((c) => c.dataIndex)).toEqual(['action'])
    // 未固定的列 `fixed` 是 undefined（Element Plus 没给这个 prop 声明 default，
    // 显式传 undefined 即「不固定」，el-table 按真值判断 —— 不要写成 toBe(false)）
    expect(columnByProp(w, 'measureId').props('fixed')).toBeUndefined()
    expect(columnByProp(w, 'keyDef').props('fixed')).toBeUndefined()
  })

  it('ID 三态：在用纯文本 / 停用红标签 / 历史删除带告警图标', async () => {
    const w = mountPage()
    await flushPromises()
    expect(cell(w, 0, 1).find('.el-tag').exists()).toBe(false)
    expect(cell(w, 0, 1).text()).toBe('7001')
    expect(cell(w, 1, 1).find('.el-tag').classes()).toContain('el-tag--danger')
    expect(cell(w, 2, 1).find('.ml-warn').exists()).toBe(true)
  })

  it('「启用」列显示 isDelete 原值（旧表格没套 enableFilter，别顺手加映射）', async () => {
    const w = mountPage()
    await flushPromises()
    expect(cell(w, 0, 12).text()).toBe('0')
    expect(cell(w, 1, 12).text()).toBe('1')
    expect(cell(w, 2, 12).text()).toBe('-1')
  })

  it('加载失败时清空列表 + 报错，不抛未捕获异常', async () => {
    spies.measurePaged.mockImplementation(async () => { throw new Error('boom') })
    const err = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const w = mountPage()
    await flushPromises()
    expect(err).toHaveBeenCalled()
    expect(w.findAll('.el-table__body tr')).toHaveLength(0)
    err.mockRestore()
  })
})

describe('indicatorsList · 搜索（改条件不自动查，点「查询」才发请求）', () => {
  it('「查询」把输入框的值带进请求并回到第 1 页', async () => {
    const w = mountPage()
    await flushPromises()
    await filterInput(w, 0).setValue('1001')
    await filterInput(w, 1).setValue('161725')
    await filterInput(w, 2).setValue('A000')
    await w.findAll('.ml-filter-form .el-form-item')[3]
      .findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '1')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    expect(lastQuery()).toMatchObject({
      datasetId: '1001', sourceId: '161725', measureCode: 'A000', enable: '1', page: 1,
    })
  })

  it('改条件不自动查询（旧页也要点「查询」）', async () => {
    const w = mountPage()
    await flushPromises()
    await filterInput(w, 2).setValue('A000')
    await flushPromises()
    expect(spies.measurePaged).toHaveBeenCalledTimes(1)
  })

  it('「重置」只清条件、不重查（旧 `@click="() => queryParam = {}"`）', async () => {
    const w = mountPage()
    await flushPromises()
    await filterInput(w, 2).setValue('A000')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    expect(lastQuery()).toMatchObject({ measureCode: 'A000' })

    await btn(w, '重置').trigger('click')
    await flushPromises()
    expect(spies.measurePaged).toHaveBeenCalledTimes(2) // 只有「查询」那两次，重置没发请求
    expect(filterInput(w, 2).element as HTMLInputElement).toHaveProperty('value', '')
  })

  it('表头降序 → sortField/sortOrder（antd 口径 descend），且保持当前页（旧 STable 排序不重置页码）', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'measureId', order: 'descending' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ sortField: 'measureId', sortOrder: 'descend', page: 2 })
  })

  it('取消排序（order=null）→ 两个键都不发', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'measureId', order: 'ascending' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ sortField: 'measureId', sortOrder: 'ascend' })
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'measureId', order: null })
    await flushPromises()
    expect(Object.keys(lastQuery())).not.toContain('sortField')
  })

  it('翻页 → page 变化；改每页条数 → 回第 1 页', async () => {
    const w = mountPage()
    await flushPromises()
    const pager = w.findComponent({ name: 'ElPagination' })
    pager.vm.$emit('current-change', 3)
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 3, limit: 20 })
    pager.vm.$emit('size-change', 40)
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 1, limit: 40 })
  })
})

describe('indicatorsList · 左侧分类树（旧 treeClick 漏了 clearParam 的那个 bug）', () => {
  it('@filter → 清空全部条件 + 写入 categorys + 回第 1 页重查', async () => {
    const w = mountPage()
    await flushPromises()
    await filterInput(w, 2).setValue('A000')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    w.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()

    w.findComponent({ name: 'SourceCategoryTree' }).vm.$emit('filter', ['10', '20'])
    await flushPromises()
    expect(lastQuery()).toMatchObject({
      categorys: '10,20', measureCode: '', datasetId: '', sourceId: '', entryTypeId: '', enable: '', page: 1,
    })
  })
})

describe('indicatorsList · 批量操作', () => {
  it('工具条下拉有 3 项（「批量复制 / 操作日志」是旧版的坏代码/死代码，没迁）', async () => {
    const w = mountPage()
    await flushPromises()
    const items = batchDropdown(w).findAllComponents({ name: 'ElDropdownItem' })
    expect(items.map((i) => i.text())).toEqual(['启用', '禁用', '删除'])
  })

  it('「启用」/「禁用」→ changeMeasureEnable(ids, 0|1)，旧版没有二次确认', async () => {
    const w = mountPage()
    await flushPromises()
    await select(w, [0, 1])
    batchDropdown(w).vm.$emit('command', 'enable')
    await flushPromises()
    expect(spies.changeMeasureEnable).toHaveBeenCalledWith([7001, 7002], 0)

    await select(w, [2])
    batchDropdown(w).vm.$emit('command', 'disable')
    await flushPromises()
    expect(spies.changeMeasureEnable).toHaveBeenLastCalledWith([7003], 1)
  })

  it('「删除」→ 确认后 deleteMeasures(ids)（确认文案里的「数据集」是旧页原文，1:1 保留）', async () => {
    const w = mountPage()
    await flushPromises()
    await select(w, [0, 2])
    batchDropdown(w).vm.$emit('command', 'delete')
    await flushPromises()
    expect(spies.deleteMeasures).toHaveBeenCalledWith([7001, 7003])
    const [, body] = vi.mocked(confirmDanger).mock.calls[0]
    expect(body).toBe('是否确认要删除以下数据集:2')
  })

  it('未勾选时启用 / 删除只提示不发请求', async () => {
    const err = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const w = mountPage()
    await flushPromises()
    batchDropdown(w).vm.$emit('command', 'enable')
    await flushPromises()
    batchDropdown(w).vm.$emit('command', 'delete')
    await flushPromises()
    expect(spies.changeMeasureEnable).not.toHaveBeenCalled()
    expect(spies.deleteMeasures).not.toHaveBeenCalled()
    expect(err.mock.calls.map((c) => String(c[0]))).toEqual(['请选择要操作的数据', '请选择要操作的数据'])
    err.mockRestore()
  })
})

describe('indicatorsList · 行内操作', () => {
  it('「详情」打开详情抽屉并带上整行 + 标题「指标详情」', async () => {
    const w = mountPage()
    await flushPromises()
    await rowOp(w, 0, '详情').trigger('click')
    expect(spies.openDetail).toHaveBeenCalledWith(ROWS[0], '指标详情')
  })

  it('「编辑」把整行交给编辑弹窗（旧 handleEdit → $refs.measureEdit.doEdit(record)）', async () => {
    const w = mountPage()
    await flushPromises()
    await rowOp(w, 1, '编辑').trigger('click')
    expect(spies.openEdit).toHaveBeenCalledWith(ROWS[1])
  })

  it('行内图标：普通行是「详情 / 编辑 / 指标副本」，历史删除行多一个「删除指标(物理删除)」', async () => {
    const w = mountPage()
    await flushPromises()
    expect(rowTips(w, 0).map(tipText)).toEqual(['详情', '编辑', '指标副本'])
    expect(rowTips(w, 2).map(tipText)).toEqual(['详情', '编辑', '指标副本', '删除指标(物理删除)'])
  })

  it('「指标副本」→ 确认后 copyMeasure(id)，并清空查询条件后重查', async () => {
    const w = mountPage()
    await flushPromises()
    await filterInput(w, 2).setValue('A000')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    expect(lastQuery()).toMatchObject({ measureCode: 'A000' })

    await rowOp(w, 0, '指标副本').trigger('click')
    await flushPromises()
    expect(spies.copyMeasure).toHaveBeenCalledWith(7001)
    expect(lastQuery()).toMatchObject({ measureCode: '' })
  })

  it('「删除指标(物理删除)」→ deleteMeasurePhy(id)', async () => {
    const w = mountPage()
    await flushPromises()
    await rowOp(w, 2, '删除指标(物理删除)').trigger('click')
    await flushPromises()
    expect(spies.deleteMeasurePhy).toHaveBeenCalledWith(7003)
    const [title] = vi.mocked(confirmDanger).mock.calls[0]
    expect(title).toBe('警告，是否从表中删除该记录')
  })
})

describe('indicatorsList · JSON 子编辑器（旧 jsonSlot / jsonDimSlot）', () => {
  it('条件列（jsonSlot）→ json_val 列集，标题「json编辑-数值类」', async () => {
    const w = mountPage()
    await flushPromises()
    await clickJsonEdit(w, 0, 7)
    expect(spies.openEdit).toHaveBeenCalledWith({ cols: 'K1' }, 'json编辑-数值类')
  })

  it('纬度列（jsonDimSlot）→ json_dim 列集，标题「json编辑-日期类」', async () => {
    const w = mountPage()
    await flushPromises()
    await clickJsonEdit(w, 0, 8)
    expect(spies.openEdit).toHaveBeenCalledWith({ cols: 'K2', type: 'date' }, 'json编辑-日期类')
  })

  it('空值是空串 → 当 {} 打开（旧版裸 JSON.parse 会抛 SyntaxError、弹窗打不开）', async () => {
    const w = mountPage()
    await flushPromises()
    await clickJsonEdit(w, 1, 9) // val1Def === ''
    expect(spies.openEdit).toHaveBeenCalledWith({}, 'json编辑-数值类')
  })

  it('非法 JSON → 给可见提示且不打开弹窗（不静默吞）', async () => {
    const err = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const w = mountPage()
    await flushPromises()
    await clickJsonEdit(w, 2, 9) // val1Def === 'oops'
    expect(spies.openEdit).not.toHaveBeenCalled()
    expect(String(err.mock.calls[0][0])).toContain('不是合法的 JSON')
    err.mockRestore()
  })
})

describe('indicatorsList · 入参（旧 props/created 的等价物）', () => {
  it('页签形态：sourceId / entryTypeId / datasetId / configId 从 $route.query 透传进请求', async () => {
    mountPage({ sourceId: '161725', entryTypeId: '1001', datasetId: '1001', configId: '70598' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({
      sourceId: '161725', entryTypeId: '1001', datasetId: '1001', configId: '70598',
    })
  })

  it('弹窗形态：sourceId / entryTypeId / datasetId 三个 props 透传进请求（旧 MeasureShow 内嵌）', async () => {
    mountPage({}, { sourceId: '161725', entryTypeId: '1001', datasetId: '1001' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ sourceId: '161725', entryTypeId: '1001', datasetId: '1001' })
  })

  it('props 覆盖 $route.query（旧 created 的顺序：query 先写、props 后覆盖；空值不覆盖）', async () => {
    mountPage(
      { sourceId: '9', entryTypeId: '9', datasetId: '9' },
      { sourceId: '161725', datasetId: '1001' },
    )
    await flushPromises()
    // sourceId / datasetId 被 props 覆盖；entryTypeId 没传 → 保留 query 里的值
    expect(lastQuery()).toMatchObject({ sourceId: '161725', entryTypeId: '9', datasetId: '1001' })
  })

  it('configId 变化时跟随改条件并重查（旧 `watch "$route.query.configId"`）', async () => {
    mountPage()
    await flushPromises()
    expect(spies.measurePaged).toHaveBeenCalledTimes(1)
    const route = routeState.route as unknown as { query: Record<string, string> }
    route.query.configId = '70599'
    await flushPromises()
    expect(lastQuery()).toMatchObject({ configId: '70599' })
  })

  it('不再有 add=1|new 的自动开弹窗（1014 随跳页一起删除，文件头偏差第 12 条）', async () => {
    // 传了也不该有任何副作用：本页不该再存在新增入口，只按普通筛选键处理
    mountPage({ sourceId: '161725', add: '1', datasetName: '公告明细数据集' })
    await flushPromises()
    expect(spies.measurePaged).toHaveBeenCalledTimes(1)
    expect(lastQuery()).toMatchObject({ sourceId: '161725' })
    expect(Object.keys(lastQuery())).not.toContain('add')
  })
})
