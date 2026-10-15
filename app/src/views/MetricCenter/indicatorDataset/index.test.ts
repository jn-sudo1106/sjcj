// @vitest-environment jsdom
// 指标数据集页（旧 page/config/DatasetList.vue → MetricCenter/indicatorDataset/index.vue）接线回归。
// 与 queueCheck / sourceCheck 的 index.test.ts 同一套思路：只验证「每个操作调到了哪条接口、带了什么参数」——
// 旧页面这一列操作本来就是直连后端，迁到新平台最容易出问题的地方是接线断了或落回 mock。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import Page from './index.vue'
import { DATASET_BASE } from './columns'
import type { DatasetRow } from '@/api/dataset'

// Element Plus 的表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const spies = vi.hoisted(() => ({
  datasetPaged: vi.fn(),
  changeDatasetEnable: vi.fn(() => Promise.resolve({ message: '已启用' })),
  deleteDataSets: vi.fn(() => Promise.resolve({ message: '删除 1 条成功（演示）' })),
  copyDataset: vi.fn(() => Promise.resolve({ message: '新数据集 ID:2000' })),
  genDatasetFromSource: vi.fn(() => Promise.resolve({ message: '已生成数据集 2000' })),
  runMeasureNow: vi.fn(() => Promise.resolve({ message: '已提交 1 条数据集，从上次 ID开始' })),
  updateDataSet: vi.fn(() => Promise.resolve({ message: '修改成功（演示）' })),
  openDialog: vi.fn(),
  showPrompt: vi.fn(),
  // 指标三件套（旧 MeasureShow / MeasureAdd / MeasureAddNew）
  openMeasureShow: vi.fn(),
  openMeasureAdd: vi.fn(),
  openMeasureAddNew: vi.fn(),
}))

// 只替掉请求函数（这里每个操作发哪条接口就是要验的东西）
vi.mock('@/api/dataset', () => ({
  datasetPaged: spies.datasetPaged,
  changeDatasetEnable: spies.changeDatasetEnable,
  deleteDataSets: spies.deleteDataSets,
  copyDataset: spies.copyDataset,
  genDatasetFromSource: spies.genDatasetFromSource,
  runMeasureNow: spies.runMeasureNow,
  updateDataSet: spies.updateDataSet,
}))

// 三个弹层用轻量替身：真弹窗内部是 teleport + 过渡，jsdom 里断言不到「被打开」，
// 而这里要验的只是「父组件用哪一行、什么配置打开的它」。
vi.mock('./DatasetEditDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'DatasetEditDialog',
      setup(_props, { expose }) {
        expose({ openDialog: spies.openDialog })
        return () => h('div', { class: 'stub-edit' })
      },
    }),
  }
})

vi.mock('./DatasetDetailDrawer.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'DatasetDetailDrawer',
      props: ['modelValue', 'record'],
      setup() {
        return () => h('div', { class: 'stub-detail' })
      },
    }),
  }
})

vi.mock('./PromptDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'PromptDialog',
      setup(_props, { expose }) {
        expose({ show: spies.showPrompt, close: vi.fn() })
        return () => h('div', { class: 'stub-prompt' })
      },
    }),
  }
})

// 指标三件套（旧 MeasureShow / MeasureAdd / MeasureAddNew）也都是弹层，同样只验「用哪一行、
// 什么入参打开的」。⚠️ MeasureAddDialog / MeasureAddNewDialog 是 indicatorsList 目录下的组件，
// 路径要写对（跨目录 import），否则会真的挂载它们、连带拉进 JsonDefDialog 那一整串。
vi.mock('./MeasureShowDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'MeasureShowDialog',
      setup(_props, { expose }) {
        expose({ open: spies.openMeasureShow })
        return () => h('div', { class: 'stub-measure-show' })
      },
    }),
  }
})

vi.mock('../indicatorsList/MeasureAddDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'MeasureAddDialog',
      emits: ['saved'],
      setup(_props, { expose }) {
        expose({ open: spies.openMeasureAdd })
        return () => h('div', { class: 'stub-measure-add' })
      },
    }),
  }
})

vi.mock('../indicatorsList/MeasureAddNewDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'MeasureAddNewDialog',
      emits: ['saved'],
      setup(_props, { expose }) {
        expose({ open: spies.openMeasureAddNew })
        return () => h('div', { class: 'stub-measure-add-new' })
      },
    }),
  }
})

// confirmDanger 真实实现要弹 ElMessageBox（jsdom 里点不到「确认执行」），默认直接放行动作本身。
vi.mock('@/utils/confirmDanger', () => ({
  confirmDanger: vi.fn((_title: string, _body: string, run: () => unknown) => run()),
  confirmOrRun: vi.fn((_need: boolean, _t: string, _b: string, run: () => unknown) => run()),
}))

// 路由页没有 props，旧版 props/created 的入参改从 $route.query 取。
// （1014 起本页不再有跳页签的入口，所以这里连 useRouter 都不用替身了。）
const routeState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
}))
vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

function row(over: Partial<DatasetRow> = {}): DatasetRow {
  return {
    datasetId: 1001,
    datasetName: '公告明细数据集',
    sourceId: 161725,
    entryTypeId: 1001,
    measureCnt: 6,
    lastId: 88213,
    schedule: '0 0 3 * * ?',
    lastRun: '2026-10-13 03:00:12',
    nextRun: '2026-10-14 03:00:00',
    runCnt: 412,
    successCnt: 408,
    state: 'C',
    isDelete: 0,
    ...over,
  }
}

const ROWS: DatasetRow[] = [
  row(),
  row({ datasetId: 1002, datasetName: '论坛帖子数据集（已停用）', isDelete: 1 }),
  row({ datasetId: 1011, datasetName: '旧版文章数据集', measureCnt: 0, isDelete: -1 }),
]

function mountPage(query: Record<string, string> = {}) {
  routeState.query = query
  return mount(Page, { global: { plugins: [ElementPlus] } })
}

/** 按可见文案找按钮（el-button 渲染成 <button><span>文案</span></button>） */
function btn(w: VueWrapper, text: string) {
  const hit = w.findAll('button').find((b) => b.text() === text)
  if (!hit) throw new Error(`找不到按钮：${text}`)
  return hit
}

/** el-tooltip 的 content（行内图标的原按钮文案） */
const tipText = (t: VueWrapper) => (t.props() as { content?: string }).content

/** 行内操作已改成图标（el-tooltip 的 content 是原文案），按行内 tooltip 文案找图标 */
function opLink(w: VueWrapper, rowIndex: number, text: string) {
  const tip = w.findAll('tbody tr')[rowIndex].findAllComponents({ name: 'ElTooltip' }).find((t: VueWrapper) => tipText(t) === text)
  if (!tip) throw new Error(`第 ${rowIndex} 行找不到操作：${text}`)
  return tip.find('.ids-op-icon')
}

/** 最近一次 datasetPaged 的入参 */
function lastQuery(): Record<string, unknown> {
  const calls = spies.datasetPaged.mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}

beforeEach(() => {
  Object.values(spies).forEach((fn) => fn.mockClear())
  spies.datasetPaged.mockImplementation(async () => ({ list: ROWS, total: 3 }))
})

describe('indicatorDataset · 首屏', () => {
  it('按 page=1&limit=10 拉列表（旧 :pageSize="10" 覆盖了 pagination.defaultPageSize:20）', async () => {
    mountPage()
    await flushPromises()
    expect(spies.datasetPaged).toHaveBeenCalledTimes(1)
    expect(lastQuery()).toMatchObject({ page: 1, limit: 10 })
    // 未排序时参数里没有 sortField/sortOrder（旧 s-table 同款）
    expect(Object.keys(lastQuery())).not.toContain('sortField')
  })

  it('渲染 base 12 列表头（含前面的勾选列）', async () => {
    const w = mountPage()
    await flushPromises()
    const headers = w.findAll('thead th').map((th) => th.text())
    expect(headers).toEqual(['', ...DATASET_BASE.map((c) => c.title)])
  })

  it('自动选中第一行（旧 loadData 的 selectedRowKeys = [oriData[0].datasetId]）', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.find('.ids-more button').attributes('disabled')).toBeUndefined()
  })

  it('空响应时不选中，「更多..」置灰', async () => {
    spies.datasetPaged.mockImplementation(async () => ({ list: [], total: 0 }))
    const w = mountPage()
    await flushPromises()
    expect(w.find('.ids-more button').attributes('disabled')).toBeDefined()
  })

  it('数据集ID 三态：在用纯文本 / 停用红标签 / 历史删除带告警图标', async () => {
    const w = mountPage()
    await flushPromises()
    const cells = w.findAll('tbody tr').map((tr) => tr.findAll('td')[1])
    expect(cells[0].find('.el-tag').exists()).toBe(false)
    expect(cells[1].find('.el-tag').exists()).toBe(true)
    expect(cells[1].find('.el-tag').classes()).toContain('el-tag--danger')
    expect(cells[2].find('.ids-warn').exists()).toBe(true)
  })

  it('指标数 0 显示「-」，有值显示可点标签（旧 measureCntSlot）', async () => {
    const w = mountPage()
    await flushPromises()
    const cells = w.findAll('tbody tr').map((tr) => tr.findAll('td')[3])
    expect(cells[0].find('.ids-measure-tag').text()).toBe('6')
    expect(cells[2].text()).toBe('-')
  })
})

describe('indicatorDataset · 搜索', () => {
  it('「查询」把输入框的值带进请求并回到第 1 页', async () => {
    const w = mountPage()
    await flushPromises()
    await w.findAll('.ids-filter-form input')[0].setValue('1009')
    await w.findAllComponents({ name: 'ElSelect' })[0].vm.$emit('update:modelValue', '1')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    expect(lastQuery()).toMatchObject({ datasetId: '1009', enable: '1', page: 1 })
  })

  it('改条件不自动查询（旧页也要点「查询」）', async () => {
    const w = mountPage()
    await flushPromises()
    await w.findAll('.ids-filter-form input')[0].setValue('1009')
    await flushPromises()
    expect(spies.datasetPaged).toHaveBeenCalledTimes(1)
  })
})

describe('indicatorDataset · 批量与执行操作', () => {
  it('「启用」/「禁用」直连 changeDatasetEnable(ids, 0|1)，旧版没有二次确认', async () => {
    const w = mountPage()
    await flushPromises()
    await btn(w, '启用').trigger('click')
    await flushPromises()
    expect(spies.changeDatasetEnable).toHaveBeenCalledWith([1001], 0)

    await btn(w, '禁用').trigger('click')
    await flushPromises()
    expect(spies.changeDatasetEnable).toHaveBeenLastCalledWith([1001], 1)
  })

  it('「更多..」→ 删除 → deleteDataSets(ids)', async () => {
    const w = mountPage()
    await flushPromises()
    w.findAllComponents({ name: 'ElDropdown' })[0].vm.$emit('command', 'delete')
    await flushPromises()
    expect(spies.deleteDataSets).toHaveBeenCalledWith([1001])
  })

  it('「立即运行(从上次ID)」→ runMeasureNow(ids, null)', async () => {
    const w = mountPage()
    await flushPromises()
    await btn(w, '立即运行(从上次ID)').trigger('click')
    await flushPromises()
    expect(spies.runMeasureNow).toHaveBeenCalledWith([1001], null)
  })

  it('「立即执行(手工设ID)」→ 打开 FROM_ID 弹窗，确认后按输入的 ID 执行', async () => {
    const w = mountPage()
    await flushPromises()
    await btn(w, '立即执行(手工设ID)').trigger('click')
    expect(spies.showPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 500,
        title: '请输入从以下数据ID开始执行指标',
        cols: [expect.objectContaining({ dataIndex: 'lastId', defaultValue: 0, title: 'FROM_ID' })],
      }),
    )
    w.findComponent({ name: 'PromptDialog' }).vm.$emit('confirm', { lastId: 12 })
    await flushPromises()
    expect(spies.runMeasureNow).toHaveBeenLastCalledWith([1001], 12)
  })

  it('未勾选时启用 / 立即运行只提示不发请求（旧版 $message / $notification 的等价）', async () => {
    spies.datasetPaged.mockImplementation(async () => ({ list: [], total: 0 }))
    const w = mountPage()
    await flushPromises()
    await btn(w, '启用').trigger('click')
    await flushPromises()
    expect(spies.changeDatasetEnable).not.toHaveBeenCalled()
    await btn(w, '立即运行(从上次ID)').trigger('click')
    await flushPromises()
    expect(spies.runMeasureNow).not.toHaveBeenCalled()
  })
})

describe('indicatorDataset · 行内操作', () => {
  it('「详情」打开右侧抽屉并带上传入的行', async () => {
    const w = mountPage()
    await flushPromises()
    await opLink(w, 0, '详情').trigger('click')
    const drawer = w.findComponent({ name: 'DatasetDetailDrawer' })
    expect(drawer.props('modelValue')).toBe(true)
    expect((drawer.props('record') as DatasetRow).datasetId).toBe(1001)
  })

  it('「编辑」把整行交给编辑弹窗（旧 handleEdit → $refs.datasetEdit.doEdit(record)）', async () => {
    const w = mountPage()
    await flushPromises()
    await opLink(w, 1, '编辑').trigger('click')
    expect(spies.openDialog).toHaveBeenCalledWith(expect.objectContaining({ datasetId: 1002 }))
  })

  it('名称点击也进详情（旧 nameSlot 的 a @click=handleDetail）', async () => {
    const w = mountPage()
    await flushPromises()
    await w.findAll('tbody tr')[0].find('.ids-link').trigger('click')
    expect(w.findComponent({ name: 'DatasetDetailDrawer' }).props('modelValue')).toBe(true)
  })

  it('「制作副本」图标 → copyDataset(datasetId)，并按旧版清掉查询条件后重查', async () => {
    const w = mountPage()
    await flushPromises()
    // 先设一个筛选条件，验证复制后会被清掉
    await w.findAll('.ids-filter-form input')[0].setValue('1001')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    expect(lastQuery()).toMatchObject({ datasetId: '1001' })

    // 行内操作**必须按行定位**。el-table 会把列插槽用一个「假 row」预渲染一次
    // （那块挂在 .hidden-columns 里、row 是空对象），页面上存在 row 为空的幽灵图标，
    // 全局找第一个会点到它，拿到的 datasetId 就是 undefined。一律按表体行内找（opLink）。
    await opLink(w, 0, '制作副本').trigger('click')
    await flushPromises()
    expect(spies.copyDataset).toHaveBeenCalledWith(1001)
    expect(lastQuery()).toMatchObject({ datasetId: '' })
  })

  it('「增加指标」/「指标-新」→ 原地打开对应抽屉，入参 (sourceId, 整行, entryTypeId)（旧 doEdit）', async () => {
    const w = mountPage()
    await flushPromises()
    // 首屏默认选中第一行（旧 loadData 里 `selectedRowKeys = [oriData[0].datasetId]`），
    // 而这两个入口要求**恰好选中 1 行**，所以直接点即可。
    await btn(w, '增加指标').trigger('click')
    expect(spies.openMeasureAdd).toHaveBeenCalledWith(
      161725,
      expect.objectContaining({ datasetId: 1001, datasetName: '公告明细数据集', entryTypeId: 1001 }),
      1001,
    )
    expect(spies.openMeasureAddNew).not.toHaveBeenCalled()

    await btn(w, '指标-新').trigger('click')
    expect(spies.openMeasureAddNew).toHaveBeenCalledWith(
      161725,
      expect.objectContaining({ datasetId: 1001, datasetName: '公告明细数据集', entryTypeId: 1001 }),
      1001,
    )
  })

  it('未选中恰好 1 行时「增加指标 / 指标-新」只报错、不开弹窗（旧 handleAddMeasure/New 的守卫）', async () => {
    const err = vi.spyOn(ElMessage, 'error')
    const w = mountPage()
    await flushPromises()
    // 清掉首屏自动加上的那行勾选
    w.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', [])
    await flushPromises()
    await btn(w, '增加指标').trigger('click')
    await btn(w, '指标-新').trigger('click')
    expect(spies.openMeasureAdd).not.toHaveBeenCalled()
    expect(spies.openMeasureAddNew).not.toHaveBeenCalled()
    expect(String(err.mock.calls[0][0])).toContain('请选择要一行操作的数据集')
    // 第二句文案旧版尾部多一个「2」（原文照抄）
    expect(String(err.mock.calls[1][0])).toContain('请选择要一行操作的数据集2')
    err.mockRestore()
  })

  it('行内「指标」/ 指标数标签 → 原地打开 MeasureShowDialog，入参 (sourceId, entryTypeId, datasetId)', async () => {
    const w = mountPage()
    await flushPromises()
    await opLink(w, 0, '指标').trigger('click')
    expect(spies.openMeasureShow).toHaveBeenCalledWith(161725, 1001, 1001)
    // 指标数标签走同一个 handleShowMeasure
    // （测试环境把老式 <transition> 桩成了 transition-stub，类名落在桩上、真正的 click
    //   监听在它内层的 span.el-tag 上，所以要往里再点一层；浏览器里没有这层包装）
    await w.findAll('.el-table__body tr')[0].find('.ids-measure-tag .el-tag').trigger('click')
    expect(spies.openMeasureShow).toHaveBeenCalledTimes(2)
    expect(spies.openMeasureShow).toHaveBeenLastCalledWith(161725, 1001, 1001)
  })
})

describe('indicatorDataset · 排序与分页（服务端口径）', () => {
  it('表头降序 → sortField/sortOrder = descend（antd 口径）', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'measureCnt', order: 'descending' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ sortField: 'measureCnt', sortOrder: 'descend' })
  })

  it('取消排序（order=null）→ 两个键都不发', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'measureCnt', order: 'descending' })
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'measureCnt', order: null })
    await flushPromises()
    expect(Object.keys(lastQuery())).not.toContain('sortField')
  })

  it('翻页 → page 变化、页码不重置筛选', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 2, limit: 10 })
  })
})

describe('indicatorDataset · 路由 query（旧 props / created 的等价物）', () => {
  it('sourceId + entryTypeId 透传进筛选，并放出「增加数据集」', async () => {
    const w = mountPage({ sourceId: '161725', entryTypeId: '1001' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ sourceId: '161725', entryTypeId: '1001' })
    await btn(w, '增加数据集').trigger('click')
    await flushPromises()
    expect(spies.genDatasetFromSource).toHaveBeenCalledWith('161725', '1001')
  })

  it('没有 sourceId / entryTypeId 时「增加数据集」不出现（旧 v-if="this.sourceId && this.entryTypeId"）', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('button').some((b) => b.text() === '增加数据集')).toBe(false)
  })

  it('entryType / configId 随请求透传（旧 queryParam 里的两个键）', async () => {
    mountPage({ entryType: '1001', configId: '70598' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ entryType: '1001', configId: '70598' })
  })

  it('「增加数据集」缺源或缺表ID 时只报错、不发请求', async () => {
    const w = mountPage({ sourceId: '161725' })
    await flushPromises()
    // sourceId 有、entryTypeId 没有 → 按钮不出现（旧判据就是两个都要有）
    expect(w.findAll('button').some((b) => b.text() === '增加数据集')).toBe(false)
    expect(spies.genDatasetFromSource).not.toHaveBeenCalled()
  })
})
