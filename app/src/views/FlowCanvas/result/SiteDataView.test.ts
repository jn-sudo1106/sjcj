// @vitest-environment jsdom
// 组件层接线测试：归并算法本身的正确性已经在 siteDataMerge.test.ts 里独立、彻底地测过，
// buildSourceSeed/buildHorizontalLayout 等纯函数本身的正确性在 stores/flow.test.ts 里测过。
// 这里验证 SiteDataView 有没有正确接线：全部源（选表触发查询、源收窄、筛选透传、加载更多、
// 部分源失败提示、空态）、具体源（本地加载流程、节点选择、请求竞态、纯查看——不提供节点手动
// 执行、不展示输入/输出切换）、以及两种状态切换时是不是"同一套"查询视图——同一套分页（加载
// 更多，不是具体源单独一套总数/上一页下一页）、同一套筛选行位置，只是可编辑字段不同。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteDataView from './SiteDataView.vue'
import { dataApi, flowApi, siteApi, sourceApi } from '@/api'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'
import type { DataRow, DataTableMeta, Source } from '@/api'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

function source(id: string): Source {
  return { sourceId: id, name: `源-${id}`, url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}
function row(sourceId: string, dataId: string): DataRow {
  return { dataId, sourceId, title: `${sourceId}-${dataId}`, summary: '', acceptState: 'pending' }
}
function cfg(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return { title: '', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], ...overrides }
}
const meta: DataTableMeta = { tableId: 't1', tableName: 'T1', rowCount: 0, fields: [{ prop: 'title', type: 'string', desc: '标题' }] }

const stubs = {
  SiteTableSelect: { name: 'SiteTableSelect', template: '<div />', emits: ['update:modelValue'] },
  SiteSourceSelect: { name: 'SiteSourceSelect', template: '<div />', emits: ['update:modelValue'] },
  ElDrawer: true,
}

function mountView(siteId = 'site-a') {
  return mount(SiteDataView, { props: { siteId }, global: { stubs } })
}

async function pickTable(wrapper: ReturnType<typeof mount>, tableId = 't1') {
  const select = wrapper.findComponent({ name: 'SiteTableSelect' })
  await select.vm.$emit('update:modelValue', tableId)
  await flushPromises()
}
async function pickSource(wrapper: ReturnType<typeof mount>, sourceId: string) {
  const select = wrapper.findComponent({ name: 'SiteSourceSelect' })
  await select.vm.$emit('update:modelValue', sourceId)
  await flushPromises()
}
// 节点选择用跟"选表"一样的纯下拉：先点输入框展开，再点目标节点选项——不是流程画布的
// 节点链路图（那个太"流程图"了，用户明确要求换成纯下拉，见 2026-08-14 第三次纠偏）。
async function selectNode(wrapper: ReturnType<typeof mount>, nodeId: string) {
  await wrapper.get('[data-testid="source-node-select-input"]').trigger('focus')
  await wrapper.get(`[data-node-id="${nodeId}"]`).trigger('mousedown')
  await flushPromises()
}

// 跟 ResultView.test.ts 的 loadExecFixture 同一套设计：first(输出 T1，首节点) → mid(输入
// T1，输出 T2) → last(输入 T2，唯一消费者)；mid2 单独把输入也设成 T1，跟 mid 撞车制造歧义。
// 具体源分支这里不测执行（已经不提供手动执行入口，见 2026-08-14 第四次纠偏），
// 这套多节点骨架主要用来测节点切换、请求竞态。
function mockFlowFixture(sourceId = '391007768') {
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(mockSourceDetail({ sourceId })!)
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
  vi.spyOn(flowApi, 'flowLoad').mockResolvedValue({
    id: sourceId, name: 'f', version: 'v1', updatedAt: '',
    main: ['start', 'first', 'mid', 'mid2', 'last', 'end'],
    branches: [],
    configs: {
      first: cfg({ title: '抓取列表页', outputTable: 'T1' }),
      mid: cfg({ title: '处理A', inputTable: 'T1', outputTable: 'T2' }),
      mid2: cfg({ title: '处理B', inputTable: 'T1', outputTable: 'T3' }),
      last: cfg({ title: '入库', inputTable: 'T2' }),
    },
  })
}

describe('SiteDataView · 全部源（表筛选）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('未选表时提示先选表，不发起任何查询', async () => {
    const distinctSource = vi.spyOn(dataApi, 'distinctSource')
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('请先选择一张表')
    expect(distinctSource).not.toHaveBeenCalled()
  })

  it('选表后收窄源集合（siteSources ∩ distinctSource），并查询到数据', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a'), source('b'), source('c')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a', 'b', 'not-in-site'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => ({
      total: 0, list: sourceId === 'a' ? [row('a', '10')] : [row('b', '20')],
    }))

    const wrapper = mountView()
    await pickTable(wrapper)

    // 只应该查 a 和 b（c 被 distinctSource 排除，not-in-site 不属于本网站）
    const queried = new Set(rowQueryPaged.mock.calls.map((call) => call[0].sourceId))
    expect(queried).toEqual(new Set(['a', 'b']))
    expect(wrapper.text()).toContain('已加载 2 条')
  })

  it('查 distinctSource 时要传大 size 取全量，不能用默认分页 20（真实 bug：全平台共用表的引用源数一旦超过 20，本网站的源可能不在默认返回范围内，交集算出来会是空的）', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    const distinctSource = vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('a', '1')] })

    const wrapper = mountView()
    await pickTable(wrapper)

    expect(distinctSource).toHaveBeenCalledWith(expect.objectContaining({ size: 1000 }))
  })

  it('distinctSource 收窄失败时退回网站全部源，不整体不可用', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockRejectedValue(new Error('boom'))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('a', '1')] })

    const wrapper = mountView()
    await pickTable(wrapper)

    expect(rowQueryPaged).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'a' }))
    expect(wrapper.text()).toContain('已加载 1 条')
  })

  it('distinctSource 返回空集合时也退回网站全部源，继续真实查询', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('a', '1')] })

    const wrapper = mountView()
    await pickTable(wrapper)

    expect(rowQueryPaged).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'a' }))
    expect(wrapper.text()).toContain('已加载 1 条')
    expect(wrapper.text()).not.toContain('没有可查询的源')
  })

  it('查询条件原样透传给每个源', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.get('input[placeholder="数据 ID"]').setValue('123')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()

    expect(rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ dataId: '123', sourceId: 'a' }))
  })

  it('点击加载更多会继续归并查询，不重复已展示的行', async () => {
    // 每页需要返回满 size 条，否则归并算法会把这一页判定为该源已取完（exhausted），
    // "加载更多"按钮就会被替换成"已加载全部数据"，测不到第二次加载。
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ page, size }) => ({
      total: 0, list: Array.from({ length: size ?? 20 }, (_, i) => row('a', String(1000 * Number(page) - i))),
    }))

    const wrapper = mountView()
    await pickTable(wrapper)
    expect(wrapper.text()).toContain('已加载 20 条')

    await wrapper.get('[data-testid="site-data-load-more"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已加载 40 条')
  })

  it('部分源查询失败时显示提示，不影响已成功源的数据展示', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('ok'), source('bad')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['ok', 'bad'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => {
      if (sourceId === 'bad') throw new Error('boom')
      return { total: 0, list: [row('ok', '1')] }
    })

    const wrapper = mountView()
    await pickTable(wrapper)

    expect(wrapper.find('[data-testid="site-data-partial-fail"]').text()).toContain('源-bad（bad）：boom')
    expect(wrapper.text()).toContain('已加载 1 条')
  })

  it('网站全部源查询并发最多为 4，避免大量源同时占满请求', async () => {
    const sources = ['a', 'b', 'c', 'd', 'e'].map(source)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue(sources)
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(sources.map((item) => item.sourceId))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    let active = 0
    let maxActive = 0
    vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 0))
      active -= 1
      return { total: 0, list: [row(String(sourceId), '1')] }
    })

    const wrapper = mountView()
    await pickTable(wrapper)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushPromises()

    expect(maxActive).toBeLessThanOrEqual(4)
    expect(wrapper.text()).toContain('已加载 5 条')
  })

  it('切换网站时清空已选的表', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('a', '1')] })

    const wrapper = mountView('site-a')
    await pickTable(wrapper)
    expect(wrapper.text()).toContain('已加载 1 条')

    await wrapper.setProps({ siteId: 'site-b' })
    await flushPromises()

    expect(wrapper.text()).toContain('请先选择一张表')
  })
})

describe('SiteDataView · 全部源 ⇔ 具体源切换（方案 §6.5：任何时刻只展示表筛选或节点筛选中的一种，且是同一个组件、同一套分页——不是跳到另一个独立组件）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('选中具体源后，表选择器消失、换成节点下拉，不跳转离开', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push('/canvas?siteId=site-a&view=data')
    const siteSources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a'), source('b')])
    const distinctSource = vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a', 'b'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => ({
      total: 0, list: [row(String(sourceId), '1')],
    }))
    mockFlowFixture('391007768')

    const wrapper = mount(SiteDataView, {
      props: { siteId: 'site-a' },
      global: { plugins: [router], stubs },
    })
    await pickTable(wrapper)
    expect(rowQueryPaged.mock.calls.map((c) => c[0].sourceId)).toEqual(expect.arrayContaining(['a', 'b']))
    siteSources.mockClear()
    distinctSource.mockClear()
    rowQueryPaged.mockClear()

    await pickSource(wrapper, '391007768')

    // 还在同一个组件、同一个路由上——没有发生任何导航
    expect(router.currentRoute.value.fullPath).toBe('/canvas?siteId=site-a&view=data')
    // 表选择器不见了，换成节点下拉；具体源分支自己走 sourceApi/flowApi，
    // 不该再碰全部源分支的 siteSources/distinctSource
    expect(wrapper.findComponent({ name: 'SiteTableSelect' }).exists()).toBe(false)
    expect(wrapper.find('[data-testid="source-node-select-input"]').exists()).toBe(true)
    expect(siteSources).not.toHaveBeenCalled()
    expect(distinctSource).not.toHaveBeenCalled()
  })

  it('从具体源清空回全部源时，表选择器重新出现且已清空（方案 §6.5 规则 3：不带着上一个状态的表选择过去，强制重新选表）', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a'), source('b')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a', 'b'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => ({
      total: 0, list: [row(String(sourceId), '1')],
    }))
    mockFlowFixture('391007768')

    const wrapper = mountView()
    await pickTable(wrapper)
    expect(wrapper.text()).not.toContain('请先选择一张表')

    await pickSource(wrapper, '391007768')
    expect(wrapper.findComponent({ name: 'SiteTableSelect' }).exists()).toBe(false)

    await pickSource(wrapper, '')

    expect(wrapper.find('[data-testid="source-node-select-input"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'SiteTableSelect' }).exists()).toBe(true)
    expect(wrapper.text()).toContain('请先选择一张表')
  })

  it('具体源模式复用同一套"加载更多"分页，不是单独的总数/上一页下一页', async () => {
    mockFlowFixture('391007768')
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    // 满一页（size=20）才不会被归并算法判成该源已取完，"加载更多"按钮才会留着。
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 0, list: Array.from({ length: 20 }, (_, i) => row('391007768', String(i))),
    })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')

    expect(wrapper.find('[data-testid="site-data-load-more"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('上一页')
    expect(wrapper.text()).not.toContain('下一页')
    expect(wrapper.text()).toContain('已加载 20 条')
  })
})

describe('SiteDataView · 具体源（节点筛选，纯查看——2026-08-14 第四次纠偏：不提供手动执行、不展示输入/输出切换，避免跟具体源自己的流程结果视图混淆）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('源不存在时展示错误，不渲染节点下拉', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(null)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    vi.spyOn(flowApi, 'flowLoad').mockResolvedValue(null)

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')

    expect(wrapper.text()).toContain('源不存在或加载失败')
    expect(wrapper.find('[data-testid="source-node-select-input"]').exists()).toBe(false)
  })

  it('没有已保存流程时，按步骤用 buildSourceSeed 拼默认骨架并展示节点', async () => {
    const current = mockSourceDetail({ sourceId: '391007768' })!
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(current)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(flowApi, 'flowLoad').mockResolvedValue(null)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')

    // 默认选中末端节点：详情解析（buildSourceSeed 按步骤拼出的最后一个真实节点）——
    // 纯查看态没有节点摘要行了，选中的节点名只显示在下拉输入框的 placeholder 里。
    expect(wrapper.get('[data-testid="source-node-select-input"]').attributes('placeholder')).toBe('详情解析')
  })

  it('有已保存流程（flowLoad 返回非空）时优先用它，不再用 buildSourceSeed 拼骨架', async () => {
    const current = mockSourceDetail({ sourceId: '391007768' })!
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(current)
    const sourceSteps = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(flowApi, 'flowLoad').mockResolvedValue({
      id: current.sourceId, name: '自定义流程', version: 'v1', updatedAt: '',
      main: ['start', 'custom-node', 'end'],
      branches: [],
      configs: { 'custom-node': { title: '自定义节点', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], outputTable: 'CUSTOM_TB' } },
    })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')

    expect(wrapper.get('[data-testid="source-node-select-input"]').attributes('placeholder')).toBe('自定义节点')
    // sourceSteps 依然会拉（并行请求的一部分），但结果被 persistedDef 盖过，不影响展示
    expect(sourceSteps).toHaveBeenCalled()
  })

  it('决策/分头等结构节点选中后展示只读空态，不查询数据', async () => {
    const current = mockSourceDetail({ sourceId: '391007768' })!
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(current)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(flowApi, 'flowLoad').mockResolvedValue({
      id: current.sourceId, name: 'f', version: 'v1', updatedAt: '',
      main: ['start', 'decision-1', 'end'],
      branches: [],
      configs: { 'decision-1': { title: '决策分支', sub: '', status: '', planned: false, kind: 'decision', base: [], fields: [], inmap: [], params: [], output: [] } },
    })
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged')

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')

    expect(wrapper.find('[data-testid="source-node-empty"]').exists()).toBe(true)
    expect(rowQueryPaged).not.toHaveBeenCalled()
  })

  it('纯查看：不展示输入/输出切换、不提供手动执行按钮', async () => {
    mockFlowFixture('391007768')
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')
    await selectNode(wrapper, 'mid') // mid 有输入 T1 也有输出 T2，两侧都在也不该有切换按钮

    expect(wrapper.find('[data-testid="source-node-scope-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="source-node-scope-output"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="source-node-exec-btn"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('发起抓取')
    expect(wrapper.text()).not.toContain('发后续任务')
  })

  it('DataGrid「所属源」列在具体源下改叫「所属节点」，且不展示操作列（避免跟具体源自己的数据视图混淆）', async () => {
    mockFlowFixture('391007768')
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('391007768', 'd1')] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')
    await selectNode(wrapper, 'last')

    const grid = wrapper.findComponent({ name: 'DataGrid' })
    expect(grid.text()).toContain('所属节点')
    expect(grid.text()).not.toContain('所属源')
    expect(grid.text()).not.toContain('操作')
  })

  it('请求竞态保护：快速切节点时，只有最后一次请求的结果生效，过期响应到达也不覆盖当前展示', async () => {
    const current = mockSourceDetail({ sourceId: '391007768' })!
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(current)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(flowApi, 'flowLoad').mockResolvedValue(null)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    // 按调用顺序区分：请求 #1（初始挂载默认节点）立即返回，#2（切到首节点）卡住，
    // #3（切回末端节点）立即返回——验证 #2 迟到时不会覆盖 #3 已经展示的结果。
    let resolveStale: (() => void) | undefined
    let requestCount = 0
    vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async () => {
      requestCount += 1
      if (requestCount === 2) {
        await new Promise<void>((resolve) => { resolveStale = resolve })
        return { total: 1, list: [row('391007768', 'stale')] }
      }
      return { total: 1, list: [row('391007768', 'fresh')] }
    })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768') // 请求 #1：初始挂载默认选中末端节点，立即返回 fresh

    await selectNode(wrapper, '391007768-s1') // 请求 #2：切到首节点，卡住
    await selectNode(wrapper, '391007768-s2') // 请求 #3：切回末端节点，立即返回

    const grid = () => wrapper.findComponent({ name: 'DataGrid' })
    expect(grid().props('rows')?.[0]?.dataId).toBe('fresh')

    resolveStale?.()
    await flushPromises()

    // 过期的请求 #2 响应到达了，但请求竞态保护应该已经丢弃它
    expect(grid().props('rows')?.[0]?.dataId).toBe('fresh')
  })
})
