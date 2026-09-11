// @vitest-environment jsdom
// 组件层接线测试：归并算法本身的正确性已经在 siteDataMerge.test.ts 里独立、彻底地测过，
// buildSourceSeed/buildHorizontalLayout 等纯函数本身的正确性在 stores/flow.test.ts 里测过。
// 这里验证 SiteDataView 有没有正确接线：全部源（选表触发查询、源收窄、筛选透传、加载更多、
// 部分源失败提示、空态）、具体源（本地加载流程、节点选择、请求竞态、纯查看——不提供节点手动
// 执行、不展示输入/输出切换）、以及两种状态切换时是不是"同一套"查询视图——同一套分页（加载
// 更多，不是具体源单独一套总数/上一页下一页）、同一套筛选行位置，只是可编辑字段不同。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspaceStore } from '@/stores/workspace'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteDataView from './SiteDataView.vue'
import DataGrid from './DataGrid.vue'
import { readSqlConditions } from '@/utils/sqlConditionHistory'
import { dataApi, siteApi, sourceApi } from '@/api'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'
import type { DataRow, DataTableMeta, Source, Step } from '@/api'

function source(id: string): Source {
  return { sourceId: id, name: `源-${id}`, url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}
function row(sourceId: string, dataId: string): DataRow {
  return { dataId, sourceId, title: `${sourceId}-${dataId}`, summary: '', acceptState: 'pending' }
}
const meta: DataTableMeta = { tableId: 't1', tableName: 'T1', rowCount: 0, fields: [{ prop: 'title', type: 'string', desc: '标题' }] }

const stubs = {
  SiteTableSelect: { name: 'SiteTableSelect', template: '<div />', emits: ['update:modelValue'] },
  SiteSourceSelect: { name: 'SiteSourceSelect', template: '<div />', emits: ['update:modelValue'] },
  TaskInstDialog: { name: 'TaskInstDialog', props: ['modelValue', 'sourceId', 'parentId', 'canWrite'], template: '<div />' },
  ElDrawer: true,
  ElDialog: { name: 'ElDialog', props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  SummaryDrawer: true,
  // 「按条件查源」旁边的 ⋯ 下拉（0909）：默认桩不渲染插槽，菜单项断言不到
  ElDropdown: { name: 'ElDropdown', template: '<div><slot /><slot name="dropdown" /></div>' },
  ElDropdownMenu: { name: 'ElDropdownMenu', template: '<div><slot /></div>' },
  ElDropdownItem: { name: 'ElDropdownItem', props: ['disabled', 'divided'], template: '<div class="el-dropdown-item"><slot /></div>' },
}

function mountView(siteId = 'site-a') {
  // 反查命中源写进 workspace store 供侧栏消费（0909），组件里用了 useWorkspaceStore
  setActivePinia(createPinia())
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
// 节点选择走流程图 ProcessNodeRail，与具体源结果视图同构（0819 N1-3；此前的"纯下拉"
// 决定已被 0819 会议 04:47"给我加个流程图"推翻）。这里是 mount 不是 shallowMount，
// 轨道真实渲染，直接点节点按钮即可。
async function selectNode(wrapper: ReturnType<typeof mount>, nodeId: string) {
  await wrapper.get(`[data-node-id="${nodeId}"]`).trigger('click')
  await flushPromises()
}

// 跟 ResultView.test.ts 的 loadExecFixture 同一套设计：first(输出 T1，首节点) → mid(输入
// T1，输出 T2) → last(输入 T2，唯一消费者)；mid2 单独把输入也设成 T1，跟 mid 撞车制造歧义。
// 具体源分支这里不测执行（已经不提供手动执行入口，见 2026-08-14 第四次纠偏），
// 这套多节点骨架主要用来测节点切换、请求竞态。
// 不再走 flowApi.flowLoad 本地草稿（该路径已移除，见 SiteDataView.vue 的同一处修复说明），
// 改用真实的 sourceApi.sourceSteps + buildSourceSeed 拼出同一套四节点结构：
// first(输出 T1，首节点) → mid(输入 T1，输出 T2) → mid2(输入 T1，输出 T3，跟 mid 撞车制造
// 歧义场景) → last(输入 T2，唯一消费者)。
function mockFlowFixture(sourceId = '391007768') {
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(mockSourceDetail({ sourceId })!)
  const steps: Step[] = [
    { stepId: 'first', sourceId, name: '抓取列表页', outputTable: 'T1', enabled: true },
    { stepId: 'mid', sourceId, name: '处理A', inputTable: 'T1', outputTable: 'T2', enabled: true },
    { stepId: 'mid2', sourceId, name: '处理B', inputTable: 'T1', outputTable: 'T3', enabled: true },
    { stepId: 'last', sourceId, name: '入库', inputTable: 'T2', enabled: true },
  ]
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps)
}

afterEach(() => localStorage.clear())

describe('SiteDataView · 全部源（表筛选）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('未选表时提示先选表，不发起任何查询', async () => {
    const distinctSource = vi.spyOn(dataApi, 'distinctSource')
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('请先选择一张表')
    expect(distinctSource).not.toHaveBeenCalled()
  })

  // 2026-09-09：候选源只在本网站范围内算，不再问 entryDistinctSource「全库这张表有哪些源」
  // 再取交集——那个接口不认 siteId，共用大表下必被上限截断，本网站的源会整个漏掉。
  it('无条件选表时候选源就是网站的源，不再走 distinctSource 取交集', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a'), source('b')])
    const distinctSource = vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => ({
      total: 0, list: sourceId === 'a' ? [row('a', '10')] : [row('b', '20')],
    }))

    const wrapper = mountView()
    await pickTable(wrapper)

    // b 不在 distinctSource 的返回里，但它属于本网站，照样要查——否则它的数据就凭空消失了
    expect(new Set(rowQueryPaged.mock.calls.map((call) => call[0].sourceId))).toEqual(new Set(['a', 'b']))
    expect(distinctSource).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已加载 2 条')
  })

  it('带条件时用 summaryEntryData 在本网站源里精确收窄，把候选压到真正命中的那些', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a'), source('b'), source('c')])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ SOURCE_ID: 'c', CNT: 5 }] as never)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.get('input[placeholder="数据 ID"]').setValue('123')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()

    expect(summary).toHaveBeenCalled()
    expect(rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'c' }))
  })

  it('精确收窄失败时退回网站全部源，不整体不可用', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'summaryData').mockRejectedValue(new Error('boom'))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('a', '1')] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.get('input[placeholder="数据 ID"]').setValue('123')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()

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
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ SOURCE_ID: 'a', CNT: 1 }] as never)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const rowQueryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.get('input[placeholder="数据 ID"]').setValue('123')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()

    expect(rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ dataId: '123', sourceId: 'a' }))
  })

  it('表名/行数走 DataGrid 的 #head 插槽，跟「列」同一条横条——不再是独立的 .sdv2-tablehead 单占一行（参考 ResultView.vue)', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    const meta2Cols: DataTableMeta = {
      tableId: 't1', tableName: 'T1', rowCount: 0,
      fields: [{ prop: 'title', type: 'string', desc: '标题' }, { prop: 'url', type: 'string', desc: '链接' }],
    }
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta2Cols)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('a', '1')] })

    const wrapper = mountView()
    await pickTable(wrapper)

    // 旧结构会有独立的 .sdv2-tablehead 包裹层；现在表名/计数直接是 DataGrid 工具行的一部分。
    expect(wrapper.find('.sdv2-tablehead').exists()).toBe(false)
    const toolbar = wrapper.get('.dg-toolbar')
    expect(toolbar.text()).toContain('T1')
    expect(toolbar.text()).toContain('已加载 1 条')
    expect(toolbar.find('[data-testid="site-data-fullscreen-toggle"]').exists()).toBe(true)
    expect(toolbar.find('[data-testid="column-picker-btn"]').exists()).toBe(true)
  })

  it('全屏切换：点击进入/退出全屏，Esc 也能退出（参考 ResultView.vue 具体源数据视图）', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickTable(wrapper)

    const shell = wrapper.get('.sdv2-shell')
    expect(shell.classes()).not.toContain('is-fullscreen')

    const toggle = wrapper.get('[data-testid="site-data-fullscreen-toggle"]')
    expect(toggle.text()).toBe('⤢ 全屏')
    await toggle.trigger('click')
    expect(shell.classes()).toContain('is-fullscreen')
    expect(wrapper.get('[data-testid="site-data-fullscreen-toggle"]').text()).toBe('⤡ 退出全屏')

    // Esc 监听挂在 window 上，不是组件根节点——直接派发到 window。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(shell.classes()).not.toContain('is-fullscreen')

    wrapper.unmount()
  })

  it('行内查后续任务实例按当前行的 sourceId 和 dataId 打开任务弹窗', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [row('a', '123')] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action', row('a', '123'), 'tasks')

    const dialog = wrapper.findComponent({ name: 'TaskInstDialog' })
    expect(dialog.props()).toMatchObject({ modelValue: true, sourceId: 'a', parentId: '123', canWrite: false })
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
    // 后半段会填 SQL 条件再查，那时走精确收窄——两个源都命中，候选集合保持不变
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: 'ok', CNT: 1 }, { SOURCE_ID: 'bad', CNT: 1 },
    ] as never)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => {
      if (sourceId === 'bad') throw new Error('boom')
      return { total: 0, list: [row('ok', '1')] }
    })

    const wrapper = mountView()
    await pickTable(wrapper)

    expect(wrapper.find('[data-testid="site-data-partial-fail"]').text()).toContain('源-bad（bad）：boom')
    expect(wrapper.text()).toContain('已加载 1 条')
    await wrapper.get('.sdv2-sql input').setValue('K1 IS NULL')
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(readSqlConditions('t1')).toEqual([])
    query.mockResolvedValue({ total: 0, list: [] })
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(readSqlConditions('t1')).toEqual(['K1 IS NULL'])
    wrapper.unmount()
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

  it('大源量网站首屏只扫描 20 个候选源，加载更多再继续下一批', async () => {
    const sources = Array.from({ length: 45 }, (_, index) => source(`s${index + 1}`))
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue(sources)
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(sources.map((item) => item.sourceId))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ sourceId }) => ({
      total: 1, list: [row(String(sourceId), '1')],
    }))

    const wrapper = mountView()
    await pickTable(wrapper)

    expect(query).toHaveBeenCalledTimes(20)
    expect(wrapper.text()).toContain('已扫描 20/45 个源')

    await wrapper.get('[data-testid="site-data-load-more"]').trigger('click')
    await flushPromises()

    expect(query).toHaveBeenCalledTimes(40)
    expect(wrapper.text()).toContain('已扫描 40/45 个源')
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
    expect(wrapper.find('[data-testid="site-data-process-rail"]').exists()).toBe(true)
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

    expect(wrapper.find('[data-testid="site-data-process-rail"]').exists()).toBe(false)
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

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')

    expect(wrapper.text()).toContain('源不存在或加载失败')
    expect(wrapper.find('[data-testid="site-data-process-rail"]').exists()).toBe(false)
  })

  // 此前这里还有两个用例：一个断言"没有本地草稿时才用 buildSourceSeed"，一个断言"有本地
  // 草稿（flowApi.flowLoad 非空）时优先用它"。2026-08-26 去掉了本地草稿层——flowLoad 没有
  // 真实后端对应物，画布保存过一次就会一直挡住这里的真实拓扑展示（见 FlowCanvas/index.vue
  // 同一处修复说明）。现在节点链只有一种来源，两个用例合并成这一个；draft-覆盖那个分支已经
  // 不是这个组件的行为，不再测。
  it('按步骤用 buildSourceSeed 拼默认骨架并展示节点', async () => {
    const current = mockSourceDetail({ sourceId: '391007768' })!
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(current)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')

    // 默认选中**首个**节点：列表抓取（0831 F09 反转了此前的"默认末端"，与 ResultView 一致）。
    // 选中节点由轨道自己高亮，不再有下拉 placeholder 承载"当前是哪个节点"
    expect(wrapper.get('[data-node-id="391007768-s1"]').classes()).toContain('active')
    expect(wrapper.get('[data-node-id="391007768-s1"]').text()).toContain('列表抓取')
  })

  // 决策/分头节点此前只能靠本地草稿（flowApi.flowLoad 返回一个手工构造的 kind:'decision'
  // 节点）注入进这个只读视图；本地草稿层已去掉，而三批真实生产样本（430016821/430016822/
  // 430016516）证明 item/next 的真实拓扑始终是线性链，没有分支结构。这个场景现在无法通过
  // 应用的真实行为触达，用例一并删除，不留一个只能靠已废弃机制才能达到的假测试。

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

  it('具体源 + 首节点（只有输出表）可以勾行发后续', async () => {
    mockFlowFixture('391007768')
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [row('391007768', 'd1')] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')
    await selectNode(wrapper, 'first')

    expect(wrapper.get('[data-testid="source-node-exec-btn"]').text()).toBe('发后续任务')
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
  })

  it('DataGrid「所属源」列在具体源下改叫「所属节点」，且不展示操作列（避免跟具体源自己的数据视图混淆）', async () => {
    mockFlowFixture('391007768')
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('391007768', 'd1')] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')
    await selectNode(wrapper, 'last')

    // 按列标题精确断言，不用 text() 全文包含：SOURCE_ID 身份列的表头是
    // 「所属源 ID-SOURCE_ID」（0819 N1-5，会议 09:44 要求行内能看到源 ID），
    // 全文匹配会把它误判成「所属源」列还在。
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    const headers = grid.findAll('thead th').map((th) => th.text())
    expect(headers).toContain('所属节点')
    expect(headers).not.toContain('所属源')
    expect(headers).not.toContain('操作')
  })

  it('触底自动加载：DataGrid 派发 reach-end 就继续取下一批（会议 10:39"是不是应该直接朝下滑动就加载更多啊？你这个要点还不麻烦吗"）', async () => {
    mockFlowFixture('391007768')
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    // 每批都返回满页（PAGE_SIZE=20），归并层据此判定"还有更多"
    const fullPage = Array.from({ length: 20 }, (_, i) => row('391007768', `d${i}`))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: fullPage })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')
    await selectNode(wrapper, 'last')
    const before = wrapper.findComponent({ name: 'DataGrid' }).props('rows')!.length
    expect(before).toBe(20)

    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('reach-end')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('rows')!.length).toBeGreaterThan(before)
  })

  it('数据耗尽后解除观察（autoLoadMore 转 false），底部只留"已加载全部数据"，不再有加载更多按钮', async () => {
    mockFlowFixture('391007768')
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    // 不足一页 → 归并层直接判定耗尽
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('391007768', 'only')] })

    const wrapper = mountView()
    await pickSource(wrapper, '391007768')
    await selectNode(wrapper, 'last')

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('autoLoadMore')).toBe(false)
    expect(wrapper.find('[data-testid="site-data-load-more"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已加载全部数据')
  })

  it('请求竞态保护：快速切节点时，只有最后一次请求的结果生效，过期响应到达也不覆盖当前展示', async () => {
    const current = mockSourceDetail({ sourceId: '391007768' })!
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(current)
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    // 按调用顺序区分：请求 #1（初始挂载默认选中首节点）立即返回，#2（切到末端节点）卡住，
    // #3（切回首节点）立即返回——验证 #2 迟到时不会覆盖 #3 已经展示的结果。
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
    await pickSource(wrapper, '391007768') // 请求 #1：初始挂载默认选中首节点，立即返回 fresh

    await selectNode(wrapper, '391007768-s2') // 请求 #2：切到末端节点，卡住
    await selectNode(wrapper, '391007768-s1') // 请求 #3：切回首节点，立即返回

    const grid = () => wrapper.findComponent({ name: 'DataGrid' })
    expect(grid().props('rows')?.[0]?.dataId).toBe('fresh')

    resolveStale?.()
    await flushPromises()

    // 过期的请求 #2 响应到达了，但请求竞态保护应该已经丢弃它
    expect(grid().props('rows')?.[0]?.dataId).toBe('fresh')
  })
})

// M3-0H：ResultView.vue 已有的 M3-0B（父 ID 下钻）此前只落在具体源流程页；网站数据视图
// 这边一直没补——筛选行有「父 ID」输入框能按父 ID 筛，却点不开任何一行的父数据，同一页面
// 内口径不一致。逻辑照搬 ResultView.vue 的 canDrillParent/openParentDetail，用 ElDrawer 的
// 真实渲染 stub（而非全量 true stub）才能点进抽屉内部找父 ID 链接。
const ElDrawerStub = { name: 'ElDrawer', props: ['modelValue'], template: '<div><slot /></div>' }
function mountViewWithDrawer(siteId = 'site-a') {
  return mount(SiteDataView, { props: { siteId }, global: { stubs: { ...stubs, ElDrawer: ElDrawerStub } } })
}

describe('SiteDataView · 上游数据下钻（M3-0H）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('行带 categoryId+parentId 时详情抽屉里父 ID 可点，点开后展示上游行数据', async () => {
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('391007768')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['391007768'])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ dataId: 'd1', sourceId: '391007768', title: '详情行', summary: '', acceptState: 'pending', categoryId: 'cat-1', parentId: 'p1' }],
    })
    const rowDetail = vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: { dataId: 'p1', sourceId: '391007768', title: '上游行', summary: '', acceptState: 'pending' },
      showItems: [{ columnName: 'K1', itemName: '标题', value: '上游标题' }],
    })

    const wrapper = mountViewWithDrawer()
    await pickTable(wrapper)
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action',
      { dataId: 'd1', sourceId: '391007768', title: '详情行', summary: '', acceptState: 'pending', categoryId: 'cat-1', parentId: 'p1' }, 'detail')
    await flushPromises()

    const link = wrapper.get('[data-testid="site-data-parent-drill"]')
    expect(link.text()).toContain('p1')

    await link.trigger('click')
    await flushPromises()

    expect(rowDetail).toHaveBeenCalledWith('cat-1', 'p1')
    expect(wrapper.get('[data-testid="site-data-parent-panel"]').text()).toContain('上游标题')
  })

  it('行没有 categoryId/parentId（或 parentId 是 "0"）时不渲染下钻入口', async () => {
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('391007768')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['391007768'])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ dataId: 'd1', sourceId: '391007768', title: '无父行', summary: '', acceptState: 'pending', parentId: '0' }],
    })

    const wrapper = mountViewWithDrawer()
    await pickTable(wrapper)
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action',
      { dataId: 'd1', sourceId: '391007768', title: '无父行', summary: '', acceptState: 'pending', parentId: '0' }, 'detail')
    await flushPromises()

    expect(wrapper.find('[data-testid="site-data-parent-drill"]').exists()).toBe(false)
  })

  it('换行打开新详情时收起上一行残留的上游数据面板', async () => {
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('391007768')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['391007768'])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ dataId: 'd1', sourceId: '391007768', title: 'A', summary: '', acceptState: 'pending', categoryId: 'cat-1', parentId: 'p1' }],
    })
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: { dataId: 'p1', sourceId: '391007768', title: '上游行', summary: '', acceptState: 'pending' },
      showItems: [],
    })

    const wrapper = mountViewWithDrawer()
    await pickTable(wrapper)
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action',
      { dataId: 'd1', sourceId: '391007768', title: 'A', summary: '', acceptState: 'pending', categoryId: 'cat-1', parentId: 'p1' }, 'detail')
    await flushPromises()
    await wrapper.get('[data-testid="site-data-parent-drill"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="site-data-parent-panel"]').exists()).toBe(true)

    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action',
      { dataId: 'd2', sourceId: '391007768', title: 'B', summary: '', acceptState: 'pending' }, 'detail')
    await flushPromises()

    expect(wrapper.find('[data-testid="site-data-parent-panel"]').exists()).toBe(false)
  })
})

// 按条件查源（0909 改落点）：命中源从「跳到源视图」改成「写进左侧源侧栏」。
// 会上原话「就是要再加到左边最好」「因为我点一个源又要进去」——跳过去只是换个地方看列表，
// 挨个排查问题源还得在两个视图之间来回跳。
// 2026-09-09：归并视图逐源懒加载，自己算不出总量，表头一直只有「已加载 N 条」（加载进度）。
// 用户问的"一共多少条"看不到——旧平台分页器上那个「共 7030 条」没迁过来。
// 收窄用的 summaryEntryData 本来就按源分组带 CNT，求和即总数，不额外发请求。
describe('SiteDataView · 命中总条数', () => {
  afterEach(() => vi.restoreAllMocks())

  it('带条件时直接用收窄那步的分组计数求和，不为总数再发一轮', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1'), source('s2')])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: 's1', CNT: 7000 }, { SOURCE_ID: 's2', CNT: 30 },
    ] as never)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.get('input[placeholder="数据 ID"]').setValue('1')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="site-data-total"]').text()).toBe('共 7,030 条')
  })

  // 2026-09-09 修正：上一版不带条件时不显示总数（"不值得为一个数字先付一轮请求"），
  // 想窄了——「一共多少条」跟有没有筛选条件无关，进来就该看得到。改成后台补算。
  it('不带条件时也算总数，只是放后台不挡着数据先出来', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1')])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: 's1', CNT: 4321 },
    ] as never)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('s1', '1')] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await flushPromises()

    expect(summary).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="site-data-total"]').text()).toBe('共 4,321 条')
    expect(wrapper.text()).toContain('已加载 1 条')
  })

  it('后台补算失败就不显示，不拿个错数字糊弄——数据本身照常展示', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1')])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'summaryData').mockRejectedValue(new Error('boom'))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('s1', '1')] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await flushPromises()

    expect(wrapper.find('[data-testid="site-data-total"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已加载 1 条')
  })

  it('收窄失败时不显示总数，不拿个错数字糊弄', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1')])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'summaryData').mockRejectedValue(new Error('boom'))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.get('input[placeholder="数据 ID"]').setValue('1')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="site-data-total"]').exists()).toBe(false)
  })
})

describe('SiteDataView · 按条件查源', () => {
  afterEach(() => vi.restoreAllMocks())

  async function backTraceReady() {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1'), source('s2'), source('s3')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['s1', 's2', 's3'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    // 反查主路径：summaryEntryData 按 SOURCE_ID 分组，一次拿到「哪些源 + 各命中几条」
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([
      { SOURCE_ID: 's2', CNT: 3 },
      { SOURCE_ID: 's1', CNT: 12 },
    ] as never)
    const wrapper = mountView()
    await pickTable(wrapper)
    await wrapper.get('input.sdv2-input.flex').setValue("K1 IS NULL")
    return wrapper
  }

  it('命中源写进 workspace store 供侧栏消费，按命中条数从多到少排', async () => {
    const wrapper = await backTraceReady()
    await wrapper.get('[data-testid="site-data-backtrace"]').trigger('click')
    await flushPromises()

    const ws = useWorkspaceStore()
    expect(ws.backTraceHitsOf('site-a')).toEqual([
      { sourceId: 's1', count: 12 },
      { sourceId: 's2', count: 3 },
    ])
  })

  // 侧栏那一行写着「12 条」，点进去看到的就得是那 12 条，否则数字是误导
  it('把产生这批命中的条件一并记下，供点侧栏源时带进具体源数据视图', async () => {
    const wrapper = await backTraceReady()
    await wrapper.get('[data-testid="site-data-backtrace"]').trigger('click')
    await flushPromises()

    expect(useWorkspaceStore().backTraceConditionOf('site-a')).toEqual({
      tableId: 't1', sql: 'K1 IS NULL', state: undefined, dataId: undefined, parentId: undefined,
    })
  })

  it('命中态清掉后条件也不再供给（别把过期条件带进源里）', async () => {
    const wrapper = await backTraceReady()
    await wrapper.get('[data-testid="site-data-backtrace"]').trigger('click')
    await flushPromises()
    const ws = useWorkspaceStore()
    expect(ws.backTraceConditionOf('site-a')).not.toBeNull()

    ws.clearBackTraceHits()
    expect(ws.backTraceConditionOf('site-a')).toBeNull()
  })

  it('命中态按 siteId 隔离：切到别的网站就不适用了，侧栏拿不到', async () => {
    const wrapper = await backTraceReady()
    await wrapper.get('[data-testid="site-data-backtrace"]').trigger('click')
    await flushPromises()

    const ws = useWorkspaceStore()
    expect(ws.backTraceHitsOf('site-a')).toHaveLength(2)
    expect(ws.backTraceHitsOf('site-other')).toEqual([])
  })

  it('没填任何数据条件时不发请求，只提示——无条件反查等于把全部源填回去，没意义', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['s1'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    const summary = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([])

    const wrapper = mountView()
    await pickTable(wrapper)
    await flushPromises()
    // 选表时后台会补算一次总数，也走 summaryData——这里只关心点按钮之后有没有再发
    const before = summary.mock.calls.length
    await wrapper.get('[data-testid="site-data-backtrace"]').trigger('click')
    await flushPromises()

    expect(summary.mock.calls.length).toBe(before)
    expect(useWorkspaceStore().backTraceHitsOf('site-a')).toEqual([])
  })

  it('点「查询」清掉侧栏命中态——那是上一次条件的快照，条件一改就过期', async () => {
    const wrapper = await backTraceReady()
    await wrapper.get('[data-testid="site-data-backtrace"]').trigger('click')
    await flushPromises()
    const ws = useWorkspaceStore()
    expect(ws.backTraceHitsOf('site-a')).toHaveLength(2)

    await wrapper.get('button.primary').trigger('click')
    await flushPromises()

    expect(ws.backTraceHitsOf('site-a')).toEqual([])
  })

  it('旧的「跳源视图」收进 ⋯ 下拉当第二条路：反查完要批量发任务时那边的勾选更好使', async () => {
    const wrapper = await backTraceReady()
    expect(wrapper.find('[data-testid="site-data-backtrace-more"]').exists()).toBe(true)
    const item = wrapper.findAll('.el-dropdown-item').find((i) => i.text().includes('源视图'))
    expect(item).toBeTruthy()
  })
})


// 每次加载条数可选（0910 会议 §1-2）。会上原话是"改成可配置的分页加载，可选 20/100/200"，
// 确认过语义：调的是表格每次追加多少行，不是每个源向后端要多少条——后者跟着放大，
// 在源多的网站上请求体积和内存直接翻十倍，用户要的只是"一屏多看点"。
describe('SiteDataView · 每次加载条数', () => {
  afterEach(() => vi.restoreAllMocks())

  function mockOneBigSource() {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['a'])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const sizes: number[] = []
    let seq = 0
    vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ size = 0 }) => {
      sizes.push(size)
      return { total: 9999, list: Array.from({ length: size }, () => row('a', String(++seq))) }
    })
    return sizes
  }

  it('默认一次 20 行；改成 100 后再加载追加 100 行，而每源每页仍固定取 20 条', async () => {
    const sizes = mockOneBigSource()

    const wrapper = mountView()
    await pickTable(wrapper)
    expect(wrapper.text()).toContain('已加载 20 条')

    await wrapper.get('[data-testid="site-data-append-size"]').setValue('100')
    await wrapper.get('[data-testid="site-data-load-more"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已加载 120 条')
    // 这条是本功能的核心约定：无论用户选多少，向后端要的每页条数不变
    expect([...new Set(sizes)]).toEqual([20])
  })

  it('改动只影响下一次加载，不清空已经加载出来的行', async () => {
    mockOneBigSource()

    const wrapper = mountView()
    await pickTable(wrapper)
    expect(wrapper.text()).toContain('已加载 20 条')

    await wrapper.get('[data-testid="site-data-append-size"]').setValue('200')
    await flushPromises()
    // 选完还没点加载更多：已加载的 20 行必须原地不动
    expect(wrapper.text()).toContain('已加载 20 条')
  })

  it('选择被记住：换一个网站重新进来仍是上次选的条数', async () => {
    mockOneBigSource()

    const first = mountView('site-a')
    await pickTable(first)
    await first.get('[data-testid="site-data-append-size"]').setValue('200')
    await flushPromises()

    const second = mountView('site-b')
    await pickTable(second)
    expect(second.text()).toContain('已加载 200 条')
  })
})

// 列头排序（2026-09-11）。此前这个视图根本没接 DataGrid 的 sort-change——列头画着 ↕、
// 点了毫无反应，而隔壁具体源视图是好的。只开放 ENTRY_ID：归并键固定取 dataId，
// 按别的列排出来的全局顺序是假的。
describe('SiteDataView · 列头排序', () => {
  afterEach(() => vi.restoreAllMocks())

  async function mountWithRows() {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('a')])
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [row('a', '1')] })
    const wrapper = mountView()
    await pickTable(wrapper)
    return { wrapper, query }
  }

  it('默认按 ENTRY_ID 降序，并把方向发给后端', async () => {
    const { query } = await mountWithRows()
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ sortField: 'ENTRY_ID', sortOrder: 'descend' }))
  })

  it('点 ENTRY_ID 列头切成升序：重新查询且方向跟着变', async () => {
    const { wrapper, query } = await mountWithRows()
    const grid = wrapper.findComponent(DataGrid)
    expect(grid.props('sortableProps')).toEqual(['ENTRY_ID'])

    grid.vm.$emit('sort-change', 'ENTRY_ID', 'ascend')
    await flushPromises()

    expect(grid.props('sortOrder')).toBe('ascend')
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ sortOrder: 'ascend' }))
  })

  // DataGrid 是三态（升→降→取消），归并视图没有"不排序"这一态，压成两态：取消＝翻方向。
  // 不这么做点列头会原地打转——sortField 固定 ENTRY_ID + 初始降序，第一次点就落进第三态。
  it('收到三态里的"取消"时翻到另一个方向，而不是停在原地', async () => {
    const { wrapper, query } = await mountWithRows()
    const grid = wrapper.findComponent(DataGrid)

    grid.vm.$emit('sort-change', '', '')
    await flushPromises()
    expect(grid.props('sortOrder')).toBe('ascend')
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ sortOrder: 'ascend' }))

    grid.vm.$emit('sort-change', '', '')
    await flushPromises()
    expect(grid.props('sortOrder')).toBe('descend')
  })

  // 走真实点击路径（而不是直接 emit）：上面那个 bug 就是因为测试只 emit、
  // 没经过 DataGrid 的三态计算，才没被拦住
  it('真的点 ENTRY_ID 列头能在升降之间切换', async () => {
    const { wrapper } = await mountWithRows()
    const clean = (t: string) => t.replace(/[↕↑↓]\s*$/, '').trim()
    const th = wrapper.findAll('.dg-table thead th').find((x) => clean(x.text()) === 'ENTRY_ID')!

    await th.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(DataGrid).props('sortOrder')).toBe('ascend')

    await th.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(DataGrid).props('sortOrder')).toBe('descend')
  })
})
