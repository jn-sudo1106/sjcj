// 步骤写入：把画布节点和加载时留下的 Step 快照合回一条可提交的 Step。
//
// 写接口（item/next/stepModify、saveItemConfig）要整包字段，缺 url / itemId / lastStep
// 会被后端写成 null。画布只编辑名称、进入条件、配置/表，其余必须从快照带回。
// 可落库的节点 id 是 nextConfigPaged 的 itemConfig（纯数字且不是虚拟起点 0）。

import type { Step } from '@/api'
import {
  allBranchChainNodes,
  effectiveOutputTable,
  isDataValidationNode,
  isMonitorNode,
  isRuleLikeNode,
  isRuleNode,
  isPdfNode,
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

/**
 * 画布合成的**虚拟起点**（`rootStepForSource` 造的 `source:<sourceId>`）。
 *
 * **它绝不能落库**（2026-09-04 修）。源视图的起点在后端是 `nextConfigPaged?sourceId=X&svg=true`
 * **现算拼出来**的那行 `itemConfig: 0`——把源自己的 config 套壳成一个节点，不是
 * `cs_item_config` 里的真实记录。前端这个合成节点占的就是那一行的位置。
 *
 * 之前没排除它，导致**新建网站/新建源后一进画布，自动保存就把这个虚拟起点当成新节点
 * `saveItemConfig` 建了一条真实步骤**。下次再进来，后端照旧返回现算的 `itemConfig:0`，
 * 外加这条新建的真实行 —— 画布上就多出一个同名首节点，且每来一次多一条。
 * （生产数据里已有这个形状：流程 1400760 不带 svg 的 13 条里，40206/40211 都是 `lastStep='0'`
 * 的"根位置"步骤；1400935 更有 40589/40596/40597 三条并列。是不是全由此而来没法追溯，
 * 但机制对得上。）
 *
 * 用户在它后面加的节点不受影响：`lastStepIdsFromCanvas` 找不到可落库前置时返回哨兵 `'0'`，
 * 正是"挂在根上"的正确写法。
 */
export function isSyntheticRootId(id: string | undefined): boolean {
  return !!id && id.startsWith('source:')
}

/** 返回首个尚未绑定配置的本地草稿节点；此时应等待配置保存，而不是报流程保存失败。 */
export function firstUnboundDraftNodeId(main: string[], configs: Record<string, NodeConfig>): string | undefined {
  return main.find((id) => {
    if (id === 'start' || id === 'end' || id === '0' || isSyntheticRootId(id) || isWritableStepId(id)) return false
    return !!configs[id] && !configs[id].configId
  })
}

/**
 * 0927 H1：文件下载节点判定。后端 OUT_ENTRY（输出入口/输出表）必填只豁免 `type='file'`
 * （ItemConfigService saveItemConfig / stepModify 两处）；对应前端：模板插入节点看
 * `template === 'file'`（文件下载模板），历史回读节点看快照 `nodeType === 'file'`。
 */
export function isFileLikeNode(cfg: NodeConfig, snapshot?: Step): boolean {
  return cfg?.template === 'file' || snapshot?.nodeType === 'file'
}

/**
 * 0927 H1：非文件节点输出表是否「未就绪」——显式输出表、编辑框承诺的「默认 = 输入表」、
 * 快照里既有的输出表三者都没有。这类节点提交必被后端以「节点输出表不能为空」拒绝，
 * 自动保存按「配置未就绪草稿」处理（跳过该节点 + 头部提示），不整批卡死。
 * 0927 P1-2：真实 ROOT 行同步豁免（后端 OUT_ENTRY 不校验 ROOT；写侧与展示侧同一口径，
 * 否则新流程一打开默认选中的入口节点就误报「输出表未选择」）。
 * 2026-10-15：流程启用版本后写草稿不校验 OUT_ENTRY（186 实测），写侧是否跳过由 useStepWrite 按
 * flowVersion.allowsEmptyOutput 决定；本函数只回答「缺不缺」，发布 / 发起抓取前的检查仍按它拦。
 */
export function outputTableMissing(cfg: NodeConfig, snapshot?: Step): boolean {
  if (isFileLikeNode(cfg, snapshot)) return false
  if (snapshot?.isRoot) return false
  return !effectiveOutputTable(cfg) && !snapshot?.outputTable
}

/**
 * 0927 P2-4：有效流程 ID = 非空数字串且非 '0'（'0' 是未绑定哨兵，不能当流程 ID 提交）。
 * 画布可写流程 ID 的全部判定共用这一个口径（useStepWrite / applyTemplateToSource /
 * loadSourceFlow / FlowBoard 重载），避免各处手写数字正则与 '0' 特判漂移。
 */
export function validFlowIdOf(value: unknown): string {
  const text = value == null ? '' : String(value)
  return text && /^\d+$/.test(text) && text !== '0' ? text : ''
}

/**
 * 0927 H1：第一个「输出表未就绪」节点（含已落库的存量行——它们编辑时同样会被后端拒绝）。
 * 排除文件节点与真实 ROOT（ROOT 由流程生命周期管，OUT_ENTRY 不做必填校验）。供自动保存
 * 的 pending 判定与头部提示使用。
 */
export function firstOutputTableMissingNodeId(
  main: string[],
  branchGroups: FlowBranchGroup[],
  configs: Record<string, NodeConfig>,
  snapshots: Record<string, Step> = {},
): string | undefined {
  for (const id of persistableNodeIds(main, branchGroups)) {
    if (id === 'start' || id === 'end' || id === '0' || isSyntheticRootId(id)) continue
    const snapshot = snapshots[id]
    if (snapshot?.isRoot) continue
    const cfg = configs[id]
    if (!cfg) continue
    if (outputTableMissing(cfg, snapshot)) return id
  }
  return undefined
}

/** 流程发布 / 发起抓取前检查出的节点问题（2026-10-14）。 */
export interface FlowNodeIssue {
  nodeId: string
  title: string
  /** unsaved：新节点还没保存过节点配置（没有配置、也没进草稿）；outputTableMissing：非文件节点输出表未选；
   *  tableMismatch：输入表与上游输出表不一致（只提示） */
  reason: 'unsaved' | 'outputTableMissing' | 'tableMismatch'
  message: string
}

/**
 * 2026-10-14：发布 / 发起抓取（以后手工运行草稿）前的节点完整性检查，逐个节点列出问题。
 * 两条口径分别与 firstUnboundDraftNodeId、firstOutputTableMissingNodeId 一致，但覆盖分支链上的节点。
 */
export function collectFlowIssues(
  main: string[],
  branchGroups: FlowBranchGroup[],
  configs: Record<string, NodeConfig>,
  snapshots: Record<string, Step> = {},
): FlowNodeIssue[] {
  const issues: FlowNodeIssue[] = []
  for (const id of persistableNodeIds(main, branchGroups)) {
    if (id === 'start' || id === 'end' || id === '0' || isSyntheticRootId(id)) continue
    const cfg = configs[id]
    if (!cfg) continue
    const title = cfg.title || id
    if (!isWritableStepId(id) && !cfg.configId) {
      issues.push({ nodeId: id, title, reason: 'unsaved', message: '尚未保存，请在右侧保存节点配置' })
      continue
    }
    if (snapshots[id]?.isRoot) continue
    if (outputTableMissing(cfg, snapshots[id])) {
      issues.push({ nodeId: id, title, reason: 'outputTableMissing', message: '输出表未选择，请在右侧「表配置」补全' })
    }
  }
  return issues
}

/**
 * 2026-10-14：输入表与上游节点输出表不一致的节点（后端发布时会校验「输入表与上一个节点的输出表不一致」）。
 * 前端只作提示、不拦截；两边任一没有表时不比较。
 */
export function collectTableMismatches(
  main: string[],
  branchGroups: FlowBranchGroup[],
  configs: Record<string, NodeConfig>,
): FlowNodeIssue[] {
  const issues: FlowNodeIssue[] = []
  for (const id of persistableNodeIds(main, branchGroups)) {
    if (!isWritableStepId(id) || !configs[id]) continue
    const parentId = lastStepIdsFromCanvas(main, id, branchGroups)[0]
    const parent = parentId ? configs[parentId] : undefined
    if (!parent) continue
    const input = nodeInputTable(configs[id])
    const upstream = effectiveOutputTable(parent)
    if (input && upstream && input !== upstream) {
      issues.push({
        nodeId: id,
        title: configs[id].title || id,
        reason: 'tableMismatch',
        message: `输入表（${input}）与上一个节点「${parent.title || parentId}」的输出表（${upstream}）不一致`,
      })
    }
  }
  return issues
}

/**
 * 新增节点的「适用源」默认值：`-1` = 该配置下所有源（2026-09-04 先落在规则处理 / 数据监控，
 * 2026-09-24 用户拍板扩到**所有类型**——新建节点不该一上来就锁死在当前源上）。
 *
 * 步骤真正归属哪个源靠 `mainConfig` 锚点（`nextConfigPaged?sourceId=X` 按它查，
 * `cs_item_next.SOURCE_ID` 恒为 -1），所以这里写 -1 不会把步骤弄丢。
 *
 * 只在**新建**路径调用；回读已有步骤走 `buildNodeForStep`，值以库里的 `step.sourceId` 为准。
 * 已经是空串/已设值都不动——用户改过的必须听用户的（见 `mergeStepForWrite` 的三级优先）。
 */
export function applyStepSourceDefault(cfg: NodeConfig): void {
  if (cfg.stepSourceId === undefined || cfg.stepSourceId === '') cfg.stepSourceId = '-1'
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
 *
 * 0926：`opts.skipUnbound` 供自动保存用——画布上存在未绑定配置的草稿节点时，不再整体
 * 拦截（此前 `firstUnboundDraftNodeId` 让自动保存永久停摆，其它节点的改动全部丢掉），
 * 而是跳过这些草稿、只保存已绑定节点（草稿节点保留在画布上等右侧绑定配置）。缺省
 * 仍抛错：单节点保存等路径要求每一步都必须可落库，不能静默跳过。
 */
export function assertStepsPersistable(
  main: string[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[] = [],
  opts: { skipUnbound?: boolean } = {},
): void {
  // 0903 YB-B：分支链上的节点同样要过这道校验，否则"没绑配置的新节点"藏在分支里就溜过去了
  const all = persistableNodeIds(main, branchGroups)
  for (const id of all) {
    if (id === 'start' || id === 'end' || id === '0' || isSyntheticRootId(id) || isWritableStepId(id)) continue
    const cfg = configs[id]
    if (!cfg) continue
    if (opts.skipUnbound && !cfg.configId) continue
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
    // 1008-BR-01：多个上级（旧平台勾选多步「添加步骤」写成 lastStep="A,B"）同样冻结。画布只按
    // 第一个上级挂，重算会写回单值、丢掉其余上级；A、B 各只有这一个下游时下面的计数判不出来。
    if (step && extraParentsOf(step).length) return true
    for (const parent of new Set(step?.dependsOn ?? [])) {
      if (!parent || parent === '0') continue
      const next = (childrenOf.get(parent) ?? 0) + 1
      if (next > 1) return true
      childrenOf.set(parent, next)
    }
  }
  return false
}

/**
 * 步骤除画布连线那个上级之外的其余上级（1008-BR-01）。画布按 `dependsOn` 第一个上级挂
 * （`buildSourceSeed` 的 `realParentOf`），其余的不画线，在节点卡片上用「另有上级」标出来。
 * 去重、去空、去自身；根哨兵 `'0'` 照常算一个上级。
 */
export function extraParentsOf(step: Step | undefined): string[] {
  const parents = [...new Set((step?.dependsOn ?? []).filter((id) => id && id !== step?.stepId))]
  return parents.slice(1)
}

/**
 * 画布上所有可落库的节点 id：主链 + 各分支链（0903 YB-B）。
 *
 * **写回必须走这个而不是直接遍历 `main`**：分支还原之后，分支链里的节点不在 `main` 里，
 * 只遍历 main 会让它们"改了名字静默不保存"——界面显示已保存、后端没动，比拍平更难发现。
 *
 * 0925：覆盖嵌套 subGroups（还原拓扑的链内再分叉），见 `allBranchChainNodes`。
 */
export function persistableNodeIds(main: string[], branchGroups: FlowBranchGroup[] = []): string[] {
  return [...main, ...allBranchChainNodes(branchGroups)]
}

/**
 * 该节点的前置步骤：最近一个可落库 id，否则虚拟起点 0。
 *
 * 三种位置：
 *   - 在主链上 → 往前找最近的可落库节点
 *   - 在某条分支链的中间 → 在该链内往前找
 *   - 在某条分支链的链头 → 前置是该分组的 **owner**（分叉点），owner 不可落库时继续往它前面找
 *
 * 0925：分支链内嵌套分叉（subGroups）的节点，先按最近一层分支组链内找；链头 owner 为嵌套
 * 分支节点时沿它的父链继续。
 * 0927 P0-2：findChain 用**递归路径栈**防环，不再向共享 seen 累积已扫描的组——旧实现把
 * 扫描阶段路过的组一律塞进 seen，递归上溯（owner 不可落库时沿父链找）复用同一 seen，会把
 * 含该 owner 的祖先组跳过，嵌套链头被静默写回 ['0']（挂根）、跨保存周期持续改坏拓扑。
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
  // 0925：递归找 nodeId 落在哪条分支链——嵌套 subGroups 的链也要扫到，否则嵌套链节点
  // 一律回 ['0']（断链）。
  const findChain = (groups: FlowBranchGroup[], path: Set<string>): FlowBranchGroup | null => {
    for (const group of groups) {
      if (path.has(group.ownerId)) continue
      const nextPath = new Set([...path, group.ownerId])
      for (const branch of group.branches) {
        if (branch.chain.includes(nodeId)) return group
        if (branch.subGroups?.length) {
          const nested = findChain(branch.subGroups, nextPath)
          if (nested) return nested
        }
      }
    }
    return null
  }
  const group = findChain(branchGroups, new Set())
  if (group) {
    for (const branch of group.branches) {
      const ci = branch.chain.indexOf(nodeId)
      if (ci < 0) continue
      for (let i = ci - 1; i >= 0; i--) {
        if (isWritableStepId(branch.chain[i])) return [branch.chain[i]]
      }
      if (isWritableStepId(group.ownerId)) return [group.ownerId]
      // owner 自己还没落库（本地新建的分叉点 / 嵌套分叉的链内节点）：继续沿 owner 往上找。
      // 传回完整分支组列表（owner 的上一层在别的 branch 的 chain 里，链头遍历必须全局找），
      // path 栈只挡当前递归路径（上层 owner 成环引用时不再重复展开），祖先组不再被跳过。
      return lastStepIdsFromCanvas(main, group.ownerId, branchGroups)
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
 * `sourceId`（适用源）**不在这里处理**：它只是新建节点时的**默认值**（-1 = 该配置下所有源，
 * 见 `applyStepSourceDefault`），用户可以改，改了就得听用户的。
 * 这里照旧 `cfg.stepSourceId` 优先——写死成 -1 会把用户改过的值冲掉。
 *
 * | `context` / `outContext` | 表配置的入参 / 出参 | 采集节点这两个字段来自任务配置；规则节点的入出参在**表配置**里（ruleCfg） |
 *
 * ⚠️ **存的是物理列名（K1,K2,K3），不是 itemCode**。`ruleCfg.inputFields/outputFields` 存的是
 * itemCode（`RuleTableFieldBinder` 的 `toggleField` 传 `f.itemCode`），得靠表 schema 换一道；
 * 换不到的原样保留——宁可写个认得出的 itemCode，也别悄悄丢掉一个字段。
 *
 * ⚠️ **入参和出参查的是两张不同的表**：入参来自输入表，出参来自**输出表**
 * （`useRuleTableFields`：`outputTableId ? fieldsOf(outputTableId) : inputFieldOptions`，
 * 与 UI 上「输出表（可选，默认使用输入表）」一致）。两者共用一张映射的话，
 * 输出表 ≠ 输入表时出参会全部换不到、悄悄退化成 itemCode。
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
  /** 0925 步骤归属切 flowId：画布当前流程 ID（数字串）；缺省时沿用快照里的 flowId。 */
  flowId?: string
  /** 传入则覆盖快照里的 lastStep（自动保存按画布重算）；改名即时写入不要传，以免改拓扑。 */
  lastStepIds?: string[] | null
  /** 规则节点专用：**输入表**的 itemCode → 物理列名，用于入参（context） */
  columnByItemCode?: Map<string, string>
  /** 规则节点专用：**输出表**的 itemCode → 物理列名，用于出参（outContext）；缺省时退回输入表映射 */
  outColumnByItemCode?: Map<string, string>
}): Step {
  const { snapshot, cfg, nodeId, sourceId } = args
  // 0927 P2-5：flowId 落 Step 前过 validFlowIdOf——'0'（truthy）或非数字（如老后端回读异常值）
  // 一律不占键，避免 '0'/NaN 被显式写进写 payload（绕过后端 fillFlowIdIfEmpty 回填）。
  const flowId = validFlowIdOf(args.flowId ?? snapshot?.flowId)
  const rule = isRuleNode(cfg) ? cfg.ruleCfg : undefined
  // 翻译助手 / 打标签 / 摘要 / 音频转文字 / 视频转音频 / OCR 抓取（2026-09-18、09-22）：表配置的入参/出参跟规则节点同一套落库口径——存步骤的
  // context/outContext（物理列名），只是编排内容在 execCfg 而不是 ruleCfg。
  // nodeType 也跟规则节点一致写 'rule'：**发后续（source/nextStep）按步骤 type 派发执行器**，
  // 写 'entry' 会让旧后端拿采集执行器去跑这些配置，直接 500 服务器异常（2026-09-18 实测：
  // 把打标签步骤的 type 从 entry 改成 rule 后 ok_41696 即恢复正常）。回读侧的区分靠
  // configType 优先路由 + applyStepDetails 重建（见 flowModel.seeds），不会串成规则节点。
  // PDF抓取（2026-09-29 方案 A）：编排/表配置按规则式渲染，入出参也落在 execCfg，
  // 所以 context/outColumns 与规则式节点一样从 execCfg 取——否则「任务配置 → 上下文来源」
  // 已对 PDF 隐藏、taskCfg.contextMap 恒空，会导致发后续报文缺 context。
  // ⚠️ 只影响 context/outColumns 取值来源，**不动 nodeType/configType**（PDF 仍是采集身份）。
  const tableOrch = rule ?? ((isRuleLikeNode(cfg) || isPdfNode(cfg)) ? cfg.execCfg : undefined)
  const lastStepIds = args.lastStepIds !== undefined ? args.lastStepIds : snapshot?.dependsOn
  return {
    stepId: isWritableStepId(nodeId) ? nodeId : '',
    sourceId: cfg.stepSourceId ?? snapshot?.sourceId ?? sourceId,
    name: cfg.title.trim(),
    // monitor 必须排在 rule 前面：monitor 节点复用 rule 种子（isRuleNode 也为 true），
    // 恒写 'rule' 会让 monitor 类型信息不落库，回读后只能靠标题正则兜底——节点一改名
    // （如"库存监控"）template 就恢复不出来，isMonitorNode=false，数据监控节点专属逻辑
    // （表配置监控方法回填、保存时同步 ck_source 等）全部静默失效。
    nodeType: isMonitorNode(cfg) ? 'monitor' : isDataValidationNode(cfg) ? 'data-validation' : isRuleLikeNode(cfg) ? 'rule' : snapshot?.nodeType,
    inputTable: nodeInputTable(cfg) || snapshot?.inputTable,
    // 0901：显式未落表时按「默认 = 输入表」取本节点自己的输入表，而不是把这个新建节点还
    // 没配置过的空 outputTable 直接提交上去（旧写法遇到规则节点只填了输入表就会把 outputTable
    // 提交成空/沿用创建时从上游继承来的陈旧值，跟编辑框「默认 = 输入表」的承诺对不上）。
    outputTable: effectiveOutputTable(cfg) || snapshot?.outputTable,
    configId: cfg.configId || snapshot?.configId,
    mainConfig: snapshot?.mainConfig,
    // 0925 步骤归属切 flowId：入参（画布流程 ID）优先，新建节点由调用方传入；快照回读兜底。
    // 都没有时不占键（空串 / undefined / '0' 一律不出现），与写 payload 的口径一致。
    ...(flowId ? { flowId } : {}),
    flowCode: snapshot?.flowCode,
    itemId: cfg.itemId ?? snapshot?.itemId,
    extName: snapshot?.extName,
    url: snapshot?.url,
    condition: condExprOf(cfg) ?? undefined,
    failAction: cfg.outputAdvanced?.failPolicy || snapshot?.failAction,
    dependsOn: lastStepIds?.length ? lastStepIds : undefined,
    // 规则节点（含翻译助手）的入出参在表配置里（ruleCfg / execCfg），不是任务配置
    contextMap: tableOrch
      ? ruleStepContext(tableOrch.inputFields, args.columnByItemCode) ?? snapshot?.contextMap
      : cfg.taskCfg?.contextMap ?? snapshot?.contextMap,
    outColumns: tableOrch
      ? ruleStepContext(tableOrch.outputFields, args.outColumnByItemCode ?? args.columnByItemCode) ?? snapshot?.outColumns
      : cfg.taskCfg?.outColumns ?? snapshot?.outColumns,
    enabled: !cfg.disabled,
  }
}

/**
 * 孤儿步骤「关联到节点」的候选目标（0925 功能，0926 修正候选口径）。
 *
 * 判定：
 *  - 画布上所有可落库节点（main + 分支链，`persistableNodeIds`）；
 *  - 排除孤儿自己与它的**子子孙孙**（按步骤快照 dependsOn 闭包收集，挂进去会成环）；
 *  - 排除 `start` / `end` / 合成虚拟根（`source:` 前缀）；
 *  - **流程入口也允许**：源视角的虚拟入口行 `'0'`（svg=true 后端现算套壳行）与流程视角的
 *    真实入口行（isRoot=1）。`lastStep` 指向入口 = 「挂在根上」——后端
 *    `normalizeRootReferenceForStorage` 会把流程自己的根引用归一成 `'0'` 哨兵，
 *    与旧平台 `lastStep='0'` 是同一语义。
 *
 * 0926 修正（用户反馈「孤儿节点没法选择上一个节点，下拉是空的」）：此前入口被排除且候选
 * 要求必须有步骤快照，当孤儿的唯一合理归属就是入口（如流程只有「入口行 + 孤儿」）时下拉
 * 空无一物。现在入口放行、快照只在写入时检查（`relinkOrphan` 取孤儿自己的快照整包回带）。
 * 0926 REVIEW F2：源视图的入口是**合成根**（`source:${sourceId}`，svg=true 的虚拟入口行），
 * 同入口一并放行——否则源视图里只挂得回入口的孤儿下拉又是空的。
 *
 * @returns 目标列表，入口总是排在最前（孤儿最常见的正确归属就是挂回流程起点）；
 *          `isEntry` 标记用于 UI 展示「流程入口 · 」前缀。
 */
export function relinkCandidates(
  main: string[],
  branchGroups: FlowBranchGroup[],
  configs: Record<string, NodeConfig>,
  snapshots: Record<string, Step | undefined>,
  orphanId: string,
): { id: string; title: string; isEntry: boolean }[] {
  // 孤儿自己的子子孙孙（沿 dependsOn 闭包）不能当目标——挂回去就成环。
  const excluded = new Set<string>([orphanId])
  let changed = true
  while (changed) {
    changed = false
    for (const snap of Object.values(snapshots)) {
      if (!snap || excluded.has(snap.stepId)) continue
      if ((snap.dependsOn ?? []).some((p) => excluded.has(p))) {
        excluded.add(snap.stepId)
        changed = true
      }
    }
  }
  const isEntry = (nid: string): boolean =>
    nid === '0' || snapshots[nid]?.isRoot === true || isSyntheticRootId(nid)
  const seen = new Set<string>()
  const targets: { id: string; title: string; isEntry: boolean }[] = []
  // '0' 入口行可能同时在 persistableNodeIds 里（源模式它在 main 中），seen 去重；
  // 入口先推，保证固有排序在其它候选前面。
  for (const nid of ['0', ...persistableNodeIds(main, branchGroups)]) {
    if (seen.has(nid) || !configs[nid]) continue
    seen.add(nid)
    if (nid === orphanId || nid === 'start' || nid === 'end') continue
    // 合成根（source:xxx，源视图 = svg=true 的虚拟入口行）是源视图的**入口**，放行；
    // 写侧 relinkOrphan 会把合成根归一成 '0' 哨兵（2026-09-26 REVIEW F2：源视图孤儿
    // 只挂得回入口时，下拉之前是空的——合成根被排除、'0' 行又不在 configs 里，两头都够不着）。
    if (!(nid === '0' || isWritableStepId(nid) || isSyntheticRootId(nid))) continue
    if (excluded.has(nid)) continue
    const entry = isEntry(nid)
    targets.push({ id: nid, title: `${entry ? '流程入口 · ' : ''}${configs[nid]?.title ?? nid}`, isEntry: entry })
  }
  return targets
}
