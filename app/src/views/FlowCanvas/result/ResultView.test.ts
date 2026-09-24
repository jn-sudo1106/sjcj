// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import ResultView from './ResultView.vue'
import { readSqlConditions } from '@/utils/sqlConditionHistory'
import ProcessNodeRail from './ProcessNodeRail.vue'
import SnatchLauncher from '@/views/FlowCanvas/source/SnatchLauncher.vue'
import { dataApi, isProductionBackend, ruleApi, siteApi, sourceApi, type DataRow, type DataTableMeta, type Source, type Step } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

// 只替换 isProductionBackend，其余照搬真实模块——现有用例的 vi.spyOn(dataApi, …)
// 作用在同一个 dataApi 对象引用上，不受影响。
const routerPush = vi.fn()
// replace 是「带条件进来」用的：cond* 参数消费完要从 URL 抹掉（2026-09-09）
const routerReplace = vi.fn()
const mockRouteQuery: Record<string, string> = { siteId: '1', sourceId: '391007768', view: 'data' }
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  // 跳转要透传当前 query（否则会丢 siteId，左侧源列表整个不渲染）
  useRoute: () => ({ query: mockRouteQuery, path: '/canvas' }),
}))

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return { ...actual, isProductionBackend: vi.fn(() => false) }
})

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }
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
  props: ['meta', 'rows', 'loading', 'selectedId', 'compact', 'hideActions', 'sourceNames', 'sourceColLabel', 'selectable', 'selectedIds', 'presetCols', 'visibleFieldProps', 'forceAllColumns', 'allowRowEdit', 'allowRowDelete'],
  emits: ['row-click', 'row-action', 'update:selectedIds'],
  template: '<div class="dg-stub"><slot name="head" /><slot name="head-right" /><slot name="foot" /></div>',
}
const ElDrawerStub = { name: 'ElDrawer', props: ['modelValue'], template: '<div><slot /></div>' }
const ElDialogStub = { name: 'ElDialog', props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' }
const TaskInstDialogStub = { name: 'TaskInstDialog', props: ['modelValue', 'sourceId', 'parentId', 'canWrite'], template: '<div />' }
const RowDetailFieldsStub = {
  name: 'RowDetailFields',
  props: ['fields', 'editing', 'values', 'compact', 'showEmpty', 'visibleProps'],
  template: '<div class="rdf-stub"><div v-for="f in (fields || [])" :key="f.key">{{ f.name }} {{ f.value }}</div></div>',
}
const FilePreviewStub = { name: 'FilePreview', props: ['path', 'name', 'ext'], template: '<div data-testid="data-cell-file-preview">{{ path }}</div>' }
// 删除数据下拉（2026-09-09）：shallowMount 默认桩不渲染插槽，菜单项一条都断言不到。
// 显式桩把默认插槽（触发按钮）和 #dropdown（菜单）都摊平渲染；item 保持单根，
// 模板上的 @click 走 attrs fallthrough，跟真实 ElDropdownItem 一样能点。
const ElDropdownStub = { name: 'ElDropdown', template: '<div><slot /><slot name="dropdown" /></div>' }
const ElDropdownMenuStub = { name: 'ElDropdownMenu', template: '<div><slot /></div>' }
const ElDropdownItemStub = { name: 'ElDropdownItem', props: ['disabled', 'divided'], template: '<div class="el-dropdown-item" :disabled="disabled ? \'\' : undefined"><slot /></div>' }
const STUBS = { ElDropdown: ElDropdownStub, ElDropdownMenu: ElDropdownMenuStub, ElDropdownItem: ElDropdownItemStub, SqlConditionEditor: false, CanvasHeader: true, ElDrawer: ElDrawerStub, ElDialog: ElDialogStub, ElPagination: true, DataGrid: DataGridStub, TaskInstDialog: TaskInstDialogStub, RowDetailFields: RowDetailFieldsStub, FilePreview: FilePreviewStub, SummaryDrawer: true }

function mountResultView() {
  return shallowMount(ResultView, {
    global: {
      directives: { loading: {} },
      // SnatchLauncher 需真实渲染：onSendFetch 通过它的 launch 走 loadParams→sendSnatchWithParam，
      // 其孙级 SourceParamModal 在 shallowMount 下仍被桩（本测试只覆盖无参数的直发路径）。
      //
      // 0903 Y0-B：`teleport: false` 已去掉——它是给「发后续 ▾」那个 Teleport 到 body 的
      // 展开面板准备的，面板随发本页/发大量两项一起删了，现在没有任何 Teleport 需要真实渲染。
      stubs: { ...STUBS, SnatchLauncher },
    },
  })
}

afterEach(() => localStorage.clear())

beforeEach(() => {
  localStorage.setItem('rc.dataview.result.railOpen', '1')
})

describe('ResultView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete mockRouteQuery.scriptPath
    delete mockRouteQuery.dataId
  })

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

  it('带 scriptPath 进入数据视图时不会自动打开文件预览', async () => {
    setActivePinia(createPinia())
    mockRouteQuery.scriptPath = '/code01/202609/1788326374508.py'
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.find('[data-testid="data-cell-file-preview"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="script-test-dialog"]').exists()).toBe(false)
    delete mockRouteQuery.scriptPath
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

  it('行内「编辑」：走 row-action edit，打开抽屉并直接进入编辑态', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const rows: DataRow[] = [
      { dataId: 'entry-1', sourceId: current.sourceId, title: '第一条', summary: '', acceptState: 'pending', values: { content: '初始内容' } },
    ]
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: rows, total: 1 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    expect(grid.props('allowRowEdit')).toBe(true)

    await grid.vm.$emit('row-action', rows[0], 'edit')
    await flushPromises()

    const fieldsComp = wrapper.findComponent({ name: 'RowDetailFields' })
    expect(fieldsComp.props('editing')).toBe(true)
    expect(fieldsComp.props('values')).toMatchObject({ content: '初始内容' })
    expect(wrapper.find('.rv-d-foot').text()).toContain('保存')
    expect(wrapper.find('.rv-d-foot').text()).toContain('取消')
  })

  // 2026-09-23 用户报：TB_YOUTUBE 的 K17「字幕minio地址」是 .mp3，点开打不开——extFromFieldHint 把 K17
  // 一律猜成 html（新闻表 K17 是网页快照），猜的 html 盖掉了路径自带的 .mp3。路径有后缀时以路径为准。
  it('文件预览：路径自带后缀时扩展名以路径为准，K17 上的 .mp3 不会被猜成 html', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()
    const grid = wrapper.findComponent({ name: 'DataGrid' })

    await grid.vm.$emit('file-click', '/qinlong/youtube/a.mp3', { prop: 'zimu', columnName: 'K17', desc: '字幕minio地址' })
    await flushPromises()
    let preview = wrapper.findComponent({ name: 'FilePreview' })
    expect(preview.props('path')).toBe('/qinlong/youtube/a.mp3')
    expect(preview.props('ext')).toBe('mp3')

    // 没后缀的 K17（新闻表网页快照）照旧按字段猜成 html
    await grid.vm.$emit('file-click', '/qinlong/dds/abc', { prop: 'html', columnName: 'K17', desc: '网页快照' })
    await flushPromises()
    preview = wrapper.findComponent({ name: 'FilePreview' })
    expect(preview.props('path')).toBe('/qinlong/dds/abc.html')
    expect(preview.props('ext')).toBe('html')
  })

  // 2026-09-23 用户报：TB_YOUTUBE 改 K19「视频minio地址」保存不了。原因是按逻辑名（video_minio）发给
  // entry/entryUpdate，后端只认物理列名（K19）。改为只提交改过的字段、键用物理列名。
  it('保存行编辑：只提交改过的字段，键用物理列名（K 列），系统列不提交；本地行就地更新', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const ytMeta: DataTableMeta = {
      tableId: '2101720', tableName: 'sense_data.TB_YOUTUBE', rowCount: 1,
      fields: [
        { prop: 'URLTITLE', columnName: 'K1', type: 'string', desc: '标题' },
        { prop: 'video_minio', columnName: 'K19', type: 'string', desc: '视频minio地址' },
      ],
    }
    const rows: DataRow[] = [
      { dataId: '3819088', sourceId: current.sourceId, title: '', summary: '', acceptState: 'pending', values: { K1: '标题', K19: '/qinlong/a.mp3' } },
    ]
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: rows, total: 1 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(ytMeta)
    const update = vi.spyOn(dataApi, 'rowUpdate').mockResolvedValue({ message: '修改成功' })

    const wrapper = mountResultView()
    await flushPromises()
    // 走详情抽屉底部的「编辑」按钮进入编辑态（不依赖行内编辑入口）
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action', rows[0], 'detail')
    await flushPromises()
    await wrapper.findAll('.rv-d-foot button').find((b) => b.text() === '编辑')!.trigger('click')
    await flushPromises()

    const fieldsComp = wrapper.findComponent({ name: 'RowDetailFields' })
    await fieldsComp.vm.$emit('update:field', { prop: 'video_minio', value: '/qinlong/a.mp4' })
    await wrapper.findAll('.rv-d-foot button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    const [, dataId, changes] = update.mock.calls[0]
    expect(dataId).toBe('3819088')
    // 只有改过的 K19；没改的 K1、系统列 ENTRY_ID 都不在里面，也没有逻辑名 video_minio
    expect(changes).toEqual({ K19: '/qinlong/a.mp4' })
    // 不用手动刷新：详情里立刻是新值
    expect(wrapper.findComponent({ name: 'RowDetailFields' }).props('fields')
      .find((f: { prop: string }) => f.prop === 'video_minio').value).toBe('/qinlong/a.mp4')
  })

  it('保存行编辑：什么都没改就不发请求', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const rows: DataRow[] = [
      { dataId: 'entry-1', sourceId: current.sourceId, title: '', summary: '', acceptState: 'pending', values: { content: '初始内容' } },
    ]
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: rows, total: 1 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const update = vi.spyOn(dataApi, 'rowUpdate')

    const wrapper = mountResultView()
    await flushPromises()
    // 走详情抽屉底部的「编辑」按钮进入编辑态（不依赖行内编辑入口）
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-action', rows[0], 'detail')
    await flushPromises()
    await wrapper.findAll('.rv-d-foot button').find((b) => b.text() === '编辑')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('.rv-d-foot button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(update).not.toHaveBeenCalled()
    expect(ElMessage.info).toHaveBeenCalledWith('没有改动')
    // 退出编辑态
    expect(wrapper.findComponent({ name: 'RowDetailFields' }).props('editing')).toBe(false)
  })

  it('测试脚本会把 scriptPath 和当前行参数一起送到执行接口，并展示返回结果', async () => {
    setActivePinia(createPinia())
    mockRouteQuery.scriptPath = '/code01/202609/1788327078099.py'
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    flow.configs['391007768-s1'].ruleCfg = {
      mode: 'ref',
      describe: '',
      inputTableId: '2102157',
      inputFields: ['content'],
      outputFields: [],
    }
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [
        {
          dataId: 'row-1',
          sourceId: current.sourceId,
          title: '测试行',
          summary: '',
          acceptState: 'pending',
          values: { K1: '正文', K2: 'AVC-清洁电器-线下市场月度监测数据报告（25.08）' },
        },
      ],
    })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({
      ...meta,
      fields: [{ prop: 'content', type: 'string', desc: '内容', columnName: 'K1' }],
    })
    const execSpy = vi.spyOn(ruleApi, 'executeCode').mockResolvedValue({ success: true, outputs: [{ ok: true }] })

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-click', {
      dataId: 'row-1',
      sourceId: current.sourceId,
      title: '测试行',
      summary: '',
      acceptState: 'pending',
      values: { K1: '正文', K2: 'AVC-清洁电器-线下市场月度监测数据报告（25.08）' },
    })
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '测试脚本')!.trigger('click')
    await flushPromises()

    expect(execSpy).toHaveBeenCalledWith({
      codePath: '/code01/202609/1788327078099.py',
      params: { content: '正文' },
      timeout: 300,
    })
    expect(wrapper.text()).toContain('"success": true')
    expect(wrapper.text()).toContain('"ok": true')
  })

  it('测试脚本只发送表配置选中的入参字段，不把当前行其他字段拼入 params', async () => {
    setActivePinia(createPinia())
    mockRouteQuery.scriptPath = '/code01/202609/1788941858106.py'
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    flow.configs.last = cfg({
      title: '规则处理',
      inputTable: 'T2',
      ruleCfg: {
        mode: 'ref',
        describe: '',
        inputTableId: 'T2',
        inputFields: ['code'],
        outputFields: ['result'],
      },
    })
    const row = {
      dataId: 'row-1',
      sourceId: current.sourceId,
      title: '测试行',
      summary: '',
      acceptState: 'pending' as const,
      values: { K1: '1121250', K2: '万微测试', K3: '执行成功' },
    }
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [row] })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({
      ...meta,
      tableId: 'T2',
      fields: [
        { prop: 'code', type: 'string', desc: '编码', columnName: 'K1' },
        { prop: 'name', type: 'string', desc: '名称', columnName: 'K2' },
        { prop: 'url', type: 'string', desc: 'URL', columnName: 'K3' },
      ],
    })
    const execSpy = vi.spyOn(ruleApi, 'executeCode').mockResolvedValue({ success: true, outputs: [] })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-click', row)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '测试脚本')!.trigger('click')
    await flushPromises()

    expect(execSpy).toHaveBeenCalledWith({
      codePath: '/code01/202609/1788941858106.py',
      params: { code: '1121250' },
      timeout: 300,
    })
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
  const input = wrapper.get('[data-testid="data-cond-sql"]')
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
    const tableId = query.mock.calls.at(-1)![0].tableId
    expect(readSqlConditions(tableId)).toEqual(["K1 LIKE '%工行%'"])
    query.mockImplementation(async (_query, options) => {
      if (options?.mode === 'mock') return { list: [], total: 0 }
      throw new Error('SQL syntax')
    })
    await typeSql(wrapper, 'bad sql')
    await wrapper.findAll('.rv-actions button').find((button) => button.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(readSqlConditions(tableId)).toEqual(["K1 LIKE '%工行%'"])
    expect(wrapper.find('[data-testid="data-filters-dirty"]').exists()).toBe(false)
  })
})

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

  it('首节点只有输出表：摘要行不出现可点的范围切换控件，从输出表勾行发后续（0824）', async () => {
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
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发后续任务')
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.find('[data-testid="data-exec-all-btn"]').exists()).toBe(true)
  })

  it('输入表===输出表（如规则处理节点）时，摘要行合并成一个 tab，不再有输入/输出切换（M3-0C 方案 A）；该 fixture 的 mid 已是末节点，0831 改成从上一节点重跑', async () => {
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
    // 末节点：不发后续，但从上一节点重跑（0831 X7-B）
    expect(wrapper.findComponent({ name: 'DataGrid' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('从上一节点重跑')
    expect(wrapper.find('[data-testid="data-exec-all-btn"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('发后续任务')
  })

  it('输入表≠输出表（正常场景）时保留双 tab 切换，输出 tab 允许勾选发后续任务，切到"输入"可勾选发起本节点任务', async () => {
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

    // 输出 tab：本节点产出数据，发给后续节点，默认允许勾选并显示发后续任务按钮
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发后续任务')

    await inputBtn.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发起本节点任务')
    // 分页简化成一个 el-pagination（2026-08-19），不再是"第 N 页"文字——这里只确认
    // 分页控件确实渲染了，具体交互由下面 M3-0F 那组测试单独覆盖。
    expect(wrapper.find('[data-testid="data-pagination"]').exists()).toBe(true)
  })

  // 默认值已于 0910 会议 §2-2 翻成收起（推翻 08-15「不靠默认折叠换那几行」的定案），
  // 由上面的 beforeEach 喂成展开态；这条现在验证的是**开合本身**能来回切。
  // 「默认收起」在文件末尾的折叠组里单独测。
  it('轨道能收起再展开', async () => {
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

  it('全屏：隐藏源信息头，保留筛选与当前节点的执行入口；补出源名；Esc 退出', async () => {
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
    // 筛选条件、发后续入口——全屏不是"只能看不能用"
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-cond-sql"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-exec-btn"]').exists()).toBe(true)
    // 源信息头没了，源名要在筛选行补回来，否则看不出在看哪个源的数据
    expect(wrapper.find('.rv-fs-source').text()).toBe(current.name)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('.rv-shell').classes()).not.toContain('is-fullscreen')
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
  })

  it('流程节点的「查看条件」入口已去掉，不再渲染查看条件按钮', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    flow.configs[ruleNodeId] = cfg({ title: '规则处理', entryCondition: { logic: 'AND', items: [{ field: 'title', op: 'contains', value: '公告' }] } })
    flow.main.splice(2, 0, ruleNodeId)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, ruleNodeId)

    expect(wrapper.find('[data-testid="data-node-condition-link"]').exists()).toBe(false)
    expect(wrapper.find('.ctx-detail').exists()).toBe(false)
  })

  it('没有进入条件也不在任何分支上的节点，不出现"查看条件"', async () => {
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

    expect(wrapper.find('[data-testid="data-node-condition-link"]').exists()).toBe(false)
  })

  it('分支上的节点同样不出现「查看条件」入口', async () => {
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

    expect(wrapper.find('[data-testid="data-node-condition-link"]').exists()).toBe(false)
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

describe('ResultView · 默认节点与默认列（0831 F09/F10）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('默认选中首个节点，不是末端结果表', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.findComponent(ProcessNodeRail).props('modelValue')).toBe('first')
  })

  it('再次进入数据视图恢复快照中选中的节点与页码', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    const ws = useWorkspaceStore()
    ws.open('391007768', 'demo')
    ws.saveSnapshot('391007768', { view: 'data', selectedNodeId: 'sink', page: 3 })
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.findComponent(ProcessNodeRail).props('modelValue')).toBe('sink')
    expect(query.mock.calls.at(-1)![0].page).toBe(3)
  })

  it('数据视图选定节点后切到任务视图再切回，保持选中的节点不重置为初始节点', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    const ws = useWorkspaceStore()
    ws.open('391007768', 'demo')
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    // 首次进入：默认是首节点
    let wrapper = mountResultView()
    await flushPromises()
    expect(wrapper.findComponent(ProcessNodeRail).props('modelValue')).toBe('first')

    // 用户在数据视图中选择了中间节点 mid
    wrapper.findComponent(ProcessNodeRail).vm.$emit('update:modelValue', 'mid')
    await flushPromises()
    expect(wrapper.findComponent(ProcessNodeRail).props('modelValue')).toBe('mid')
    expect(ws.snapshotOf('391007768')?.selectedNodeId).toBe('mid')

    // 模拟切到任务视图（组件销毁卸载）
    wrapper.unmount()
    await flushPromises()

    // 模拟再切回数据视图（组件重新挂载）
    wrapper = mountResultView()
    await flushPromises()

    // 应当保持选中的 mid 节点，而不是变回 first
    expect(wrapper.findComponent(ProcessNodeRail).props('modelValue')).toBe('mid')
  })

  it('默认列取后继节点的上下文来源 + 进入条件字段，换算成当前表的 prop 传给表格', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    // mid / mid2 都直接消费 first 的输出表，是 first 的后继（本 fixture 里 mid 在前）
    flow.configs.mid.taskCfg = { queue: '', urlRule: '', contextMap: ['K1'] }
    flow.configs.mid.entryCondition = { logic: 'AND', items: [{ field: 'author', op: 'notEmpty', value: '' }] }
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({
      tableId: 'T1', tableName: '列表', rowCount: 0,
      fields: [
        { prop: 'title', columnName: 'K1', type: 'string', desc: '标题' },
        { prop: 'body', columnName: 'K2', type: 'string', desc: '正文' },
        { prop: 'author', columnName: 'K3', type: 'string', desc: '作者' },
      ],
    })

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('presetCols')).toEqual(['title', 'author'])
  })

  it('末节点算不出后继，预设为空——表格据此退回全部列', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'sink')

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('presetCols')).toEqual([])
  })

  it('点击「节点配置」展开右侧面板时，数据表只展示当前节点表配置的入参字段', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    flow.configs.mid.ruleCfg = {
      mode: 'ref',
      describe: '',
      inputTableId: 'T1',
      inputFields: ['title'],
      outputFields: ['body'],
    }
    const ui = useUiStore()
    ui.inspectorCollapsed = true
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({
      tableId: 'T1', tableName: '列表', rowCount: 0,
      fields: [
        { prop: 'title', columnName: 'K1', type: 'string', desc: '标题' },
        { prop: 'body', columnName: 'K2', type: 'string', desc: '正文' },
        { prop: 'url', columnName: 'K3', type: 'string', desc: '链接' },
      ],
    })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid')
    ui.toggleInspectorCollapsed()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('visibleFieldProps')).toEqual(['title'])
  })

  it('点击数据视图中的流程节点时正常展示全部字段，不按入参字段或下一步字段隐藏列', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    flow.configs.mid.ruleCfg = {
      mode: 'ref',
      describe: '',
      inputTableId: 'T1',
      inputFields: ['title'],
      outputFields: ['body'],
    }
    const ui = useUiStore()
    ui.inspectorCollapsed = false
    ui.inspectorFieldFilterActive = false
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({
      tableId: 'T1', tableName: '列表', rowCount: 0,
      fields: [
        { prop: 'title', columnName: 'K1', type: 'string', desc: '标题' },
        { prop: 'body', columnName: 'K2', type: 'string', desc: '正文' },
        { prop: 'url', columnName: 'K3', type: 'string', desc: '链接' },
      ],
    })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid')

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('visibleFieldProps')).toBeUndefined()
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('forceAllColumns')).toBe(true)
  })
})

// 规则处理节点（无 collectCfg）的固定 ID，供进入条件用例显式构造，不依赖种子自动补节点。
const ruleNodeId = '391007768-rule-node'

function cfg(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return { title: '', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], ...overrides }
}

// 自定义一条干净的主链，绕开 391007768 demo 流程里 s1/规则处理输出表恰好撞同名的巧合，
// 精确控制"唯一消费者 / 多消费者共用同一张输入表"两种场景：
//   first(输出 T1，无输入，首节点) → mid(输入 T1，输出 T2) → last(输入 T2，唯一消费者) → sink(输入 T4，真末节点)
//   mid2 单独把输入也显式设成 T1，跟 mid 撞车，制造 M2-14 的歧义场景
//   0824：last 后面补 sink，让既有 nextStep 用例继续选 last 发后续；sink 才是没有后继的末节点。
function loadExecFixture(flow: ReturnType<typeof useFlowStore>, current: Source) {
  flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
  flow.main.splice(0, flow.main.length, 'start', 'first', 'mid', 'mid2', 'last', 'sink', 'end')
  Object.assign(flow.configs, {
    first: cfg({ title: '抓取列表页', outputTable: 'T1' }),
    mid: cfg({ title: '处理A', inputTable: 'T1', outputTable: 'T2' }),
    mid2: cfg({ title: '处理B', inputTable: 'T1', outputTable: 'T3' }),
    last: cfg({ title: '入库', inputTable: 'T2' }),
    sink: cfg({ title: '完成', inputTable: 'T4' }),
  })
}

// 干净的"输入≠输出、唯一消费者"场景（M3-0C）：跟 loadExecFixture 分开，避免复用 mid 时
// 撞上 mid2 制造的 M2-14 歧义——这里就是想测"正常、不歧义"的双 tab 场景本身。
// mid 后面还有 last，0824 仍展示发后续；last 才是末节点（本 fixture 的双 tab 用例选的是 mid）。
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
// 0824：这条链 first→mid，mid 已是末节点，不展示发后续。
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

  it('首节点只有输出表：勾选行后发后续任务，调用 nextStep（0824：列表行发给后继，不是按源抓取）', async () => {
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
    const sendSnatch = vi.spyOn(sourceApi, 'sendSnatchWithParam')
    const nextStep = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已提交 2 条' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')

    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发后续任务')
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.find('[data-testid="data-exec-all-btn"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('已选 0 条')

    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['d1', 'd2'])
    await flushPromises()
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(sendSnatch).not.toHaveBeenCalled()
    expect(nextStep).toHaveBeenCalledWith(current.sourceId, 'T1', ['d1', 'd2'])
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectedIds')).toEqual(['d1', 'd2'])
  })

  // 0917-05（2026-09-21）：勾 ≤20 条零弹框。会上原话「就不要弹框」「什么确认一下，不要确认」。
  // 上面那条已经能证明 nextStep 被调用；这条专门钉住"确认框根本没出现"。
  it('勾 20 条以内：零弹框直接发（0917-05）', async () => {
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
    const confirm = vi.mocked(ElMessageBox.confirm)
    confirm.mockClear()
    const nextStep = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已提交 2 条' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['d1', 'd2'])
    await flushPromises()
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    expect(nextStep).toHaveBeenCalledWith(current.sourceId, 'T1', ['d1', 'd2'])
  })

  it('首节点显式有输入表且后面还有后继：按钮是「发后续任务」，不是「发起抓取」（0824：前一个节点把行发给后一个）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    flow.main.splice(0, flow.main.length, 'start', 'first', 'mid', 'last', 'end')
    Object.assign(flow.configs, {
      first: cfg({ title: '列表', inputTable: 'T0', outputTable: 'T1' }),
      mid: cfg({ title: '详情', inputTable: 'T1', outputTable: 'T2' }),
      last: cfg({ title: '入库', inputTable: 'T2' }),
    })
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')

    // 输出 tab：本节点产物发给后续 mid 节点，默认可勾选且按钮是发后续任务
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发后续任务')
    expect(wrapper.find('[data-testid="data-exec-all-btn"]').exists()).toBe(true)

    await wrapper.get('[data-testid="data-scope-input"]').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发起本节点任务')
    expect(wrapper.find('[data-testid="data-exec-all-btn"]').exists()).toBe(true)
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

    expect(nextStep).toHaveBeenCalledWith(current.sourceId, 'T4', ['d1', 'd2'])
    expect(ElMessage.success).toHaveBeenCalledWith('已提交 2 条')
  })

  it('末节点没有直接后继：不展示发后续，改为从上一节点重跑（0831 X7-B）', async () => {
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

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'sink')

    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('从上一节点重跑')
    expect(wrapper.find('[data-testid="data-exec-all-btn"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('发后续任务')
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    expect(grid.exists()).toBe(true)
    expect(grid.props('selectable')).toBe(true)
    expect(grid.props('rows')).toHaveLength(2)
    expect(wrapper.find('.rv-tablecount').text()).toContain('行')
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
    ;(wrapper.vm as any).filters.state = 'E'
    await wrapper.get('[data-testid="data-cond-sql"]').setValue("K1 IS NULL")

    await wrapper.get('[data-testid="data-exec-all-btn"]').trigger('click')
    await flushPromises()

    expect(nextStepBatch).toHaveBeenCalledWith({
      tableId: 'T4', sourceId: current.sourceId,
      state: 'E', cond: 'K1 IS NULL',
      size: 500000, start: 0,
    })
  })

  it('发全部（当前条件）失败时同样补上目标节点名（M3-0K 覆盖范围扩到批量接口，不止逐行入口）', async () => {
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
    await wrapper.get('[data-testid="data-exec-all-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith(
      '目标节点"完成"处理失败：错误信息:运行时异常（多为该节点的进入条件表达式写错，可检查节点配置里的进入条件）',
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

  // 0903 Y0-B 回归锁：发任务只留两档——「按勾选发」（data-exec-btn）和「按当前条件全部发」
  // （data-exec-all-btn）。「发本页任务」「发大量后续」以及装它们的「发后续 ▾」下拉都已删除。
  // 会上原话：「什么发本页发大量什么这是？不要把它全抄过来」。旧平台有这些按钮不是加回来的理由。
  it('发任务只有两档，且不再有「发后续 ▾」下拉与发本页/发大量入口', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    loadExecFixture(useFlowStore(), current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')

    // 两档都在，且「发全部」是并排按钮而不是藏在下拉里（只剩一项还做成下拉是坏交互）
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发后续任务')
    expect(wrapper.get('[data-testid="data-exec-all-btn"]').text()).toBe('发全部（命中 0 条）')

    // 删掉的三个入口一个都不能回来
    expect(wrapper.find('[data-testid="data-exec-more-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-exec-page-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-exec-batch-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-sendmore-panel"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('发本页')
    expect(wrapper.text()).not.toContain('发大量')
  })

  // 0903：`nextStep2` 的参数里没有 dataId、更没有 parentId——填了这两个条件却照发，
  // 发出去的是**整张表**，而按钮上写着"当前条件"。Y1 的「下级」跳转会自动填 父ID，
  // 用户看到 5 行点「发全部」实际发几万条，所以这两个条件在场时必须禁用。
  it('填了数据 ID / 父 ID 时「发全部」禁用，并说明该改用勾选', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    loadExecFixture(useFlowStore(), current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    const batch = vi.spyOn(dataApi, 'nextStepBatch')

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')

    const btn = () => wrapper.get('[data-testid="data-exec-all-btn"]')
    expect(btn().attributes('disabled')).toBeUndefined()

    ;(wrapper.vm as any).filters.dataId = '8809116'
    await flushPromises()
    expect(btn().attributes('disabled')).toBeDefined()
    expect(btn().attributes('title')).toContain('不支持按数据 ID')

    await btn().trigger('click')
    await flushPromises()
    expect(batch).not.toHaveBeenCalled()
  })

  // 0903 Y2-7：单源视图里反查它自己没有意义——用户问的是"别的源上有没有"。
  // 所以这个按钮不在本页反查，而是带着条件跳到全部源数据视图，且**不能带 sourceId**（带了等于没跳）。
  it('「按此条件反查源」带条件跳全部源视图，不带 sourceId', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    loadExecFixture(useFlowStore(), current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')

    const btn = () => wrapper.get('[data-testid="data-backtrace-jump"]')
    // 没有条件时禁用：无条件反查等于"这张表涉及的所有源"，没有意义
    expect(btn().attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="data-cond-sql"]').setValue("K1 LIKE '%人保%'")
    await flushPromises()
    expect(btn().attributes('disabled')).toBeUndefined()

    routerPush.mockClear()
    await btn().trigger('click')

    const arg = routerPush.mock.calls[0][0] as { query: Record<string, unknown> }
    expect(arg.query.view).toBe('data')
    expect(arg.query.condSql).toBe("K1 LIKE '%人保%'")
    expect(arg.query.condTable).toBeTruthy()
    expect(arg.query.sourceId).toBeUndefined()
  })

  // 2026-09-04 用户实测提出：「这个节点不是最后一个节点，为什么叫从上一节点重跑」。
  // 根因是 hasDirectSuccessor 会跳过停用节点（对的，停用的不能当发送目标），
  // 但把"真末节点"和"后继存在但停用了"压成了同一个"没有后继"。判定不改，把原因说出来。
  it('后继被停用时：仍是「从上一节点重跑」，但说明下游已停用', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    // 用 mid（中间节点，有上游）：把它之后的全停用 → 没有可用后继，但它显然不是末节点。
    // 不能用 first——它没有上游，execMode 会落到 'none'，按钮整个不渲染。
    // 也不能只停 mid2：laterRunnableIdsOnMain 会往后走，把 last 当成后继。
    for (const id of ['mid2', 'last', 'sink']) flow.configs[id].disabled = true

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid')

    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('从上一节点重跑')
    const hint = wrapper.get('[data-testid="data-disabled-successor-hint"]').text()
    expect(hint).toContain('已停用')
    expect(hint).toContain(flow.configs.mid2.title)
  })

  it('真末节点不显示"下游已停用"那句', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    loadExecFixture(useFlowStore(), current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'sink')

    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('从上一节点重跑')
    expect(wrapper.find('[data-testid="data-disabled-successor-hint"]').exists()).toBe(false)
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
      "目标节点\"完成\"处理失败：错误信息:运行时异常：<Long, 1> can't be a left value for assignment.（多为该节点的进入条件表达式写错，可检查节点配置里的进入条件）",
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

    expect(ElMessage.error).toHaveBeenCalledWith('目标节点"完成"处理失败：生产环境写保护：端点不在允许清单')
  })

  it('后端返回「没有详情配置」时不把后继误说成必须是详情页', async () => {
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
    vi.spyOn(dataApi, 'nextStep').mockRejectedValue(new Error('请求异常 [data/nextStep]: 没有详情配置'))

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['d1'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('没有详情配置'))
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining('并不要求下一个节点必须是详情页'))
    expect(ElMessage.error).not.toHaveBeenCalledWith(expect.stringContaining('详情类配置'))
  })

  // 2026-09-04 推翻 M2-14：原来"输入表被多个节点共用"直接禁用执行 + 不给勾选，
  // 前提是"后端没法知道任务发给谁"。实际后端**按各后继节点的进入条件**逐个求值分流，
  // 同表多后继是旧平台的正常形态（用户："每个分支都有进入条件的"）。
  // 这条阻断把 920663 那类整条链共用一张表的源全锁死了。
  it('输入表被多个节点共用不再禁用执行（后端按进入条件分流）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid') // mid 和 mid2 都显式声明输入表 T1
    await wrapper.get('[data-testid="data-scope-input"]').trigger('click')
    await flushPromises()

    // fixture 里 rowQueryPaged 返回空列表，按钮仍会因"没勾选"而禁用——这里要看的是
    // 禁用**理由**不再是歧义，以及勾选列回来了（原来歧义判定排在"请先勾选"前面，掩盖了这点）。
    const btn = wrapper.get('[data-testid="data-exec-btn"]')
    expect(btn.attributes('title')).toBe('请先勾选要发送的数据')
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    // mid 在主链上只有一个直接后继，谈不上分流，不该出提示
    expect(wrapper.find('[data-testid="data-fanout-hint"]').exists()).toBe(false)
  })

  it('一个节点分叉出多个后继时，提示会按进入条件分流到几个节点', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    // 把 mid 做成分叉点：两个分支各挂一个后继，各自带进入条件（对齐 yahoo 的真实形态）
    flow.main.splice(0, flow.main.length, 'start', 'first', 'mid', 'last', 'end')
    Object.assign(flow.configs, {
      br1: cfg({ title: 'python正文提取', inputTable: 'T2' }),
      br2: cfg({ title: 'python正文提取_dev', inputTable: 'T2' }),
    })
    flow.branchGroups.splice(0, flow.branchGroups.length, {
      ownerId: 'mid',
      branches: [
        { label: '分支1', condition: { logic: 'and', items: [{ field: 'K19', op: 'isNull', value: '' }] }, chain: ['br1'] },
        { label: '分支2', condition: { logic: 'and', items: [{ field: 'K6', op: 'isNull', value: '' }] }, chain: ['br2'] },
      ],
    } as never)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid')
    await wrapper.get('[data-testid="data-scope-input"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="data-exec-btn"]').attributes('title')).toBe('请先勾选要发送的数据')
    expect(wrapper.findComponent({ name: 'DataGrid' }).props('selectable')).toBe(true)
    const hint = wrapper.get('[data-testid="data-fanout-hint"]')
    expect(hint.text()).toContain('2 个后继')
    expect(hint.attributes('title')).toContain('python正文提取_dev')
  })


  it('勾选后取消发后续确认框：不调用 nextStep（勾 21 条才会弹，见下方 0917-05 两条）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 21,
      list: Array.from({ length: 21 }, (_, i) => ({
        dataId: `d${i + 1}`, sourceId: current.sourceId, title: `A${i + 1}`, summary: '', acceptState: 'pending' as const,
      })),
    })
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel')
    const nextStep = vi.spyOn(dataApi, 'nextStep')

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', Array.from({ length: 21 }, (_, i) => `d${i + 1}`))
    await flushPromises()
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(nextStep).not.toHaveBeenCalled()
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

describe('ResultView · 0831 详情翻条与末节点回上游', () => {
  afterEach(() => vi.restoreAllMocks())

  it('详情抽屉按当前页翻条，翻到最后一条时下一条禁用', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const rows: DataRow[] = [
      { dataId: 'd1', sourceId: current.sourceId, title: '行1', summary: '', acceptState: 'accepted', values: {} },
      { dataId: 'd2', sourceId: current.sourceId, title: '行2', summary: '', acceptState: 'accepted', values: {} },
    ]
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: rows, total: 2 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('row-click', rows[0])
    await flushPromises()

    expect(wrapper.get('[data-testid="row-detail-pos"]').text()).toBe('1/2')
    expect((wrapper.get('[data-testid="row-detail-prev"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.get('[data-testid="row-detail-next"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="row-detail-pos"]').text()).toBe('2/2')
    const next = wrapper.get('[data-testid="row-detail-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)
    expect(next.attributes('title')).toContain('本页最后一条')
  })

  it('同表末节点从上一节点重跑：nextStep 带当前表和勾选 ID', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadSameTableFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ dataId: 'd1', sourceId: current.sourceId, title: 'A', summary: '', acceptState: 'pending' }],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStep = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已提交 1 条' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'mid')
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['d1'])
    await flushPromises()
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(nextStep).toHaveBeenCalledWith(current.sourceId, 'T1', ['d1'])
  })

  it('异表末节点从上一节点重跑：用 parentId 去重后发到上游表', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 2,
      list: [
        { dataId: 'c1', sourceId: current.sourceId, title: 'C1', summary: '', acceptState: 'pending', parentId: 'p9' },
        { dataId: 'c2', sourceId: current.sourceId, title: 'C2', summary: '', acceptState: 'pending', parentId: 'p9' },
      ],
    })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStep = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已提交 1 条' })

    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'sink')
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['c1', 'c2'])
    await flushPromises()
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(nextStep).toHaveBeenCalledWith(current.sourceId, 'T2', ['p9'])
  })
})

// 删除数据（2026-09-09 从数据中心迁入）。数据中心那套下拉共 9 项，这里只迁 4 项：
// 删除该源当日/所有、删除选中、行内删单条。整表清空与设为正式表**刻意不迁**，
// 理由见 ResultView.vue 里同名注释（源视图里表常被同网站多个源共用，整表删跨源杀伤）。
describe('ResultView · 删除数据', () => {
  afterEach(() => vi.restoreAllMocks())

  // 按文案取菜单项：SqlConditionEditor 的"最近条件"下拉也渲染 el-dropdown-item，
  // 位置索引会随它有没有历史记录而漂。
  function menuItem(wrapper: ReturnType<typeof shallowMount>, text: string) {
    const hit = wrapper.findAll('.el-dropdown-item').find((i) => i.text() === text)
    if (!hit) throw new Error(`菜单里没有「${text}」`)
    return hit
  }

  async function mountForDelete(state: string | undefined = 'C') {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const flow = useFlowStore()
    loadExecFixture(flow, current)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({ ...meta, state })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'last')
    return { wrapper, current }
  }

  it('删除入口仅测试表出现：state=C 有，正式表 AC 整块不渲染（与数据中心同一道门禁）', async () => {
    const { wrapper } = await mountForDelete('C')
    expect(wrapper.find('[data-testid="data-delete"]').exists()).toBe(true)
    wrapper.unmount()

    const formal = await mountForDelete('AC')
    expect(formal.wrapper.find('[data-testid="data-delete"]').exists()).toBe(false)
  })

  it('只迁该源范围的三项，不提供整表清空和设为正式表——源视图里表常被同站多个源共用，整表删会跨源', async () => {
    const { wrapper } = await mountForDelete()
    const menu = wrapper.find('[data-testid="data-delete"]').element.parentElement!
    expect(menu.textContent).toContain('删除选中的数据')
    expect(menu.textContent).toContain('删除该源-当日数据')
    expect(menu.textContent).toContain('删除该源-所有数据')
    expect(menu.textContent).not.toContain('清空表数据')
    expect(menu.textContent).not.toContain('设为正式表')
  })

  it('删除该源-所有数据：带当前节点的表与本页锁定的 sourceId，all=1，删完回第 1 页重查', async () => {
    const { wrapper, current } = await mountForDelete()
    const rowDelete = vi.spyOn(dataApi, 'rowDelete').mockResolvedValue({ success: 12 })
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })

    await menuItem(wrapper, '删除该源-所有数据').trigger('click')
    await flushPromises()

    expect(rowDelete).toHaveBeenCalledWith('T2', { sourceId: current.sourceId, all: 1 })
    expect(query).toHaveBeenCalled()
  })

  it('删除该源-当日数据：同一入口只差 all=0', async () => {
    const { wrapper, current } = await mountForDelete()
    const rowDelete = vi.spyOn(dataApi, 'rowDelete').mockResolvedValue({ success: 3 })

    await menuItem(wrapper, '删除该源-当日数据').trigger('click')
    await flushPromises()

    expect(rowDelete).toHaveBeenCalledWith('T2', { sourceId: current.sourceId, all: 0 })
  })

  it('删除选中：把勾选的行 ID 交给 rowDeleteBatch，删完清空勾选', async () => {
    const { wrapper } = await mountForDelete()
    const batch = vi.spyOn(dataApi, 'rowDeleteBatch').mockResolvedValue({ success: 2, all: 2, not_found: 0 })
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    await grid.vm.$emit('update:selectedIds', ['e1', 'e2'])
    await flushPromises()

    await menuItem(wrapper, '删除选中的数据').trigger('click')
    await flushPromises()

    expect(batch).toHaveBeenCalledWith('T2', ['e1', 'e2'])
    expect(grid.props('selectedIds')).toEqual([])
  })

  it('删除返回 success=0（超 14 天或找不到 ID）弹 warning，不能只报成功', async () => {
    const { wrapper } = await mountForDelete()
    vi.spyOn(dataApi, 'rowDelete').mockResolvedValue({ success: 0 })

    await menuItem(wrapper, '删除该源-所有数据').trigger('click')
    await flushPromises()

    expect(ElMessage.warning).toHaveBeenCalled()
  })

  it('行内「删除单条」：走 row-action delete，带 entryId 与该行自己的源 ID；测试表标志透传给 DataGrid', async () => {
    const { wrapper, current } = await mountForDelete()
    const rowDelete = vi.spyOn(dataApi, 'rowDelete').mockResolvedValue({ success: 1 })
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    expect(grid.props('allowRowDelete')).toBe(true)

    await grid.vm.$emit('row-action', { dataId: 'e9', sourceId: current.sourceId } as DataRow, 'delete')
    await flushPromises()

    expect(rowDelete).toHaveBeenCalledWith('T2', { sourceId: current.sourceId, all: 1, entryId: 'e9' })
  })
})

// 从网站汇总「按条件查源」的命中列表点进某个源（2026-09-09）：侧栏那一行写着「906 条」，
// 进来看到的就得是那 906 条。条件走 store 不走 URL——本视图按 sourceId 做 key，源→源切换
// 会销毁重建，用 query 传会撞上「旧实例抹掉 query、新实例读不到」的竞态。
describe('ResultView · 带条件进来', () => {
  afterEach(() => vi.restoreAllMocks())

  function mountWithPending(cond: { tableId: string; sql?: string; state?: string } | null) {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    const ws = useWorkspaceStore()
    if (cond) ws.setPendingSourceCondition(cond)
    return { wrapper: mountResultView(), query, ws }
  }

  it('把待应用条件填进筛选框，并作为查询条件发出去', async () => {
    const { wrapper, query } = mountWithPending({ tableId: '900', sql: 'K1 IS NULL', state: 'E' })
    await flushPromises()

    expect((wrapper.get('input.rv-input.flex').element as HTMLInputElement).value).toBe('K1 IS NULL')
    expect((wrapper.vm as any).filters.state).toBe('E')
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ sql: 'K1 IS NULL', state: 'E' }))
  })

  it('取走即清，只应用一次——之后用户自己改的筛选不会被再次覆盖', async () => {
    const { ws } = mountWithPending({ tableId: '900', sql: 'K1 IS NULL' })
    await flushPromises()

    expect(ws.takePendingSourceCondition()).toBeNull()
  })

  it('没有待应用条件时筛选框保持空（普通切源不受影响）', async () => {
    const { wrapper, query } = mountWithPending(null)
    await flushPromises()

    expect((wrapper.get('input.rv-input.flex').element as HTMLInputElement).value).toBe('')
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ sql: undefined }))
  })
})

// 布局折叠（0910 会议 §2-2「点数据视图时自动收起上方流程配置区域」+
// §2-3「把『展开流程』及下方查询表折叠至单行」）。
// 主干行只留：筛选开关、查询，以及整组数据操作（发任务/删除留在外面——那是这个页面的
// 主要动作，藏起来比藏筛选条件更伤）。轨道开合按钮不在这一行，它浮在轨道区右上角。
describe('ResultView · 布局与操作', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    localStorage.removeItem('rc.dataview.result.railOpen')
  })

  async function mountAtNode() {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    const wrapper = mountResultView()
    await flushPromises()
    return wrapper
  }

  it('默认收起流程轨道，默认展示 SQL 查询条件，筛选按钮已去掉', async () => {
    const wrapper = await mountAtNode()

    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-filter-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-filter-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-cond-sql"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-rail-toggle"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '查询')).toBe(true)
  })

  // 收起后开合按钮不能跟着消失，否则就没法再展开、也没法切节点（0819 N1-2 踩过一次：
  // 「流程图是唯一的节点选择器」）。按钮浮在轨道区右上角，与全部源视图同构。
  it('轨道收起时「展开流程」按钮仍在，点它把轨道展开', async () => {
    const wrapper = await mountAtNode()

    const toggle = wrapper.get('[data-testid="data-rail-toggle"]')
    expect(toggle.text()).toContain('展开流程')

    await toggle.trigger('click')
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="data-rail-toggle"]').attributes('title')).toBe('收起流程')
    await wrapper.get('[data-testid="data-rail-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(false)
  })

  it('输入 SQL 查询条件后点击清空，条件被清空', async () => {
    const wrapper = await mountAtNode()
    await wrapper.get('[data-testid="data-cond-sql"]').setValue("K1 LIKE '%测试%'")
    expect((wrapper.get('[data-testid="data-cond-sql"]').element as HTMLInputElement).value).toBe("K1 LIKE '%测试%'")

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')
    expect(clearBtn).toBeDefined()
    await clearBtn!.trigger('click')
    expect((wrapper.get('[data-testid="data-cond-sql"]').element as HTMLInputElement).value).toBe('')
  })

  it('发后续任务与发全部按钮合并，提供主按钮与下拉发全部选项', async () => {
    const wrapper = await mountAtNode()
    expect(wrapper.find('[data-testid="data-exec-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-exec-all-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-exec-split-arrow"]').exists()).toBe(true)
  })

  it('发后续任务时：根据 nextConfigPaged 步骤链路取得下一个节点配置，并使用下一个节点的输入表与配置 ID 发起任务', async () => {
    setActivePinia(createPinia())
    const current = {
      sourceId: '430006252',
      name: '测试源430006252',
      siteId: 'site-1',
      mainTable: '900',
    } as any
    const flow = useFlowStore()
    const { useSourceStore } = await import('@/stores/source')
    const sourceStore = useSourceStore()

    const steps = [
      { stepId: '0', sourceId: '430006252', name: '起点列表', isRoot: true, outputTable: '900', enabled: true },
      { stepId: '40597', sourceId: '430006252', name: '中间步骤1', configId: '1400974', inputTable: '900', outputTable: '900', dependsOn: ['0'], enabled: true },
      { stepId: '40598', sourceId: '430006252', name: '后续步骤2', configId: '1400975', inputTable: '901', outputTable: '901', dependsOn: ['40597'], enabled: true },
    ]
    flow.loadFromSource(current, steps)
    sourceStore.rememberSteps(steps, 'replace')

    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStepSpy = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已提交 1 条' })

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.get('[data-testid="data-rail-toggle"]').trigger('click')
    await selectNode(wrapper, '40597')

    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['8688522'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    // 必须发给后续步骤 40598 的输入表 901、configId 1400975，而不是当前步骤自己的 900
    expect(nextStepSpy).toHaveBeenCalledWith(
      '430006252',
      '901',
      ['8688522'],
      expect.objectContaining({
        configId: '1400975',
        itemConfig: '40598',
        stepId: '40598',
        nextStep: '40598',
      }),
    )
  })

  it('选择html网页下载节点发后续任务，发送给html解析节点（news_cont / 40598），不发给自己（dev_web_snatch_html_download）', async () => {
    const current: Source = {
      sourceId: '430016821',
      name: '上市公司-测试',
      url: 'http://example.com',
      owner: 'test',
      state: 'C',
      mainTable: '900',
      configId: '1400935',
    }
    const flow = useFlowStore()
    const { useSourceStore } = await import('@/stores/source')
    const sourceStore = useSourceStore()

    const steps: Step[] = [
      { stepId: '0', sourceId: '430016821', name: '上市公司-配置', isRoot: true, outputTable: '900', enabled: true, topic: 'news_snt', configId: '1400935' },
      { stepId: '40597', sourceId: '430016821', name: 'html网页下载', configId: '1400974', inputTable: '900', outputTable: '900', dependsOn: ['0'], enabled: true, topic: 'dev_web_snatch_html_download' },
      { stepId: '40598', sourceId: '430016821', name: 'html解析', configId: '1400975', inputTable: '900', outputTable: '900', dependsOn: ['40597'], enabled: true, topic: 'news_cont' },
    ]
    flow.loadFromSource(current, steps)
    sourceStore.rememberSteps(steps, 'replace')

    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const nextStepSpy = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已提交 1 条' })

    const wrapper = mountResultView()
    await flushPromises()
    await wrapper.get('[data-testid="data-rail-toggle"]').trigger('click')
    await selectNode(wrapper, '40597')

    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['1001'])
    await flushPromises()

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    // 必须发送给 html解析 节点（itemConfig/stepId=40598, configId=1400975），绝对不能发送给当前 40597
    expect(nextStepSpy).toHaveBeenCalledWith(
      '430016821',
      '900',
      ['1001'],
      expect.objectContaining({
        configId: '1400975',
        itemConfig: '40598',
        stepId: '40598',
        nextStep: '40598',
      }),
    )
    expect(nextStepSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        itemConfig: '40597',
      }),
    )
  })
})

// 2026-09-17：'fetch' 这个 ExecMode 连同 onSendFetch / actionBtnText 的分支早就写好了，
// 但在此之前没有任何路径产生它——孤立首节点落到 'none'，工具栏整块不渲染，
// 用户看着像"这里没功能"。公众号那批源正是这形态：起点自己就是完整的抓取配置
// （网页抓取 → 直接写 6200029），抓完入库、流程到此为止，5429 个源共 83 万条数据都这么来的。
describe('ResultView · 孤立首节点（没有后继也没有上游）', () => {
  afterEach(() => vi.restoreAllMocks())

  // 与公众号源同构：整条流程只有一个可运行节点，有输出表、没有输入表、没有后继
  function loadLoneNodeFixture(flow: ReturnType<typeof useFlowStore>, current: Source) {
    flow.loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    flow.main.splice(0, flow.main.length, 'start', 'only', 'end')
    Object.keys(flow.configs).forEach((k) => { delete flow.configs[k] })
    Object.assign(flow.configs, {
      only: cfg({ title: '公众号文章抓取', outputTable: '6200029' }),
    })
  }

  async function mountLone() {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    loadLoneNodeFixture(useFlowStore(), current)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])
    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'only')
    return wrapper
  }

  it('给出「发起抓取」而不是一片空白', async () => {
    const wrapper = await mountLone()
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发起抓取')
    // 没有可发的对象时才提示；这里有得发，就不该再出现说明文字
    expect(wrapper.find('[data-testid="data-no-exec-reason"]').exists()).toBe(false)
  })

  // 2026-09-24 用户定：单节点也给勾选列。「发起抓取」仍是整个源、不看勾选；
  // 勾选是给「删除数据 → 删除选中的数据」和行详情用的——此前没有勾选列，那一项永远是灰的。
  it('出勾选列；「发起抓取」不受勾选影响（勾不勾都能点，也不会变成发后续）', async () => {
    const wrapper = await mountLone()
    const grid = wrapper.findComponent({ name: 'DataGrid' })
    expect(grid.props('selectable')).toBe(true)
    expect(wrapper.text()).toContain('已选 0 条')
    expect(wrapper.get('[data-testid="data-exec-btn"]').attributes('disabled')).toBeUndefined()

    await grid.vm.$emit('update:selected-ids', ['d1', 'd2'])
    await flushPromises()
    expect(wrapper.text()).toContain('已选 2 条')
    expect(wrapper.get('[data-testid="data-exec-btn"]').text()).toBe('发起抓取')
    expect(wrapper.text()).not.toContain('发后续任务')
  })

  // 0917-05（2026-09-21）：发起抓取**不再弹确认**。
  // SnatchLauncher.launch 内部本来就是 loadParams → 有参数弹参数框、无参数直发，
  // 外面那层"是否继续"纯属多点一次。
  it('点它直接发起抓取，不弹确认（0917-05）', async () => {
    const wrapper = await mountLone()
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    confirm.mockClear()
    const loadParams = vi.spyOn(sourceApi, 'loadParams').mockResolvedValue([] as never)

    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    expect(confirm).not.toHaveBeenCalled()
    // 走到了 SnatchLauncher：它的第一步就是探参数
    expect(loadParams).toHaveBeenCalled()
  })
})

// 0917-06 / 0917-08（2026-09-21 用户定）：节点轨道右键菜单。
// 会上原话「默认我不点的时候他就全部发，如果我点个（叉），他就只发第一个」；
// 首节点那项对应「第一个节点其实就是发这个流程的抓取」。
describe('ResultView · 节点右键菜单（0917-06 / 0917-08）', () => {
  async function mountWithRail() {
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
    const wrapper = mountResultView()
    await flushPromises()
    await selectNode(wrapper, 'first')
    return { wrapper, flow, current }
  }

  async function openMenuOn(wrapper: Awaited<ReturnType<typeof mountWithRail>>['wrapper'], nodeId: string) {
    wrapper.findComponent({ name: 'ProcessNodeRail' }).vm.$emit('node-menu', { nodeId, x: 100, y: 100 })
    await flushPromises()
    return wrapper.get('[data-testid="rail-node-menu"]')
  }

  it('右键出菜单；首节点才有「发起抓取」', async () => {
    const { wrapper, flow } = await mountWithRail()
    const firstId = flow.main.find((id) => flow.configs[id]) || 'first'

    const menu = await openMenuOn(wrapper, firstId)
    expect(menu.find('[data-testid="rail-menu-send-fetch"]').exists()).toBe(true)
    expect(menu.find('[data-testid="rail-menu-toggle-skip"]').exists()).toBe(true)
  })

  it('点「本次不发后续」：节点上出现角标，菜单文案变成「恢复发送」', async () => {
    const { wrapper, flow } = await mountWithRail()
    const firstId = flow.main.find((id) => flow.configs[id]) || 'first'

    ;(await openMenuOn(wrapper, firstId)).get('[data-testid="rail-menu-toggle-skip"]').trigger('click')
    await flushPromises()

    // 标记传给了轨道（角标由 ProcessNodeRail 渲染，这里验 prop 传对了）
    expect(wrapper.findComponent({ name: 'ProcessNodeRail' }).props('skipped')).toEqual([firstId])
    // 菜单关掉了；再右键同一个节点，文案变成恢复
    expect(wrapper.find('[data-testid="rail-node-menu"]').exists()).toBe(false)
    expect((await openMenuOn(wrapper, firstId)).get('[data-testid="rail-menu-toggle-skip"]').text()).toBe('恢复发送')
  })

  // 核心：标了「本次不发」的节点不出现在 itemConfig 里，它的下游照发
  it('被标记的节点不会收到任务，itemConfig 里没有它的 stepId', async () => {
    const { wrapper, flow, current } = await mountWithRail()
    const nextStep = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '本次发送:2 条' })

    // 先不标记，记下完整的 itemConfig
    await wrapper.findComponent({ name: 'DataGrid' }).vm.$emit('update:selectedIds', ['d1', 'd2'])
    await flushPromises()
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()
    const fullOpts = nextStep.mock.calls.at(-1)?.[3] as { itemConfig?: string } | undefined
    const fullIds = String(fullOpts?.itemConfig ?? '').split(',').filter(Boolean)

    if (!fullIds.length) return // 该 fixture 没有可发的下游 stepId，这条断言无从谈起

    // 标记下游第一个节点，再发一次
    const skipStepId = fullIds[0]
    const skipNodeId = Object.keys(flow.configs).find((id) => String((flow.configs[id] as { stepId?: string }).stepId ?? id) === skipStepId) || skipStepId
    ;(await openMenuOn(wrapper, skipNodeId)).get('[data-testid="rail-menu-toggle-skip"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="data-exec-btn"]').trigger('click')
    await flushPromises()

    const afterOpts = nextStep.mock.calls.at(-1)?.[3] as { itemConfig?: string } | undefined
    const afterIds = String(afterOpts?.itemConfig ?? '').split(',').filter(Boolean)
    expect(afterIds).not.toContain(skipStepId)
    expect(nextStep).toHaveBeenCalledTimes(2)
    expect(nextStep.mock.calls.at(-1)?.[0]).toBe(current.sourceId)
  })

  it('「全部恢复」把标记清空', async () => {
    const { wrapper, flow } = await mountWithRail()
    const ids = flow.main.filter((id) => flow.configs[id]).slice(0, 2)
    if (ids.length < 2) return

    for (const id of ids) {
      ;(await openMenuOn(wrapper, id)).get('[data-testid="rail-menu-toggle-skip"]').trigger('click')
      await flushPromises()
    }
    expect(wrapper.findComponent({ name: 'ProcessNodeRail' }).props('skipped')).toHaveLength(2)

    ;(await openMenuOn(wrapper, ids[0])).get('[data-testid="rail-menu-restore-all"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ProcessNodeRail' }).props('skipped')).toEqual([])
  })
})

describe('ResultView · 0917-01 任务跳转定位（query.dataId）', () => {
  // mockRouteQuery 是模块级共享对象，上面那个 describe 的 afterEach 管不到这里——
  // 不清的话 dataId 会漏给后面的用例（2026-09-22 被下面那条"没有条件时不显示标签"撞出来）
  afterEach(() => {
    vi.restoreAllMocks()
    delete mockRouteQuery.dataId
    delete mockRouteQuery.parentId
  })

  it('URL 中带有 dataId 时自动预填 filters.dataId 并作为条件发起查询', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))

    mockRouteQuery.dataId = 'data_986079'
    const queryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    const wrapper = mountResultView()
    await flushPromises()

    expect(queryPaged).toHaveBeenCalledWith(
      expect.objectContaining({
        dataId: 'data_986079',
      }),
    )

    wrapper.unmount()
  })

  // 2026-09-22：数据 ID / 父 ID **没有输入框**（只能由任务视图「定位数据」、数据行「下级」
  // 带进来）。不摆出来就是隐形筛选——实测从任务视图点数据 ID 跳过来筛不到时，看到的是一个
  // 完全正常的空表格，会当成"这条数据没了"，而不是"我被筛住了"。
  it('带 dataId 进来时摆出可一键清除的条件标签，清掉后重查且不再带这个条件', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))

    mockRouteQuery.dataId = 'data_986079'
    const queryPaged = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    const wrapper = mountResultView()
    await flushPromises()

    const chip = wrapper.get('[data-testid="data-cond-chip-dataId"]')
    expect(chip.text()).toContain('data_986079')
    expect(wrapper.find('[data-testid="data-cond-chip-parentId"]').exists()).toBe(false)

    queryPaged.mockClear()
    await chip.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="data-cond-chip-dataId"]').exists()).toBe(false)
    expect(queryPaged).toHaveBeenCalled()
    expect(queryPaged.mock.calls.at(-1)?.[0]).toMatchObject({ dataId: undefined })

    wrapper.unmount()
  })

  it('没有这两个条件时不显示条件标签区', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })

    const wrapper = mountResultView()
    await flushPromises()

    expect(wrapper.find('[data-testid="data-cond-chips"]').exists()).toBe(false)

    wrapper.unmount()
  })
})

