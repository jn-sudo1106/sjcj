import { describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNodeStore } from './node'
import { NODE_CONFIGS, cloneConfig, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

function makeConfigs(): Record<string, NodeConfig> {
  return {
    'web-list': cloneConfig(NODE_CONFIGS['web-list']),
    'web-detail': cloneConfig(NODE_CONFIGS['web-detail']),
  }
}

/** 每个用例都要自己 bindFlowStore，否则 configs 是空的 {}，所有写操作会静默 no-op（这是 store 设计本身，不是 bug）。 */
function setup(main: string[] = ['start', 'web-list', 'web-detail', 'end']) {
  setActivePinia(createPinia())
  const n = useNodeStore()
  const configs = makeConfigs()
  n.bindFlowStore(configs, () => main)
  return { n, configs }
}

describe('node store 初始状态 + dirty 标记', () => {
  it('初始 selectedId/activeTab/dirty 有默认值', () => {
    setActivePinia(createPinia())
    const n = useNodeStore()
    expect(n.selectedId).toBe('')
    expect(n.activeTab).toBe('config')
    expect(n.dirty).toBe(false)
  })

  it('touch() 置脏，markSaved() 清零', () => {
    setActivePinia(createPinia())
    const n = useNodeStore()
    n.touch()
    expect(n.dirty).toBe(true)
    n.markSaved()
    expect(n.dirty).toBe(false)
  })

  it('未 bindFlowStore 时写操作静默 no-op，不抛异常', () => {
    setActivePinia(createPinia())
    const n = useNodeStore()
    expect(() => n.setOutputTable('web-list', 'T2')).not.toThrow()
    expect(() => n.patchCollect('web-list', { url: 'x' })).not.toThrow()
  })
})

describe('三列表格：setTripleCell / addTripleRow / removeTripleRow', () => {
  it('setTripleCell 改 inmap 指定行指定列', () => {
    const { n, configs } = setup()
    n.setTripleCell('web-list', 'inmap', 0, 0, '改名后的字段')
    expect(configs['web-list'].inmap[0].name).toBe('改名后的字段')
    expect(n.dirty).toBe(true)
  })

  it('addTripleRow 给 inmap 新增一行空行', () => {
    const { n, configs } = setup()
    const before = configs['web-list'].inmap.length
    n.addTripleRow('web-list', 'inmap')
    expect(configs['web-list'].inmap.length).toBe(before + 1)
    expect(configs['web-list'].inmap[before]).toEqual({ name: '', from: '', desc: '' })
  })

  it('addTripleRow 给 params 新增一行空行（非 inmap 分支）', () => {
    const { n, configs } = setup()
    const before = configs['web-list'].params.length
    n.addTripleRow('web-list', 'params')
    expect(configs['web-list'].params.length).toBe(before + 1)
  })

  it('removeTripleRow 删除指定行（此前全项目零覆盖）', () => {
    const { n, configs } = setup()
    const before = configs['web-list'].inmap.length
    const firstName = configs['web-list'].inmap[0].name
    n.removeTripleRow('web-list', 'inmap', 0)
    expect(configs['web-list'].inmap.length).toBe(before - 1)
    expect(configs['web-list'].inmap[0]?.name).not.toBe(firstName)
  })

  it('removeTripleRow 对不存在的节点 id 安全 no-op', () => {
    const { n } = setup()
    expect(() => n.removeTripleRow('not-exist', 'inmap', 0)).not.toThrow()
  })
})

describe('setBaseRow / setFieldRow（此前全项目零覆盖）', () => {
  it('setBaseRow 改 base 表指定行的值列（第二列）', () => {
    const { n, configs } = setup()
    n.setBaseRow('web-list', 0, '新的值')
    expect(configs['web-list'].base[0][1]).toBe('新的值')
    expect(configs['web-list'].base[0][0]).toBe('源 URL') // 第一列（key）不受影响
  })

  it('setFieldRow 改 fields 表指定行的值列', () => {
    const { n, configs } = setup()
    n.setFieldRow('web-list', 0, '是')
    expect(configs['web-list'].fields[0][1]).toBe('是')
  })

  it('index 越界时安全 no-op，不抛异常', () => {
    const { n } = setup()
    expect(() => n.setBaseRow('web-list', 999, 'x')).not.toThrow()
    expect(() => n.setFieldRow('web-list', 999, 'x')).not.toThrow()
  })
})

describe('patchCollect', () => {
  it('设置 webKind 时同步 isDetail', () => {
    const { n, configs } = setup()
    n.patchCollect('web-detail', { webKind: 'detail' })
    expect(configs['web-detail'].collectCfg?.isDetail).toBe(true)
  })

  it('设置 isDetail=true 时反向同步 webKind', () => {
    const { n, configs } = setup()
    n.patchCollect('web-list', { isDetail: true })
    expect(configs['web-list'].collectCfg?.webKind).toBe('detail')
  })

  it('urlParamRefs 变化后过滤掉 taskCfg.paramValues 里不再被引用的参数', () => {
    const { n, configs } = setup()
    configs['web-list'].taskCfg = { queue: 'q', urlRule: '', paramValues: [{ paramId: 'p-date' }, { paramId: 'p-gone' }] }
    n.patchCollect('web-list', { urlParamRefs: ['p-date'] })
    expect(configs['web-list'].taskCfg?.paramValues?.map((v) => v.paramId)).toEqual(['p-date'])
  })

  it('对没有 collectCfg 的节点安全 no-op', () => {
    const { n, configs } = setup()
    delete configs['web-list'].collectCfg
    expect(() => n.patchCollect('web-list', { url: 'x' })).not.toThrow()
  })
})

describe('patchTaskConfig', () => {
  // 注：isFirstMainNode 判定是否首节点看「main 数组里排在前面、且在 configs 里有实体」的节点，
  // 不是看数组下标——默认 setup 的 configs 只有 web-list/web-detail 两个实体，'start' 没有对应
  // configs 项，所以 web-list（前面只有 'start'）会被判定为「首节点」，触发下面 patchTaskConfig
  // 里 isFirstMainNode 分支清空 paramValues/contextMap/outColumns。因此下面两个用例用 web-detail
  // （前面有 web-list 这个真实节点）来验证「非首节点」时的正常合并逻辑，首节点分支单独测。

  it('paramValues 只保留本节点 urlParamRefs 里的参数，且去重（非首节点）', () => {
    const { n, configs } = setup()
    configs['web-detail'].collectCfg!.urlParamRefs = ['p-a']
    n.patchTaskConfig('web-detail', { paramValues: [{ paramId: 'p-a' }, { paramId: 'p-a' }, { paramId: 'p-not-own' }] })
    expect(configs['web-detail'].taskCfg?.paramValues).toEqual([{ paramId: 'p-a', fieldId: '', valueExpr: '' }])
  })

  it('contextMap / outColumns 去重且过滤空值（非首节点）', () => {
    const { n, configs } = setup()
    n.patchTaskConfig('web-detail', { contextMap: ['a', 'a', '', 'b'] })
    expect(configs['web-detail'].taskCfg?.contextMap).toEqual(['a', 'b'])
  })

  it('主链首节点会被清掉 paramValues/contextMap/outColumns（首节点无上游可传参）', () => {
    const { n, configs } = setup() // web-list 前面只有无 configs 实体的 'start'，判定为首节点
    n.patchTaskConfig('web-list', { paramValues: [], contextMap: ['a'], outColumns: ['b'] })
    expect(configs['web-list'].taskCfg?.contextMap).toBeUndefined()
    expect(configs['web-list'].taskCfg?.outColumns).toBeUndefined()
  })
})

describe('setOutputTable / setInputTable / setTaskQueue / setNodeDisabled', () => {
  it('setOutputTable 直接写 cfg.outputTable', () => {
    const { n, configs } = setup()
    n.setOutputTable('web-list', 'T-new')
    expect(configs['web-list'].outputTable).toBe('T-new')
  })

  it('setInputTable 直接写 cfg.inputTable', () => {
    const { n, configs } = setup()
    n.setInputTable('web-list', 'T-in')
    expect(configs['web-list'].inputTable).toBe('T-in')
  })

  it('setTaskQueue 委托给 patchTaskConfig', () => {
    const { n, configs } = setup()
    n.setTaskQueue('web-list', 'new.queue')
    expect(configs['web-list'].taskCfg?.queue).toBe('new.queue')
  })

  it('setNodeDisabled 切换禁用状态', () => {
    const { n, configs } = setup()
    n.setNodeDisabled('web-list', true)
    expect(configs['web-list'].disabled).toBe(true)
  })
})

describe('setStructuredConfig / setContentRules（0804 S3-1）', () => {
  it('有 collectCfg 时写在 collectCfg 上，而不是 cfg 顶层', () => {
    const { n, configs } = setup()
    n.setStructuredConfig('web-list', '{"table":"T1"}')
    n.setContentRules('web-list', 'content=trim')
    expect(configs['web-list'].collectCfg?.structuredConfig).toBe('{"table":"T1"}')
    expect(configs['web-list'].collectCfg?.contentRules).toBe('content=trim')
    expect(configs['web-list'].structuredConfig).toBeUndefined()
    expect(configs['web-list'].contentRules).toBeUndefined()
  })

  it('没有 collectCfg（非采集节点）时写在 cfg 顶层', () => {
    const { n, configs } = setup()
    configs['rule-1'] = {
      title: '规则处理', sub: '', status: '', planned: false,
      base: [], fields: [], inmap: [], params: [], output: [],
    }
    n.setStructuredConfig('rule-1', '{"table":"T2"}')
    n.setContentRules('rule-1', 'summary=truncate(200)')
    expect(configs['rule-1'].structuredConfig).toBe('{"table":"T2"}')
    expect(configs['rule-1'].contentRules).toBe('summary=truncate(200)')
  })

  it('传空字符串时清空为 undefined（不留空字符串占位）', () => {
    const { n, configs } = setup()
    n.setStructuredConfig('web-list', '{"table":"T1"}')
    n.setStructuredConfig('web-list', '')
    expect(configs['web-list'].collectCfg?.structuredConfig).toBeUndefined()
  })
})

describe('setEntryCondition', () => {
  it('有 collectCfg 时条件写在 collectCfg 上，而不是 cfg 顶层', () => {
    const { n, configs } = setup()
    n.setEntryCondition('web-list', { logic: 'AND', items: [{ field: 'a', op: 'eq', value: '1' }] })
    expect(configs['web-list'].collectCfg?.entryCondition?.items[0].field).toBe('a')
    expect(configs['web-list'].entryCondition).toBeUndefined()
  })

  it('传 undefined 时删除条件', () => {
    const { n, configs } = setup()
    n.setEntryCondition('web-list', { logic: 'AND', items: [] })
    n.setEntryCondition('web-list', undefined)
    expect(configs['web-list'].collectCfg?.entryCondition).toBeUndefined()
  })
})

describe('patchRuleConfig', () => {
  it('首次 patch 时用默认规则编排兜底缺省字段', () => {
    const { n, configs } = setup()
    n.patchRuleConfig('web-list', { describe: '自定义描述' })
    expect(configs['web-list'].ruleCfg?.describe).toBe('自定义描述')
    expect(configs['web-list'].ruleCfg?.mode).toBe('new') // 来自默认值
  })

  it('第二次 patch 在已有 ruleCfg 基础上合并', () => {
    const { n, configs } = setup()
    n.patchRuleConfig('web-list', { describe: 'A' })
    n.patchRuleConfig('web-list', { enabled: false })
    expect(configs['web-list'].ruleCfg?.describe).toBe('A')
    expect(configs['web-list'].ruleCfg?.enabled).toBe(false)
  })
})

// 0804 S3-3：采集节点的抓取配置走独立的 execCfg，不写 ruleCfg——否则 isRuleNode() 会把它误判成规则节点
describe('patchExecConfig（0804 S3-3）', () => {
  it('首次 patch 时用默认抓取配置兜底缺省字段，format 恒为 xml', () => {
    const { n, configs } = setup()
    n.patchExecConfig('web-list', { describe: '抓取列表页' })
    expect(configs['web-list'].execCfg?.describe).toBe('抓取列表页')
    expect(configs['web-list'].execCfg?.format).toBe('xml')
    expect(configs['web-list'].ruleCfg).toBeUndefined() // 不污染 ruleCfg
  })

  it('第二次 patch 在已有 execCfg 基础上合并', () => {
    const { n, configs } = setup()
    n.patchExecConfig('web-list', { describe: 'A' })
    n.patchExecConfig('web-list', { scriptPath: '/x/1.xml' })
    expect(configs['web-list'].execCfg?.describe).toBe('A')
    expect(configs['web-list'].execCfg?.scriptPath).toBe('/x/1.xml')
  })
})
