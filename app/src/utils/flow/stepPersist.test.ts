import { describe, expect, it } from 'vitest'
import { stepFromLegacy, stepToStepModifyPayload } from '@/api/legacyAdapters'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'
import {
  assertStepsPersistable,
  condExprOf,
  hasRealBranches,
  ruleStepContext,
  isWritableStepId,
  lastStepIdsFromCanvas,
  mergeStepForWrite,
} from './stepPersist'
import type { Step } from '@/api'

const MEASURED_40600 = stepFromLegacy({
  authConfig: null, bizType: null, cond: null, configId: 1400917, context: null,
  entryTypeId: 6200026, extName: null, flowCode: 'WEB_SNATCH', isDelete: 1,
  itemConfig: 40600, itemId: 52000351, lastStep: '0', mainConfig: 1400917,
  name: '1400917-详情', nextStep: null, outContext: null, outEntry: 6200026,
  sid: null, sourceId: -1, type: 'entry', url: '$VAL$',
}, '430016398')

function cfgFromSnapshot() {
  const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
  cfg.title = '1400917-详情'
  cfg.disabled = true
  cfg.configId = '1400917'
  if (cfg.collectCfg) {
    cfg.collectCfg.inputTable = '6200026'
    cfg.collectCfg.outputTable = '6200026'
  }
  return cfg
}

describe('isWritableStepId', () => {
  it('只接受非 0 的纯数字 itemConfig', () => {
    expect(isWritableStepId('40600')).toBe(true)
    expect(isWritableStepId('0')).toBe(false)
    expect(isWritableStepId('source:430016398')).toBe(false)
    expect(isWritableStepId('web-detail-3')).toBe(false)
    expect(isWritableStepId('40600-copy-1')).toBe(false)
  })
})

describe('lastStepIdsFromCanvas', () => {
  it('跳过虚拟起点 0 和本地草稿 id，落到最近可落库步骤或 0', () => {
    expect(lastStepIdsFromCanvas(['start', '0', '40600', 'end'], '40600')).toEqual(['0'])
    expect(lastStepIdsFromCanvas(['start', '40597', 'web-detail-3', '40600', 'end'], '40600')).toEqual(['40597'])
    expect(lastStepIdsFromCanvas(['start', 'web-detail-1', 'end'], 'web-detail-1')).toEqual(['0'])
  })
})

describe('condExprOf', () => {
  it('表达式模式原样回写；清空后是 null', () => {
    const cfg = cfgFromSnapshot()
    cfg.collectCfg!.entryCondition = { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' }
    expect(condExprOf(cfg)).toBe('K6==nil')
    delete cfg.collectCfg!.entryCondition
    expect(condExprOf(cfg)).toBeNull()
  })
})

describe('mergeStepForWrite', () => {
  it('改名时保留 2026-08-26 实测源 430016398 / 40600 的 url、itemId、lastStep、sourceId', () => {
    const cfg = cfgFromSnapshot()
    cfg.title = '1400917-详情（联调）'
    const merged = mergeStepForWrite({
      snapshot: MEASURED_40600,
      cfg,
      nodeId: '40600',
      sourceId: '430016398',
    })
    expect(stepToStepModifyPayload(merged)).toMatchObject({
      itemConfig: 40600,
      name: '1400917-详情（联调）',
      url: '$VAL$',
      itemId: 52000351,
      lastStep: '0',
      sourceId: -1,
      mainConfig: 1400917,
      configId: 1400917,
      cond: null,
      isDelete: 1,
      enabled: false,
    })
  })

  it('自动保存可按画布重写 lastStep，不碰快照里的 url', () => {
    const cfg = cfgFromSnapshot()
    const merged = mergeStepForWrite({
      snapshot: MEASURED_40600,
      cfg,
      nodeId: '40600',
      sourceId: '430016398',
      lastStepIds: ['40597'],
    })
    expect(merged.dependsOn).toEqual(['40597'])
    expect(merged.url).toBe('$VAL$')
  })

  it('规则处理节点：画布上的规则 ID / 适用源写回步骤，不沿用快照里的旧值', () => {
    const snapshot = stepFromLegacy({
      itemConfig: 40604, sourceId: 430022404, name: '1400979-规则处理',
      configId: 1400586, entryTypeId: 900, outEntry: 2100249, itemId: -1,
      context: 'K1,K2', lastStep: '0', isDelete: 1, type: 'entry',
    }, '430022404')
    const cfg = cloneConfig(NODE_CONFIGS.rule)
    cfg.title = '1400979-规则处理'
    cfg.configId = '1400586'
    cfg.itemId = '173'
    cfg.stepSourceId = '-1'
    cfg.inputTable = '900'
    cfg.outputTable = '2100249'
    const merged = mergeStepForWrite({
      snapshot,
      cfg,
      nodeId: '40604',
      sourceId: '430022404',
    })
    expect(stepToStepModifyPayload(merged)).toMatchObject({
      itemConfig: 40604,
      itemId: 173,
      sourceId: -1,
      entryTypeId: 900,
      outEntry: 2100249,
      configId: 1400586,
    })
  })

  // 0901：规则节点「输出表」编辑框自己写着「默认 = 输入表」（RuleTableFieldBinder.vue），
  // 只填了输入表、没碰输出表时，提交给后端的 outEntry 得兑现这句承诺，不能是空/陈旧值。
  it('规则处理节点只填输入表、未落输出表：提交时输出表回退到输入表', () => {
    const snapshot = stepFromLegacy({
      itemConfig: 40604, sourceId: 430022404, name: '1400979-规则处理',
      configId: 1400586, entryTypeId: 900, outEntry: null, itemId: -1,
      context: 'K1,K2', lastStep: '0', isDelete: 1, type: 'entry',
    }, '430022404')
    const cfg = cloneConfig(NODE_CONFIGS.rule)
    cfg.title = '1400979-规则处理'
    cfg.configId = '1400586'
    cfg.itemId = '173'
    cfg.stepSourceId = '-1'
    cfg.inputTable = '6200026'
    cfg.outputTable = ''
    const merged = mergeStepForWrite({
      snapshot,
      cfg,
      nodeId: '40604',
      sourceId: '430022404',
    })
    expect(stepToStepModifyPayload(merged)).toMatchObject({
      entryTypeId: 6200026,
      outEntry: 6200026,
    })
  })
})

// 0903 YB-A 止血：源 920663 的真实拓扑是 40597 ├─▶ 40598 / └─▶ 40620（两支同一前置），
// 而画布把子步骤一律拍成直线。据画布重算 lastStep 会把 40620 从 40597 挪到 40598 后面——
// 分支被静默拍平且不可逆。这组用例锁住"检测得出真分支"这件事，写回侧据此冻结 lastStep。
describe('hasRealBranches（0903 YB-A）', () => {
  const step = (stepId: string, dependsOn?: string[]): Step =>
    ({ stepId, sourceId: '430016824', name: stepId, dependsOn, enabled: true }) as Step

  it('两个步骤指向同一个前置 = 真分支', () => {
    expect(hasRealBranches({
      '40597': step('40597', ['0']),
      '40598': step('40598', ['40597']),
      '40620': step('40620', ['40597']),
    })).toBe(true)
  })

  it('一条直链不是分支', () => {
    expect(hasRealBranches({
      '40597': step('40597', ['0']),
      '40598': step('40598', ['40597']),
      '40620': step('40620', ['40598']),
    })).toBe(false)
  })

  it("多个步骤同为起点（lastStep='0'）不算分支——虚拟起点不是真实前置", () => {
    expect(hasRealBranches({
      a: step('a', ['0']),
      b: step('b', ['0']),
    })).toBe(false)
  })

  it('没有 dependsOn / 空快照都不算分支', () => {
    expect(hasRealBranches({ a: step('a'), b: step('b') })).toBe(false)
    expect(hasRealBranches({})).toBe(false)
  })
})

// 2026-09-04 会上提出、后端已按此收：规则处理节点写步骤时有三处特殊口径。
describe('规则节点写步骤（0904）', () => {
  function ruleCfg(inputFields: string[], outputFields: string[], outputTableId?: string) {
    const cfg = cloneConfig(NODE_CONFIGS.rule)
    cfg.title = '规则处理'
    cfg.configId = '1400998'
    cfg.ruleCfg = { ...(cfg.ruleCfg ?? { mode: 'new', describe: '' }), inputTableId: '6200026', outputTableId, inputFields, outputFields }
    return cfg
  }
  const snapshot = { ...MEASURED_40600, sourceId: '430016398', nodeType: 'entry' }

  it('type 写 rule', () => {
    const step = mergeStepForWrite({
      snapshot, cfg: ruleCfg(['title'], ['title']), nodeId: '40600', sourceId: '430016398',
    })
    expect(step.nodeType).toBe('rule')
  })

  // monitor 复用 rule 种子（isRuleNode 同样为 true），但 nodeType 必须写 'monitor' 落库：
  // 否则刷新回读后只能靠标题正则兜底恢复 template，节点一改名 isMonitorNode 即失效，
  // 保存脚本时同步 ck_source（/api/source/*）会被静默跳过。
  it('monitor 节点 type 写 monitor（优先于 rule，改名后仍可恢复）', () => {
    const cfg = ruleCfg(['title'], ['title'])
    cfg.template = 'monitor'
    cfg.title = '库存监控' // 改名后不含「数据监控」，回读只能靠 nodeType
    const step = mergeStepForWrite({
      snapshot, cfg, nodeId: '40600', sourceId: '430016398',
    })
    expect(step.nodeType).toBe('monitor')
  })

  it('数据校验节点 type 写 data-validation（优先于 rule，改名后仍可恢复）', () => {
    const cfg = ruleCfg(['title'], ['title'])
    cfg.template = 'data-validation'
    cfg.title = '字段检查'
    const step = mergeStepForWrite({
      snapshot, cfg, nodeId: '40600', sourceId: '430016398',
    })
    expect(step.nodeType).toBe('data-validation')
  })

  // 适用源 -1 是**新建节点时的默认值**，不是写死。写死会把用户改过的值冲掉——
  // 所以写入侧一律以 cfg.stepSourceId 为准，默认值落在插入节点的地方（stores/flow.ts）。
  it('适用源以节点上的值为准，写入侧不强制 -1', () => {
    const withDefault = ruleCfg(['title'], ['title'])
    withDefault.stepSourceId = '-1'
    expect(mergeStepForWrite({ snapshot, cfg: withDefault, nodeId: '40600', sourceId: '430016398' }).sourceId).toBe('-1')

    const changed = ruleCfg(['title'], ['title'])
    changed.stepSourceId = '430016398'
    expect(mergeStepForWrite({ snapshot, cfg: changed, nodeId: '40600', sourceId: '430016398' }).sourceId).toBe('430016398')
  })

  it('表配置的入参/出参写进 context/outContext，且换成物理列名', () => {
    const step = mergeStepForWrite({
      snapshot,
      cfg: ruleCfg(['title', 'url'], ['tags']),
      nodeId: '40600',
      sourceId: '430016398',
      columnByItemCode: new Map([['title', 'K1'], ['url', 'K2'], ['tags', 'K3']]),
    })
    // 落库前的模型字段；stepToStepModifyPayload 会 join 成 "K1,K2"
    expect(step.contextMap).toEqual(['K1', 'K2'])
    expect(step.outColumns).toEqual(['K3'])
    expect(stepToStepModifyPayload(step).context).toBe('K1,K2')
    expect(stepToStepModifyPayload(step).outContext).toBe('K3')
  })

  // 入参查输入表、出参查**输出表**（useRuleTableFields 的口径：没配输出表才回退到输入表）。
  // 共用一张映射的话，输出表 ≠ 输入表时出参会全部换不到、悄悄退化成 itemCode。
  it('输出表与输入表不同时：出参按输出表的映射换列名', () => {
    const step = mergeStepForWrite({
      snapshot,
      cfg: ruleCfg(['title'], ['tags'], '6200099'),
      nodeId: '40600',
      sourceId: '430016398',
      columnByItemCode: new Map([['title', 'K1']]),
      // 输出表里 tags 是 K7，输入表里根本没有这个字段
      outColumnByItemCode: new Map([['tags', 'K7']]),
    })
    expect(step.contextMap).toEqual(['K1'])
    expect(step.outColumns).toEqual(['K7'])
  })

  it('没给输出表映射时退回输入表映射（= 没配输出表的常见情况）', () => {
    const step = mergeStepForWrite({
      snapshot,
      cfg: ruleCfg(['title'], ['title']),
      nodeId: '40600',
      sourceId: '430016398',
      columnByItemCode: new Map([['title', 'K1']]),
    })
    expect(step.outColumns).toEqual(['K1'])
  })

  // 换不到宁可写 itemCode：悄悄丢字段比写个认得出的值糟得多
  it('拿不到列名映射时原样写 itemCode，不丢字段', () => {
    const step = mergeStepForWrite({
      snapshot, cfg: ruleCfg(['title', 'url'], ['tags']), nodeId: '40600', sourceId: '430016398',
    })
    expect(step.contextMap).toEqual(['title', 'url'])
  })

  it('非规则节点不受影响：仍走任务配置，type 照旧', () => {
    const cfg = cfgFromSnapshot()
    const step = mergeStepForWrite({ snapshot, cfg, nodeId: '40600', sourceId: '430016398' })
    expect(step.nodeType).toBe('entry')
  })

  it('ruleStepContext：空数组/undefined 都返回 undefined（不写空串）', () => {
    expect(ruleStepContext(undefined, undefined)).toBeUndefined()
    expect(ruleStepContext([], new Map())).toBeUndefined()
  })
})

describe('assertStepsPersistable（0828 W9-4）', () => {
  it('虚拟起点和已落库步骤不因缺 configId 拦截', () => {
    expect(() => assertStepsPersistable(
      ['0', '40600'],
      { 0: { ...cfgFromSnapshot(), title: '源', configId: undefined }, 40600: cfgFromSnapshot() },
    )).not.toThrow()
  })

  it('本地新节点尚未绑定配置时拦截', () => {
    const draft = cloneConfig(NODE_CONFIGS['web-detail'])
    delete draft.configId
    draft.title = '新详情'
    expect(() => assertStepsPersistable(
      ['0', '40600', 'web-detail-3'],
      { 40600: cfgFromSnapshot(), 'web-detail-3': draft },
    )).toThrow(/尚未绑定配置/)
  })
})
