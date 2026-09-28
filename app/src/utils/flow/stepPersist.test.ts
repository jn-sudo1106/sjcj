import { describe, expect, it } from 'vitest'
import { stepFromLegacy, stepToStepModifyPayload } from '@/api/legacyAdapters'
import { cloneConfig, NODE_CONFIGS, type FlowBranchGroup, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import {
  applyStepSourceDefault,
  assertStepsPersistable,
  condExprOf,
  hasRealBranches,
  isFileLikeNode,
  outputTableMissing,
  firstOutputTableMissingNodeId,
  relinkCandidates,
  ruleStepContext,
  isWritableStepId,
  lastStepIdsFromCanvas,
  mergeStepForWrite,
  persistableNodeIds,
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

// 0927 H1：非文件节点输出表必填（后端 OUT_ENTRY 强制）的判定纯函数。
// 缺输出表 = 显式输出表 / 「默认=输入表」兜底 / 快照自带输出表 三者皆空；file 类节点豁免。
describe('outputTableMissing / isFileLikeNode（0927 H1）', () => {
  function cfgWith(patch: Partial<NodeConfig> = {}): NodeConfig {
    // 用规则节点种子：无 collectCfg 输出表默认值（web-detail 种子自带 outputTable 默认表，
    // 属「已选输出表」语义，不适合当缺表样本）
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    return { ...cfg, ...patch }
  }

  it('输出表/输入表/快照全空：缺输出表；快照有输出表则不算缺（存量步骤转换期）', () => {
    expect(outputTableMissing(cfgWith(), undefined)).toBe(true)
    expect(outputTableMissing(cfgWith({ outputTable: '6200027' }), undefined)).toBe(false)
    expect(outputTableMissing(cfgWith(), { outputTable: '6200026' } as Step)).toBe(false)
  })

  it('输入表兜底：没选输出表但输入表有值 = "默认 = 输入表"，不算缺', () => {
    expect(outputTableMissing(cfgWith({ inputTable: '6200026' }), undefined)).toBe(false)
  })

  it('file 节点豁免；快照里 nodeType=file 的历史节点也豁免', () => {
    const cfg = cfgWith({ template: 'file' })
    expect(isFileLikeNode(cfg, undefined)).toBe(true)
    expect(outputTableMissing(cfg, undefined)).toBe(false)
    const historical = cfgWith()
    expect(isFileLikeNode(historical, { nodeType: 'file' } as Step)).toBe(true)
    expect(outputTableMissing(historical, { nodeType: 'file' } as Step)).toBe(false)
  })
})

describe('firstOutputTableMissingNodeId（0927 H1）', () => {
  const snap: Step = { stepId: '40597', sourceId: '-1', name: 'a', configId: '1400917', enabled: false }

  it('没有缺输出表的节点：返回 undefined（start/end/根/草稿局部 id 天然不计）', () => {
    const main = ['start', '40597', 'end']
    const configs = {
      '40597': { title: 'a', kind: 'node', configId: '1400917', outputTable: '6200026' },
    } as unknown as Record<string, NodeConfig>
    expect(firstOutputTableMissingNodeId(main, [], configs)).toBeUndefined()
  })

  it('画布上第一个缺输出表的可写节点（规则节点无输入表兜底）', () => {
    const main = ['start', '40597', 'rule-1', '40598', 'end']
    const configs = {
      '40597': { title: 'a', kind: 'node', configId: '1400917', outputTable: '6200026' },
      'rule-1': { title: 'r', kind: 'node', configId: '1400999' },
      '40598': { title: 'b', kind: 'node', configId: '1400918' },
    } as unknown as Record<string, NodeConfig>
    expect(firstOutputTableMissingNodeId(main, [], configs)).toBe('rule-1')
  })

  it('rule-1 的 40597 与快照同名（存量行缺输出表但输入表为空）也计入', () => {
    const main = ['start', '40598', 'end']
    const configs = { '40598': { title: 'b', kind: 'node', configId: '1400918' } } as unknown as Record<string, NodeConfig>
    expect(firstOutputTableMissingNodeId(main, [], configs, { '40598': snap })).toBe('40598')
  })
})

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

describe('lastStepIdsFromCanvas · 嵌套分支组（0925 REVIEW 加固）', () => {
  // 1 → 2 分叉出 3 / 4；3 又分叉出 5→6 与 7（嵌套 subGroups，见 REVIEW 0925 §2.4）
  const NESTED: FlowBranchGroup[] = [{
    ownerId: '2',
    branches: [
      {
        id: '2-b1', label: '路径A', chain: ['3'],
        subGroups: [{
          ownerId: '3',
          branches: [
            { id: '3-b1', label: 'X', chain: ['5', '6'] },
            { id: '3-b2', label: 'Y', chain: ['7'] },
          ],
        }],
      },
      { id: '2-b2', label: '路径B', chain: ['4'] },
    ],
  }]

  it('嵌套链上的节点按真实前驱回写，不回 0（修复前一律回 0 = 断链）', () => {
    const main = ['start', '1', '2', '8', 'end']
    expect(lastStepIdsFromCanvas(main, '6', NESTED)).toEqual(['5'])
    expect(lastStepIdsFromCanvas(main, '5', NESTED)).toEqual(['3'])
    expect(lastStepIdsFromCanvas(main, '7', NESTED)).toEqual(['3'])
    expect(lastStepIdsFromCanvas(main, '3', NESTED)).toEqual(['2'])
    expect(lastStepIdsFromCanvas(main, '4', NESTED)).toEqual(['2'])
    // 主链回归：逐级向上、越过分叉点回到最近可落库步骤
    expect(lastStepIdsFromCanvas(main, '8', NESTED)).toEqual(['2'])
    expect(lastStepIdsFromCanvas(main, '1', NESTED)).toEqual(['0'])
  })

  it('persistableNodeIds 递归含嵌套链（主链在上、链节点文档序）', () => {
    expect(persistableNodeIds(['start', '1', 'end'], NESTED)).toEqual(['start', '1', 'end', '3', '5', '6', '7', '4'])
  })

  it('0927 P0-2 回归：嵌套链头 + 草稿 owner（不可落库）沿父链上溯，祖先组不再被 seen 跳过', () => {
    // 复现旧 bug 的形态：嵌套组 owner 是本地草稿 id（复制嵌套节点产出的 x-nested-N 形态），
    // 链头 X1 的最近可落库前驱在**顶层分支组**的 chain 里。旧 findChain 在扫描阶段把
    // '2' / 'draft-8' 塞进共享 seen，上溯时顶层组被 continue 跳过 → 静默回 ['0']（挂根）。
    const main = ['start', '1', '2', 'end']
    const DRAFT_NESTED: FlowBranchGroup[] = [{
      ownerId: '2',
      branches: [{
        id: '2-b1', label: '路径A', chain: ['draft-8'],
        subGroups: [{ ownerId: 'draft-8', branches: [{ id: 'g2-b1', label: 'X', chain: ['X1'] }] }],
      }],
    }]
    // 一层上溯：X1（嵌套链头）→ draft-8（不可落库）→ 顶层组 chain 里的 '2'（可落库）
    expect(lastStepIdsFromCanvas(main, 'X1', DRAFT_NESTED)).toEqual(['2'])
  })

  it('assertStepsPersistable 对嵌套链不误报断链', () => {
    const c = cfgFromSnapshot()
    const configs: Record<string, NodeConfig> = { '1': c, '2': c, '3': c, '4': c, '5': c, '6': c, '7': c }
    expect(() => assertStepsPersistable(['start', '1', '2', '8', 'end'], configs, NESTED)).not.toThrow()
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
  // 所以写入侧一律以 cfg.stepSourceId 为准，默认值由 applyStepSourceDefault 在新建路径上打。
  it('适用源以节点上的值为准，写入侧不强制 -1', () => {
    const withDefault = ruleCfg(['title'], ['title'])
    withDefault.stepSourceId = '-1'
    expect(mergeStepForWrite({ snapshot, cfg: withDefault, nodeId: '40600', sourceId: '430016398' }).sourceId).toBe('-1')

    const changed = ruleCfg(['title'], ['title'])
    changed.stepSourceId = '430016398'
    expect(mergeStepForWrite({ snapshot, cfg: changed, nodeId: '40600', sourceId: '430016398' }).sourceId).toBe('430016398')
  })

  // 2026-09-24：所有类型新建节点都默认 -1，不再只有规则处理 / 数据监控。
  describe('applyStepSourceDefault', () => {
    it('未设置或空串时补 -1', () => {
      const unset = cloneConfig(NODE_CONFIGS['web-list'])
      applyStepSourceDefault(unset)
      expect(unset.stepSourceId).toBe('-1')

      const blank = cloneConfig(NODE_CONFIGS.ocr)
      blank.stepSourceId = ''
      applyStepSourceDefault(blank)
      expect(blank.stepSourceId).toBe('-1')
    })

    it('已有值不动（回读步骤带的是库里的 sourceId）', () => {
      const cfg = cloneConfig(NODE_CONFIGS['web-list'])
      cfg.stepSourceId = '430016398'
      applyStepSourceDefault(cfg)
      expect(cfg.stepSourceId).toBe('430016398')
    })
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

// 2026-09-18：翻译助手的表配置入参/出参与规则节点同一套落库口径（context/outContext 物理列名），
// type 也写 'rule'——发后续（source/nextStep）按步骤 type 派发执行器，写 entry 会 500
//（实测打标签步骤 type 改成 rule 后 ok_41696 恢复正常）；回读侧靠 configType 路由区分，不会串成规则节点。
describe('翻译助手写步骤（2026-09-18）', () => {
  function translateCfg(inputFields: string[], outputFields: string[], outputTableId?: string) {
    const cfg = cloneConfig(NODE_CONFIGS.translate)
    cfg.title = '翻译助手'
    cfg.configId = '1400999'
    cfg.execCfg = {
      mode: 'new', format: 'xml', describe: '', script: '', scriptPath: '', enabled: true,
      inputTableId: '6200026', outputTableId, inputFields, outputFields,
    }
    return cfg
  }
  const snapshot = { ...MEASURED_40600, sourceId: '430016398', nodeType: 'entry' }

  it('入参/出参从 execCfg 写进 context/outContext（物理列名），type 写 rule（发后续按 type 派发）', () => {
    const step = mergeStepForWrite({
      snapshot,
      cfg: translateCfg(['title', 'url'], ['translated_text']),
      nodeId: '40600',
      sourceId: '430016398',
      columnByItemCode: new Map([['title', 'K1'], ['url', 'K2'], ['translated_text', 'K9']]),
    })
    expect(step.nodeType).toBe('rule')
    expect(step.contextMap).toEqual(['K1', 'K2'])
    expect(step.outColumns).toEqual(['K9'])
    expect(stepToStepModifyPayload(step).context).toBe('K1,K2')
    expect(stepToStepModifyPayload(step).outContext).toBe('K9')
  })

  it('没绑表字段（无 execCfg）时退回快照原值，不写空；type 仍写 rule', () => {
    const cfg = cloneConfig(NODE_CONFIGS.translate)
    cfg.title = '翻译助手'
    const step = mergeStepForWrite({ snapshot, cfg, nodeId: '40600', sourceId: '430016398' })
    expect(step.nodeType).toBe('rule')
    expect(step.contextMap).toBe(snapshot.contextMap)
    expect(step.outColumns).toBe(snapshot.outColumns)
  })
})

// 2026-09-18：文章打标签与翻译助手同待遇——execCfg 的入参/出参与规则节点同一套落库口径
//（context/outContext 物理列名），type 写 'rule'（发后续按 type 派发执行器）。
describe('文章打标签写步骤（2026-09-18）', () => {
  function tagCfg(inputFields: string[], outputFields: string[]) {
    const cfg = cloneConfig(NODE_CONFIGS['article-tag'])
    cfg.title = '文章打标签'
    cfg.configId = '1400998'
    cfg.execCfg = {
      mode: 'new', format: 'xml', describe: '', script: '', scriptPath: '', enabled: true,
      inputTableId: '6200026', inputFields, outputFields,
    }
    return cfg
  }
  const snapshot = { ...MEASURED_40600, sourceId: '430016398', nodeType: 'entry' }

  it('入参/出参从 execCfg 写进 context/outContext（物理列名），type 写 rule', () => {
    const step = mergeStepForWrite({
      snapshot,
      cfg: tagCfg(['title'], ['labels']),
      nodeId: '40600',
      sourceId: '430016398',
      columnByItemCode: new Map([['title', 'K1'], ['labels', 'K9']]),
    })
    expect(step.nodeType).toBe('rule')
    expect(step.contextMap).toEqual(['K1'])
    expect(step.outColumns).toEqual(['K9'])
    expect(stepToStepModifyPayload(step).context).toBe('K1')
    expect(stepToStepModifyPayload(step).outContext).toBe('K9')
  })
})

// 2026-09-18：文章生成摘要 / 音频提取文字 / 视频提取音频与翻译助手同待遇——
// type 写 'rule'（发后续按 type 派发执行器），入参/出参随步骤 context/outContext 落库。
// 2026-09-22：OCR 抓取同待遇（并入 isRuleLikeNode）。
describe('摘要/音视频/OCR 处理节点写步骤（2026-09-18、09-22）', () => {
  const snapshot = { ...MEASURED_40600, sourceId: '430016398', nodeType: 'entry' }

  it.each([
    ['article-summary', '文章生成摘要'],
    ['audio-text', '音频提取文字'],
    ['video-audio', '视频提取音频'],
    ['ocr', 'OCR抓取'],
  ])('%s：execCfg 的入参/出参写进 context/outContext，type 写 rule', (seedKey, title) => {
    const cfg = cloneConfig(NODE_CONFIGS[seedKey])
    cfg.title = title
    cfg.configId = '1400998'
    cfg.execCfg = {
      mode: 'new', format: 'xml', describe: '', script: '', scriptPath: '', enabled: true,
      inputTableId: '6200026', inputFields: ['title'], outputFields: ['summary'],
    }
    const step = mergeStepForWrite({
      snapshot,
      cfg,
      nodeId: '40600',
      sourceId: '430016398',
      columnByItemCode: new Map([['title', 'K1'], ['summary', 'K9']]),
    })
    expect(step.nodeType).toBe('rule')
    expect(step.contextMap).toEqual(['K1'])
    expect(step.outColumns).toEqual(['K9'])
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

// 0926 修正（用户反馈「孤儿节点没法选择上一个节点，下拉是空的」）：候选必须包含流程入口。
describe('relinkCandidates（0925 孤儿关联 · 0926 准入入口）', () => {
  const step = (stepId: string, dependsOn?: string[], extra: Partial<Step> = {}): Step =>
    ({ stepId, sourceId: '430016398', name: stepId, dependsOn, enabled: true, ...extra }) as Step

  it('流程只有「入口行 + 孤儿」：入口行（isRoot=1）也可选，下拉不再为空', () => {
    // flowId 模式 svg=true：main 里第一个真实行就是流程入口（带 isRoot，名字 = 配置名）
    const main = ['start', '41000', '40600', 'end']
    const configs: Record<string, NodeConfig> = {
      '41000': { ...cfgFromSnapshot(), title: '上市公司-配置' },
      '40600': { ...cfgFromSnapshot(), title: '孤儿步骤' },
    }
    const snapshots = {
      '41000': step('41000', undefined, { isRoot: true }),
      '40600': step('40600', ['999']),
    }
    expect(relinkCandidates(main, [], configs, snapshots, '40600')).toEqual([
      { id: '41000', title: '流程入口 · 上市公司-配置', isEntry: true },
    ])
  })

  it('源模式「0 行 + 孤儿」：虚拟入口行（#0）也可选，标「流程入口」', () => {
    const main = ['start', '0', '40600', 'end']
    const configs: Record<string, NodeConfig> = {
      '0': { ...cfgFromSnapshot(), title: '上市公司-配置' },
      '40600': { ...cfgFromSnapshot(), title: '孤儿步骤' },
    }
    expect(relinkCandidates(main, [], configs, {}, '40600')).toEqual([
      { id: '0', title: '流程入口 · 上市公司-配置', isEntry: true },
    ])
  })

  it('入口之外的候选按可写、不重叠、排除孤儿子树过滤；入口恒排第一', () => {
    const main = ['start', '0', '40597', '40600', '40598', 'end']
    // 40600 的子孙：40601/40602（沿快照 dependsOn 闭包）——不能挂回去（成环）
    const configs: Record<string, NodeConfig> = {
      '0': { ...cfgFromSnapshot(), title: '上市公司-配置' },
      '40597': { ...cfgFromSnapshot(), title: '列表页' },
      '40600': { ...cfgFromSnapshot(), title: '孤儿步骤' },
      '40598': { ...cfgFromSnapshot(), title: '详情页' },
      '40601': { ...cfgFromSnapshot(), title: '子步骤' },
      '40602': { ...cfgFromSnapshot(), title: '孙步骤' },
    }
    const snapshots = {
      '40597': step('40597', ['0']),
      '40600': step('40600', ['999']),
      '40598': step('40598', ['40597']),
      '40601': step('40601', ['40600']),
      '40602': step('40602', ['40601']),
    }
    const ids = relinkCandidates(main, [], configs, snapshots, '40600').map((t) => t.id)
    expect(ids).toEqual(['0', '40597', '40598'])
  })

  // 0926 REVIEW F2：源视图画布入口是合成根（source: 前缀），作为入口入候选；
  // start/end 仍排除（真实源视图 = start + 合成根 + 步骤 + end）。
  it('源视图合成根（source: 前缀）作为入口入候选；start/end 仍排除', () => {
    const main = ['start', 'source:430016398', '40600', 'end']
    const configs: Record<string, NodeConfig> = {
      'source:430016398': { ...cfgFromSnapshot(), title: '合成起点' },
      '40600': { ...cfgFromSnapshot(), title: '孤儿步骤' },
    }
    expect(relinkCandidates(main, [], configs, {}, '40600')).toEqual([
      { id: 'source:430016398', title: '流程入口 · 合成起点', isEntry: true },
    ])
  })

  it('候选只看画布（configs），不要求步骤快照——快照是写入时才需要的', () => {
    const main = ['start', '40597', '40600', 'end']
    const configs: Record<string, NodeConfig> = {
      '40597': { ...cfgFromSnapshot(), title: '列表页' },
      '40600': { ...cfgFromSnapshot(), title: '孤儿步骤' },
    }
    // snapshots = {}：流程序列里其它步骤的快照也没了，但目标仍可列出
    expect(relinkCandidates(main, [], configs, {}, '40600')).toEqual([
      { id: '40597', title: '列表页', isEntry: false },
    ])
  })

  it('「0」同时出现在 persistable（源模式在 main 里）时不去重出两个入口', () => {
    const main = ['start', '0', '40600', 'end']
    const configs: Record<string, NodeConfig> = {
      '0': { ...cfgFromSnapshot(), title: '上市公司-配置' },
      '40600': { ...cfgFromSnapshot(), title: '孤儿步骤' },
    }
    const ids = relinkCandidates(main, [], configs, {}, '40600').map((t) => t.id)
    expect(ids).toEqual(['0'])
  })
})
