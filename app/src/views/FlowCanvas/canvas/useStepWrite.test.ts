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
