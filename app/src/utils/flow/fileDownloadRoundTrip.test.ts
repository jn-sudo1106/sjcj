import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Source } from '@/api'
import { stepFromLegacy, stepToStepModifyPayload } from '@/api/legacyAdapters'
import { useFlowStore } from '@/stores/flow'
import {
  buildSourceSeed, cloneConfig, collectorCapabilityOf, inferCollectorKind, NODE_CONFIGS,
} from '@/views/FlowCanvas/canvas/flowModel'
import { defaultPromptCategoryForNode } from '@/views/FlowCanvas/inspector/promptCategory'
import { applyConfigToNode, buildConfigPayload, configTypeFrom } from './nodeConfigPayload'
import { isFileLikeNode, mergeStepForWrite } from './stepPersist'

const source: Source = {
  sourceId: '1', name: '测试源', url: 'https://example.com/list',
  configId: '1000', mainTable: '2101', owner: '', state: 'C',
}

describe('文件下载类型的创建与保存回读', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('新建文件下载使用文件能力和提示词分类，不继承 APP 或网页的能力', () => {
    const flow = useFlowStore()
    flow.newFlow('blank')
    const id = flow.insertAfter('start', 'file')!
    const cfg = flow.configs[id]

    expect(collectorCapabilityOf(cfg)).toMatchObject({
      kind: 'file_download', artifactType: 'file', supportsResume: true, supportsLogin: false,
    })
    expect(defaultPromptCategoryForNode(cfg)).toBe('文件下载')
    expect(cfg.collectCfg).toMatchObject({ inputTable: '', outputTable: '', url: '' })
  })

  it.each(['entry', 'list', 'detail'])('type=%s 的文件下载改名后，保存、回读、再次保存仍为 95', (nodeType) => {
    const flow = useFlowStore()
    flow.newFlow('blank')
    const id = flow.insertAfter('start', 'file')!
    const cfg = flow.configs[id]
    cfg.title = '归档 A'
    cfg.configId = '1001'
    cfg.collectCfg!.inputTable = '2101'
    cfg.collectCfg!.outputTable = '2102'
    const snapshot = stepFromLegacy({ itemConfig: 42, sourceId: -1, type: nodeType }, '1')
    const configPayload = buildConfigPayload(cfg)
    const stepPayload = stepToStepModifyPayload(mergeStepForWrite({ cfg, snapshot, nodeId: '42', sourceId: '1' }))
    // 步骤行走旧字段适配；configType / isMulti 由 configDetail 补充。
    const read = {
      ...stepFromLegacy({ ...stepPayload, configType: configPayload.configType }, '1'),
      multiMode: configPayload.isMulti as 0 | 1 | 2,
    }
    const loaded = buildSourceSeed(source, [read]).configs['42']

    expect(configPayload.configType).toBe(95)
    expect(stepPayload).toMatchObject({ stepType: 95, type: nodeType })
    expect(loaded.template).toBe('file')
    expect(loaded.title).toBe('归档 A')
    expect(loaded.collectCfg?.snatchType).toBe('[95] - 文件下载')
    expect(collectorCapabilityOf(loaded)?.kind).toBe('file_download')
    expect(isFileLikeNode(loaded, read)).toBe(true)
    expect(buildConfigPayload(loaded, { configType: 95 }).configType).toBe(95)
    expect(mergeStepForWrite({ cfg: loaded, snapshot: read, nodeId: '42', sourceId: '1' }).stepType).toBe(95)
  })

  it.each(['entry', 'rule'])('首屏 type=%s 时尚无配置类型，异步回填 95 后恢复文件下载', (nodeType) => {
    const flow = useFlowStore()
    const bare = stepFromLegacy({
      itemConfig: 42, configId: 1001, sourceId: -1, name: '归档 A', type: nodeType,
      entryTypeId: 2101, outEntry: 2102,
    }, '1')
    flow.loadFromSource(source, [bare], null)
    flow.applyStepDetails([{ ...bare, configType: '95', multiMode: 0, inputTable: '2101', outputTable: '2102' }])

    const cfg = flow.configs['42']
    expect(cfg.template).toBe('file')
    expect(cfg.ruleCfg).toBeUndefined()
    expect(cfg.collectCfg).toMatchObject({ snatchType: '[95] - 文件下载', inputTable: '2101', outputTable: '2102' })
    expect(collectorCapabilityOf(cfg)?.kind).toBe('file_download')
    expect(buildConfigPayload(cfg, { configType: 95 }).configType).toBe(95)
    expect(flow.dirty).toBe(false)
  })

  it('配置详情回填 95 时同步类型身份，保留节点名称、源 URL 与进入条件', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
    cfg.title = '归档 A'
    cfg.collectCfg!.url = 'https://source.example.com'
    cfg.collectCfg!.entryCondition = { mode: 'expr', logic: 'AND', items: [], expr: 'K1!=nil' }
    applyConfigToNode(cfg, { configId: '1001', name: '下载配置', configType: '95', enabled: true, multiMode: 0 })

    expect(cfg.template).toBe('file')
    expect(collectorCapabilityOf(cfg)?.kind).toBe('file_download')
    expect(defaultPromptCategoryForNode(cfg)).toBe('文件下载')
    expect(cfg.title).toBe('归档 A')
    expect(cfg.collectCfg?.url).toBe('https://source.example.com')
    expect(cfg.collectCfg?.entryCondition?.expr).toBe('K1!=nil')
    expect(buildConfigPayload(cfg, { configType: 95 }).configType).toBe(95)
  })

  it('模板或后端已确认为文件下载时，旧展示串 90 不会覆盖类型', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
    cfg.template = 'file'
    expect(configTypeFrom(cfg)).toBe(95)
    delete cfg.template
    cfg.configType = '95'
    expect(configTypeFrom(cfg)).toBe(95)
  })

  it('缺少明确身份的旧 APP 95 兼容路径与现行 APP 140 保持原语义', () => {
    expect(inferCollectorKind({ ...NODE_CONFIGS['app-collect'].collectCfg!, snatchType: '[95] - APP 抓取' })).toBe('app')
    expect(inferCollectorKind(NODE_CONFIGS['app-collect'].collectCfg)).toBe('app')
  })
})
