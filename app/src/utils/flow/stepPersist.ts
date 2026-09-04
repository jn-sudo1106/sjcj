// 步骤写入：把画布节点和加载时留下的 Step 快照合回一条可提交的 Step。
//
// 写接口（item/next/stepModify、saveItemConfig）要整包字段，缺 url / itemId / lastStep
// 会被后端写成 null。画布只编辑名称、进入条件、配置/表，其余必须从快照带回。
// 可落库的节点 id 是 nextConfigPaged 的 itemConfig（纯数字且不是虚拟起点 0）。

import type { Step } from '@/api'
import {
  effectiveOutputTable,
  isRuleNode,
  nodeEntryCondition,
  nodeInputTable,
  type FlowBranchGroup,
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
export function assertStepsPersistable(
  main: string[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[] = [],
): void {
  // 0903 YB-B：分支链上的节点同样要过这道校验，否则"没绑配置的新节点"藏在分支里就溜过去了
  const all = persistableNodeIds(main, branchGroups)
  for (const id of all) {
    if (id === 'start' || id === 'end' || id === '0' || isWritableStepId(id)) continue
    const cfg = configs[id]
    if (!cfg) continue
    if (!cfg.title?.trim()) throw new Error('节点名称不能为空')
    if (!cfg.configId) throw new Error(`节点「${cfg.title || id}」尚未绑定配置，无法保存步骤`)
  }
  const writable = all.filter((id) => isWritableStepId(id))
  for (const id of writable) {
    const pred = lastStepIdsFromCanvas(main, id, branchGroups)[0]
    if (pred === id) throw new Error('流程成环，无法保存')
    if (pred && pred !== '0' && pred !== 'start' && !all.includes(pred)) {
      throw new Error(`流程在「${configs[id]?.title || id}」处断链，无法保存`)
    }
    const walk = new Set<string>()
    let cur: string | undefined = id
    while (cur && isWritableStepId(cur)) {
      if (walk.has(cur)) throw new Error('流程成环，无法保存')
      walk.add(cur)
      cur = lastStepIdsFromCanvas(main, cur, branchGroups)[0]
    }
  }
}

/**
 * 这批步骤里是否存在**真实分支**：两个及以上步骤的 `lastStep`（`dependsOn`）指向同一个前置。
 *
 * 为什么要问这件事（2026-09-03 走查源 920663 发现）：`buildSourceSeed` 当时把子步骤
 * **一律拍成一条主链**，有分支的历史流程被画成直线。旧平台真实拓扑长这样：
 *
 * ```
 * 920663 ──▶ 40597 ├─ _from=='api' && ... ──▶ 40598
 *                  └─ K24=="正文抓取失败" ──▶ 40620
 * ```
 *
 * 画布拍成 `40597 → 40598 → 40620` 之后，自动保存按画布位置重算 `lastStep`，会把
 * `40620.lastStep` 从 `40597` 改写成 `40598`——**分支被静默拍成链，且不可逆**。
 *
 * **YB-B 已经把拓扑还原了**（`buildSourceSeed` 按 `dependsOn` 建 `branchGroups`），
 * 但这条冻结**继续保留**，原因有二：
 *   ① **嵌套分叉仍然画不出来**——`buildHorizontalLayout` 只对主链上的节点查 owner，
 *      分支链内部再分叉时那一段还是被摊平的，据画布重算前置仍会改错；
 *   ② 还没有显式的"用户真的改过拓扑"标记（YB-2），只靠"值不一样"反推分不清
 *      "用户拖动了节点" 和 "画布本来就画得不准"。
 *
 * 所以对有分支的流程一律不写 `lastStep`，名称、进入条件这些与拓扑无关的字段照常保存。
 * 代价是分支流程的挂接关系暂时不能在画布上调整——画布头有对应提示，不是静默失效。
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

/**
 * 画布上所有可落库的节点 id：主链 + 各分支链（0903 YB-B）。
 *
 * **写回必须走这个而不是直接遍历 `main`**：分支还原之后，分支链里的节点不在 `main` 里，
 * 只遍历 main 会让它们"改了名字静默不保存"——界面显示已保存、后端没动，比拍平更难发现。
 */
export function persistableNodeIds(main: string[], branchGroups: FlowBranchGroup[] = []): string[] {
  const ids = [...main]
  for (const group of branchGroups) {
    for (const branch of group.branches) ids.push(...branch.chain)
  }
  return ids
}

/**
 * 该节点的前置步骤：最近一个可落库 id，否则虚拟起点 0。
 *
 * 三种位置：
 *   - 在主链上 → 往前找最近的可落库节点
 *   - 在某条分支链的中间 → 在该链内往前找
 *   - 在某条分支链的链头 → 前置是该分组的 **owner**（分叉点），owner 不可落库时继续往它前面找
 */
export function lastStepIdsFromCanvas(main: string[], nodeId: string, branchGroups: FlowBranchGroup[] = []): string[] {
  const idx = main.indexOf(nodeId)
  if (idx > 0) {
    for (let i = idx - 1; i >= 0; i--) {
      const id = main[i]
      if (id === 'start') return ['0']
      if (isWritableStepId(id)) return [id]
    }
    return ['0']
  }
  if (idx === 0) return ['0']
  for (const group of branchGroups) {
    for (const branch of group.branches) {
      const ci = branch.chain.indexOf(nodeId)
      if (ci < 0) continue
      for (let i = ci - 1; i >= 0; i--) {
        if (isWritableStepId(branch.chain[i])) return [branch.chain[i]]
      }
      if (isWritableStepId(group.ownerId)) return [group.ownerId]
      // owner 自己还没落库（本地新建的分叉点）：继续沿 owner 往上找
      return lastStepIdsFromCanvas(main, group.ownerId, branchGroups.filter((g) => g !== group))
    }
  }
  return ['0']
}

/**
 * 规则处理节点写步骤时的三处特殊口径（2026-09-04 会上提出，后端已按此收）：
 *
 * | 字段 | 值 | 为什么 |
 * |---|---|---|
 * | `type` | `'rule'` | 默认是 `'entry'`；执行端按它区分要不要走规则引擎 |
 * | `sourceId` | `'-1'` | 规则步骤不绑具体源（"适用源"默认全部），跟着源走会把它锁死在一个源上 |
 * | `context` / `outContext` | 表配置的入参 / 出参 | 采集节点这两个字段来自任务配置；规则节点的入出参在**表配置**里（ruleCfg） |
 *
 * ⚠️ **存的是物理列名（K1,K2,K3），不是 itemCode**。`ruleCfg.inputFields/outputFields` 存的是
 * itemCode（`RuleTableFieldBinder` 的 `toggleField` 传 `f.itemCode`），得靠表 schema 换一道；
 * 换不到的原样保留——宁可写个认得出的 itemCode，也别悄悄丢掉一个字段。
 */
export function ruleStepContext(
  codes: string[] | undefined,
  columnByItemCode: Map<string, string> | undefined,
): string[] | undefined {
  if (!codes?.length) return undefined
  return codes.map((code) => columnByItemCode?.get(code) || code)
}

export function mergeStepForWrite(args: {
  snapshot?: Step
  cfg: NodeConfig
  nodeId: string
  sourceId: string
  /** 传入则覆盖快照里的 lastStep（自动保存按画布重算）；改名即时写入不要传，以免改拓扑。 */
  lastStepIds?: string[] | null
  /** 规则节点专用：itemCode → 物理列名，用来把表配置的入出参写成 K1,K2,K3（见 ruleStepContext） */
  columnByItemCode?: Map<string, string>
}): Step {
  const { snapshot, cfg, nodeId, sourceId } = args
  const rule = isRuleNode(cfg) ? cfg.ruleCfg : undefined
  const lastStepIds = args.lastStepIds !== undefined ? args.lastStepIds : snapshot?.dependsOn
  return {
    stepId: isWritableStepId(nodeId) ? nodeId : '',
    // 规则步骤不绑具体源：适用源默认 -1
    sourceId: rule ? '-1' : (cfg.stepSourceId ?? snapshot?.sourceId ?? sourceId),
    name: cfg.title.trim(),
    nodeType: rule ? 'rule' : snapshot?.nodeType,
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
    // 规则节点的入出参在表配置里（ruleCfg），不是任务配置
    contextMap: rule
      ? ruleStepContext(rule.inputFields, args.columnByItemCode) ?? snapshot?.contextMap
      : cfg.taskCfg?.contextMap ?? snapshot?.contextMap,
    outColumns: rule
      ? ruleStepContext(rule.outputFields, args.columnByItemCode) ?? snapshot?.outColumns
      : cfg.taskCfg?.outColumns ?? snapshot?.outColumns,
    enabled: !cfg.disabled,
  }
}
