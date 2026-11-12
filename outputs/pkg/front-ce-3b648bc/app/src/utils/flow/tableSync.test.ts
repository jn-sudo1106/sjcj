// 节点表联动（0928）：输入表默认取上游输出表；插入 / 删除 / 改表时跟随的下游一起改，用户自己指定的不动。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFlowStore } from '@/stores/flow'
import { cloneConfig, NODE_CONFIGS, nodeInputTable, nodeOutputTable, type FlowDef, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { inputTableMismatch } from './tableSync'

function collect(input: string, output: string): NodeConfig {
  const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
  cfg.collectCfg!.inputTable = input
  cfg.collectCfg!.outputTable = output
  return cfg
}
function rule(input: string, output: string): NodeConfig {
  const cfg = cloneConfig(NODE_CONFIGS.rule)
  cfg.inputTable = input
  cfg.outputTable = output
  cfg.ruleCfg = { ...cfg.ruleCfg!, inputTableId: input, outputTableId: output }
  return cfg
}

function load(configs: Record<string, NodeConfig>, main: string[], branchGroups: FlowDef['branchGroups'] = []) {
  const flow = useFlowStore()
  flow.load({ id: 'f', name: 'f', version: 'v', main, branches: [], configs, updatedAt: '', branchGroups })
  return flow
}

const tables = (flow: ReturnType<typeof useFlowStore>, id: string) => {
  const cfg = flow.configs[id]
  return { in: nodeInputTable(cfg), out: nodeOutputTable(cfg), ruleIn: cfg.ruleCfg?.inputTableId, ruleOut: cfg.ruleCfg?.outputTableId }
}

describe('节点表联动（0928）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // A(采集, 出 T1) → B(规则, T1→T1) → C(规则, T1→T1) → D(采集, T1→T2)
  function chain() {
    return load({
      A: collect('', 'T1'),
      B: rule('T1', 'T1'),
      C: rule('T1', 'T1'),
      D: collect('T1', 'T2'),
    }, ['start', 'A', 'B', 'C', 'D', 'end'])
  }

  it('新增采集节点：输入表显式取上游输出表（原来为空，保存时 entryTypeId=null）', () => {
    const flow = chain()
    const id = flow.insertAfter('A', 'web')!
    expect(flow.main.indexOf(id)).toBe(2)
    expect(tables(flow, id).in).toBe('T1')
  })

  it('A→B 之间插入 X，X 选了输出表后跟随的下游沿链改写，采集节点输出表不跟', () => {
    const flow = chain()
    const x = flow.insertAfter('A', 'web')!
    flow.patchCollect(x, { outputTable: 'T9' })
    expect(tables(flow, 'B')).toEqual({ in: 'T9', out: 'T9', ruleIn: 'T9', ruleOut: 'T9' })
    expect(tables(flow, 'C')).toMatchObject({ in: 'T9', out: 'T9' })
    expect(tables(flow, 'D')).toMatchObject({ in: 'T9', out: 'T2' })
    expect(flow.flowDirty).toBe(true)
  })

  it('删除 A→X→B 的 X：跟随 X 的下游改挂到 X 的上游表', () => {
    const flow = chain()
    const x = flow.insertAfter('A', 'web')!
    flow.patchCollect(x, { outputTable: 'T9' })
    flow.remove(x)
    expect(tables(flow, 'B')).toMatchObject({ in: 'T1', out: 'T1' })
    expect(tables(flow, 'C')).toMatchObject({ in: 'T1', out: 'T1' })
    expect(tables(flow, 'D')).toMatchObject({ in: 'T1', out: 'T2' })
  })

  it('用户自己指定了不同输入表的节点不被覆盖，传播到此为止', () => {
    const flow = load({
      A: collect('', 'T1'),
      B: rule('T1', 'T1'),
      C: rule('TX', 'TX'),
      D: collect('TX', 'T2'),
    }, ['start', 'A', 'B', 'C', 'D', 'end'])
    flow.patchCollect('A', { outputTable: 'T5' })
    expect(tables(flow, 'B')).toMatchObject({ in: 'T5', out: 'T5' })
    expect(tables(flow, 'C')).toMatchObject({ in: 'TX', out: 'TX' })
    expect(tables(flow, 'D').in).toBe('TX')
  })

  it('非采集节点输出表单独指定过的：输入表跟上游，输出表保留，下游不再往下传', () => {
    const flow = load({
      A: collect('', 'T1'),
      B: rule('T1', 'TB'),
      C: rule('TB', 'TB'),
    }, ['start', 'A', 'B', 'C', 'end'])
    flow.patchCollect('A', { outputTable: 'T5' })
    expect(tables(flow, 'B')).toMatchObject({ in: 'T5', out: 'TB' })
    expect(tables(flow, 'C')).toMatchObject({ in: 'TB', out: 'TB' })
  })

  it('改规则节点输入表：原本跟着输入表的输出表一起改，并传给下游', () => {
    const flow = chain()
    flow.setInputTable('B', 'T7')
    expect(tables(flow, 'B')).toMatchObject({ in: 'T7', out: 'T7', ruleOut: 'T7' })
    expect(tables(flow, 'C')).toMatchObject({ in: 'T7', out: 'T7' })
    expect(tables(flow, 'D').in).toBe('T7')
  })

  it('分叉：owner 改输出表，各分支链头都跟随', () => {
    const flow = load({
      A: collect('', 'T1'),
      B: rule('T1', 'T1'),
      C: collect('T1', 'T3'),
    }, ['start', 'A', 'end'], [{
      ownerId: 'A',
      branches: [
        { id: 'A-b1', label: 'B', chain: ['B'] },
        { id: 'A-b2', label: 'C', chain: ['C'] },
      ],
    }])
    flow.patchCollect('A', { outputTable: 'T8' })
    expect(tables(flow, 'B')).toMatchObject({ in: 'T8', out: 'T8' })
    expect(tables(flow, 'C')).toMatchObject({ in: 'T8', out: 'T3' })
  })

  it('输入表与上游不一致时给出提示数据；一致或无上游时为 null', () => {
    const flow = load({
      A: collect('', 'T1'),
      B: rule('T1', 'T1'),
      C: rule('TX', 'TX'),
    }, ['start', 'A', 'B', 'C', 'end'])
    const topo = { main: flow.main, branches: flow.branches, configs: flow.configs, branchGroups: flow.branchGroups }
    expect(inputTableMismatch(topo, 'A')).toBeNull()
    expect(inputTableMismatch(topo, 'B')).toBeNull()
    expect(inputTableMismatch(topo, 'C')).toEqual({ own: 'TX', upstream: 'T1' })
  })

  // 2026-09-29 实测（流程 1400994）：首节点换回一份没登记输出表的配置，空值沿链传下去把下游
  // 画布上的表清空了。换配置时「新配置没登记表」不等于「用户要清空」，不联动。
  it('换配置：新配置有输出表时照常联动', () => {
    const flow = chain()
    flow.bindExistingConfig('A', { configId: '9002', name: '有表的配置', entryTypeId: 'T6' } as never)
    expect(tables(flow, 'B')).toMatchObject({ in: 'T6', out: 'T6' })
    expect(tables(flow, 'D').in).toBe('T6')
  })

  it('换配置：新配置没登记输出表时不清空下游；之后再换成有表的配置，下游保留自己的表（跟随关系已断）', () => {
    const flow = chain()
    flow.bindExistingConfig('A', { configId: '9001', name: '没登记表的配置', entryTypeId: '' } as never)
    expect(tables(flow, 'A').out).toBe('')
    expect(tables(flow, 'B')).toMatchObject({ in: 'T1', out: 'T1' })
    expect(tables(flow, 'D').in).toBe('T1')

    // 下游 T1 ≠ 上游变动前的空值 → 按「用户自己指定」保留，不被改写（保守：宁可不跟，不乱改）
    flow.bindExistingConfig('A', { configId: '9002', name: '有表的配置', entryTypeId: 'T6' } as never)
    expect(tables(flow, 'B')).toMatchObject({ in: 'T1', out: 'T1' })
  })

  it('用户在表配置里主动清空输出表：照旧往下传（断链校验才报得出「缺少输入表」）', () => {
    const flow = chain()
    flow.patchCollect('A', { outputTable: '' })
    expect(tables(flow, 'B')).toMatchObject({ in: '', out: '' })
  })
})
