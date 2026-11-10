import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { stepFromLegacy, stepToSaveItemConfigPayload, stepToStepModifyPayload } from '@/api/legacyAdapters'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'
import { useFlowStore } from '@/stores/flow'
import { buildConfigPayload } from './nodeConfigPayload'
import { mergeStepForWrite } from './stepPersist'
import type { Source } from '@/api'

const source = { sourceId: '430016398', name: 'test', url: 'https://example.test', configId: '11', mainTable: '900', flowId: '42' } as Source
const record = { itemConfig: 12, flowId: 42, configId: 13, sourceId: -1, name: '详情', type: 'entry', outEntry: 900, fillEntry: 2102154, fillContext: 'K2,K99', isDelete: 0 }

describe('回填字段保存契约', () => {
  it('加载真实步骤 → 编辑模型 → 保存后再回读保留表、物理列和未知列', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const step = stepFromLegacy(record, source.sourceId)
    flow.loadFromSource(source, [step])
    const cfg = flow.configs['12']
    expect(cfg.taskCfg).toMatchObject({ fillTable: '2102154', fillColumns: ['K2', 'K99'] })
    const payload = stepToStepModifyPayload(mergeStepForWrite({ cfg, snapshot: step, nodeId: '12', sourceId: source.sourceId }))
    expect(payload).toMatchObject({ fillEntry: 2102154, fillContext: 'K2,K99' })
    expect(stepFromLegacy(payload, source.sourceId)).toMatchObject({ fillTable: '2102154', fillColumns: ['K2', 'K99'] })
  })

  it.each(['web-detail', 'rule', 'file-download'])('%s 新节点随步骤保存，不写入共享配置', (key) => {
    const cfg = cloneConfig(NODE_CONFIGS[key])
    cfg.taskCfg = { queue: '', urlRule: '', fillTable: '2102154', fillColumns: ['K2'] }
    const step = mergeStepForWrite({ cfg, nodeId: 'new-step', sourceId: source.sourceId })
    expect(stepToSaveItemConfigPayload(step)).toMatchObject({ fillEntry: 2102154, fillContext: 'K2' })
    const config = buildConfigPayload(cfg)
    expect(config).not.toHaveProperty('fillEntry')
    expect(config).not.toHaveProperty('fillContext')
  })

  it('未编辑时沿用快照；明确清空时发送空串，不被旧快照覆盖', () => {
    const snapshot = stepFromLegacy(record, source.sourceId)
    const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
    const write = () => stepToStepModifyPayload(mergeStepForWrite({ cfg, snapshot, nodeId: '12', sourceId: source.sourceId }))
    expect(write()).toMatchObject({ fillEntry: 2102154, fillContext: 'K2,K99' })
    cfg.taskCfg!.fillColumns = []
    expect(write()).toMatchObject({ fillEntry: 2102154, fillContext: '' })
    const saved = stepFromLegacy({ ...record, fillContext: '' }, source.sourceId)
    expect(saved.fillColumns).toEqual([])
  })

  it('明确取消回填优先于快照，回读空值不会误触发清空请求', () => {
    const snapshot = stepFromLegacy(record, source.sourceId)
    const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
    cfg.taskCfg = { queue: '', urlRule: '', fillTable: null, fillColumns: [] }
    const payload = stepToStepModifyPayload(mergeStepForWrite({ cfg, snapshot, nodeId: '12', sourceId: source.sourceId }))
    expect(payload.clearFill).toBe(true)
    expect(payload).not.toHaveProperty('fillEntry')
    expect(payload).not.toHaveProperty('fillContext')
    const read = stepToStepModifyPayload(stepFromLegacy({ ...record, fillEntry: null, fillContext: null }, source.sourceId))
    expect(read).not.toHaveProperty('clearFill')
  })

  it('旧节点没有新增字段时不添加回填配置', () => {
    const step = stepFromLegacy({ itemConfig: 12, name: '旧步骤' }, source.sourceId)
    const payload = stepToStepModifyPayload(step)
    expect(payload).not.toHaveProperty('fillEntry')
    expect(payload).not.toHaveProperty('fillContext')
  })

  it('回填编辑触发步骤自动保存所依赖的 flowRev', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['12'] = cloneConfig(NODE_CONFIGS['web-detail'])
    const rev = flow.flowRev
    flow.patchTaskConfig('12', { fillTable: '2102154', fillColumns: ['K2'] })
    expect(flow.flowRev).toBeGreaterThan(rev)
  })
})
