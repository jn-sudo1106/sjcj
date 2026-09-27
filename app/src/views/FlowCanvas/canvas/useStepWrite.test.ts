// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { entryApi, flowCenterApi, itemApi, sourceApi } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { useStepWrite } from './useStepWrite'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'
import type { Step } from '@/api'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    ElMessageBox: { confirm: vi.fn().mockResolvedValue(true) },
  }
})

afterEach(() => vi.restoreAllMocks())

const SNAPSHOT: Step = {
  stepId: '40600',
  sourceId: '-1',
  name: '1400917-详情',
  configId: '1400917',
  mainConfig: '1400917',
  url: '$VAL$',
  itemId: '52000351',
  inputTable: '6200026',
  outputTable: '6200026',
  dependsOn: ['0'],
  flowCode: 'WEB_SNATCH',
  nodeType: 'entry',
  enabled: false,
}

function loadTestSource() {
  const flow = useFlowStore()
  const source = useSourceStore()
  const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
  cfg.title = '1400917-详情'
  cfg.disabled = true
  cfg.configId = '1400917'
  if (cfg.collectCfg) {
    cfg.collectCfg.inputTable = '6200026'
    cfg.collectCfg.outputTable = '6200026'
  }
  flow.loadFromSource(
    { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
    [SNAPSHOT],
  )
  source.rememberSteps([SNAPSHOT], 'replace')
  return { flow, source }
}

describe('useStepWrite.persistNodeName', () => {
  it('已落库步骤走 stepModify，保留快照 url/itemId/lastStep', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { persistNodeName } = useStepWrite()
    await persistNodeName('40600', '1400917-详情（联调）')

    expect(modify).toHaveBeenCalledTimes(1)
    const sent = modify.mock.calls[0][0]
    expect(sent.name).toBe('1400917-详情（联调）')
    expect(sent.url).toBe('$VAL$')
    expect(sent.itemId).toBe('52000351')
    expect(sent.dependsOn).toEqual(['0'])
    expect(sent.stepId).toBe('40600')
    expect(flow.configs['40600'].title).toBe('1400917-详情（联调）')
  })

  it('stepModify 失败时回滚画布名称', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    vi.spyOn(itemApi, 'stepModify').mockRejectedValue(new Error('写保护'))

    const { persistNodeName } = useStepWrite()
    await expect(persistNodeName('40600', '不该留下')).rejects.toThrow('写保护')
    expect(flow.configs['40600'].title).toBe('1400917-详情')
  })
})

describe('useStepWrite.persistFlowSteps', () => {
  it('把进入条件写进 cond，并按画布重算 lastStep', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    flow.setEntryCondition('40600', { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' })
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(result.updated).toBe(1)
    expect(modify.mock.calls[0][0].condition).toBe('K6==nil')
    expect(modify.mock.calls[0][0].url).toBe('$VAL$')
  })

  // 0903 YB-A 止血。真实源 920663 的拓扑：40597 ├─▶ 40598 / └─▶ 40620（两支同一前置），
  // 而 buildSourceSeed 把子步骤一律拍成直线，画布上看到的是 40597 → 40598 → 40620。
  // 按画布重算 lastStep 会把 40620 从 40597 挪到 40598 后面——分支被静默拍平且不可逆。
  it('分支流程：拓扑还原成 40597 →{40598, 40620}，且写回时两支的 lastStep 都是 40597', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const mk = (stepId: string, dependsOn: string[]): Step => ({
      ...SNAPSHOT, stepId, name: `节点${stepId}`, dependsOn,
    })
    const steps = [mk('40597', ['0']), mk('40598', ['40597']), mk('40620', ['40597'])]
    flow.loadFromSource(
      { sourceId: '430016824', name: '明阳科技', url: 'http://x', configId: '1400935', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      steps,
    )
    source.rememberSteps(steps, 'replace')
    // YB-B 之后画布还原出真实拓扑：主链只到分叉点，两支各自成 chain
    expect(flow.main.filter((id: string) => /^\d+$/.test(id))).toEqual(['40597'])
    expect(flow.branchGroups).toHaveLength(1)
    expect(flow.branchGroups[0].ownerId).toBe('40597')
    expect(flow.branchGroups[0].branches.map((b: { chain: string[] }) => b.chain)).toEqual([['40598'], ['40620']])

    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    flow.setEntryCondition('40598', { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' })

    const { persistFlowSteps } = useStepWrite()
    await persistFlowSteps()

    const written = Object.fromEntries(modify.mock.calls.map(([step]) => [step.stepId, step.dependsOn]))
    // 关键：40620 仍然挂在 40597 下，没有被改写成 40598
    expect(written['40620']).toEqual(['40597'])
    expect(written['40598']).toEqual(['40597'])
    // 与拓扑无关的字段照常保存
    expect(modify.mock.calls.find(([s]) => s.stepId === '40598')![0].condition).toBe('K6==nil')
  })

  it('没有分支的直链流程仍然按画布重算 lastStep（止血只作用于分支流程）', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const mk = (stepId: string, dependsOn: string[]): Step => ({
      ...SNAPSHOT, stepId, name: `节点${stepId}`, dependsOn,
    })
    // 快照里 b 的前置写的是 '0'，画布上 b 排在 a 后面 → 重算应得到 ['a' 的 id]
    const steps = [mk('40597', ['0']), mk('40598', ['0'])]
    flow.loadFromSource(
      { sourceId: '430016824', name: '直链源', url: 'http://x', configId: '1400935', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      steps,
    )
    source.rememberSteps(steps, 'replace')

    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const { persistFlowSteps } = useStepWrite()
    await persistFlowSteps()

    const written = Object.fromEntries(modify.mock.calls.map(([step]) => [step.stepId, step.dependsOn]))
    expect(written['40598']).toEqual(['40597'])
  })

  it('本地新节点有 configId 时 saveItemConfig + 差集定位 + enable', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    flow.insertAfter('40600', 'web')
    const localId = flow.selectedId
    flow.configs[localId].configId = '1400999'
    flow.configs[localId].outputTable = '6200026'
    flow.configs[localId].title = '新详情'

    vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40601', name: '新详情', configId: '1400999', enabled: false },
    ])

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(result.created).toBe(1)
    expect(itemApi.saveItemConfig).toHaveBeenCalledTimes(1)
    expect(itemApi.enable).toHaveBeenCalledWith('40601', '0')
    expect(flow.configs['40601']).toBeTruthy()
    expect(flow.configs[localId]).toBeUndefined()
  })

  // 0927 H1：非文件节点输出表未就绪（已绑配置但没选输出表）——提交必被后端
  // 「节点输出表不能为空」拒绝，自动保存按草稿跳过（画布保留，等待补输出表）。
  it('已绑配置但缺输出表的草稿节点：不建不报错，补上输出表后才落库', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    flow.insertAfter('40600', 'web')
    const localId = flow.selectedId
    flow.configs[localId].configId = '1400999' // 只差输出表
    flow.configs[localId].title = '缺输出表'

    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([SNAPSHOT])

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(create).not.toHaveBeenCalled()
    // 40600 会因拓扑重算被回写 1 次（既有行为），缺输出表的新节点不建
    expect(result.created).toBe(0)
    expect(flow.configs[localId]).toBeTruthy() // 节点还在画布上等输出表

    flow.configs[localId].outputTable = '6200027'
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40601', name: '缺输出表', configId: '1400999', outputTable: '6200027', enabled: false },
    ])
    const again = await persistFlowSteps()
    expect(again.created).toBe(1)
  })

  it('缺输出表的存量行（规则节点，输入表也为空）改名：先改画布并提示，不调 stepModify（0927 H1）', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    // 规则节点形态：输入表/输出表都空（采集节点回读会被源/上游回填输入表，「默认 = 输入表」
    // 兜底后不算缺；规则节点没有该兜底）。后端 STEP_UPDATE 时新增值优先、旧值也空 → 拒。
    const tainted = { ...SNAPSHOT, stepId: '40601', name: '旧名', nodeType: 'rule', inputTable: undefined, outputTable: undefined }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [SNAPSHOT, tainted],
    )
    const source = useSourceStore()
    source.rememberSteps([SNAPSHOT, tainted], 'replace')

    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const { persistNodeName } = useStepWrite()
    await persistNodeName('40601', '新名')

    expect(modify).not.toHaveBeenCalled()
    expect(flow.configs['40601'].title).toBe('新名') // 画布已改，等补输出表后自动保存落库
  })

  // 0925 整体切 flowId：源记录回读带 flowId（bee-top cs_source.FLOW_ID）→ 新建步骤写 payload
  // 显式携带 flowId（mainConfig 保留），新建后的认领回查也走 flowId 视角（svg=true 含根行）。
  it('源带 flowId：新建步骤 saveItemConfig 带 flowId，认领回查走 flowCenterApi.steps', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C', flowId: '1400935' } as never,
      [SNAPSHOT],
    )
    source.rememberSteps([SNAPSHOT], 'replace')
    const localId = flow.insertAfter('40600', 'web')
    flow.configs[localId].configId = '1400999'
    flow.configs[localId].outputTable = '6200026'
    flow.configs[localId].title = '新详情'

    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const flowSteps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40601', name: '新详情', configId: '1400999', enabled: false, flowId: '1400935' },
    ])
    const sourceSteps = vi.spyOn(sourceApi, 'sourceSteps')

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(result.created).toBe(1)
    expect(create.mock.calls[0][0].flowId).toBe('1400935')
    expect(create.mock.calls[0][0].mainConfig).toBe('1400917')
    expect(flowSteps).toHaveBeenCalledWith('1400935', { withConfigDetails: false })
    expect(sourceSteps).not.toHaveBeenCalled()
    expect(flow.configs['40601']).toBeTruthy()
  })

  // 0925 整体切 flowId：老后端 / 未绑流程的源没有 flowId。此时新建步骤的 flowId 落
  // 存量等价兜底——prev 快照的 mainConfig（存量数据 flowId===mainConfig，与后端
  // fillFlowIdIfEmpty 回填口径一致），认领回查维持按源查（改造前行为）。
  it('源没有 flowId：新建步骤 flowId 按存量等价兜底 mainConfig，认领回查仍走 sourceApi.sourceSteps', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    const localId = flow.insertAfter('40600', 'web')
    flow.configs[localId].configId = '1400999'
    flow.configs[localId].outputTable = '6200026'
    flow.configs[localId].title = '旧后端新节点'

    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const sourceSteps = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40601', name: '旧后端新节点', configId: '1400999', enabled: false },
    ])
    const flowSteps = vi.spyOn(flowCenterApi, 'steps')

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(result.created).toBe(1)
    // 源与快照都没有 flowId 时 prev 的 mainConfig（1400917）兜底（存量等价）
    expect(create.mock.calls[0][0].flowId).toBe('1400917')
    expect(sourceSteps).toHaveBeenCalled()
    expect(flowSteps).not.toHaveBeenCalled()
  })

  it('源与快照都没有 flowId 和 mainConfig 时：saveItemConfig 不传 flowId（后端回填）', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    // 空步骤源：没有任何真实步骤快照、源也没有主配置（合成根节点仍在，但无快照/无 configId）
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://www.baidu.com/', configId: '', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [],
    )
    source.rememberSteps([], 'replace')
    const rootId = flow.main.find((id: string) => id.startsWith('source:'))!
    flow.insertAfter(rootId, 'web')
    const localId = flow.selectedId
    flow.configs[localId].configId = '1400999'
    flow.configs[localId].outputTable = '6200026'
    flow.configs[localId].title = '新节点'

    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    // 根节点（source:xxx 合成起点）也会被建，需要两条都能被认领
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { ...SNAPSHOT, stepId: '40601', name: flow.configs[rootId].title, configId: '' },
      { ...SNAPSHOT, stepId: '40602', name: '新节点', configId: '1400999', mainConfig: '1400999' },
    ])

    const { persistFlowSteps } = useStepWrite()
    await persistFlowSteps()

    const webCall = create.mock.calls.find(([step]) => step.configId === '1400999')
    expect(webCall).toBeTruthy()
    expect(webCall![0]).not.toHaveProperty('flowId')
  })

  // 0925 整体切 flowId：flowId 模式的画布会带回真实根节点行（isRoot=1，真实 itemConfig）。
  // 它由流程生命周期管理，自动保存必须跳过——不能建（普通新增接口拒建根）、不能改（后端
  // 校验 type/sourceId/lastStep 合规、根不能有上游）。
  it('真实根节点（isRoot=1）不参与自动保存：不建不更', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const rootStep: Step = {
      ...SNAPSHOT, stepId: '41352', name: '流程入口', isRoot: true,
      dependsOn: undefined, mainConfig: '1400935', flowId: '1400935',
    }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C', flowId: '1400935' } as never,
      [rootStep],
    )
    source.rememberSteps([rootStep], 'replace')

    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(result).toEqual({ created: 0, updated: 0, skipped: 0 })
    expect(modify).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  // 0927 G1：真实根节点（isRoot=1）现在是「只读元数据 + 可换配置」。每次自动保存先判断画布
  // configId 与快照是否一致：一致不写；不一致走 ROOT 专属轻量通道（rootConfigUpdate 只交
  // itemConfig+configId——普通整包/stepModify 反算的 isDelete 会被后端 validateRootUpdate 拒绝）。
  it('根节点换配置：走 ROOT 专属轻量 rootConfigUpdate，快照同步后不重复写', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const rootStep: Step = {
      ...SNAPSHOT, stepId: '41352', name: '流程入口', isRoot: true,
      dependsOn: undefined, mainConfig: '1400935', flowId: '1400935',
    }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C', flowId: '1400935' } as never,
      [rootStep],
    )
    source.rememberSteps([rootStep], 'replace')
    // 右侧「更换配置」绑了新配置（bindExistingConfig 置画布 configId + touchFlow）
    flow.configs['41352'].configId = '1400999'

    const rootUpdate = vi.spyOn(itemApi, 'rootConfigUpdate').mockResolvedValue({ ok: true, message: 'ok' })
    const modify = vi.spyOn(itemApi, 'stepModify')
    const create = vi.spyOn(itemApi, 'saveItemConfig')

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    // 最小集：只有 itemConfig + configId，不带输出表/输入表/条件/源/启停反算
    expect(rootUpdate).toHaveBeenCalledTimes(1)
    expect(rootUpdate).toHaveBeenCalledWith('41352', '1400999')
    expect(modify).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(result).toEqual({ created: 0, updated: 1, skipped: 0 })
    // 快照同步 → 再次保存不再重复写
    await persistFlowSteps()
    expect(rootUpdate).toHaveBeenCalledTimes(1)
  })

  it('根节点换配置失败：错误上抛（autosave 进入退避重试），快照不回写', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const rootStep: Step = {
      ...SNAPSHOT, stepId: '41352', name: '流程入口', isRoot: true,
      dependsOn: undefined, mainConfig: '1400935', flowId: '1400935',
    }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C', flowId: '1400935' } as never,
      [rootStep],
    )
    source.rememberSteps([rootStep], 'replace')
    flow.configs['41352'].configId = '1400999'

    vi.spyOn(itemApi, 'rootConfigUpdate').mockResolvedValue({ ok: false, message: 'ROOT配置已变化或不存在' })

    const { persistFlowSteps } = useStepWrite()
    await expect(persistFlowSteps()).rejects.toThrow('ROOT配置已变化或不存在')
    // 快照仍指向旧配置：重试还会再发，不会假成功
    expect(source.stepSnapshots['41352']?.configId).toBe('1400917')
  })

  // 0927 P1-8：虚拟根（svg 回退行 stepId='0'、isRoot=1）不是真实物化 ROOT——isRootStepStepId
  // 排除 '0' 后：G1 不触发（不 rootConfigUpdate 物化虚拟根）、自动保存不建不更、删除被拦截。
  it('虚拟根（stepId=0 的 isRoot 行）：不触发 G1 换配置，删除被拦截', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const virtualRoot: Step = {
      ...SNAPSHOT, stepId: '0', name: '源名', isRoot: true,
      dependsOn: undefined, mainConfig: '1400935', flowId: '1400935',
    }
    const child: Step = {
      ...SNAPSHOT, stepId: '40597', name: '详情', dependsOn: ['0'],
      mainConfig: '1400935', flowId: '1400935', configId: '1400917',
    }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C', flowId: '1400935' } as never,
      [virtualRoot, child],
    )
    source.rememberSteps([virtualRoot, child], 'replace')
    // 模拟右侧把虚拟根的配置改了——G1 只认真实物化根，虚拟根不得 rootConfigUpdate
    if (flow.configs['0']) flow.configs['0'].configId = '1400999'

    const rootUpdate = vi.spyOn(itemApi, 'rootConfigUpdate').mockResolvedValue({ ok: true, message: 'ok' })
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { persistFlowSteps, deleteCanvasNode } = useStepWrite()
    const result = await persistFlowSteps()
    expect(rootUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({ created: 0, updated: 1, skipped: 0 }) // 只有 child 走普通回写
    // 删除拦截保持：虚拟根与真实根一样不能单独删除
    await expect(deleteCanvasNode('0', { confirmed: true })).resolves.toBe(false)
    expect(modify).toHaveBeenCalledTimes(1)
  })

  it('根节点改名被拒绝：不调 stepModify，画布名称不动（流程根名称由流程管理维护）', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const rootStep: Step = {
      ...SNAPSHOT, stepId: '41352', name: '流程入口', isRoot: true,
      dependsOn: undefined, mainConfig: '1400935', flowId: '1400935',
    }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C', flowId: '1400935' } as never,
      [rootStep],
    )
    source.rememberSteps([rootStep], 'replace')

    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const { persistNodeName } = useStepWrite()
    await persistNodeName('41352', '改个新名')

    expect(modify).not.toHaveBeenCalled()
    expect(flow.configs['41352'].title).toBe('流程入口')
  })

  it('根节点删除被拦截：不调 deleteStep，返回 false', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    const rootStep: Step = {
      ...SNAPSHOT, stepId: '41352', name: '流程入口', isRoot: true,
      dependsOn: undefined, mainConfig: '1400935', flowId: '1400935',
    }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C', flowId: '1400935' } as never,
      [rootStep],
    )
    source.rememberSteps([rootStep], 'replace')

    const del = vi.spyOn(itemApi, 'deleteStep').mockResolvedValue({ ok: true, message: 'ok' })
    const { deleteCanvasNode } = useStepWrite()
    const ok = await deleteCanvasNode('41352')

    expect(ok).toBe(false)
    expect(del).not.toHaveBeenCalled()
  })

  it('已有步骤改名：步骤快照带 flowId 时 stepModify 整包带上 flowId（老后端源无 flowId 场景）', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    // 源没有 flowId（老后端回读），但步骤快照自己带着 flowId
    const snap = { ...SNAPSHOT, flowId: '1400935' }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [snap],
    )
    source.rememberSteps([snap], 'replace')

    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const { persistNodeName } = useStepWrite()
    await persistNodeName('40600', '改名')

    expect(modify.mock.calls[0][0].flowId).toBe('1400935')
  })

  // mainConfig 是"这个步骤属于哪个源"的锚点（见 Source.mainConfig 注释：同一源的所有步骤
  // mainConfig 相同）。cs_item_next 的 SOURCE_ID 恒为 -1，指望不上，归属全靠它。
  //
  // ⚠️ 本用例锁的是"mainConfig 必须是源级锚点"这条不变量，**不是**对
  // 「新建步骤后无法唯一定位（匹配到 0 条）」那个线上故障的复现——那个还没定位到（见
  // createTemplateFromPrev 的注释）。本用例走的是从 prev 继承的路径，兜底分支未被覆盖。
  it('新步骤的 mainConfig 是源级锚点（源主配置），不是节点自己的 configId', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    // 空步骤源：画布只有合成根节点，没有任何真实步骤，快照也是空的
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://www.baidu.com/', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [],
    )
    source.rememberSteps([], 'replace')
    const rootId = flow.main.find((id: string) => id.startsWith('source:'))!
    const localId = flow.insertAfter(rootId, 'rule')!
    flow.configs[localId].configId = '1400992'
    flow.configs[localId].outputTable = '6200026'

    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    // 空步骤源上，画布合成的根节点本身也是一个待落库草稿——它会先被建一次，
    // 所以两条都要能被差集唯一定位（靠 name 区分）。
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { ...SNAPSHOT, stepId: '40601', name: flow.configs[rootId].title, configId: '1400917', mainConfig: '1400917' },
      { ...SNAPSHOT, stepId: '40602', name: flow.configs[localId].title, configId: '1400992', mainConfig: '1400917' },
    ])

    const { persistFlowSteps } = useStepWrite()
    await persistFlowSteps()

    // 源的主配置是 1400917；写成新节点自己的 1400992 就会挂到查不到的锚点上
    const ruleCall = create.mock.calls.find(([step]) => step.configId === '1400992')
    expect(ruleCall, '规则节点应当被新建一次').toBeTruthy()
    expect(ruleCall![0].mainConfig).toBe('1400917')
  })

  // 2026-09-04：认领新建步骤的判据从"名字"换成三级（回执 ID → itemConfig 最大 → 名字只做校验）。
  // 名字是用户随时能改的，默认值又天生重复（同一前置下加两个规则节点都叫「1400917-规则处理」），
  // 拿它认身份本来就不牢靠——原来差集多于一条时靠名字过滤，撞名就抛「无法唯一定位」。
  it('差集有多条同名新增时，按 itemConfig 最大认领，不再报"无法唯一定位"', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    const localId = flow.insertAfter('40600', 'web')!
    flow.configs[localId].configId = '1400999'
    flow.configs[localId].outputTable = '6200026'
    const wanted = flow.configs[localId].title

    vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    // 两条新增且同名——老逻辑在这里必抛
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40601', name: wanted },
      { ...SNAPSHOT, stepId: '40602', name: wanted },
    ])

    const { persistFlowSteps } = useStepWrite()
    await expect(persistFlowSteps()).resolves.toBeTruthy()
    // 认领的是 id 最大那条
    expect(flow.main).toContain('40602')
  })

  it('回执直接带 itemConfig 时优先用它，不靠差集', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    const localId = flow.insertAfter('40600', 'web')!
    flow.configs[localId].configId = '1400999'
    flow.configs[localId].outputTable = '6200026'

    vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok', itemConfig: '40777' } as never)
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    // 差集里 40888 更大；回执指名 40777，就该听回执的
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      SNAPSHOT,
      { ...SNAPSHOT, stepId: '40777', name: '回执指定' },
      { ...SNAPSHOT, stepId: '40888', name: '别的' },
    ])

    const { persistFlowSteps } = useStepWrite()
    await persistFlowSteps()

    expect(flow.main).toContain('40777')
    expect(flow.main).not.toContain('40888')
  })

  it('本地新节点缺 configId 时跳过它，其余节点照常保存（0926）', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    const draftId = flow.insertAfter('40600', 'web')!
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })

    const { persistFlowSteps } = useStepWrite()
    // 0926 起不再整次拦下：草稿节点留在画布上等右侧绑定配置，已绑定节点照常落库
    await expect(persistFlowSteps()).resolves.toEqual({ created: 0, updated: 1, skipped: 0 })
    expect(create).not.toHaveBeenCalled()
    expect(modify).toHaveBeenCalledTimes(1)
    expect(modify.mock.calls[0][0].stepId).toBe('40600')
    expect(flow.main).toContain(draftId) // 草稿节点还在画布上，等配置绑定后由 touchFlow 触发保存
  })

  it('虚拟起点 0 不走 saveItemConfig，只回写可落库步骤', async () => {
    setActivePinia(createPinia())
    const origin: Step = { ...SNAPSHOT, stepId: '0', sourceId: '430016398', name: 'test1', dependsOn: undefined }
    const flow = useFlowStore()
    const source = useSourceStore()
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [origin, SNAPSHOT],
    )
    source.rememberSteps([origin, SNAPSHOT], 'replace')
    const create = vi.spyOn(itemApi, 'saveItemConfig')
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(create).not.toHaveBeenCalled()
    expect(result.updated).toBe(1)
    expect(modify.mock.calls.map((c) => c[0].stepId)).toEqual(['40600'])
  })
})

// 0926「基础数据写正常」：流程工作区（FlowDetailDrawer，无源上下文）的写路径。
// 抽屉里新建/改名/改条件/删除节点要真正落 cs_item_config（执行按流程反查步骤），
// 不允许"画布有、执行没有"。useStepWrite 在 flow.flowIdMode 下按 flowId 锚定：
// mainConfig=flowId、sourceId=-1、认领回查走 flowCenterApi.steps(flowId)。
const FLOW_ROOT: Step = {
  ...SNAPSHOT,
  stepId: '41380',
  name: '流程入口',
  mainConfig: '1400987',
  flowId: '1400987',
  dependsOn: undefined,
  isRoot: true,
}
const FLOW_STEP: Step = {
  ...SNAPSHOT,
  stepId: '41385',
  mainConfig: '1400987',
  flowId: '1400987',
}

function loadFlowWorkspace() {
  const flow = useFlowStore()
  flow.loadFromSource(
    { sourceId: '', name: '测试流程', url: '', configId: '1400987', mainTable: '', owner: '', state: 'C' } as never,
    [FLOW_ROOT, FLOW_STEP],
  )
  flow.flowId = '1400987'
  flow.setFlowIdMode(true)
  flow.clearSourceCtxKeepSteps()
  return flow
}

describe('useStepWrite · 流程工作区（flowIdMode）', () => {
  it('新建节点按 flowId 锚定落库：flowId/mainConfig=流程 ID、sourceId=-1、认领换 ID', async () => {
    setActivePinia(createPinia())
    const flow = loadFlowWorkspace()
    const source = useSourceStore()
    const localId = flow.insertAfter('41385', 'web')!
    flow.configs[localId].configId = '1400992'
    flow.configs[localId].outputTable = '6200026'

    const wantedTitle = flow.configs[localId].title
    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([
      FLOW_ROOT,
      FLOW_STEP,
      { ...FLOW_STEP, stepId: '41386', name: wantedTitle, configId: '1400992', dependsOn: ['41385'], enabled: false },
    ])

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(result.created).toBe(1)
    const payload = create.mock.calls[0][0]
    expect(payload.flowId).toBe('1400987')
    expect(payload.mainConfig).toBe('1400987')
    expect(payload.sourceId).toBe('-1')
    expect(payload.name).toBe(wantedTitle)
    // 认领：草稿 id 换成后端返回的真实步骤 id
    expect(flow.main).toContain('41386')
    expect(flow.main).not.toContain(localId)
    expect(source.stepSnapshots['41386']).toBeTruthy()
  })

  it('flowConf 里没有步骤行的历史节点（R2 遗留形态）跳过回写，计数上报 skipped（0927 P1-5）', async () => {
    setActivePinia(createPinia())
    const flow = loadFlowWorkspace()
    // 构造"只有画布定义、cs_item_config 里没有对应行"的节点：数字 id、无快照
    const ghostId = '41999'
    flow.insertAfter('41385', 'web') // 顺手加一个未绑定配置的草稿节点（应被跳过）
    const ghostCfg = cloneConfig(NODE_CONFIGS['web-detail'])
    ghostCfg.title = '幽灵节点'
    ghostCfg.configId = '1400992'
    flow.configs[ghostId] = ghostCfg
    flow.main.splice(flow.main.indexOf('end'), 0, ghostId)

    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const create = vi.spyOn(itemApi, 'saveItemConfig')

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    // 0927 P1-5：无快照跳过不再静默——skipped 上报给 autosave，状态停在 pending（不假装已保存）
    expect(result).toEqual({ created: 0, updated: 1, skipped: 1 })
    expect(create).not.toHaveBeenCalled()
    expect(modify.mock.calls.map((c) => c[0].stepId)).toEqual(['41385'])
  })
})

describe('useStepWrite.deleteCanvasNode', () => {
  it('可落库 id 先 deleteStep 再从画布移除', async () => {
    setActivePinia(createPinia())
    const { flow, source } = loadTestSource()
    vi.spyOn(itemApi, 'deleteStep').mockResolvedValue({ ok: true, message: 'ok' })

    const { deleteCanvasNode } = useStepWrite()
    await deleteCanvasNode('40600')

    expect(itemApi.deleteStep).toHaveBeenCalledWith('40600')
    expect(flow.configs['40600']).toBeUndefined()
    expect(source.stepSnapshots['40600']).toBeUndefined()
  })
})

// 2026-09-04：新建网站 / 新建源之后一进画布，自动保存把**画布合成的虚拟起点**
// （rootStepForSource 造的 `source:<sourceId>`）当成新节点建了一条真实步骤。
// 那个节点对应的是后端 `nextConfigPaged?sourceId=X&svg=true` **现算**的 itemConfig:0 行，
// 不是 cs_item_config 里的记录——落库之后再进画布，后端照旧返回现算的那行、外加这条新建的，
// 首节点就多出一个，且每进一次多一条。
describe('useStepWrite · 画布合成的虚拟起点不落库', () => {
  it('空步骤源：只建用户新加的节点，不建 source:xxx 这个合成起点', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://www.baidu.com/', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [],
    )
    source.rememberSteps([], 'replace')
    const rootId = flow.main.find((id: string) => id.startsWith('source:'))!
    const localId = flow.insertAfter(rootId, 'rule')!
    flow.configs[localId].configId = '1400992'
    flow.configs[localId].outputTable = '6200026'

    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'enable').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { ...SNAPSHOT, stepId: '40602', name: flow.configs[localId].title, configId: '1400992', mainConfig: '1400917' },
    ])

    const { persistFlowSteps } = useStepWrite()
    await persistFlowSteps()

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].configId).toBe('1400992')
    // 合成起点的配置就是源自己的 configId——一旦它被建出来，就是那个"多出来的首节点"
    expect(create.mock.calls.some(([step]) => step.configId === '1400917')).toBe(false)
  })

  it('画布上只有合成起点、用户什么都没加时：一条请求都不发', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://www.baidu.com/', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [],
    )
    source.rememberSteps([], 'replace')

    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])

    const { persistFlowSteps } = useStepWrite()
    const result = await persistFlowSteps()

    expect(create).not.toHaveBeenCalled()
    expect(result).toEqual({ created: 0, updated: 0, skipped: 0 })
  })
})

describe('useStepWrite.relinkOrphan（0925 孤儿修复）', () => {
  it('显式写 lastStep=目标节点，不受分支流程写回冻结影响', async () => {
    setActivePinia(createPinia())
    const { flow, source } = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { relinkOrphan } = useStepWrite()
    await relinkOrphan('40600', '40999')

    expect(modify).toHaveBeenCalledTimes(1)
    const sent = modify.mock.calls[0][0]
    expect(sent.stepId).toBe('40600')
    expect(sent.dependsOn).toEqual(['40999'])
    // 快照的 url/itemId 原样带回，不因改归属丢字段
    expect(sent.url).toBe('$VAL$')
    expect(sent.itemId).toBe('52000351')
    // 快照同步成新归属
    expect(source.stepSnapshots['40600']?.dependsOn).toEqual(['40999'])
    expect(flow.orphanIds).toEqual([])
  })

  it('目标 = 自己 / 目标不可写 / 缺快照：都拒绝且不发请求', async () => {
    setActivePinia(createPinia())
    const { source } = loadTestSource()
    source.rememberSteps([{ ...SNAPSHOT, stepId: '41000', isRoot: true }], 'merge')
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { relinkOrphan } = useStepWrite()
    await expect(relinkOrphan('40600', '40600')).rejects.toThrow('不能把节点关联到自己')
    await expect(relinkOrphan('40600', 'abc')).rejects.toThrow('目标节点不可作为前置步骤')
    await expect(relinkOrphan('999', '40600')).rejects.toThrow('还没有步骤快照')
    expect(modify).not.toHaveBeenCalled()
  })

  // 0926 修正（用户反馈「孤儿要挂回流程入口时下拉是空的」）：入口放行——
  // lastStep 指向入口 = 旧平台「挂在根上」的语义，后端把根引用归一成 '0' 哨兵。
  it('挂回流程入口：目标 = \'0\' 哨兵（源视角虚拟入口行）照常写 lastStep=0', async () => {
    setActivePinia(createPinia())
    const { source } = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { relinkOrphan } = useStepWrite()
    await relinkOrphan('40600', '0')

    expect(modify).toHaveBeenCalledTimes(1)
    const sent = modify.mock.calls[0][0]
    expect(sent.stepId).toBe('40600')
    expect(sent.dependsOn).toEqual(['0'])
    expect(source.stepSnapshots['40600']?.dependsOn).toEqual(['0'])
  })

  // 0926 REVIEW F2：源视图画布入口是合成根（source:xxx），下拉给出该选项、
  // 写侧归一成 '0' 哨兵（后端源视角的根引用就是 '0'）。
  it('挂回源视图入口：目标 = 合成根（source: 前缀）归一成 lastStep=0', async () => {
    setActivePinia(createPinia())
    const { source } = loadTestSource()
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { relinkOrphan } = useStepWrite()
    await relinkOrphan('40600', 'source:430016398')

    expect(modify).toHaveBeenCalledTimes(1)
    const sent = modify.mock.calls[0][0]
    expect(sent.stepId).toBe('40600')
    expect(sent.dependsOn).toEqual(['0'])
    expect(source.stepSnapshots['40600']?.dependsOn).toEqual(['0'])
  })

  it('挂到真实入口行（isRoot=1，flowId 模式的根节点行）：照常写 lastStep=根行 ID', async () => {
    setActivePinia(createPinia())
    const { source } = loadTestSource()
    source.rememberSteps([{ ...SNAPSHOT, stepId: '41000', isRoot: true }], 'merge')
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })

    const { relinkOrphan } = useStepWrite()
    await relinkOrphan('40600', '41000')

    expect(modify).toHaveBeenCalledTimes(1)
    expect(modify.mock.calls[0][0].dependsOn).toEqual(['41000'])
    expect(source.stepSnapshots['40600']?.dependsOn).toEqual(['41000'])
  })

  it('规则节点关联：入出参钉回快照原值，不按画布重算、不查列名映射（0925 REVIEW 再评）', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source = useSourceStore()
    // 数据监控步骤：seeds 按名字回读成 rule 模板（带 ruleCfg），画布 cfg 的 inputFields 与
    // 快照入出参故意不一致——关联语义是只改归属，payload 必须保持快照原值。
    const ruleSnap: Step = {
      ...SNAPSHOT,
      stepId: '41999',
      name: '数据监控-测试',
      nodeType: 'rule',
      configType: '620',
      dependsOn: ['999'],
      contextMap: ['COL_A', 'COL_B'],
      outColumns: ['COL_C'],
    }
    flow.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [SNAPSHOT, ruleSnap],
    )
    source.rememberSteps([SNAPSHOT, ruleSnap], 'replace')
    const ruleCfg = flow.configs['41999']
    expect(ruleCfg?.ruleCfg).toBeTruthy()
    ruleCfg.ruleCfg = {
      mode: 'new', describe: '', inputTableId: '6200026', outputTableId: '6200026',
      inputFields: ['K7'], outputFields: ['K9'], script: '', scriptPath: '', enabled: true,
    }
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const entryDetail = vi.spyOn(entryApi, 'entryDetail')

    const { relinkOrphan } = useStepWrite()
    await relinkOrphan('41999', '40600')

    expect(modify).toHaveBeenCalledTimes(1)
    const sent = modify.mock.calls[0][0]
    expect(sent.stepId).toBe('41999')
    expect(sent.dependsOn).toEqual(['40600'])
    // 入出参不被画布重算覆盖（K7/K9 都不出现），保持快照原样
    expect(sent.contextMap).toEqual(['COL_A', 'COL_B'])
    expect(sent.outColumns).toEqual(['COL_C'])
    // 不触发列名映射的额外网络往返
    expect(entryDetail).not.toHaveBeenCalled()
  })
})
