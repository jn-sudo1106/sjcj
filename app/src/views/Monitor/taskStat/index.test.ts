// @vitest-environment jsdom
// 任务统计页（旧 page/inst/TaskStat.vue → Monitor/taskStat/index.vue）接线回归。
// 这一页最要紧的三件事：①请求编排（v2 双路 / v1 七路 / 单状态一路）；②「错误率 ≥」阈值筛选的视图切换；
// ③钻取到任务实例页时带的参数。其余是渲染层面的守门（指标卡数字、环图切片、整行标红、分页出现条件）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import TaskStatPage from './index.vue'
import StatePieChart from './StatePieChart.vue'
import TopBarChart from './TopBarChart.vue'
import { statColumns, emptyText } from './columns'
import { taskStat, type TaskStatRow } from '@/api/taskStat'
import { downloadCsv } from '@/utils/csv'

// Element Plus 的表格 / 环形进度内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

// 监控中心是单页签容器：钻取走 router.push（旧页是 $multiTab.open 开新标签）
const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push }),
}))

// 只替掉请求函数，类型与 buildStatParams 仍用真实实现
vi.mock('@/api/taskStat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/taskStat')>()
  return { ...actual, taskStat: vi.fn() }
})

// 导出（旧页 xlsx-style → 新平台前端 CSV，见页面文件头偏差 1）。只拦下载动作，csvCell 用真实实现
vi.mock('@/utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/csv')>()
  return { ...actual, downloadCsv: vi.fn() }
})

const statMock = vi.mocked(taskStat)

/** 总数视角（不带 state，行里没有 state 字段） */
const TOTAL: TaskStatRow[] = [
  { sourceId: '161725', cnt: 1000 },
  { sourceId: '161801', cnt: 60 },
  { sourceId: '161900', cnt: 30 },
]
/** 多状态视角（带 state；v2 后端形态）。E 合计 160，其中 161801 是全失败 → 错误率 100% */
const MULTI: TaskStatRow[] = [
  { sourceId: '161725', cnt: 720, state: 'C' },
  { sourceId: '161725', cnt: 100, state: 'E' },
  { sourceId: '161725', cnt: 180, state: 'AC' },
  { sourceId: '161801', cnt: 60, state: 'E' },
  { sourceId: '161900', cnt: 30, state: 'C' },
]

function fakeStat(query: Record<string, unknown>): TaskStatRow[] {
  const state = String(query.state ?? '')
  if (!state) return TOTAL
  if (state.includes(',')) return MULTI
  return MULTI.filter((r) => r.state === state)
}

const stubs = {
  // inheritAttrs:false —— 同 taskList/commJob 测试：对象 attrs 落到 stub 的 span 上会触发
  // jsdom 的 "Cannot convert object to primitive value"
  ElTooltip: { name: 'ElTooltip', inheritAttrs: false, template: '<span class="stub-tooltip"><slot /></span>' },
  ElPagination: {
    name: 'ElPagination',
    props: ['currentPage', 'pageSize', 'total'],
    emits: ['current-change', 'size-change'],
    template: '<div class="stub-pager" />',
  },
  ElDatePicker: {
    name: 'ElDatePicker',
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<div class="stub-date" />',
  },
  ElInputNumber: {
    name: 'ElInputNumber',
    props: ['modelValue'],
    emits: ['update:modelValue', 'change'],
    template: '<input class="stub-number" />',
  },
  ElDropdown: { name: 'ElDropdown', emits: ['command'], template: '<div class="stub-dropdown"><slot /><slot name="dropdown" /></div>' },
  ElDropdownMenu: { name: 'ElDropdownMenu', template: '<div class="stub-dropdown-menu"><slot /></div>' },
  ElDropdownItem: { name: 'ElDropdownItem', props: ['command'], template: '<div class="stub-dropdown-item"><slot /></div>' },
}

async function mountPage() {
  const wrapper = mount(TaskStatPage, { global: { plugins: [ElementPlus], stubs } })
  await flushPromises()
  await flushPromises()
  return wrapper
}
/** 只取真实数据行（ElTable 会另外渲染一份 hidden-columns 量宽树） */
const dataRows = (w: VueWrapper) => w.findAll('tr.el-table__row')
const btn = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().trim() === text)!
const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

beforeEach(() => {
  statMock.mockReset()
  statMock.mockImplementation(async (query) => fakeStat(query as Record<string, unknown>))
  push.mockReset()
  vi.mocked(downloadCsv).mockClear()
})

describe('taskStat · 请求编排', () => {
  it('首屏走 v2 探测：total 与多状态两路，日期默认当天、维度默认按来源', async () => {
    await mountPage()
    expect(statMock).toHaveBeenCalledTimes(2)
    const [first, second] = statMock.mock.calls
    expect(first[0]).toEqual({ group: 'source', date: today() })
    expect(second[0]).toEqual({ group: 'source', date: today(), state: 'E,C,AC,W1,W,L' })
    // 两路共用一个 AbortSignal（旧层是同一个 CancelToken）
    expect(first[1]).toBe(second[1])
  })

  it('探测到行里带 state → 记住 v2，之后的查询只发两路（不再多次探测）', async () => {
    const w = await mountPage()
    statMock.mockClear()
    btn(w, '查询').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(statMock).toHaveBeenCalledTimes(2)
    expect(statMock.mock.calls[1][0]).toMatchObject({ state: 'E,C,AC,W1,W,L' })
  })

  it('状态过滤时只有一路请求（ERROR 双重视角不适用）', async () => {
    const w = await mountPage()
    statMock.mockClear()
    // 第 3 个 ElSelect 是「状态过滤」（前两个是快捷时间、分组维度）
    const selects = w.findAllComponents({ name: 'ElSelect' })
    selects[2].vm.$emit('update:modelValue', 'E')
    selects[2].vm.$emit('change', 'E')
    await flushPromises()
    await flushPromises()
    expect(statMock).toHaveBeenCalledTimes(1)
    expect(statMock.mock.calls[0][0]).toMatchObject({ group: 'source', date: today(), state: 'E' })
  })

  it('改分组维度会重新请求：v2 两路都带上新维度（total 无 state，多状态带 state）', async () => {
    const w = await mountPage()
    statMock.mockClear()
    const group = w.findAllComponents({ name: 'ElSelect' })[1]
    group.vm.$emit('update:modelValue', 'both')
    group.vm.$emit('change', 'both')
    await flushPromises()
    await flushPromises()
    expect(statMock).toHaveBeenCalledTimes(2)
    expect(statMock.mock.calls[0][0]).toMatchObject({ group: 'both' })
    expect(statMock.mock.calls[1][0]).toMatchObject({ group: 'both', state: 'E,C,AC,W1,W,L' })
  })
})

describe('taskStat · 概览与图表', () => {
  it('四张指标卡的数字与口径文案（不限状态时）', async () => {
    const w = await mountPage()
    const text = w.text()
    expect(text).toContain('任务总数')
    expect(text).toContain((1090).toLocaleString())
    expect(text).toContain('ERROR 任务数')
    expect(text).toContain((160).toLocaleString())
    expect(text).toContain('14.68%')
    expect(text).toContain('涉及分组数')
    expect(text).toContain('按来源 · TOP1 源#161725')
    expect(text).toContain('含全部状态')
    // 状态过滤时的两张卡不该出现
    expect(text).not.toContain('最大分组任务数')
  })

  it('告警条按错误率 ≥ 100%（未设阈值时的默认）列出分组，chip 文案为「源#id · E/总」', async () => {
    const w = await mountPage()
    const bar = w.find('.ts-danger-bar')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toContain('错误率 ≥ 100% 分组（1 个）')
    expect(bar.text()).toContain('源#161801 · 60/60')
  })

  it('环图切片 = 关键状态 + 其他（其他取自总数与关键状态之和的差），两张柱图各取 TOP10', async () => {
    const w = await mountPage()
    const slices = w.findComponent(StatePieChart).props('slices') as { label: string; value: number }[]
    // 关键状态之和 750+180+160 = 1090 = 总数 → 「其他」为 0；旧页 filter(value>0) 会把它丢掉
    expect(slices.map((s) => s.label)).toEqual(['C COMPLETE', 'AC 自动完成', 'E ERROR'])
    expect(slices.map((s) => s.value)).toEqual([750, 180, 160])
    const bars = w.findAllComponents(TopBarChart)
    expect(bars).toHaveLength(2)
    expect(bars[0].props('items')).toEqual([
      { label: '源#161725', value: 1000 },
      { label: '源#161801', value: 60 },
      { label: '源#161900', value: 30 },
    ])
    // ERROR 分布只含有 ERROR 的分组，按 ERROR 数降序
    expect(bars[1].props('items')).toEqual([
      { label: '源#161725', value: 100 },
      { label: '源#161801', value: 60 },
    ])
  })
})

describe('taskStat · 卡片加载态用骨架屏（明细表保持 v-loading）', () => {
  it('统计返回前：4 张指标卡 + 3 张图表卡显示 el-skeleton，返回后换成真实内容', async () => {
    // 首屏两路请求（total + 多状态探测）都挂起，观察加载态
    const release: Array<() => void> = []
    statMock.mockImplementation(
      (q) =>
        new Promise<TaskStatRow[]>((resolve) => {
          release.push(() => resolve(fakeStat(q as Record<string, unknown>)))
        }),
    )
    const w = mount(TaskStatPage, { global: { plugins: [ElementPlus], stubs } })
    await flushPromises()

    expect(release).toHaveLength(2)
    // 卡片是骨架屏（带流光动画的 el-skeleton）
    expect(w.findAll('.ts-metric-card .el-skeleton.is-animated')).toHaveLength(4)
    expect(w.findAll('.ts-chart-card .el-skeleton.is-animated')).toHaveLength(3)
    expect(w.findAll('.ts-metric-card .el-skeleton__item').length).toBeGreaterThan(0)
    // 骨架在时真实内容不渲染（不是「遮罩盖住」的旧做法）
    expect(w.findAll('.ts-metric-card .ts-metric')).toHaveLength(0)
    expect(w.findAll('.ts-chart-card .sp-svg, .ts-chart-card .bc-svg')).toHaveLength(0)
    // 图表卡的表头保留可见，只有 body 是骨架
    expect(w.findAll('.ts-chart-card .ts-card-title')).toHaveLength(3)
    // 明细表不动：仍是 v-loading 遮罩，卡片区没有把表格也包进骨架
    expect(w.find('.ts-table .el-loading-mask').exists()).toBe(true)
    expect(w.find('.ts-detail-card .el-skeleton').exists()).toBe(false)

    // 放行全部请求 → 骨架消失、真实内容出现
    statMock.mockImplementation(async (q) => fakeStat(q as Record<string, unknown>))
    release.forEach((fn) => fn())
    await flushPromises()
    await flushPromises()
    expect(w.findAll('.el-skeleton.is-animated')).toHaveLength(0)
    expect(w.findAll('.ts-metric-card .ts-metric')).toHaveLength(4)
    expect(w.findAll('.ts-chart-card .el-skeleton__item')).toHaveLength(0)
  })
})

describe('taskStat · 明细表', () => {
  it('三行明细；错误率 100% 的行整行标红；「错误明细」只在该行有 ERROR 时出现', async () => {
    const w = await mountPage()
    expect(dataRows(w)).toHaveLength(3)
    expect(w.findAll('tr.row-danger')).toHaveLength(1)
    expect(w.find('tr.row-danger').text()).toContain('161801')
    // 161725(E=100/总1000=10%) 与 161801(E=60/总60=100%) 两行都有 ERROR → 两个「错误明细」
    expect(w.findAll('.ts-op-error')).toHaveLength(2)
    // 「任务明细」每行都有 → 3 个
    expect(w.findAll('.ts-op-link').filter((l) => l.text() === '任务明细')).toHaveLength(3)
  })

  it('点行 = 打开「任务明细」，带 sourceId/configId 跳任务实例页', async () => {
    const w = await mountPage()
    await dataRows(w)[1].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/monitor', query: { tab: 'taskList', sourceId: '161801' } })
  })

  it('「错误明细」额外带上 state=E（与旧页 handleDrill(record, true) 一致）', async () => {
    const w = await mountPage()
    // 行序 = cnt 降序：161725(1000) 在前，161801(60) 在后；点后者的「错误明细」
    await dataRows(w)[1].find('.ts-op-error').trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/monitor', query: { tab: 'taskList', sourceId: '161801', state: 'E' } })
  })

  it('≤10 行不出现分页器；>10 行出现，且排序作用在**全量**数据上（不是当页）', async () => {
    const small = await mountPage()
    expect(small.findComponent({ name: 'ElPagination' }).exists()).toBe(false)

    const many: TaskStatRow[] = Array.from({ length: 12 }, (_, i) => ({ sourceId: `s${i + 1}`, cnt: (i + 1) * 10 }))
    statMock.mockImplementation(async (query) =>
      (query as Record<string, unknown>).state ? [] : many,
    )
    const w = await mountPage()
    const pager = w.findComponent({ name: 'ElPagination' })
    expect(pager.exists()).toBe(true)
    expect(pager.props('total')).toBe(12)
    // 默认顺序就是 mergeRows 的顺序（cnt 降序）→ 首行是 s12
    expect(dataRows(w)[0].text()).toContain((120).toLocaleString())
    // 点「任务数」升序：12 行里最小的 s1(cnt=10) 应在第一页第一行 → 证明是先全量排序再分页
    w.findComponent({ name: 'ElTable' }).vm.$emit('sort-change', { prop: 'cnt', order: 'ascending' })
    await flushPromises()
    expect(dataRows(w)[0].text()).toContain('s1')
  })
})

describe('taskStat · 错误率阈值筛选', () => {
  it('点预设 100% → 只留重点关注分组、显示筛出数、导出变成「全部/当前视图」下拉', async () => {
    const w = await mountPage()
    expect(w.find('.stub-dropdown').exists()).toBe(false)
    await btn(w, '100%').trigger('click')
    await flushPromises()
    expect(dataRows(w)).toHaveLength(1)
    expect(w.text()).toContain('筛出 1 个')
    expect(w.find('.ts-count').text()).toBe('1/3')

    const dropdown = w.find('.stub-dropdown')
    expect(dropdown.exists()).toBe(true)
    const items = w.findAll('.stub-dropdown-item').map((i) => i.text())
    expect(items).toEqual(['导出全部（3 行）', '导出当前视图（1 行）'])
  })

  it('再次点同一个预设 = 清除筛选（旧页 onRatePreset 的开关语义）', async () => {
    const w = await mountPage()
    await btn(w, '100%').trigger('click')
    await flushPromises()
    await btn(w, '100%').trigger('click')
    await flushPromises()
    expect(dataRows(w)).toHaveLength(3)
    expect(w.find('.stub-dropdown').exists()).toBe(false)
  })

  it('自定义阈值输入被夹到 1~100（旧页 onRateInput）', async () => {
    const w = await mountPage()
    const input = w.findComponent({ name: 'ElInputNumber' })
    input.vm.$emit('change', 150)
    await flushPromises()
    expect(w.text()).toContain('错误率 ≥')
    expect(w.text()).toContain('筛出 1 个')
    input.vm.$emit('change', 0)
    await flushPromises()
    // 0 被夹到 1：三条里两条有 ERROR（10% / 100%）都 ≥1%
    expect(w.text()).toContain('筛出 2 个')
  })

  it('告警卡的「错误率≥N%分组 X 个 →」与告警条的「在明细表中查看全部」都开启筛选', async () => {
    const w = await mountPage()
    expect(w.find('.ts-danger-link').exists()).toBe(true)
    await w.find('.ts-danger-link').trigger('click')
    await flushPromises()
    expect(dataRows(w)).toHaveLength(1)
  })
})

describe('taskStat · 状态过滤（ERROR 双重视角不适用）', () => {
  async function filterState(w: VueWrapper, state: string) {
    const selects = w.findAllComponents({ name: 'ElSelect' })
    selects[2].vm.$emit('update:modelValue', state)
    selects[2].vm.$emit('change', state)
    await flushPromises()
    await flushPromises()
  }

  it('出现黄条提示、去掉两张图表、指标卡换成「涉及分组数/最大分组任务数」', async () => {
    const w = await mountPage()
    await filterState(w, 'E')
    expect(w.find('.el-alert--warning').exists()).toBe(true)
    expect(w.text()).toContain('当前已按状态「E」过滤')
    expect(w.findComponent(StatePieChart).exists()).toBe(false)
    // 只剩「总任务分布」一张柱图
    expect(w.findAllComponents(TopBarChart)).toHaveLength(1)
    expect(w.text()).toContain('最大分组任务数')
    expect(w.text()).toContain('仅状态 E')
    // 告警条与「错误率 ≥」筛选都不适用
    expect(w.find('.ts-danger-bar').exists()).toBe(false)
    expect(w.find('.ts-rate').exists()).toBe(false)
  })

  it('明细表去掉「ERROR数 / 错误率」两列、操作列只剩「任务明细」', async () => {
    const w = await mountPage()
    await filterState(w, 'E')
    const headers = w.findAll('th.el-table__cell').map((th) => th.text())
    expect(headers).not.toContain('ERROR数')
    expect(headers).not.toContain('错误率')
    expect(headers).toContain('任务数')
    expect(w.findAll('.ts-op-error')).toHaveLength(0)
    // 单状态：161725(E=100) 与 161801(E=60) 两组
    expect(dataRows(w)).toHaveLength(2)
  })

  it('钻取时把当前状态一并带过去（旧页 handleDrill 的 else 分支）', async () => {
    const w = await mountPage()
    await filterState(w, 'E')
    await dataRows(w)[0].trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/monitor', query: { tab: 'taskList', sourceId: '161725', state: 'E' } })
  })
})

describe('taskStat · 导出（旧页 xlsx-style → 新平台前端 CSV，见页面文件头偏差 1）', () => {
  /** 取最后一次下载的 [文件名, 内容] */
  const lastDownload = () => vi.mocked(downloadCsv).mock.calls.at(-1)!

  it('无筛选时是普通按钮：抬头 4 行 + 表头 + 3 行明细，文件名带维度/日期/时刻', async () => {
    const w = await mountPage()
    await btn(w, '导出Excel').trigger('click')
    await flushPromises()
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [name, content] = lastDownload()
    expect(name).toMatch(/^任务统计_source_\d{8}_\d{6}$/)
    // 旧 exportExcel 的 4 行说明在最上方（toCsv 只支持单行表头，故自拼抬头）
    expect(content).toContain('按来源 任务统计')
    expect(content).toContain('（全部状态）')
    expect(content).toContain('口径: 按任务创建时间(CREATE_DT)统计')
    // 表头带 ERROR 两列（未按状态过滤）
    expect(content).toContain('排名,来源ID,配置ID,任务数,任务占比(%),ERROR数,错误率(%)')
    // 3 行明细，排名从 1 开始
    expect(content).toContain('1,161725,,1000,91.74,100,10')
    expect(content).toContain('3,161900,,30,2.75,0,0')
    // 带 BOM，Excel 打开中文不乱码
    expect(content.startsWith('\uFEFF')).toBe(true)
  })

  it('阈值筛选下变成下拉：command=all 用全量 rows 并在抬头标注筛出数；command=current 用筛选后的行', async () => {
    const w = await mountPage()
    await btn(w, '100%').trigger('click')
    await flushPromises()

    w.findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'all')
    await flushPromises()
    let [, content] = lastDownload()
    expect(content).toContain('（全部状态，错误率≥100%分组 1 个）')
    expect(content).toContain('3,161900') // 全量 3 行

    w.findComponent({ name: 'ElDropdown' }).vm.$emit('command', 'current')
    await flushPromises()
    ;[, content] = lastDownload()
    expect(content).toContain('（仅错误率≥100%分组 1 个）')
    expect(content).not.toContain('3,161900') // 只导出 161801 那 1 行
  })
})

describe('taskStat · 列定义与空态文案（旧页 columns / tableLocale）', () => {
  it('状态过滤时少两列，开启阈值筛选时错误率列默认降序', () => {
    expect(statColumns(false, false).map((c) => c.title)).toEqual([
      '#', '来源ID', '配置ID', '任务数', '任务占比', 'ERROR数', '错误率', '操作',
    ])
    expect(statColumns(true, false).map((c) => c.title)).toEqual(['#', '来源ID', '配置ID', '任务数', '任务占比', '操作'])
    expect(statColumns(false, true).find((c) => c.prop === 'errorRate')!.defaultDesc).toBe(true)
    expect(statColumns(false, false).find((c) => c.prop === 'errorRate')!.defaultDesc).toBe(false)
    // 旧页「任务占比」列比的是 cnt
    const rate = statColumns(false, false).find((c) => c.prop === 'rate')!
    expect(rate.sortMethod!({ cnt: 1, errorCnt: 0, errorRate: 0 } as never, { cnt: 2, errorCnt: 0, errorRate: 9 } as never)).toBe(-1)
  })

  it('列宽一律用 min-width（旧页 antd 的 width 语义）：全列参与分配，表格才会撑满容器', () => {
    // el-table 只在「存在没有数字 width 的列」时才把容器剩余宽度分出去（table-layout 的 flexColumns）。
    // 若这里退回 width，表格宽度会被定成各列之和，容器再宽右侧也留白（空数据时最明显）。
    const all = statColumns(false, false)
    expect(all.every((c) => typeof c.minWidth === 'number' && c.minWidth > 0)).toBe(true)
    expect(all.every((c) => !('width' in c))).toBe(true)
    // 数值沿用旧页原样（60+110+110+130+190+110+190+150）
    expect(all.reduce((s, c) => s + c.minWidth, 0)).toBe(1050)
    // 状态过滤时少「ERROR数 110 / 错误率 190」两列
    expect(statColumns(true, false).reduce((s, c) => s + c.minWidth, 0)).toBe(750)
  })

  it('空态文案区分「阈值筛选下没有命中」与「当前条件无数据」', () => {
    expect(emptyText(true, 80)).toBe('当前条件下没有错误率 ≥ 80% 的分组，可调整阈值或清除筛选查看全部')
    expect(emptyText(false, 100)).toBe('当前条件下暂无统计数据，可调整时间范围或过滤条件')
  })
})

describe('taskStat · 进度条百分比收口（el-progress 的 percentage 只接受 0~100 的有限数值）', () => {
  // 线上现象：控制台刷 `Invalid prop: custom validator check failed for prop "percentage"`。
  // 成因是后端两路聚合（总数 vs ERROR/多状态）口径不一致：ERROR 数可能大于任务数（错误率 >100），
  // 甚至 cnt 给了非数字串（errorCnt 变 NaN → 错误率 NaN），这些值直接喂给 <el-progress> 就会越界。
  it('ERROR 数大于任务数 / ERROR 路 cnt 非数字时，不触发 percentage 警告且进度条值夹在 0~100', async () => {
    statMock.mockImplementation(async (query) => {
      const state = String((query as Record<string, unknown>).state ?? '')
      if (!state) {
        return [
          { sourceId: '161725', cnt: 10 },
          { sourceId: '161801', cnt: 20 },
        ]
      }
      return [
        { sourceId: '161725', cnt: 25, state: 'E' },
        { sourceId: '161801', cnt: 'null' as unknown as number, state: 'E' },
      ]
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const w = await mountPage()
    const messages = warn.mock.calls.map((c) => String(c[0] ?? ''))
    warn.mockRestore()

    expect(messages.filter((m) => m.includes('percentage'))).toEqual([])
    // 页面上所有进度条（指标卡环图 + 任务占比 + 错误率）都是有限且落在 0~100 的值
    const percentages = w.findAllComponents({ name: 'ElProgress' }).map((p) => p.props('percentage') as number)
    expect(percentages.length).toBeGreaterThan(0)
    percentages.forEach((v) => {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    })
    // 口径不一致是后端问题，展示文案仍如实反映（不把 250% 悄悄写成 100%）
    expect(w.text()).toContain('250%')
  })
})

