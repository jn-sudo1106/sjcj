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

/** 返回首个尚未绑定配置的本地草稿节点；此时应等待配置保存，而不是报流程保存失败。 */
export function firstUnboundDraftNodeId(main: string[], configs: Record<string, NodeConfig>): string | undefined {
  return main.find((id) => {
    if (id === 'start' || id === 'end' || id === '0' || isWritableStepId(id)) return false
    return !!configs[id] && !configs[id].configId
  })
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

/**
 * 这批步骤里是否存在**真实分支**：两个及以上步骤的 `lastStep`（`dependsOn`）指向同一个前置。
 *
 * 为什么要问这件事（2026-09-03 走查源 920663 发现）：`buildSourceSeed` 目前把子步骤
 * **一律拍成一条主链**（`branches` 恒为 `[]`），有分支的历史流程会被画成直线。
 * 旧平台真实拓扑长这样：
 *
 * ```
 * 920663 ──▶ 40597 ├─ _from=='api' && ... ──▶ 40598
 *                  └─ K24=="正文抓取失败" ──▶ 40620
 * ```
 *
 * 画布拍成 `40597 → 40598 → 40620` 之后，自动保存按画布位置重算 `lastStep`，会把
 * `40620.lastStep` 从 `40597` 改写成 `40598`——**分支被静默拍成链，且不可逆**。
 *
 * 在分支拓扑还原（YB-B）落地之前，检测到真分支就**冻结 `lastStep` 的写回**：
 * 画布上看到的顺序本来就不是真实拓扑，据此重算前置只会把对的数据改错。
 * 名称、进入条件这些与拓扑无关的字段照常保存。
 */
export function hasRealBranches(snapshots: Record<string, Step | undefined>): boolean {
  const childrenOf = new Map<string, number>()
  for (const step of Object.values(snapshots)) {
    for (const parent of step?.dependsOn ?? []) {
      if (!parent || parent === '0') continue
      const next = (childrenOf.get(parent) ?? 0) + 1
      if (next > 1) return true
      childrenOf.set(parent, next)
    }
  }
  return false
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
