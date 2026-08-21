// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import ResultView from './ResultView.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { dataApi, isProductionBackend, siteApi, sourceApi, type DataRow, type DataTableMeta, type Source } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

// 只替换 isProductionBackend，其余照搬真实模块——现有用例的 vi.spyOn(dataApi, …)
// 作用在同一个 dataApi 对象引用上，不受影响。
const routerPush = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return { ...actual, isProductionBackend: vi.fn(() => false) }
})

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }
})

const meta: DataTableMeta = {
  tableId: 'TB_ZFB_COMMENT', tableName: '评论', rowCount: 0,
  fields: [{ prop: 'content', type: 'string', desc: '内容' }],
}

// 表头内容（表名/行数/输入输出切换/发起抓取/分页）现在渲染在 DataGrid 的 #head 插槽里
// （2026-08-15 第十二次纠偏，三条横条并成一条），`DataGrid: true` 那种全量 stub 不渲染
// 插槽，会让这些断言全部落空——换成显式 stub，保留 name/props/emits 供测试查询与触发。
const DataGridStub = {
  name: 'DataGrid',
  props: ['meta', 'rows', 'loading', 'selectedId', 'compact', 'hideActions', 'sourceNames', 'sourceColLabel', 'selectable', 'selectedIds'],
  emits: ['row-click', 'row-action', 'update:selectedIds'],
  // head-right 是"不随表头横向滚动"的常驻区（全屏按钮在里面），foot 是表格下方的横条
  // （分页在里面，0819 N1-8 从 #head 移过去的）；stub 里都要渲染，否则依赖它们的断言
  // 会全部落空。
  template: '<div class="dg-stub"><slot name="head" /><slot name="head-right" /><slot name="foot" /></div>',
}
// ElDrawer 用显式 stub（而非 `true` 全量 stub）：M3-0B 的上游数据下钻测试要点进详情
// 抽屉内部找父 ID 链接，`true` 全量 stub 不渲染默认插槽，会让这些断言全部落空。
const ElDrawerStub = { name: 'ElDrawer', props: ['modelValue'], template: '<div><slot /></div>' }
const TaskInstDialogStub = { name: 'TaskInstDialog', props: ['modelValue', 'sourceId', 'parentId', 'canWrite'], template: '<div />' }
const STUBS = { CanvasHeader: true, ElDrawer: ElDrawerStub, DataGrid: DataGridStub, TaskInstDialog: TaskInstDialogStub }

describe('ResultView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('以当前源流程展示无首尾节点的节点条，且只查当前源数据（不提供所属源筛选——本页始终锁定在进入时的具体源，2026-08-14 第五次纠偏去掉了容易让人切到同站其他源的下拉）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = shallowMount(ResultView, {
      global: {
        directives: { loading: {} },
        stubs: STUBS,
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-source-filter"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('开始')
    expect(wrapper.text()).not.toContain('完成')
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: current.siteId, sourceId: current.sourceId }))
  })

  it('数据视图筛选栏包含流程节点下拉框', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = shallowMount(ResultView, {
      global: {
        directives: { loading: {} },
        stubs: STUBS,
      },
    })
    await flushPromises()

    const rail = wrapper.findComponent(ProcessNodeRail)
    expect(rail.exists()).toBe(true)
    expect(rail.props('modelValue')).not.toBe('')
    // 节点选择只此一处：与流程图重复的下拉已删（0819 会议 05:13）
    expect(wrapper.find('[data-testid="data-node-filter"]').exists()).toBe(false)
  })

  it('行内查后续任务实例按当前行打开只读任务弹窗', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action', { dataId: 'entry-1', sourceId: current.sourceId, title: '', summary: '', acceptState: 'pending' }, 'tasks')

    const dialog = wrapper.findComponent({ name: 'TaskInstDialog' })
    expect(dialog.props()).toMatchObject({ modelValue: true, sourceId: current.sourceId, parentId: 'entry-1', canWrite: false })
  })

  it('表结构接口异常时不阻断数据查询，并提示已回退到演示数据', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const row: DataRow = {
      dataId: 'row-1', sourceId: current.sourceId, title: '测试行', summary: '',
      acceptState: 'accepted', values: { K1: '正文', K2: 42 },
    }
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockRejectedValue(new Error('业务类型不存在'))
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [row], total: 1 })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = shallowMount(ResultView, {
      global: {
        directives: { loading: {} },
        stubs: STUBS,
      },
    })
    await flushPromises()

    expect(query).toHaveBeenCalled()
    expect(wrapper.text()).toContain('真实数据接口暂不可用，已切换到本地演示数据')
    expect(wrapper.text()).toContain('1 行')
  })
})

// 节点选择统一走流程图（0819 N1-1 删掉了与之重复的下拉）。shallowMount 下 ProcessNodeRail
// 被自动 stub、内部按钮不渲染，所以直接对组件发 update:modelValue——等价于点它的节点按钮。
// 查询条件不绑回车（2026-08-20）：中文输入法上屏时也会发 Enter 的 keyup，而 Vue 的
// @keyup.enter 不过滤 isComposing，实测会在打字打到一半时把半截条件当成回车查出去。
async function typeSql(wrapper: ReturnType<typeof shallowMount>, sql: string) {
  const input = wrapper.findAll('.ctx-summary input').find((i) => (i.attributes('placeholder') || '').includes('SQL'))!
  await input.setValue(sql)
  return input
}

async function selectNode(wrapper: ReturnType<typeof shallowMount>, nodeId: string) {
  await wrapper.findComponent(ProcessNodeRail).vm.$emit('update:modelValue', nodeId)
  await flushPromises()
}

describe('ResultView · 查询失败的暴露方式（0819 N3）', () => {
  it('把后端的真实报错摆出来，而不是笼统的"请重试"——SQL 条件写错时重试多少次结果都一样', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(dataApi, 'rowQueryPaged').mockRejectedValue(
      new Error("请求异常 [data/rowQueryPaged]: 请求失败 500: You have an error in your SQL syntax near 'title'"),
    )

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.text()).toContain('请求失败 500')
    expect(wrapper.text()).toContain('SQL syntax')
    expect(wrapper.text()).not.toContain('数据加载失败，请点击')
  })

  it('连生产后端时失败不回退演示数据——页面顶着"生产环境"徽标却显示本地种子数据，误判成真实数据是迟早的事，宁可空着报错', async () => {
    setActivePinia(createPinia())
    vi.mocked(isProductionBackend).mockReturnValue(true)
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    // 与上面那条"回退"用例同样的失败形态：表结构失败、数据成功
    vi.spyOn(dataApi, 'tableMeta').mockRejectedValue(new Error('业务类型不存在'))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.text()).not.toContain('已切换到本地演示数据')
    expect(wrapper.text()).toContain('业务类型不存在')
    vi.mocked(isProductionBackend).mockReturnValue(false)
  })
})

describe('ResultView · 大数据量保护（0819 N3-3）', () => {
  it('查询期间按钮禁用并显示"查询中…"，超过阈值提示可缩小范围但不中断请求', async () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    // 所有查询都挂起不返回，模拟"大表查询很久没回来"
    const releases: ((v: { list: DataRow[]; total: number }) => void)[] = []
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(
      () => new Promise((resolve) => { releases.push(resolve) }),
    )

    const wrapper = mountResultView()
    await vi.advanceTimersByTimeAsync(0)

    const queryBtn = () => wrapper.findAll('.rv-actions button').find((b) => b.text().startsWith('查询'))!
    expect(queryBtn().attributes('disabled')).toBeDefined()
    expect(queryBtn().text()).toBe('查询中…')
    expect(wrapper.find('[data-testid="data-slow-query"]').exists()).toBe(false)

    // 跨过 8s 阈值：提示出现，但请求既没被中断也没被重发（仍挂在那儿等结果）
    const callsBefore = query.mock.calls.length
    await vi.advanceTimersByTimeAsync(8100)
    expect(wrapper.find('[data-testid="data-slow-query"]').exists()).toBe(true)
    expect(query.mock.calls.length).toBe(callsBefore)

    releases.forEach((r) => r({ list: [], total: 0 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="data-slow-query"]').exists()).toBe(false)
    expect(queryBtn().attributes('disabled')).toBeUndefined()
    vi.useRealTimers()
  })
})

describe('ResultView · 查询条件的执行时机（0819 N3 前置修复）', () => {
  it('输入条件不触发查询，只提示"条件已修改"；回车也不执行——中文输入法上屏会发 Enter 的 keyup，绑回车等于打字打到一半就把半截条件查出去', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()
    const callsAfterMount = query.mock.calls.length

    const input = await typeSql(wrapper, "K1 LIKE '%工行%'")
    await flushPromises()
    expect(query.mock.calls.length).toBe(callsAfterMount) // 输入不查
    expect(wrapper.find('[data-testid="data-filters-dirty"]').exists()).toBe(true)

    await input.trigger('keyup.enter')
    await flushPromises()
    expect(query.mock.calls.length).toBe(callsAfterMount) // 回车也不查

    await wrapper.findAll('.rv-actions button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(query.mock.calls.length).toBe(callsAfterMount + 1) // 只有点查询才查
    expect(wrapper.find('[data-testid="data-filters-dirty"]').exists()).toBe(false)
  })
})

function mountResultView() {
  return shallowMount(ResultView, {
    global: {
      directives: { loading: {} },
      // teleport: false——「发后续 ▾」的展开面板真实 Teleport 到 document.body 了
      // （脱离 DataGrid 的 .dg-head 溢出裁剪盒子，见 ResultView.vue 里的说明），VTU
      // 默认会把 <Teleport> 整个 stub 掉、内容根本不渲染，测不到真的点没点对。
      stubs: { ...STUBS, teleport: false },
    },
  })
}
// Teleport 出去的内容不在 wrapper 的 DOM 子树里，wrapper.get(...) 找不到，
// 得直接查 document、用 DOMWrapper 包一层继续复用 .trigger()/.text() 这套 API。
function teleported(selector: string) {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`teleported element not found in document: ${selector}`)
  return new DOMWrapper(el)
}

describe('ResultView · 节点上下文与范围切换（0812 计划 M2-6~M2-9）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('决策节点也在候选列表里，选中后展示只读空态，不提供筛选和数据表格', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const decId = flow.insertAfter('391007768-s2', 'decision')!
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()

    const railNodes = wrapper.findComponent(ProcessNodeRail).props('layout').nodes
    expect(railNodes.some((n: { id: string }) => n.id === decId)).toBe(true)

    await selectNode(wrapper, decId)

    // 结构节点没有表可看：整块表头/表格区都不渲染，只留空态文案说明为什么不能手动执行。
    // （原本这里还有一条 .pill 徽标不存在的断言，2026-08-19 徽标整体删除后它恒为真、
    //  失去意义，已移除。）
    expect(wrapper.find('[data-testid="data-node-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-node-empty"]').text()).toContain('不提供手动执行入口')
    expect(wrapper.find('[data-testid="data-source-filter"]').exists()).toBe(false)
  })

  it('首节点只有输出表：摘要行不出现可点的范围切换控件，执行方式是"按源抓取"', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, '391007768-s1')

    expect(wrapper.find('[data-testid="data-scope-output"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-scope-input"]').exists()).toBe(false)
    // 「按源抓取」徽标已删除（2026-08-19，与按钮文案信息重复）：这里改由按钮文案
    // 承担同一个断言——它现在是"这个节点按什么发"的唯一出处。
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发起抓取')
  })

  it('输入表===输出表（如规则处理节点）时，摘要行合并成一个 tab，行直接可勾选，不再有输入/输出切换（M3-0C 方案 A）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadSameTableFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid')

    expect(wrapper.find('[data-testid="data-scope-output"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-scope-input"]').exists()).toBe(false)
    const merged = wrapper.find('[data-testid="data-scope-merged"]')
    expect(merged.exists()).toBe(true)
    expect(merged.text()).toContain('输入·输出')
    expect(wrapper.find('[data-testid="data-view-only-hint"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发后续任务')
  })

  it('输入表≠输出表（正常场景）时保留双 tab 切换，只有切到"输入"才能勾行，输出 tab 上改用说明文字代替禁用按钮（M3-0C：合并逻辑只对输入===输出生效，不影响这个更常见的场景）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadDistinctTablesFixture(flow, current) // mid: 输入 T1 / 输出 T2，两张不同的表，唯一消费者（不掺歧义判定）
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid')

    expect(wrapper.find('[data-testid="data-scope-merged"]').exists()).toBe(false)
    const outputBtn = wrapper.get('[data-testid="data-scope-output"]')
    const inputBtn = wrapper.get('[data-testid="data-scope-input"]')
    expect(outputBtn.classes()).toContain('active') // 默认先看输出

    // 输出 tab：这批行不是本节点的输入，不给禁用按钮，给说明文字
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(false)
    expect(wrapper.find('[data-testid="data-exec-btn"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="data-view-only-hint"]').text()).toContain('本节点产出数据')

    await inputBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="data-view-only-hint"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发后续任务')
    // 分页简化成一个 el-pagination（2026-08-19），不再是"第 N 页"文字——这里只确认
    // 分页控件确实渲染了，具体交互由下面 M3-0F 那组测试单独覆盖。
    expect(wrapper.find('[data-testid="data-pagination"]').exists()).toBe(true)
  })

  it('节点轨道默认展开，点「流程」可收起再展开（2026-08-15 定案：默认展开，折叠是手动出口，不靠默认折叠换那几行数据）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)

    await wrapper.get('[data-testid="data-rail-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(false)

    await wrapper.get('[data-testid="data-rail-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
  })

  it('全屏：隐藏源信息头与节点轨道，但保留筛选与发起抓取；补出源名；Esc 退出', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')

    expect(wrapper.find('.rv-shell').classes()).not.toContain('is-fullscreen')

    await wrapper.get('[data-testid="data-fullscreen-toggle"]').trigger('click')

    expect(wrapper.find('.rv-shell').classes()).toContain('is-fullscreen')
    // 让位的：只有源信息头
    expect(wrapper.findComponent({ name: 'CanvasHeader' }).exists()).toBe(false)
    // 保留的：节点轨道（0819 N1-2——它是唯一的节点选择器，全屏藏起来就没法切节点了）、
    // 筛选条件、发起抓取——全屏不是"只能看不能用"
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="数据 ID"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-exec-btn"]').exists()).toBe(true)
    // 源信息头没了，源名要在筛选行补回来，否则看不出在看哪个源的数据
    expect(wrapper.find('.rv-fs-source').text()).toBe(current.name)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('.rv-shell').classes()).not.toContain('is-fullscreen')
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
  })

  it('节点自身设置了进入条件时出现「查看条件」，点击跳到流程画布的该节点配置——不再就地展开（0819 N4-1，会议 21:06"直接点它，然后就跳过去，不要在这边搞个东西起来"）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    // 用规则处理节点（无 collectCfg）设置：采集节点的进入条件走 collectCfg.entryCondition，
    // 直接赋值 cfg.entryCondition 会被 nodeEntryCondition() 的 collectCfg 优先读取口径吃掉。
    flow.configs['391007768-rule-demo'].entryCondition = { logic: 'AND', items: [{ field: 'title', op: 'contains', value: '公告' }] }
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, '391007768-rule-demo')

    expect(wrapper.find('[data-testid="data-node-condition-link"]').exists()).toBe(true)
    // 就地展开的条件区已删除
    expect(wrapper.find('.ctx-detail').exists()).toBe(false)

    routerPush.mockClear()
    await wrapper.find('[data-testid="data-node-condition-link"]').trigger('click')

    expect(routerPush).toHaveBeenCalledWith(expect.objectContaining({
      path: '/canvas',
      query: expect.objectContaining({
        sourceId: '391007768',
        view: 'flow',
        nodeId: '391007768-rule-demo',
        tab: 'config',
      }),
    }))
  })

  it('没有进入条件也不在任何分支上的节点，摘要行不出现"查看条件"（没内容不留空展开区）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, '391007768-s1')

    expect(wrapper.find('.ctx-toggle').exists()).toBe(false)
  })

  it('分支上的节点同样出现「查看条件」入口，跳转带上该节点 id（路径条件由分支条件决定，内容到画布里看）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const decId = flow.insertAfter('391007768-s2', 'decision')!
    const bg = flow.branchGroups.find((g) => g.ownerId === decId)!
    flow.setBranchCondition(decId, bg.branches[0].id, { logic: 'AND', items: [{ field: 'amount', op: 'gt', value: '0' }] })
    const childId = flow.addNodeToBranch(decId, bg.branches[0].id, 'web')!
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, childId)

    // 分支上的节点自身没有进入条件，靠路径条件（分支条件）也应给出入口
    expect(wrapper.find('[data-testid="data-node-condition-link"]').exists()).toBe(true)

    routerPush.mockClear()
    await wrapper.find('[data-testid="data-node-condition-link"]').trigger('click')
    expect(routerPush).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({ nodeId: childId, view: 'flow', tab: 'config' }),
    }))
  })

  it('快速切换节点时只有最后一次请求的结果生效，过期响应到达也不会覆盖当前展示（请求竞态保护）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    let resolveStale: (() => void) | undefined
    vi.spyOn(dataApi, 'rowQueryPaged').mockImplementation(async ({ tableId }) => {
      if (tableId === '2102157') {
        // 391007768-s1 的输出表：故意卡住不返回，模拟"先发出的请求反而后到达"
        await new Promise<void>((resolve) => { resolveStale = resolve })
        return { list: [{ dataId: 'stale-row', sourceId: current.sourceId, title: 'STALE', summary: '', acceptState: 'pending' }], total: 1 }
      }
      return { list: [{ dataId: `fresh-${tableId}`, sourceId: current.sourceId, title: 'FRESH', summary: '', acceptState: 'pending' }], total: 1 }
    })

    const wrapper = mountResultView()
    await flushPromises()

    await selectNode(wrapper, '391007768-s1') // 触发查询 tableId=2102157，卡住不返回
    await selectNode(wrapper, '391007768-s2') // 切回去，触发查询 tableId=2102157_DETAIL，立即返回

    const gridAfterSwitch = wrapper.findComponent({ name: 'DataGrid' })
    expect(gridAfterSwitch.props('rows')?.[0]?.dataId).toBe('fresh-2102157_DETAIL')

    resolveStale?.()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('rows')?.[0]?.dataId).toBe('fresh-2102157_DETAIL')
  })
})

function cfg(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return { title: '', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], ...overrides }
}

// 自定义一条干净的主链，绕开 391007768 demo 流程里 s1/规则处理输出表恰好撞同名的巧合，
// 精确控制"唯一消费者 / 多消费者共用同一张输入表"两种场景：
//   first(输出 T1，无输入，首节点) → mid(输入 T1，输出 T2) → last(输入 T2，唯一消费者)
//   mid2 单独把输入也显式设成 T1，跟 mid 撞车，制造 M2-14 的歧义场景
function loadExecFixture(flow: ReturnType<typeof useFlowStore>, current: Source) {
  flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
  flow.main.splice(0, flow.main.length, 'start', 'first', 'mid', 'mid2', 'last', 'end')
  Object.assign(flow.configs, {
    first: cfg({ title: '抓取列表页', outputTable: 'T1' }),
    mid: cfg({ title: '处理A', inputTable: 'T1', outputTable: 'T2' }),
    mid2: cfg({ title: '处理B', inputTable: 'T1', outputTable: 'T3' }),
    last: cfg({ title: '入库', inputTable: 'T2' }),
  })
}

// 干净的"输入≠输出、唯一消费者"场景（M3-0C）：跟 loadExecFixture 分开，避免复用 mid 时
// 撞上 mid2 制造的 M2-14 歧义——这里就是想测"正常、不歧义"的双 tab 场景本身。
function loadDistinctTablesFixture(flow: ReturnType<typeof useFlowStore>, current: Source) {
  flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
  flow.main.splice(0, flow.main.length, 'start', 'first', 'mid', 'last', 'end')
  Object.assign(flow.configs, {
    first: cfg({ title: '抓取列表页', outputTable: 'T1' }),
    mid: cfg({ title: '处理A', inputTable: 'T1', outputTable: 'T2' }),
    last: cfg({ title: '入库', inputTable: 'T2' }),
  })
}

// 输入===输出（M3-0C）：mid 的输入表和输出表故意设成同一个值，且是 T1 唯一的消费者
// （不掺 M2-14 的歧义判定，只测合并 tab 本身）。
function loadSameTableFixture(flow: ReturnType<typeof useFlowStore>, current: Source) {
  flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
  flow.main.splice(0, flow.main.length, 'start', 'first', 'mid', 'end')
  Object.assign(flow.configs, {
    first: cfg({ title: '抓取列表页', outputTable: 'T1' }),
    mid: cfg({ title: '规则处理', inputTable: 'T1', outputTable: 'T1' }),
  })
}

describe('ResultView · 节点手动执行（0812 计划 M2.2：M2-10～M2-14）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // Teleport 到 document.body 的面板不会随组件"没人再引用"自动消失，测试从不调用
    // wrapper.unmount()，不清理的话会跨用例累积，下一条测试的 document.querySelector
    // 可能挑到上一条留下的陈旧节点。
    document.querySelectorAll('.rv-more-panel').forEach((el) => el.remove())
  })

  it('首节点展示"发起抓取"按钮，确认后调用 sendSnatch', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const sendSnatch = vi.spyOn(sourceApi, 'sendSnatch').mockResolvedValue({ ok: true, message: '已发起抓取' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')

    const btn = wrapper.get('[data-testid="data-exec-btn"]')
    // 首节点按源"发起抓取"，非首节点按输入数据"发后续任务"——旧平台本就是两个不一样的
    // 方法（0812 会议 53:40），曾一度统一叫"发起抓取"是误判，已改回两个文案（M3-0A）。
    expect(btn.text()).toBe('发起抓取')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)

    await btn.trigger('click')
    await flushPromises()

    expect(sendSnatch).toHaveBeenCalledWith([current.sourceId])
    expect(ElMessage.success).toHaveBeenCalledWith('已发起抓取')
  })

  it('非首节点、有效输入表只有唯一消费者时：切到输入数据勾选行后可以发后续任务，调用 nextStep', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 2,
      list: [
        { dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' },
        { dataId: 'd2', sourceId: current.sourceId, title: 'B', summary: '', acceptState: 'pending' },
      ],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStep = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已提交 2 条' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last') // last: 输入 T2，唯一消费者，不歧义

    // 默认范围是"输出数据"（last 没有输出表，其实 defaultScope 会落到 input，因为 outputTableId 为空）
    const btnBefore = wrapper.get('[data-testid="data-exec-btn"]')
    expect((btnBefore.element as HTMLButtonElement).disabled).toBe(true)
    expect(btnBefore.attributes('title')).toContain('请先勾选要发送的数据')

    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['d1', 'd2'])
    await flushPromises()

    const btnAfter = wrapper.get('[data-testid="data-exec-btn"]')
    expect((btnAfter.element as HTMLButtonElement).disabled).toBe(false)
    expect(btnAfter.text()).toBe('发后续任务')
    expect(wrapper.text()).toContain('已选 2 条')

    await btnAfter.trigger('click')
    await flushPromises()

    expect(nextStep).toHaveBeenCalledWith(current.sourceId, 'T2', ['d1', 'd2'])
    expect(ElMessage.success).toHaveBeenCalledWith('已提交 2 条')
  })

  it('发本页任务（M3-0E）：不勾选也能一次性发当页全部行，并复用同一套回执解析', async () => {
    vi.mocked(ElMessage.success).mockClear()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 3,
      list: [
        { dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' },
        { dataId: 'd2', sourceId: current.sourceId, title: 'B', summary: '', acceptState: 'pending' },
        { dataId: 'd3', sourceId: current.sourceId, title: 'C', summary: '', acceptState: 'pending' },
      ],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStep = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '本次发送:3 条, 结果:,ok_39025: [3条]' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')

    // 「发本页任务」收进「发后续 ▾」下拉了，得先展开菜单才点得到（M3-0G 复议布局调整）。
    await wrapper.get('[data-testid="data-exec-more-toggle"]').trigger('click')
    // 旧平台「发本页任务」（sendNextCurPage）没有"先勾选"这个前置条件——不勾选任何行也能点。
    const pageBtn = teleported('[data-testid="data-exec-page-btn"]')
    expect((pageBtn.element as HTMLButtonElement).disabled).toBe(false)

    await pageBtn.trigger('click')
    await flushPromises()

    expect(nextStep).toHaveBeenCalledWith(current.sourceId, 'T2', ['d1', 'd2', 'd3'])
    expect(ElMessage.success).toHaveBeenCalledWith('已提交 3 条，3 条已进入下一步')
  })

  it('发本页任务成功后，若还有下一页则自动翻页；已是最后一页则停留原地', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 25,
      list: [{ dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' }],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '本次发送:1 条, 结果:,ok_39025: [1条]' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    query.mockClear()

    await wrapper.get('[data-testid="data-exec-more-toggle"]').trigger('click')
    await teleported('[data-testid="data-exec-page-btn"]').trigger('click')
    await flushPromises()

    // total 25、每页 20，第 1 页发完确实还有第 2 页——应自动翻页重新查询。
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('发全部后续（M3-0G 复议）：走 nextStepBatch，硬编码 size=500000/start=0，带上当前筛选的 state/cond，不含 dataId/parentId', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStepBatch = vi.spyOn(dataApi, 'nextStepBatch').mockResolvedValue({ message: '已提交' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    await wrapper.get('select.rv-input.st').setValue('E')
    await wrapper.get('input.rv-input.flex').setValue("K1 IS NULL")

    await wrapper.get('[data-testid="data-exec-more-toggle"]').trigger('click')
    await teleported('[data-testid="data-exec-all-btn"]').trigger('click')
    await flushPromises()

    expect(nextStepBatch).toHaveBeenCalledWith({
      tableId: 'T2', sourceId: current.sourceId,
      state: 'E', cond: 'K1 IS NULL',
      size: 500000, start: 0,
    })
  })

  it('发大量后续（M3-0G 复议）：打开面板会把「至该ID止」预填为当页最大 dataId', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 3,
      list: [
        { dataId: '101', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' },
        { dataId: '305', sourceId: current.sourceId, title: 'B', summary: '', acceptState: 'pending' },
        { dataId: '204', sourceId: current.sourceId, title: 'C', summary: '', acceptState: 'pending' },
      ],
    })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')

    await wrapper.get('[data-testid="data-exec-more-toggle"]').trigger('click')
    await teleported('[data-testid="data-exec-batch-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="data-sendmore-panel"]').exists()).toBe(true)
    const endInput = wrapper.findAll('.rv-sendmore-field input').find((i) => (i.element as HTMLInputElement).placeholder === '不填则不限')!
    expect((endInput.element as HTMLInputElement).value).toBe('305')
  })

  it('发大量后续（M3-0G 复议）：真实校验数量上限——旧平台"1-1W条"只是标签文字、代码里从没校验过，这里必须真拦', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    const nextStepBatch = vi.spyOn(dataApi, 'nextStepBatch').mockResolvedValue({ message: '已提交' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    await wrapper.get('[data-testid="data-exec-more-toggle"]').trigger('click')
    await teleported('[data-testid="data-exec-batch-toggle"]').trigger('click')
    await flushPromises()

    const sizeInput = wrapper.get('[data-testid="data-sendmore-size"]')
    const submitBtn = wrapper.get('[data-testid="data-sendmore-submit"]')

    await sizeInput.setValue('500000')
    expect(wrapper.get('[data-testid="data-sendmore-error"]').text()).toContain('最多 10000 条')
    expect((submitBtn.element as HTMLButtonElement).disabled).toBe(true)
    await submitBtn.trigger('click')
    expect(nextStepBatch).not.toHaveBeenCalled()

    await sizeInput.setValue('0')
    expect(wrapper.get('[data-testid="data-sendmore-error"]').text()).toContain('必须是 1 及以上的整数')

    await sizeInput.setValue('abc')
    expect(wrapper.get('[data-testid="data-sendmore-error"]').text()).toContain('必须是 1 及以上的整数')
  })

  it('发大量后续（M3-0G 复议）：数量合法时提交，走 nextStepBatch 并复用回执解析，成功后收起面板', async () => {
    vi.mocked(ElMessage.success).mockClear()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStepBatch = vi.spyOn(dataApi, 'nextStepBatch').mockResolvedValue({ message: '本次发送:200 条, 结果:,ok_39025: [200条]' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    await wrapper.get('[data-testid="data-exec-more-toggle"]').trigger('click')
    await teleported('[data-testid="data-exec-batch-toggle"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="data-sendmore-size"]').setValue('200')
    await wrapper.get('[data-testid="data-sendmore-submit"]').trigger('click')
    await flushPromises()

    expect(nextStepBatch).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'T2', sourceId: current.sourceId, size: 200, start: 0 }))
    expect(ElMessage.success).toHaveBeenCalledWith('已提交 200 条，200 条已进入下一步')
    expect(wrapper.find('[data-testid="data-sendmore-panel"]').exists()).toBe(false)
  })

  it('发全部后续/发大量后续失败时同样补上目标节点名（M3-0K 覆盖范围扩到批量接口，不止逐行/本页两个入口）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    vi.spyOn(dataApi, 'nextStepBatch').mockRejectedValue(new Error('错误信息:运行时异常'))

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    await wrapper.get('[data-testid="data-exec-more-toggle"]').trigger('click')
    await teleported('[data-testid="data-exec-all-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith(
      '目标节点"入库"处理失败：错误信息:运行时异常（多为该节点的进入条件表达式写错，可检查节点配置里的进入条件）',
    )
  })

  it('数据视图页大小选择器（M3-0F）：旧平台是 [20,40,100,200]，此前写死 20', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()

    // 分页简化成一个 el-pagination（2026-08-19）：page-sizes 就是可选项，不再是一个
    // 独立 <select> 的 <option> 列表。这个项目没有全局安装 Element Plus 插件（vitest.config.ts
    // 没配 setupFiles），测试环境里 Vue 把 <el-pagination> 当未识别的自定义元素处理，
    // 不是真实组件实例——findComponent 拿不到、也没法用 .vm.$emit 真实触发它内部的
    // update:page-size/size-change（原生自定义元素的事件是走 DOM addEventListener，
    // $event 会是原生 Event 对象而不是 Element Plus emit 出的数字，硬凑会验证出错误的
    // 语义，不是真交互）。项目里其他用 el-pagination 的地方也都没写过这类交互测试，
    // 是同一个环境限制，不是这里独有。改成验证"绑进去的 props 是不是我们想要的值"——
    // 静态断言，DOM attributes 查询即可，不依赖组件被真实解析。
    const pagination = wrapper.get('[data-testid="data-pagination"]')
    expect(pagination.attributes('page-sizes')).toBe('20,40,100,200')
    expect(pagination.attributes('page-size')).toBe('20')

    // size 变化后重新查询这条链路本身很薄（@size-change="runQuery"，一行调用），
    // runQuery 的正确性已经被"清空筛选"等其他测试路径间接覆盖，这里不重复验证。
  })

  it('发后续任务真实回执解析（M3-0J）：全部被目标节点进入条件拒绝时弹 warning，不能显示成功', async () => {
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.warning).mockClear()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 2,
      list: [
        { dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' },
        { dataId: 'd2', sourceId: current.sourceId, title: 'B', summary: '', acceptState: 'pending' },
      ],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    // 真实测试环境实测样例（2026-08-18，见方案 §12.1B）：提交数与 reject 数一致，没有任何 ok_ 分组
    vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '本次发送:2 条, 结果:,reject_39025: [2条]' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['d1', 'd2'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith('已提交 2 条，全部被目标节点的进入条件拒绝，未进入下一步')
  })

  it('发后续任务真实回执解析（M3-0J）：部分被拒绝时弹 warning 并展示进入/拒绝的拆分数字', async () => {
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.warning).mockClear()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 3,
      list: [
        { dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' },
        { dataId: 'd2', sourceId: current.sourceId, title: 'B', summary: '', acceptState: 'pending' },
        { dataId: 'd3', sourceId: current.sourceId, title: 'C', summary: '', acceptState: 'pending' },
      ],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '本次发送:3 条, 结果:,ok_39025: [1条],reject_39025: [2条]' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['d1', 'd2', 'd3'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith('已提交 3 条：1 条已进入下一步，2 条被进入条件拒绝')
  })

  it('发后续任务真实回执解析（M3-0J）：全部进入时正常弹 success，展示解析后的进入条数', async () => {
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.warning).mockClear()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 2,
      list: [
        { dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' },
        { dataId: 'd2', sourceId: current.sourceId, title: 'B', summary: '', acceptState: 'pending' },
      ],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '本次发送:2 条, 结果:,ok_39025: [2条]' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['d1', 'd2'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.warning).not.toHaveBeenCalled()
    expect(ElMessage.success).toHaveBeenCalledWith('已提交 2 条，2 条已进入下一步')
  })

  it('发后续任务失败（节点进入条件语法错误）时报错补上目标节点名和排查提示（M3-0K）', async () => {
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.error).mockClear()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' }],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    // 真实测试环境实测样例（2026-08-18，见方案 §12.1B）：cond 语法错误时业务失败，
    // client.ts 现已把 msg 与 envelope.data 拼在一起抛出。
    vi.spyOn(dataApi, 'nextStep').mockRejectedValue(
      new Error("错误信息:运行时异常：<Long, 1> can't be a left value for assignment."),
    )

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['d1'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalledWith(
      "目标节点\"入库\"处理失败：错误信息:运行时异常：<Long, 1> can't be a left value for assignment.（多为该节点的进入条件表达式写错，可检查节点配置里的进入条件）",
    )
  })

  it('发后续任务失败但不是"运行时异常"（如生产写保护）时只补节点名，不误导成条件问题（M3-0K）', async () => {
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.error).mockClear()
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' }],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    vi.spyOn(dataApi, 'nextStep').mockRejectedValue(new Error('生产环境写保护：端点不在允许清单'))

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['d1'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('目标节点"入库"处理失败：生产环境写保护：端点不在允许清单')
  })

  it('有效输入表被多个节点共用（歧义）时禁用执行按钮并说明原因', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid') // mid 和 mid2 都显式声明输入表 T1，互相冲突

    // 默认停在输出 tab，这时按钮直接不渲染（换成说明文字），先切到"输入"才看得到歧义判定。
    await wrapper.get('[data-testid="data-scope-input"]').trigger('click')
    await flushPromises()

    const btn = wrapper.get('[data-testid="data-exec-btn"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(btn.attributes('title')).toContain('该输入表被多个节点共用')
    // 歧义节点不允许勾选行（canPickRows 应为 false，不渲染勾选列）
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(false)
  })

  it('点击发起抓取后取消确认框：不调用 sendSnatch', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel')
    const sendSnatch = vi.spyOn(sourceApi, 'sendSnatch')

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(sendSnatch).not.toHaveBeenCalled()
  })

  it('切换节点会清空已勾选的行', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1, list: [{ dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' }],
    })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['d1'])
    await flushPromises()
    expect(wrapper.text()).toContain('已选 1 条')

    await selectNode(wrapper, 'mid')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectedIds')).toEqual([])
  })
})

describe('ResultView · 上游数据下钻（M3-0B：旧平台 EntryList2.vue 有的父ID可点功能，新平台迁移时漏了，数据本身早就在——categoryId/parentId 只是没渲染入口）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('行带 categoryId+parentId 时详情抽屉里父 ID 可点，点开后展示上游行数据（只放详情抽屉，不占表格列宽——M3-0B 方案 A）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const row: DataRow = {
      dataId: 'd1', sourceId: current.sourceId, title: '详情行', summary: '', acceptState: 'accepted',
      values: {}, categoryId: 'TB_PARENT', parentId: 'p-9001',
    }
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [row], total: 1 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    const rowDetail = vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: { ...row, dataId: 'p-9001', categoryId: undefined, parentId: undefined },
      showItems: [{ columnName: 'K1', itemName: '标题', value: '上游标题' }],
    })

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-click', row)
    await flushPromises()

    const parentBtn = wrapper.get('[data-testid="data-parent-drill"]')
    expect(parentBtn.text()).toContain('p-9001')
    expect(wrapper.find('[data-testid="data-parent-panel"]').exists()).toBe(false)

    await parentBtn.trigger('click')
    await flushPromises()

    expect(rowDetail).toHaveBeenCalledWith('TB_PARENT', 'p-9001')
    const panel = wrapper.get('[data-testid="data-parent-panel"]')
    expect(panel.text()).toContain('标题')
    expect(panel.text()).toContain('上游标题')
  })

  it('行没有 categoryId/parentId（或 parentId 是 "0"）时不渲染下钻入口', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const row: DataRow = { dataId: 'd2', sourceId: current.sourceId, title: '无父行', summary: '', acceptState: 'accepted', values: {}, parentId: '0' }
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [row], total: 1 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-click', row)
    await flushPromises()

    expect(wrapper.find('[data-testid="data-parent-drill"]').exists()).toBe(false)
  })

  it('换行打开新详情时收起上一行残留的上游数据面板', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const row1: DataRow = { dataId: 'd1', sourceId: current.sourceId, title: '行1', summary: '', acceptState: 'accepted', values: {}, categoryId: 'TB_PARENT', parentId: 'p-1' }
    const row2: DataRow = { dataId: 'd2', sourceId: current.sourceId, title: '行2', summary: '', acceptState: 'accepted', values: {} }
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [row1, row2], total: 2 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: { ...row1, dataId: 'p-1' },
      showItems: [{ columnName: 'K1', itemName: '标题', value: '上游标题' }],
    })

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-click', row1)
    await flushPromises()
    await wrapper.get('[data-testid="data-parent-drill"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="data-parent-panel"]').exists()).toBe(true)

    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-click', row2)
    await flushPromises()

    expect(wrapper.find('[data-testid="data-parent-panel"]').exists()).toBe(false)
  })
})
