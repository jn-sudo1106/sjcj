// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { itemApi, sourceApi } from '@/api'
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

  it('本地新节点缺 configId 时整次保存拦下，不改已有步骤（0828 W9-4）', async () => {
    setActivePinia(createPinia())
    const { flow } = loadTestSource()
    flow.insertAfter('40600', 'web')
    const modify = vi.spyOn(itemApi, 'stepModify').mockResolvedValue({ ok: true, message: 'ok' })
    const create = vi.spyOn(itemApi, 'saveItemConfig').mockResolvedValue({ ok: true, message: 'ok' })

    const { persistFlowSteps } = useStepWrite()
    await expect(persistFlowSteps()).rejects.toThrow(/尚未绑定配置/)
    expect(modify).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(flow.flowDirty).toBe(true)
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
