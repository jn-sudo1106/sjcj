// @vitest-environment jsdom
// 指标结果页（旧 page/inst/MeasureData.vue → MetricCenter/indicatorsResult/index.vue）接线回归。
//
// 这一页的旧实现是「直连后端的一大坨操作」：工具条 7 个数据操作 + 行内 5 个操作 +
// SQL / API / 导入 / 导出。迁到新平台全部换成 dataApi / entryApi 适配层，
// 最容易出问题的就是「哪个入口对应哪条接口、payload 对不对」，所以这里逐个钉死。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ElementPlus, { ElNotification } from 'element-plus'
import Page from './index.vue'
import { confirmDanger } from '@/utils/confirmDanger'
import type { DataRow, DataTableMeta, EntryDetail } from '@/api'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const spies = vi.hoisted(() => ({
  tableMeta: vi.fn(),
  rowQueryPaged: vi.fn(),
  rowDetail: vi.fn(),
  rowUpdate: vi.fn(() => Promise.resolve({ message: '修改成功' })),
  rowDelete: vi.fn(() => Promise.resolve({ success: 2, all: 5, not_found: 1 })),
  rowDeleteBatch: vi.fn(() => Promise.resolve({ success: 2, all: 3, not_found: 0 })),
  reSave: vi.fn(() => Promise.resolve({ message: 'ok' })),
  exportUrl: vi.fn(() => 'http://localhost:3000/api/v1/entry/entryExportAll?entryType=999'),
  markEntryType: vi.fn(() => Promise.resolve({ message: 'ok' })),
  openEdit: vi.fn(),
  openDetail: vi.fn(),
  openTask: vi.fn(),
  openSourceDetail: vi.fn(),
  openApi: vi.fn(),
  openUpload: vi.fn(),
  /** 源选择器 stub 的 reloadSid（旧 `$refs.sourceSelect.reloadSid`） */
  reloadSid: vi.fn(),
}))

// `@/api` 是这一页唯一的请求出口（dataApi 取数 / entryApi 改表态）；
// sourceApi 只有 EntrySourceSelect 用，而那个组件这里被替身掉了，一并给个空壳避免误报。
vi.mock('@/api', () => ({
  dataApi: {
    tableMeta: spies.tableMeta,
    rowQueryPaged: spies.rowQueryPaged,
    rowDetail: spies.rowDetail,
    rowUpdate: spies.rowUpdate,
    rowDelete: spies.rowDelete,
    rowDeleteBatch: spies.rowDeleteBatch,
    reSave: spies.reSave,
    exportUrl: spies.exportUrl,
  },
  entryApi: { markEntryType: spies.markEntryType },
  sourceApi: { sourceSame: vi.fn(async () => []), sourceDetail: vi.fn() },
}))

// 弹层全部替身：真弹窗是 teleport + 过渡，jsdom 里断言不到「被打开」，
// 而这里要验的是「父组件用哪一行 / 什么参数打开的它」。
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
    props: ['cols', 'listCols', 'listKey', 'listTitle', 'listRowKey', 'subKey', 'subCols'],
    setup(_props, { expose }) {
      expose({ open: spies.openDetail })
      return () => h('div', { class: 'stub-detail' })
    },
  }),
}))

vi.mock('./EntrySourceSelect.vue', async () => ({
  default: defineComponent({
    name: 'EntrySourceSelect',
    props: ['modelValue', 'sid', 'detail'],
    emits: ['change', 'update:modelValue'],
    setup(_props, { expose, emit }) {
      // 真组件 reloadSid 的行为：重拉候选 → 回填选中值 → emit('change', record)
      // （页面 watcher 就是靠这条 change 带出重查的，见 index.vue 的 watch）
      expose({
        reloadSid: spies.reloadSid.mockImplementation((sid: string) => {
          emit('update:modelValue', String(sid))
          emit('change', { sourceId: String(sid), name: `源${sid}` })
        }),
      })
      return () => h('div', { class: 'stub-source-select' })
    },
  }),
}))

vi.mock('./TaskInstDialog.vue', async () => ({
  default: defineComponent({
    name: 'TaskInstDialog',
    setup(_props, { expose }) {
      expose({ open: spies.openTask })
      return () => h('div', { class: 'stub-task' })
    },
  }),
}))

vi.mock('./SourceDetailDialog.vue', async () => ({
  default: defineComponent({
    name: 'SourceDetailDialog',
    setup(_props, { expose }) {
      expose({ open: spies.openSourceDetail })
      return () => h('div', { class: 'stub-source-detail' })
    },
  }),
}))

vi.mock('./ApiDescDialog.vue', async () => ({
  default: defineComponent({
    name: 'ApiDescDialog',
    setup(_props, { expose }) {
      expose({ open: spies.openApi })
      return () => h('div', { class: 'stub-api' })
    },
  }),
}))

vi.mock('./UploadDataDialog.vue', async () => ({
  default: defineComponent({
    name: 'UploadDataDialog',
    emits: ['refresh'],
    setup(_props, { expose }) {
      expose({ open: spies.openUpload })
      return () => h('div', { class: 'stub-upload' })
    },
  }),
}))

vi.mock('@/utils/confirmDanger', () => ({
  confirmDanger: vi.fn((_title: string, _body: string, run: () => unknown) => run()),
  confirmOrRun: vi.fn((_need: boolean, _t: string, _b: string, run: () => unknown) => run()),
}))

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

/* ------------------------------------------------------------------ *
 * 夹具                                                                *
 * ------------------------------------------------------------------ */

const META: DataTableMeta = {
  tableId: '999',
  tableName: 'sense_data.TB_MEASURE',
  name: '指标',
  state: 'C',
  keyField: 'K2',
  fields: [
    { prop: 'K1', type: 'string', desc: '标题', columnName: 'K1', required: true },
    { prop: 'K2', type: 'string', desc: '指标编码', columnName: 'K2', required: true },
    { prop: 'K3', type: 'date', desc: '发布日期', columnName: 'K3', required: true },
    { prop: 'K9', type: 'string', desc: '备注', columnName: 'K9', required: false },
    { prop: 'K10', type: 'url', desc: 'URL地址', columnName: 'K10', required: true },
  ],
}

function rowData(over: Partial<DataRow> = {}): DataRow {
  return {
    dataId: '88213',
    sourceId: '161725',
    configId: '70598',
    detailId: '5501',
    parentId: '0',
    categoryId: '0',
    state: 'C',
    nextFlag: '',
    createDt: '2026-10-14 03:00:12',
    updateDt: '2026-10-14 03:05:00',
    k0: '12345',
    seq: '1',
    times: '2',
    fileId: '9001',
    values: { K1: '标题A', K2: 'A00011', K3: '2026-10-14', K10: 'http://example.com/a' },
    title: '标题A',
    summary: '',
    acceptState: 'accepted',
    ...over,
  }
}

const ROWS: DataRow[] = [
  rowData(),
  rowData({
    dataId: '88214',
    k0: '',
    detailId: '',
    parentId: '700',
    categoryId: '999',
    state: 'E',
    values: { K1: '标题B', K2: 'A00012', K3: '2026-10-13', K10: '' },
  }),
]

const DETAIL: EntryDetail = {
  row: rowData({ entryTypeId: '999', entryTypeName: '指标表', sourceName: '新浪财经', ver: '3', flag1: '2026-10-14' }),
  showItems: [
    { itemId: '1', columnName: 'K1', itemName: '标题', value: '标题A' },
    { itemId: '2', columnName: 'K2', itemName: '指标编码', value: 'A00011' },
  ],
  subs: [{
    row: rowData({ dataId: '88215' }),
    tableId: '1001',
    tableName: '指标明细表',
    showItems: [{ itemId: '3', columnName: 'K1', itemName: '标题', value: '子数据' }],
  }],
  subsCnt: 6,
}

let wrapper: VueWrapper | undefined
const openSpy = vi.fn()

function mountPage(query: Record<string, string> = {}) {
  const route = routeState.route as unknown as { query: Record<string, string> }
  Object.keys(route.query).forEach((k) => delete route.query[k])
  Object.assign(route.query, query)
  wrapper = mount(Page, { global: { plugins: [ElementPlus] } })
  return wrapper
}

function btn(w: VueWrapper, text: string) {
  const hit = w.findAll('button').find((b) => b.text() === text)
  if (!hit) throw new Error(`找不到按钮：${text}`)
  return hit
}

/** 按 title 属性找工具条上的图标按钮（SQL / API / 导入数据 / 导出EXCEL） */
function iconBtn(w: VueWrapper, title: string) {
  const hit = w.findAll('button').find((b) => b.attributes('title') === title)
  if (!hit) throw new Error(`找不到图标按钮：${title}`)
  return hit
}

/** 表格数据行（必须走 .el-table__body，避开 .hidden-columns 里的空 row 幽灵渲染） */
function cellOf(w: VueWrapper, rowIndex: number, cellIndex: number) {
  return w.findAll('.el-table__body tr')[rowIndex].findAll('td')[cellIndex]
}

/** 工具条上的「数据操作」下拉（不是表格行里那个） */
function batchDropdown(w: VueWrapper) {
  const hit = w.findAllComponents({ name: 'ElDropdown' }).find((d) => !d.element.closest('.el-table'))
  return hit
}

function rowDropdown(w: VueWrapper, rowIndex: number) {
  return w.findAll('.el-table__body tr')[rowIndex].findComponent({ name: 'ElDropdown' })
}

function lastQuery(): Record<string, unknown> {
  const calls = spies.rowQueryPaged.mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}

async function runBatchCommand(w: VueWrapper, command: string) {
  batchDropdown(w)?.vm.$emit('command', command)
  await flushPromises()
}

beforeEach(() => {
  Object.values(spies).forEach((fn) => fn.mockClear())
  vi.mocked(confirmDanger).mockClear()
  openSpy.mockClear()
  vi.stubGlobal('open', openSpy)
  spies.tableMeta.mockImplementation(async () => META)
  spies.rowQueryPaged.mockImplementation(async () => ({ total: 2, list: ROWS }))
  spies.rowDetail.mockImplementation(async () => DETAIL)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
  document.body.innerHTML = '' // 清掉 el-dropdown / el-dialog / el-message 传送到 body 的残留
})

/* ------------------------------------------------------------------ *
 * 用例                                                                *
 * ------------------------------------------------------------------ */

describe('indicatorsResult · 首屏', () => {
  it('默认表 ID 是旧 `created` 里写死的「指标」表 999，先拉表元再查数据', async () => {
    mountPage()
    await flushPromises()
    expect(spies.tableMeta).toHaveBeenCalledWith('999')
    expect(lastQuery()).toMatchObject({ tableId: '999', page: 1, size: 20, sql: ' 1 = 1 ' })
  })

  it('未筛选时 sql 只有 ` 1 = 1 `，且不带 sortField / sourceId / min / max', async () => {
    mountPage()
    await flushPromises()
    const q = lastQuery()
    expect(q.sql).toBe(' 1 = 1 ')
    expect(q.sourceId).toBeUndefined()
    expect(q.min).toBeUndefined()
    expect(q.max).toBeUndefined()
    expect(Object.keys(q)).not.toContain('sortField')
  })

  it('表头 = 勾选列 + ENTRY_ID + 源 + 必填字段动态列（前 12）+ 9 个系统列', async () => {
    const w = mountPage()
    await flushPromises()
    expect(w.findAll('thead th').map((th) => th.text())).toEqual([
      '', 'ENTRY_ID', '源',
      '标题-K1', '指标编码-K2', '发布日期-K3', 'URL地址-K10',
      '状态', '更新', '生成', '任务', '后续', '父ID', '原始', '操作',
    ])
  })

  it('动态列的值取自 row.values；url 列渲染成新窗口外链，空值退化成普通文本', async () => {
    const w = mountPage()
    await flushPromises()
    expect(cellOf(w, 0, 3).text()).toBe('标题A')
    const link = cellOf(w, 0, 6).find('a')
    expect(link.attributes('href')).toBe('http://example.com/a')
    expect(link.attributes('target')).toBe('_blank')
    expect(cellOf(w, 1, 6).find('a').exists()).toBe(false)
  })

  it('动态列只给 min-width、不给 width（否则容器有富余时表格右侧会留白）', async () => {
    const w = mountPage()
    await flushPromises()
    const byProp = (prop: string) => {
      const hit = w.findAllComponents({ name: 'ElTableColumn' }).find((c) => c.props('prop') === prop)
      if (!hit) throw new Error(`找不到 prop=${prop} 的表格列`)
      return hit
    }
    // 「发布日期-K3」= 140*0.9；「指标编码-K2」= 120*0.9
    expect(byProp('K3').props('minWidth')).toBe(126)
    expect(byProp('K2').props('minWidth')).toBe(108)
    // 软定宽的属性必须留空：el-table 只把富余宽度分给「没有数字 width」的列
    expect(byProp('K3').props('width')).toBe('')
    expect(byProp('K2').props('width')).toBe('')
    // 系统短列照旧定宽（模板里是静态属性，会以字符串形式落到 prop 上）
    expect(String(byProp('STATE').props('width'))).toBe('70')
  })

  it('表里没有任何必填字段时补一个弹性占位列，表格仍然铺满容器（不留白）', async () => {
    // 没有必填字段 → 没有动态列 → 只剩 11 个定宽系统列（合计 895px），
    // 不补弹性列的话右侧会空出几百像素。占位列不给宽度，被 el-table 当作弹性列。
    spies.tableMeta.mockImplementation(async () => ({
      ...META,
      fields: META.fields.map((f) => ({ ...f, required: false })),
    }))
    const w = mountPage()
    await flushPromises()
    const cols = w.findAllComponents({ name: 'ElTableColumn' })
    // 勾选列 + 10 个系统列（ENTRY_ID…操作）+ 占位列
    expect(cols).toHaveLength(12)
    const filler = cols.filter((c) => c.props('type') === 'default' && !c.props('prop') && !c.props('label'))
    expect(filler).toHaveLength(1)
    // 占位列落在「原始」和「操作」之间
    expect(w.findAll('thead th').map((th) => th.text())).toEqual([
      '', 'ENTRY_ID', '源', '状态', '更新', '生成', '任务', '后续', '父ID', '原始', '', '操作',
    ])
  })

  it('状态列渲染 row.state（列名沿用旧模板的 prop="STATE"，行数据却是 camelCase，必须给插槽）', async () => {
    const w = mountPage()
    await flushPromises()
    expect(cellOf(w, 0, 7).text()).toBe('C')
    expect(cellOf(w, 1, 7).text()).toBe('E')
  })

  it('更新 / 生成列走相对时间（旧局部的 `dt` 过滤器 ≈ 共享 timeAgo）', async () => {
    const w = mountPage()
    await flushPromises()
    expect(cellOf(w, 0, 8).find('.ir-time').text()).not.toBe('')
    expect(cellOf(w, 0, 8).find('.ir-time').text()).not.toBe('2026-10-14 03:05:00')
    expect(cellOf(w, 0, 9).find('.ir-time').text()).not.toBe('')
  })

  it('查询失败 → ElNotification.error（旧 `查询失败:` + 前 100 字），并清空列表', async () => {
    const err = vi.spyOn(ElNotification, 'error').mockImplementation(() => undefined as never)
    spies.rowQueryPaged.mockImplementation(async () => { throw new Error('boom') })
    const w = mountPage()
    await flushPromises()
    const arg = err.mock.calls[0][0] as unknown as { message?: string }
    expect(String(arg.message)).toContain('查询失败:boom')
    expect(w.findAll('.el-table__body tr')).toHaveLength(0)
    err.mockRestore()
  })
})

describe('indicatorsResult · 搜索（一律回第 1 页）', () => {
  it('编码 / 名称 / 日期拼进 K2 / K3 / K4，起止 ID 直传 min / max', async () => {
    const w = mountPage()
    await flushPromises()
    // 按 placeholder 定位：日期选择器也会渲染一个 input，按下标取会错位
    await w.find('input[placeholder="指标编码"]').setValue('A00011')
    await w.find('input[placeholder="指标名称"]').setValue('涨跌')
    const dp = w.findComponent({ name: 'ElDatePicker' })
    dp.vm.$emit('update:modelValue', '2026-10-14')
    dp.vm.$emit('change', '2026-10-14')
    await flushPromises()
    await w.find('input[placeholder="起始ID"]').setValue('100')
    await w.find('input[placeholder="终止ID"]').setValue('200')
    await btn(w, '查询').trigger('click')
    await flushPromises()
    expect(lastQuery()).toMatchObject({
      sql: " 1 = 1  and K2 = 'A00011' and K4 = '2026-10-14' and K3 LIKE '%涨跌%'",
      min: '100',
      max: '200',
      page: 1,
    })
  })

  it('在第 2 页改条件点「查询」→ 回到第 1 页', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 2 })
    await btn(w, '查询').trigger('click')
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 1 })
  })

  it('表头排序 → sortField/sortOrder（ascend / descend），并回第 1 页', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'ENTRY_ID', order: 'ascending' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ sortField: 'ENTRY_ID', sortOrder: 'ascend', page: 1 })
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'ENTRY_ID', order: null })
    await flushPromises()
    expect(Object.keys(lastQuery())).not.toContain('sortField')
  })

  it('翻页 / 改每页条数', async () => {
    const w = mountPage()
    await flushPromises()
    const pager = w.findComponent({ name: 'ElPagination' })
    pager.vm.$emit('current-change', 3)
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 3, size: 20 })
    pager.vm.$emit('size-change', 100)
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 1, size: 100 })
  })
})

describe('indicatorsResult · 工具条（state=C 才出现「数据操作」）', () => {
  it('测试表（C）→ 7 个数据操作项；正式表（AC）→ 整个下拉不出现', async () => {
    const w = mountPage()
    await flushPromises()
    expect(batchDropdown(w)?.findAllComponents({ name: 'ElDropdownItem' }).map((i) => i.text())).toEqual([
      '删除选中的数据', '删除该源-当日数据', '删除该源-所有数据', '填入IDs-删除',
      '设为正式表', '清空表数据【当日】', '清空表数据【全量】',
    ])
    w.unmount()

    spies.tableMeta.mockImplementation(async () => ({ ...META, state: 'AC' }))
    const w2 = mountPage()
    await flushPromises()
    expect(batchDropdown(w2)).toBeUndefined()
    expect(iconBtn(w2, 'SQL').exists()).toBe(true) // 其余图标按钮不受表态影响
  })

  it('「删除选中的数据」→ rowDeleteBatch(tableId, 选中 ENTRY_ID)', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', ROWS)
    await flushPromises()
    await runBatchCommand(w, 'deleteSelected')
    expect(spies.rowDeleteBatch).toHaveBeenCalledWith('999', ['88213', '88214'])
  })

  it('「填入IDs-删除」→ 打开弹窗，按行拆 ID 后 rowDeleteBatch', async () => {
    const w = mountPage()
    await flushPromises()
    await runBatchCommand(w, 'deleteByIds')
    await nextTick()
    // el-dialog 默认不 append-to-body，内容就渲染在当前组件树里；空行/前后空格都要滤掉
    await w.find('textarea').setValue('88213\n 88214 \n\n')
    const ok = w.findAll('button').find((b) => b.text() === '确定')
    expect(ok).toBeTruthy()
    await ok?.trigger('click')
    await flushPromises()
    expect(spies.rowDeleteBatch).toHaveBeenCalledWith('999', ['88213', '88214'])
  })

  it('「删除该源-当日」/「删除该源-所有」→ rowDelete(all: 0 | 1) + 当前源', async () => {
    const w = mountPage({ sourceId: '161725' })
    await flushPromises()
    await runBatchCommand(w, 'deleteSourceDate')
    expect(spies.rowDelete).toHaveBeenLastCalledWith('999', { sourceId: '161725', all: 0 })
    await runBatchCommand(w, 'deleteSourceAll')
    expect(spies.rowDelete).toHaveBeenLastCalledWith('999', { sourceId: '161725', all: 1 })
  })

  it('「清空表数据」两个入口 → sourceId 为 undefined（整表不分源）', async () => {
    const w = mountPage({ sourceId: '161725' })
    await flushPromises()
    await runBatchCommand(w, 'clearDate')
    expect(spies.rowDelete).toHaveBeenLastCalledWith('999', { sourceId: undefined, all: 0 })
    await runBatchCommand(w, 'clearAll')
    expect(spies.rowDelete).toHaveBeenLastCalledWith('999', { sourceId: undefined, all: 1 })
  })

  it('「设为正式表」→ entryApi.markEntryType(tableId, AC)，并立刻把表态改成 AC（下拉消失）', async () => {
    const w = mountPage()
    await flushPromises()
    expect(batchDropdown(w)).toBeTruthy()
    await runBatchCommand(w, 'markFormal')
    expect(spies.markEntryType).toHaveBeenCalledWith('999', 'AC')
    expect(batchDropdown(w)).toBeUndefined()
  })

  it('「SQL」图标 → 展开提示条，语句含表名 / 选中 ID / 源 / 上次的 more', async () => {
    const w = mountPage({ sourceId: '161725' })
    await flushPromises()
    w.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', [ROWS[0]])
    await flushPromises()
    expect(w.find('.ir-tip').exists()).toBe(false)
    await iconBtn(w, 'SQL').trigger('click')
    await flushPromises()
    const text = w.find('.ir-tip').text()
    expect(text).toContain('select * from sense_data.TB_MEASURE')
    expect(text).toContain('and entry_id in (88213)')
    expect(text).toContain('and source_id = 161725')
    expect(text).toContain('and  1 = 1') // 末尾的 more（文本节点会把行尾空格裁掉）
  })

  it('「API」图标 → 三个 URL 交给 ApiDesc 弹窗（SQL 取数 / ID 取数 / 发后续任务）', async () => {
    const w = mountPage({ sourceId: '161725' })
    await flushPromises()
    await iconBtn(w, 'API').trigger('click')
    await flushPromises()
    expect(spies.openApi).toHaveBeenCalledTimes(1)
    const [api, nextUrl, qsApi] = spies.openApi.mock.calls[0] as unknown as string[]
    expect(api).toContain('/rest/api/v1/data/entry?appId=dev&appKey=dev1')
    expect(api).toContain('&type=999')
    expect(api).toContain('&sourceId=161725')
    expect(api).toContain('&startId=88213') // 未填起始ID → 取本页最小 ENTRY_ID
    expect(api).toContain('&size=10')
    expect(nextUrl).toContain('/api/v1/source/nextStep2?size=10')
    expect(nextUrl).toContain('&entryTypeId=999')
    expect(nextUrl).toContain('&sourceId=161725')
    // 旧版 nextUrl 只在填了「起始ID」时才带 start（没填不拿本页最小 ID 兜底）
    expect(nextUrl).not.toContain('start=')
    expect(qsApi).toContain('/rest/api/v1/data/qs?appId=dev&appKey=dev1')
    expect(qsApi).toContain('&page=1')

    // 填了起始/终止 ID 时：api 用填的值，nextUrl 补上 start，endId 只有 api 有
    await w.find('input[placeholder="起始ID"]').setValue('100')
    await w.find('input[placeholder="终止ID"]').setValue('200')
    await iconBtn(w, 'API').trigger('click')
    await flushPromises()
    const [api2, nextUrl2] = spies.openApi.mock.calls[1] as unknown as string[]
    expect(api2).toContain('&startId=100')
    expect(api2).toContain('&endId=200')
    expect(nextUrl2).toContain('&start=100')
    expect(nextUrl2).not.toContain('endId')
  })

  it('「导入数据」→ 弹窗拿到表 ID + 源 ID + 配置 ID（源为空时用首行的源）', async () => {
    const w = mountPage()
    await flushPromises()
    await iconBtn(w, '导入数据').trigger('click')
    expect(spies.openUpload).toHaveBeenCalledWith('999', '161725', '70598')
  })

  it('「导入数据」的配置ID：首行没有时退到源选择器带回的那条记录（旧 this.source.configId）', async () => {
    // 首行 CONFIG_ID 为空 → 旧版 `configId = this.source && this.source.configId`
    spies.rowQueryPaged.mockImplementation(async () => ({
      total: 1,
      list: [rowData({ configId: '' })],
    }))
    const w = mountPage()
    await flushPromises()
    // 源选择器 change 带回来的记录（含 configId）
    w.findComponent({ name: 'EntrySourceSelect' }).vm.$emit('change', {
      sourceId: '161725', name: '新浪财经', configId: '70598',
    })
    await flushPromises()
    await iconBtn(w, '导入数据').trigger('click')
    expect(spies.openUpload).toHaveBeenLastCalledWith('999', '161725', '70598')
  })

  it('「导入数据」的配置ID：首行与源记录都没有 → 传空串（用户在弹窗里手填）', async () => {
    spies.rowQueryPaged.mockImplementation(async () => ({
      total: 1,
      list: [rowData({ configId: '' })],
    }))
    const w = mountPage()
    await flushPromises()
    await iconBtn(w, '导入数据').trigger('click')
    expect(spies.openUpload).toHaveBeenLastCalledWith('999', '161725', '')
  })

  it('「导出EXCEL」→ 用 exportUrl 拼 URL 后新窗口直开（同源 Cookie 鉴权）', async () => {
    const w = mountPage({ sourceId: '161725' })
    await flushPromises()
    await iconBtn(w, '导出EXCEL').trigger('click')
    expect(spies.exportUrl).toHaveBeenCalledWith({
      tableId: '999',
      sourceId: '161725',
      sql: ' 1 = 1 ',
      min: undefined,
      max: undefined,
    })
    expect(openSpy).toHaveBeenCalledWith('http://localhost:3000/api/v1/entry/entryExportAll?entryType=999', '_blank')
  })
})

describe('indicatorsResult · 行内操作', () => {
  it('ENTRY_ID 点击 → rowDetail(tableId, ENTRY_ID) → 详情抽屉（subs 归一化成子表标题要的形状）', async () => {
    const w = mountPage()
    await flushPromises()
    await cellOf(w, 0, 1).find('.ir-link').trigger('click')
    await flushPromises()
    expect(spies.rowDetail).toHaveBeenCalledWith('999', '88213')
    const [record, title] = spies.openDetail.mock.calls[0] as [Record<string, unknown>, string]
    expect(title).toBe('数据表详情')
    expect(record.dataId).toBe('88213')
    expect(record.showItems).toEqual(DETAIL.showItems)
    expect(record.subsCnt).toBe(6)
    const sub = (record.subs as Record<string, unknown>[])[0]
    expect(sub.entryTypeId).toBe('1001')
    expect(sub.entryTypeName).toBe('指标明细表')
    expect(sub.entryId).toBe('88215')
  })

  it('源 点击 → 源详情弹窗（旧 showSourceDetail）', async () => {
    const w = mountPage()
    await flushPromises()
    await cellOf(w, 0, 2).find('.ir-link').trigger('click')
    expect(spies.openSourceDetail).toHaveBeenCalledWith('161725')
  })

  it('任务 点击 → 任务实例弹窗（taskId = DETAIL_ID；DETAIL_ID 为空时传空串）', async () => {
    const w = mountPage()
    await flushPromises()
    await cellOf(w, 0, 10).find('.ir-link').trigger('click')
    expect(spies.openTask).toHaveBeenLastCalledWith({ sourceId: '161725', parentId: null, taskId: 5501 })
    await cellOf(w, 1, 10).find('.ir-link').trigger('click')
    expect(spies.openTask).toHaveBeenLastCalledWith({ sourceId: '161725', parentId: null, taskId: '' })
  })

  it('父ID：父表信息齐全时才可点（categoryId > 0 && parentId > 0），否则是纯文本', async () => {
    const w = mountPage()
    await flushPromises()
    // 第 1 行 categoryId=0 → 不是链接
    expect(cellOf(w, 0, 12).find('.ir-link').exists()).toBe(false)
    expect(cellOf(w, 0, 12).text()).toBe('0')
    // 第 2 行 categoryId=999 parentId=700 → 点开的是**父表**的详情
    await cellOf(w, 1, 12).find('.ir-link').trigger('click')
    await flushPromises()
    expect(spies.rowDetail).toHaveBeenLastCalledWith('999', '700')
  })

  it('原始：K0 非空才可点，新窗口直开 readJson（带 sourceId 与 id）', async () => {
    const w = mountPage()
    await flushPromises()
    await cellOf(w, 0, 13).find('.ir-link').trigger('click')
    expect(openSpy).toHaveBeenCalledWith('/api/v1/readJson?sourceId=161725&id=12345', '_blank')
    expect(cellOf(w, 1, 13).find('.ir-link').exists()).toBe(false)
    expect(cellOf(w, 1, 13).text()).toBe('-')
  })

  it('操作下拉：测试表 + 有 K0 → 5 项；无 K0 时少「重新保存原始JSON」', async () => {
    const w = mountPage()
    await flushPromises()
    expect(rowDropdown(w, 0).findAllComponents({ name: 'ElDropdownItem' }).map((i) => i.text())).toEqual([
      '详情', '查后续任务实例', '删除单条【无法恢复】', '手动修改', '重新保存原始JSON',
    ])
    expect(rowDropdown(w, 1).findAllComponents({ name: 'ElDropdownItem' }).map((i) => i.text())).toEqual([
      '详情', '查后续任务实例', '删除单条【无法恢复】', '手动修改',
    ])
  })

  it('正式表（AC）→ 行内少了「删除单条」「手动修改」两项', async () => {
    spies.tableMeta.mockImplementation(async () => ({ ...META, state: 'AC' }))
    const w = mountPage()
    await flushPromises()
    expect(rowDropdown(w, 0).findAllComponents({ name: 'ElDropdownItem' }).map((i) => i.text())).toEqual([
      '详情', '查后续任务实例', '重新保存原始JSON',
    ])
  })

  it('「查后续任务实例」→ 以本行 ENTRY_ID 作 parentId 打开任务弹窗', async () => {
    const w = mountPage()
    await flushPromises()
    rowDropdown(w, 0).vm.$emit('command', 'subTask')
    await flushPromises()
    expect(spies.openTask).toHaveBeenCalledWith({
      sourceId: '161725', configId: null, taskId: '', parentId: '88213',
    })
  })

  it('「删除单条」→ rowDelete(tableId, { sourceId, all:1, entryId })', async () => {
    const w = mountPage()
    await flushPromises()
    rowDropdown(w, 0).vm.$emit('command', 'deleteOne')
    await flushPromises()
    expect(spies.rowDelete).toHaveBeenCalledWith('999', {
      sourceId: '161725', all: 1, entryId: '88213',
    })
  })

  it('「手动修改」→ 先 rowDetail 反填动态列，再用 keyField 作副标题打开编辑弹窗', async () => {
    const w = mountPage()
    await flushPromises()
    rowDropdown(w, 0).vm.$emit('command', 'edit')
    await flushPromises()
    expect(spies.rowDetail).toHaveBeenCalledWith('999', '88213')
    expect(spies.openEdit).toHaveBeenCalledWith({
      ENTRY_ID: '88213',
      ENTRY_TYPE_ID: '999',
      K1: '标题A',
      K2: 'A00011',
    }, '去重列:K2')
  })

  it('「重新保存原始JSON」→ 确认后 reSave(sourceId, K0)，K0 为空时什么都不做', async () => {
    const w = mountPage()
    await flushPromises()
    rowDropdown(w, 1).vm.$emit('command', 'reSave')
    await flushPromises()
    expect(spies.reSave).not.toHaveBeenCalled()
    rowDropdown(w, 0).vm.$emit('command', 'reSave')
    await flushPromises()
    expect(spies.reSave).toHaveBeenCalledWith('161725', '12345')
  })
})

describe('indicatorsResult · 路由 query（旧 props / created 的等价物）', () => {
  it('?entryType= 覆盖默认的 999', async () => {
    mountPage({ entryType: '1001' })
    await flushPromises()
    expect(spies.tableMeta).toHaveBeenCalledWith('1001')
    expect(lastQuery()).toMatchObject({ tableId: '1001' })
  })

  it('?entryTypeId= 也能覆盖（旧版两个键名的等价物）', async () => {
    mountPage({ entryTypeId: '1002' })
    await flushPromises()
    expect(spies.tableMeta).toHaveBeenCalledWith('1002')
  })

  it('?sourceId= → 源选择器初值 + 请求带 sourceId + 工具条显示源 tag', async () => {
    const w = mountPage({ sourceId: '161725' })
    await flushPromises()
    expect(w.findComponent({ name: 'EntrySourceSelect' }).props('sid')).toBe('161725')
    expect(lastQuery()).toMatchObject({ sourceId: '161725' })
    expect(w.find('.ir-tags').text()).toContain('161725')
  })

  it('拖拽（同一 tab 内再次带 query 跳进来）→ 跟随重查，表 ID 变了才重新拉表元', async () => {
    const w = mountPage()
    await flushPromises()
    expect(spies.tableMeta).toHaveBeenCalledTimes(1)
    const route = routeState.route as unknown as { query: Record<string, string> }
    route.query.sourceId = '161725'
    await flushPromises()
    expect(lastQuery()).toMatchObject({ sourceId: '161725' })
    expect(spies.tableMeta).toHaveBeenCalledTimes(1)

    route.query.entryType = '1003'
    await flushPromises()
    expect(spies.tableMeta).toHaveBeenLastCalledWith('1003')
    expect(spies.tableMeta).toHaveBeenCalledTimes(2)
    w.unmount()
  })

  it('源选择器 change → 回第 1 页重查（旧 handleSourceChange）', async () => {
    const w = mountPage()
    await flushPromises()
    w.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await flushPromises()
    w.findComponent({ name: 'EntrySourceSelect' }).vm.$emit('change', { sourceId: '161725', name: '新浪财经' })
    await flushPromises()
    expect(lastQuery()).toMatchObject({ page: 1 })
  })

  it('拖拽带 sourceId → 调源选择器的 reloadSid（旧 $refs.sourceSelect.reloadSid(this.sid)）', async () => {
    const w = mountPage()
    await flushPromises()
    // 首屏不调：旧 `created` 只是把 sid 交给组件自己 `loadData()`，reloadSid 只在路由变化时用
    expect(spies.reloadSid).not.toHaveBeenCalled()

    const route = routeState.route as unknown as { query: Record<string, string> }
    route.query.sourceId = '161725'
    await flushPromises()
    expect(spies.reloadSid).toHaveBeenCalledWith('161725')
    // reloadSid 内部 emit change → handleSourceChange → 回第 1 页重查
    expect(lastQuery()).toMatchObject({ sourceId: '161725', page: 1 })

    // sid 被清空：旧 `reloadSid` 直接 return（连候选都不动），改由页面自己补一次重查
    spies.rowQueryPaged.mockClear()
    delete route.query.sourceId
    await flushPromises()
    expect(spies.reloadSid).toHaveBeenCalledTimes(1)
    expect(lastQuery().sourceId).toBeUndefined()
    w.unmount()
  })
})
