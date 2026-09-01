// 步骤写入：把画布节点和加载时留下的 Step 快照合回一条可提交的 Step。
//
// 写接口（item/next/stepModify、saveItemConfig）要整包字段，缺 url / itemId / lastStep
// 会被后端写成 null。画布只编辑名称、进入条件、配置/表，其余必须从快照带回。
// 可落库的节点 id 是 nextConfigPaged 的 itemConfig（纯数字且不是虚拟起点 0）。

import type { Step } from '@/api'
import {
  effectiveOutputTable,
  nodeEntryCondition,
  nodeInputTable,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import { conditionsToExpr } from '@/utils/flow/conditionExpr'

/** 真实步骤 id：纯数字且不是 svg=true 时后端塞进来的虚拟起点 itemConfig=0。 */
export function isWritableStepId(id: string | undefined): boolean {
  return !!id && /^\d+$/.test(id) && id !== '0'
}

/** 画布进入条件 → Step.cond。表达式模式用原文；字段模式按物理列名生成 Lua 风格语法。 */
export function condExprOf(cfg: NodeConfig): string | null {
  const group = nodeEntryCondition(cfg)
  if (!group) return null
  const expr = group.expr?.trim()
  if (expr) return expr
  if (!group.items?.length) return null
  const serialized = conditionsToExpr(group.items, group.logic ?? 'AND').trim()
  return serialized || null
}

/**
 * 自动保存前校验（0828 W9-4）：缺配置的新节点、lastStep 断链、成环都不提交。
 * 虚拟起点 `0` 和 start/end 占位不参与写入，也不按缺 configId 拦截。
 */
export function assertStepsPersistable(main: string[], configs: Record<string, NodeConfig>): void {
  for (const id of main) {
    if (id === 'start' || id === 'end' || id === '0' || isWritableStepId(id)) continue
    const cfg = configs[id]
    if (!cfg) continue
    if (!cfg.title?.trim()) throw new Error('节点名称不能为空')
    if (!cfg.configId) throw new Error(`节点「${cfg.title || id}」尚未绑定配置，无法保存步骤`)
  }
  const writable = main.filter((id) => isWritableStepId(id))
  for (const id of writable) {
    const pred = lastStepIdsFromCanvas(main, id)[0]
    if (pred === id) throw new Error('流程成环，无法保存')
    if (pred && pred !== '0' && pred !== 'start' && !main.includes(pred)) {
      throw new Error(`流程在「${configs[id]?.title || id}」处断链，无法保存`)
    }
    const walk = new Set<string>()
    let cur: string | undefined = id
    while (cur && isWritableStepId(cur)) {
      if (walk.has(cur)) throw new Error('流程成环，无法保存')
      walk.add(cur)
      cur = lastStepIdsFromCanvas(main, cur)[0]
    }
  }
}

/** 主链上该节点的前置步骤：最近一个可落库 id，否则虚拟起点 0。 */
export function lastStepIdsFromCanvas(main: string[], nodeId: string): string[] {
  const idx = main.indexOf(nodeId)
  if (idx <= 0) return ['0']
  for (let i = idx - 1; i >= 0; i--) {
    const id = main[i]
    if (id === 'start') return ['0']
    if (isWritableStepId(id)) return [id]
  }
  return ['0']
}

export function mergeStepForWrite(args: {
  snapshot?: Step
  cfg: NodeConfig
  nodeId: string
  sourceId: string
  /** 传入则覆盖快照里的 lastStep（自动保存按画布重算）；改名即时写入不要传，以免改拓扑。 */
  lastStepIds?: string[] | null
}): Step {
  const { snapshot, cfg, nodeId, sourceId } = args
  const lastStepIds = args.lastStepIds !== undefined ? args.lastStepIds : snapshot?.dependsOn
  return {
    stepId: isWritableStepId(nodeId) ? nodeId : '',
    sourceId: cfg.stepSourceId ?? snapshot?.sourceId ?? sourceId,
    name: cfg.title.trim(),
    nodeType: snapshot?.nodeType,
    inputTable: nodeInputTable(cfg) || snapshot?.inputTable,
    // 0901：显式未落表时按「默认 = 输入表」取本节点自己的输入表，而不是把这个新建节点还
    // 没配置过的空 outputTable 直接提交上去（旧写法遇到规则节点只填了输入表就会把 outputTable
    // 提交成空/沿用创建时从上游继承来的陈旧值，跟编辑框「默认 = 输入表」的承诺对不上）。
    outputTable: effectiveOutputTable(cfg) || snapshot?.outputTable,
    configId: cfg.configId || snapshot?.configId,
    mainConfig: snapshot?.mainConfig,
    flowCode: snapshot?.flowCode,
    itemId: cfg.itemId ?? snapshot?.itemId,
    extName: snapshot?.extName,
    url: snapshot?.url,
    condition: condExprOf(cfg) ?? undefined,
    failAction: cfg.outputAdvanced?.failPolicy || snapshot?.failAction,
    dependsOn: lastStepIds?.length ? lastStepIds : undefined,
    contextMap: cfg.taskCfg?.contextMap ?? snapshot?.contextMap,
    outColumns: cfg.taskCfg?.outColumns ?? snapshot?.outColumns,
    enabled: !cfg.disabled,
  }
}
