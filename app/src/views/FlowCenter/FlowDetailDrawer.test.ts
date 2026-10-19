// @vitest-environment jsdom
// 0904 I16/I17 · Y9：流程详情抽屉里能直接改流程属性（分类/标签/描述），随「保存流程」一并提交。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import FlowDetailDrawer from './FlowDetailDrawer.vue'
import FlowVersionHistory from './FlowVersionHistory.vue'
import { flowCenterApi, flowVersionApi, workflowBindingApi, type FlowDefinition, type FlowRecord, type Step, type WorkflowBinding } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useNodeStore } from '@/stores/node'
import { useUiStore } from '@/stores/ui'
import { resetFlowAutosaveForTests } from '@/views/FlowCanvas/canvas/useFlowAutosave'

// 0926：抽屉打开会并行取流程步骤快照（改名 / 孤儿关联整包回写需要）。这里必须显式 mock：
// 真实 mock 通道固定 120ms 真实延迟，快照会在**后续用例执行途中**到达并重建画布，污染下一个
// 用例（实测：快照落在收起/展开断言窗口里，ui 渲染被重建打断）。同时显式卸载 + 复位自动保存单例，
// 避免用例间留下活的画布树与异步尾巴。
enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
  resetFlowAutosaveForTests()
})

/** 打开工作区的步骤快照夹具（与 detail 同为即时 resolve）；根行 isRoot=1 一并给出，
 *  与 svg=true 的真实返回同形状。 */
const STEPS_FIXTURE: Step[] = [
  { stepId: '405100', sourceId: '-1', name: '流程入口', nodeType: 'entry', configId: '1400774', mainConfig: '1400774', flowId: '1400987', enabled: true, isRoot: true },
  { stepId: '405101', sourceId: '-1', name: '列表页', configId: '1400774', mainConfig: '1400774', flowId: '1400987', enabled: true, outputTable: '900' },
]

const FLOW = {
  id: 'flow-1', name: '新闻采集', version: 1, updatedAt: '2026-09-05 10:00',
  categoryId: '9009289', flowTags: 'a,b', description: '原描述', bizType: '',
  definition: {
    main: ['start', 'web-list', 'end'], branches: [], branchGroups: [],
    configs: { 'web-list': { title: '列表页', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400774', outputTable: '6200026' } },
  },
} as unknown as FlowRecord

beforeEach(() => {
  // 流程版本（2026-10-10）：按未启用处理；mock 模式固定 120ms 延迟会让 flushPromises 等不到抽屉加载完
  vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: false, curVer: null, nextVer: null, publishId: null, draftId: null, versions: [] })
  vi.spyOn(workflowBindingApi, 'ensureDraft').mockImplementation(async (workflowId): Promise<WorkflowBinding> => ({
    id: `binding-${workflowId}`, bindType: 'SOURCE', bindId: '', workflowId,
    workflowCode: `LEGACY-${workflowId}`, workflowName: '新闻采集', publishedVersionNo: 1,
    publishedFlowId: workflowId, draftVersionNo: 2, draftFlowId: workflowId, versionStatus: 'DRAFT',
    workflowStatus: 'ACTIVE', followsCurrentVersion: true, role: 'MAIN', primary: true,
    priority: 0, status: 'ACTIVE', inherited: false,
  }))
})

function mountDrawer(flow: FlowRecord = FLOW) {
  setActivePinia(createPinia())
  // 抽屉一挂上就拉详情；不挡住的话 loadingDetail 一直是 true，工作区根本不渲染
  vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(flow)
  vi.spyOn(flowCenterApi, 'steps').mockResolvedValue(STEPS_FIXTURE)
  return mount(FlowDetailDrawer, {
    props: { flow, categories: [{ id: '9009289', name: '财经' }, { id: '9009290', name: '公告' }] },
    global: {
      directives: { loading: {} },
      stubs: {
        FlowBoard: { template: '<div />' },
        NodeInspector: { template: '<div />' },
      },
    },
  })
}
const saveButton = (w: ReturnType<typeof mountDrawer>) =>
  w.get('[data-testid="flow-save"]')

// 0927 P1-5：步骤快照拉取失败时打开不阻断（画布照常渲染），但常驻警示条把「为什么改不动」
// 说清楚——flowIdMode 下无快照节点跳过回写、autosave 留在 pending，不制造「已保存」假象。
describe('流程详情抽屉 · 快照失败警示（0927 P1-5）', () => {
  it('steps 拉取失败：抽屉正常打开 + 警示条出现', async () => {
    setActivePinia(createPinia())
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOW)
    vi.spyOn(flowCenterApi, 'steps').mockRejectedValue(new Error('超时'))
    const w = mount(FlowDetailDrawer, {
      props: { flow: FLOW, categories: [] },
      global: { directives: { loading: {} }, stubs: { FlowBoard: { template: '<div />' }, NodeInspector: { template: '<div />' } } },
    })
    await flushPromises()
    expect(w.get('[data-testid="flow-drawer-steps-failed"]').text()).toContain('步骤快照加载失败')
  })

  it('steps 拉取成功：无警示条', async () => {
    const w = mountDrawer()
    await flushPromises()
    expect(w.find('[data-testid="flow-drawer-steps-failed"]').exists()).toBe(false)
  })
})

describe('流程详情抽屉 · 属性编辑（Y9）', () => {
  it('已发布流程只编辑草稿，确认发布后才切换到新的发布 flowId', async () => {
    vi.spyOn(workflowBindingApi, 'available').mockReturnValue(true)
    vi.mocked(workflowBindingApi.ensureDraft).mockResolvedValue({
      id: 'binding-9', bindType: 'SOURCE', bindId: '', workflowId: 'workflow-9',
      workflowCode: 'WF-9', workflowName: FLOW.name, publishedVersionNo: 1,
      publishedFlowId: 'flow-1', draftVersionNo: 2, draftFlowId: 'draft-flow-2',
      versionStatus: 'DRAFT', workflowStatus: 'ACTIVE', followsCurrentVersion: true,
      role: 'MAIN', primary: true, priority: 0, status: 'ACTIVE', inherited: false,
    })
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...FLOW, id: 'draft-flow-2', version: 2 })
    const publish = vi.spyOn(workflowBindingApi, 'publish').mockResolvedValue({
      id: 'binding-9', bindType: 'SOURCE', bindId: '', workflowId: 'workflow-9',
      workflowCode: 'WF-9', workflowName: FLOW.name, publishedVersionNo: 2,
      publishedFlowId: 'draft-flow-2', versionStatus: 'PUBLISHED', workflowStatus: 'ACTIVE',
      followsCurrentVersion: true, role: 'MAIN', primary: true, priority: 0,
      status: 'ACTIVE', inherited: false,
    })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const w = mountDrawer()
    await flushPromises()

    expect(w.get('[data-testid="flow-drawer-version-status"]').text()).toContain('草稿 v2')
    await w.get('[data-testid="flow-publish"]').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-flow-2' }))
    expect(publish).toHaveBeenCalledWith('workflow-9')
    expect(w.emitted('saved')?.[0]?.[0]).toEqual(expect.objectContaining({ id: 'draft-flow-2', version: 2 }))
    expect(w.emitted('close')).toBeTruthy()
  })

  // 2026-10-08：217 上没有 workflow/* 时，打开流程第一步的 ensureDraft 必然失败、抽屉报错关闭——流程中心一个都打不开。
  // 未上线时退回合并前的行为：直接编辑原流程，保存即生效。
  it('多流程接口未上线：直接打开原流程，不取草稿；只有「保存流程」，保存后通知列表', async () => {
    vi.spyOn(workflowBindingApi, 'available').mockReturnValue(false)
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...FLOW, version: 2 })
    const w = mountDrawer()
    await flushPromises()

    expect(workflowBindingApi.ensureDraft).not.toHaveBeenCalled()
    expect(flowCenterApi.steps).toHaveBeenCalledWith('flow-1')
    expect(w.emitted('close')).toBeFalsy()
    expect(w.find('[data-testid="flow-publish"]').exists()).toBe(false)
    expect(w.find('[data-testid="flow-drawer-version-status"]').exists()).toBe(false)
    expect(w.get('[data-testid="flow-save"]').text()).toBe('保存流程')

    await w.get('[data-testid="flow-save"]').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'flow-1' }))
    expect(w.emitted('saved')?.[0]?.[0]).toEqual(expect.objectContaining({ id: 'flow-1', version: 2 }))
  })

  it('回填流程现值，改完随保存一起提交，标签按统一口径归一', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...FLOW, version: 2 })
    const w = mountDrawer()
    await flushPromises()

    expect((w.get('[data-testid="flow-meta-category"]').element as HTMLSelectElement).value).toBe('9009289')
    expect((w.get('[data-testid="flow-meta-tags"]').element as HTMLInputElement).value).toBe('a,b')
    expect((w.get('[data-testid="flow-meta-desc"]').element as HTMLInputElement).value).toBe('原描述')

    await w.get('[data-testid="flow-meta-category"]').setValue('9009290')
    await w.get('[data-testid="flow-meta-tags"]').setValue('公告，公告  年报')
    await w.get('[data-testid="flow-meta-desc"]').setValue('  新描述  ')
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'flow-1', categoryId: '9009290', flowTags: '公告,年报', description: '新描述',
    }))
  })

  // saveFlow 是全量保存：抽屉里清空 = 真的要清空，所以空串必须照传（与新建表单相反）。
  it('清空分类/标签/描述会提交空串，而不是被当成"没填"跳过', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue(FLOW)
    const w = mountDrawer()
    await flushPromises()
    await w.get('[data-testid="flow-meta-category"]').setValue('')
    await w.get('[data-testid="flow-meta-tags"]').setValue('')
    await w.get('[data-testid="flow-meta-desc"]').setValue('')
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ categoryId: '', flowTags: '', description: '' }))
  })

  // 保存失败必须把后端原文说出来（Y9）：只说"保存失败"排查不了权限/字段这类问题。
  it('保存失败时把后端错误原文带进提示', async () => {
    vi.spyOn(flowCenterApi, 'save').mockRejectedValue(new Error('flowName 已存在'))
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)
    const w = mountDrawer()
    await flushPromises()
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(error).toHaveBeenCalledWith(expect.stringContaining('flowName 已存在'))
  })

  // bizType 只读（0904 Q3）：生产 200 条流程全为空，枚举无从照抄，不做下拉。
  it('业务大类不提供选择', () => {
    const w = mountDrawer()
    expect(w.find('[data-testid="flow-meta-biztype"]').exists()).toBe(false)
  })
})

// 0905 反馈「这里的展开收起未生效」：那两个按钮在 NodeInspector 里，改的是 ui 上的全局标志，
// 但抽屉原来是死的两列栅格，标志变了布局纹丝不动。
describe('流程详情抽屉 · 展开/收起配置区', () => {
  it('收起配置区后配置区换成窄条，点窄条能再展开', async () => {
    const w = mountDrawer()
    await flushPromises()
    const ui = useUiStore()
    expect(w.find('[aria-label="节点设置"]').exists()).toBe(true)

    ui.toggleInspectorCollapsed()
    await flushPromises()
    expect(w.find('[aria-label="节点设置"]').exists()).toBe(false)
    expect(w.get('.fd-workspace').classes()).toContain('insp-collapsed')

    await w.get('[data-testid="flow-drawer-inspector-collapsed"]').trigger('click')
    await flushPromises()
    expect(w.find('[aria-label="节点设置"]').exists()).toBe(true)
  })

  it('展开配置区后画布换成窄条，点窄条能恢复画布', async () => {
    const w = mountDrawer()
    await flushPromises()
    const ui = useUiStore()

    ui.toggleInspectorExpanded()
    await flushPromises()
    expect(w.find('[aria-label="流程节点"]').exists()).toBe(false)
    expect(w.get('.fd-workspace').classes()).toContain('expanded')

    await w.get('[data-testid="flow-drawer-canvas-collapsed"]').trigger('click')
    await flushPromises()
    expect(w.find('[aria-label="流程节点"]').exists()).toBe(true)
  })

  // 抽屉和画布页共用同一对 ui 标志：画布页手动收起配置后，不能把收起态带进抽屉
  it('打开抽屉复位布局，不继承画布页留下的收起态', async () => {
    setActivePinia(createPinia())
    const ui = useUiStore()
    ui.applyViewLayoutDefault('data')
    expect(ui.inspectorCollapsed).toBe(true)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOW)
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue(STEPS_FIXTURE)

    const w = mount(FlowDetailDrawer, {
      props: { flow: FLOW, categories: [] },
      global: { directives: { loading: {} }, stubs: { FlowBoard: { template: '<div />' }, NodeInspector: { template: '<div />' } } },
    })
    await flushPromises()
    expect(ui.inspectorCollapsed).toBe(false)
    expect(w.find('[aria-label="节点设置"]').exists()).toBe(true)
  })

  // 0926 REVIEW F-R5（0927 P0-1 修订）：关闭前 flush 失败先弹「仍然关闭（改动可能丢失）」
  // 确认——选「留在此页」留在抽屉里（不静默丢改动）；选「仍然关闭」放行（后端持续故障时
  // 用户不能被永远困在抽屉里，比修复前"只 return、关不掉只能刷新"是显式出口）。
  // 0927 起工作区按接口步骤还原（steps 优先），改名的 405101 是已落库数字 ID →
  // 自动保存走 persistExisting → stepModify；让 stepModify 失败来触发"保存失败"状态。
  it('改动未保存成功时点关闭：留在此页（默认）不关抽屉', async () => {
    const flowWithRealId = { ...FLOW, id: '1400987', definition: {
      ...FLOW.definition,
      main: ['start', 'web-list', 'end'],
      configs: { 'web-list': { ...FLOW.definition.configs['web-list'], configId: '1400774' } },
    } } as unknown as FlowRecord
    const w = mountDrawer(flowWithRealId)
    await flushPromises()
    const { itemApi } = await import('@/api')
    vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    // 模拟用户改了一个节点（flowIdMode 下按 flowId 锚定写），保存失败
    useFlowStore().setTitle('405101', '还没保存的改名')
    await flushPromises()

    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancelled'))
    await w.get('.fd-close').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(w.emitted('close')).toBeUndefined()
  })

  it('改动未保存成功时点关闭：确认「仍然关闭」后放行（P0-1 显式出口）', async () => {
    const flowWithRealId = { ...FLOW, id: '1400987', definition: {
      ...FLOW.definition,
      main: ['start', 'web-list', 'end'],
      configs: { 'web-list': { ...FLOW.definition.configs['web-list'], configId: '1400774' } },
    } } as unknown as FlowRecord
    const w = mountDrawer(flowWithRealId)
    await flushPromises()
    const { itemApi } = await import('@/api')
    vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    useFlowStore().setTitle('405101', '还没保存的改名')
    await flushPromises()

    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await w.get('.fd-close').trigger('click')
    await flushPromises()

    expect(w.emitted('close')).toBeTruthy()
  })

  // 0926 REVIEW F-R6：整体保存时若步骤自动保存失败（flush 只置 error 状态不抛错），
  // 必须中止保存流程——否则 flowConf 会带着草稿/旧步骤 ID 落库并弹「保存成功」。
  it('步骤保存失败时点保存流程，中止保存并提示重试（不落 flowConf）', async () => {
    const flowWithRealId = { ...FLOW, id: '1400987', definition: {
      ...FLOW.definition,
      main: ['start', 'web-list', 'end'],
      configs: { 'web-list': { ...FLOW.definition.configs['web-list'], configId: '1400774' } },
    } } as unknown as FlowRecord
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...flowWithRealId, version: 2 })
    const w = mountDrawer(flowWithRealId)
    await flushPromises()
    const { itemApi } = await import('@/api')
    vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)
    // 画布有脏改动（节点改名待落库，flowIdMode 下按 flowId 锚定写）
    useFlowStore().setTitle('405101', '还没保存的改名')
    await flushPromises()

    await saveButton(w).trigger('click')
    await flushPromises()

    // 步骤没落库 → flowConf 不能带未落库的改动落库：既不发 saveFlow，也不弹成功
    expect(save).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('步骤保存失败'))
    // 头部错误态（flush 失败置 error）一直留着，等用户重试
    expect(useFlowStore().flowDirty).toBe(true)
  })
})

// 2026-10-19：「保存流程」不存节点配置，成功后的 markSaved 却会清掉配置脏标记——
// 有未保存配置时必须拦下，关抽屉时也要确认，否则配置改动会被当成已保存悄悄丢掉。
describe('流程详情抽屉 · 未保存的节点配置（2026-10-19）', () => {
  it('有未保存配置时点保存流程：拦下提示，不发 saveFlow，脏标记保留', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ ...FLOW, version: 2 })
    const w = mountDrawer()
    await flushPromises()
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)
    const flow = useFlowStore()
    const nodeId = flow.main.find((id) => !['start', 'end'].includes(id))!
    useNodeStore().touchConfig(nodeId)

    await saveButton(w).trigger('click')
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('的配置还没保存'))
    expect(flow.dirtyConfigNodes).toContain(nodeId)
  })

  it('有未保存配置时点关闭：留在此页不关抽屉；确认「仍然关闭」后放行', async () => {
    const w = mountDrawer()
    await flushPromises()
    const flow = useFlowStore()
    useNodeStore().touchConfig(flow.main.find((id) => !['start', 'end'].includes(id))!)

    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce(new Error('cancelled'))
    await w.get('.fd-close').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('的配置还没保存'), '配置未保存', expect.anything())
    expect(w.emitted('close')).toBeUndefined()

    confirm.mockResolvedValueOnce('confirm' as never)
    await w.get('.fd-close').trigger('click')
    await flushPromises()
    expect(w.emitted('close')).toBeTruthy()
  })
})

// 0927 修复（用户反馈「流程工作区未按接口返回的展示」）：工作区展示以**接口步骤**
// （nextConfigPaged?flowId&svg=true，执行拓扑的唯一事实源）为准——flowConf 是历史快照，
// 与步骤是两本账（0926 REVIEW），源画布/重载早已按步骤还原，只有抽屉还认 flowConf，
// 存量流程画出来就跟接口对不上（节点缺失 / 分支被拍平 / 缺入口）。以下用例锁契约：
// 有步骤行 → 一律按步骤还原；步骤侧没有内容 → flowConf 兜底（行为不变）。
describe('流程详情抽屉 · 工作区按接口步骤展示（0927）', () => {
  const BRANCH_STEPS: Step[] = [
    { stepId: '405100', sourceId: '-1', name: '上市公司-配置', nodeType: 'entry', configId: '1400935', flowId: '1400935', enabled: true, isRoot: true },
    { stepId: '405101', sourceId: '-1', name: 'html下载机器', nodeType: 'entry', configId: '1400974', flowId: '1400935', enabled: true, dependsOn: ['405100'] },
    { stepId: '405102', sourceId: '-1', name: 'html解析', nodeType: 'entry', configId: '1400975', flowId: '1400935', enabled: true, dependsOn: ['405101'] },
    { stepId: '405103', sourceId: '-1', name: '网页抓取', nodeType: 'entry', configId: '1401078', flowId: '1400935', enabled: true, dependsOn: ['405101'] },
  ]

  /** flowConf 是被拍平的旧定义（旧平台单链快照），与接口步骤的分叉拓扑不一致。 */
  const staleDef = {
    main: ['start', '405100', '405101', '405102', 'end'], branches: [], branchGroups: [],
    configs: {
      '405100': { title: '上市公司-配置', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400935' },
      '405101': { title: 'html下载机器', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400974' },
      '405102': { title: 'html解析', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '1400975' },
    },
  } as never

  it('flowConf 有真实节点但步骤返回分支拓扑：画布按步骤还原，flowConf 不覆盖', async () => {
    setActivePinia(createPinia())
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({
      ...FLOW, id: '1400935', name: '上市公司-配置', definition: staleDef,
    } as unknown as FlowRecord)
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue(BRANCH_STEPS)
    const w = mount(FlowDetailDrawer, {
      props: { flow: { ...FLOW, id: '1400935', name: '上市公司-配置' } as unknown as FlowRecord, categories: [] },
      global: {
        directives: { loading: {} },
        stubs: { FlowBoard: { template: '<div />' }, NodeInspector: { template: '<div />' } },
      },
    })
    await flushPromises()
    const f = useFlowStore()
    // 主链按 lastStep 走到分叉点 405101 为止，405102/405103 是它的两条分支——
    // 而不是 flowConf 里那条"405102 排在主链上"的旧单链
    expect(f.main).toEqual(['start', '405100', '405101', 'end'])
    expect(f.branchGroups).toHaveLength(1)
    expect(f.branchGroups[0]!.ownerId).toBe('405101')
    expect(f.branchGroups[0]!.branches.map((b) => b.chain)).toEqual([['405102'], ['405103']])
    // 节点内容同样来自步骤行（名字/配置ID），与接口返回一致
    expect(f.configs['405100']?.title).toBe('上市公司-配置')
    expect(f.configs['405102']?.configId).toBe('1400975')
    // 流程工作区形态：写按 flowId 锚定
    expect(f.flowId).toBe('1400935')
    w.unmount()
  })

  it('步骤侧没有内容而 flowConf 有真实节点：按 flowConf 展示（兜底不变）', async () => {
    setActivePinia(createPinia())
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(FLOW)
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([])
    const w = mount(FlowDetailDrawer, {
      props: { flow: FLOW, categories: [] },
      global: {
        directives: { loading: {} },
        stubs: { FlowBoard: { template: '<div />' }, NodeInspector: { template: '<div />' } },
      },
    })
    await flushPromises()
    const f = useFlowStore()
    expect(f.main).toEqual(['start', 'web-list', 'end'])
    expect(f.configs['web-list']?.configId).toBe('1400774')
    w.unmount()
  })
})

// 0929 F3：工作区保存流程（definitionFromCanvas）必须与 serialize() 同一脱敏口径——
// collectCfg.password / loginConfigs.loginPwd 不得写进 cs_flow.flow_conf（曾是三个出口三种做法）。
describe('流程详情抽屉 · 登录口令不进 flowConf（F3）', () => {
  it('保存时画布节点上的登录密码被摘除，其余字段原样', async () => {
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue(FLOW)
    const w = mountDrawer()
    await flushPromises()

    // 往画布塞一个带登录口令的采集节点（与源画布 serialize({includeLoginPasswords:false}) 同源场景）
    useFlowStore().load({
      id: 'flow-1',
      name: '新闻采集',
      version: 'flow-1',
      main: ['start', 'web-list', 'end'],
      branches: [],
      branchGroups: [],
      // password / loginPwd 不在类型里（它们本就是该被摘除的存量多余键），整段 cast
      configs: {
        'web-list': {
          title: '列表页', sub: '[90] 网页抓取', status: '', planned: false, base: [], fields: [], inmap: [],
          params: [], output: [], configId: '1400999', collectCfg: { snatchType: '[90] - 网页抓取', url: 'https://x', password: 'p@ss0rd', loginConfigs: [{ name: '登录', loginPwd: 'secret' }] },
        },
      } as unknown as Record<string, never>,
      updatedAt: FLOW.updatedAt,
    })
    await flushPromises()
    await saveButton(w).trigger('click')
    await flushPromises()

    const sent = save.mock.calls[0]![0] as { definition: FlowDefinition }
    const collect = sent.definition.configs['web-list']?.collectCfg as unknown as { password?: string; loginConfigs?: { loginPwd?: string }[] } | undefined
    expect(collect?.password).toBeUndefined()
    expect(collect?.loginConfigs?.[0]?.loginPwd).toBeUndefined()
    expect(sent.definition.configs['web-list'].title).toBe('列表页')

    // 脱敏只作用于落库副本：画布内存不被动。注意 loginPwd 例外——normalizeNodeConfig
    // （flowModel.layout.ts:77「登录密码只允许存在于当前编辑会话」）在 load 时就把 loginPwd
    // 归 '' 了，这是加载路径的既有设计，恰好与落库脱敏形成双保险；stripLoginSecrets 真正
    // 防的是编辑会话中新输入的明文（password 字段）。若将来有人把 load 的深拷贝改成浅拷贝，
    // password 会从内存消失——下面这条就是守护（审核 R21，2026-09-29）。
    const canvas = useFlowStore()
    const memCollect = canvas.configs['web-list']?.collectCfg as unknown as { password?: string; loginConfigs?: { loginPwd?: string }[] } | undefined
    expect(memCollect?.password).toBe('p@ss0rd')
    expect(memCollect?.loginConfigs?.[0]?.loginPwd).toBe('')
  })
})

describe('流程详情抽屉 · 查看历史版本（2026-10-14）', () => {
  const OVERVIEW = {
    enabled: true, curVer: 2, nextVer: 3, publishId: '900', draftId: null,
    versions: [
      { versionId: '900', flowVer: 2, ver: 1, state: 'C', isLock: 0, isDelete: 0, baseId: '748', publishDt: '2026-10-11 01:51:01' },
      { versionId: '748', flowVer: 1, ver: 1, state: 'C', isLock: 0, isDelete: 0, baseId: null, publishDt: '2026-10-10 13:10:00' },
    ],
  }

  it('选历史版本：按该版本重读步骤，出只读提示条、保存等按钮禁用；返回当前版本后恢复', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue(OVERVIEW)
    const w = mountDrawer()
    await flushPromises()
    const steps = vi.mocked(flowCenterApi.steps)
    expect(steps).toHaveBeenLastCalledWith('flow-1')
    expect(w.find('[data-testid="flow-history-banner"]').exists()).toBe(false)

    w.findComponent(FlowVersionHistory).vm.$emit('select', '748')
    await flushPromises()
    expect(steps).toHaveBeenLastCalledWith('flow-1', { versionId: '748' })
    expect(w.get('[data-testid="flow-history-banner"]').text()).toContain('v1（已发布）')
    expect(w.get('[data-testid="flow-history-banner"]').text()).toContain('节点配置不随版本保存')
    expect(saveButton(w).attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="flow-apply-to-source"]').attributes('disabled')).toBeDefined()
    expect(w.get('[aria-label="流程名称"]').attributes('disabled')).toBeDefined()

    await w.get('[data-testid="flow-history-exit"]').trigger('click')
    await flushPromises()
    expect(steps).toHaveBeenLastCalledWith('flow-1')
    expect(w.find('[data-testid="flow-history-banner"]').exists()).toBe(false)
    expect(saveButton(w).attributes('disabled')).toBeUndefined()
  })

  it('版本未启用的流程不显示历史版本入口', async () => {
    const w = mountDrawer()
    await flushPromises()
    expect(w.findComponent(FlowVersionHistory).exists()).toBe(false)
  })
})
