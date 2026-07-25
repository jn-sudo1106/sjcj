// 流程画布数据模型 —— 忠实移植自静态原型 prototypes/collect-config-center.html
// 节点配置、连线（子步骤）配置、节点模板与图标/样式辅助函数均与原型口径一致。
//
// 本文件仅保留：types 定义 + 杂项（applyParamSourceUrlToFirstCollectNode / makeSiteBlankTemplate）
//              + PresetIntent / FlowRecommendation 接口
//              + re-export seeds 与 layout 的所有 symbol（保持外部 `import ... from
//                '@/views/FlowCanvas/canvas/flowModel'` 的访问兼容性）
//
// 物理拆分（按 plan §A.5.2）：
//   - flowModel.seeds.ts  节点种子（COLLECTOR_CAPABILITIES / NODE_CONFIGS / LIB_GROUPS / PRESET_INTENTS / 各种 makeXxx）
//   - flowModel.layout.ts 布局与规范化算法（buildHorizontalLayout / normalizeNodeConfig / 节点 UI 辅助）
//
// 拆分原则：types 在 flowModel.ts；seeds 与 layout 互不重复；seeds → layout 单向依赖（用 cloneConfig/backfillOutputTables）。
//
// ============================================================================
// 采集 vs 非采集 节点的字段口径（plan §F.3 + P3-2 设计稿：字段命名规范_2026-07-25）
// ============================================================================
//
// NodeConfig（所有节点共有，line 81 起）与 CollectConfig（采集节点私有，line 197 起）有 3 个字段同名重复：
//
//   ┌──────────────┬────────────────────────────────┬──────────────────────────────────────┐
//   │ 字段         │ NodeConfig 语义                │ CollectConfig 语义                  │
//   ├──────────────┼────────────────────────────────┼──────────────────────────────────────┤
//   │ inputTable   │ 非采集类节点（采集类沿用       │ 采集节点步骤输入表（空 = 继承上游）   │
//   │              │ collectCfg.inputTable）        │                                      │
//   │ outputTable  │ 非采集类节点的产物落表绑定      │ 采集节点产物落表（必填）             │
//   │              │ （采集类沿用 collectCfg.output）│                                      │
//   │ entryCondition│ 节点进入条件（结构化条件组）   │ 采集节点步骤进入条件                 │
//   └──────────────┴────────────────────────────────┴──────────────────────────────────────┘
//
// 设计取舍：不合并。
//   - NodeConfig 保留空位 = 显式语义「非采集节点也能挂」，代码读起来更顺
//   - 强行合并反而要 collectCfg?.[key] ?? cfg?.[key] 一路兜底，不如把兜底逻辑集中在下面 3 个辅助函数里
//
// 统一读取辅助（已实现，所有调用方都走这里，不要再写 raw 的 cfg.collectCfg?.inputTable）：
//   - nodeInputTable(cfg)           // line 303，fallback: collectCfg.inputTable || cfg.inputTable
//   - nodeOutputTable(cfg)          // line 299，fallback: collectCfg.outputTable || cfg.outputTable
//   - nodeEntryCondition(cfg)       // line 314，fallback: collectCfg.entryCondition ?? cfg.entryCondition
//   （flowModel.layout.ts 里 effectiveInputTable / backfillOutputTables / upstreamOutputTableOf
//    等函数已改为调用这 3 个辅助，不再各自裸写兜底逻辑）
//
// 新加字段时：如果「采集节点独有」放 CollectConfig；如果「所有节点都能挂」放 NodeConfig 并加注释说明
// 采集类节点的读取优先级。**不要**在两边都定义然后不写辅助函数。

import type { RuleOrchestration, Site, Source } from '@/api'

// 让外部通过 flowModel 访问的 api types（seeds / 外部代码常用）
export type { RuleOrchestration, Site, Source } from '@/api'

// ---------- 基础类型 ----------
export type NodeKind = 'node' | 'decision' | 'parallel'
export type TripleField = 'inmap' | 'params' | 'output'
type LegacyTriple = [string, string, string]

export interface InputMapping {
  name: string
  from: string
  desc: string
}

export interface FieldDef {
  name: string
  type: string
  desc: string
}

export interface FieldOption {
  prop: string
  desc: string
}

type FieldOptionTable = {
  tableId: string
  fields: FieldOption[]
}

export function fieldOptionsFromTableOrOutput(tableId: string, tables: FieldOptionTable[], fallbackOutput: FieldDef[] = []): FieldOption[] {
  const table = tables.find((t) => t.tableId === tableId)
  if (table) return table.fields.map((f) => ({ prop: f.prop, desc: f.desc }))
  return fallbackOutput.map((f) => ({ prop: f.name, desc: f.desc || f.type }))
}

export interface NodeConfig {
  title: string
  sub: string
  status: string
  planned: boolean
  collect?: boolean
  kind?: NodeKind
  disabled?: boolean
  base: [string, string][]
  fields: [string, string][]
  inmap: InputMapping[]
  params: FieldDef[]
  output: FieldDef[]
  collectCfg?: CollectConfig
  /** 非采集类节点的产物落表绑定（采集类沿用 collectCfg.outputTable，二者不重复） */
  outputTable?: string
  /** 产物高级配置（原「落表输出」节点能力，降维为全节点通用；0701 问题四） */
  outputAdvanced?: OutputAdvanced
  /** 非采集类节点的输入表（采集类沿用 collectCfg.inputTable）；空 = 自动继承上游节点输出表，显式设置即覆盖（0701 问题五） */
  inputTable?: string
  /** 节点进入条件：语义为本节点只处理满足条件的输入表行 */
  entryCondition?: ConditionGroup
  /** 任务级配置（队列/URL规则/拼接逻辑/触发条件），采集与非采集节点共用同一处（0706 调整4·任务配置独立化） */
  taskCfg?: TaskConfig
  /** 规则处理节点编排配置（0707 Phase 9：规则引擎 rule-orchestration） */
  ruleCfg?: RuleOrchestration
}

type InputMappingLike = InputMapping | LegacyTriple
type FieldDefLike = FieldDef | LegacyTriple
export type NodeConfigSeed = Omit<NodeConfig, 'inmap' | 'params' | 'output'> & {
  inmap: InputMappingLike[]
  params: FieldDefLike[]
  output: FieldDefLike[]
}

// 节点库分组类型（seeds 用，外部通过 flowModel 也能访问）
export type Pill = 'p1' | 'p2' | 'plan'
export interface LibItem { template: string; code: string; badge?: string; name: string; desc: string; pill: Pill; planned?: boolean }
export interface LibGroup { title: string; items: LibItem[] }

/** 条件操作符（0701 问题十·方案B「节点进入条件」） */
export type ConditionOp = 'contains' | 'eq' | 'ne' | 'gt' | 'lt' | 'notEmpty'

/** 结构化进入条件：语义"本节点只处理满足条件的行"，1:1 对应 Step.condition（函数表达式）契约 */
export interface EntryCondition {
  field: string
  op: ConditionOp
  value: string
}

/** 条件组：多字段组合逻辑（0706 优化·主题二「条件表达式统一规范」），叶子沿用 EntryCondition。
 *  0707 优化·补：结构化字段选择表达不了跨字段比较/函数调用等复杂逻辑，加表达式模式兜底（1:1 对应 Step.condition 契约）；
 *  mode 缺省 = 'fields'（旧数据无此字段，兼容读取，0701 问题五同款 1:1+fallback 口径）；两种模式二选一，不混用。 */
export interface ConditionGroup {
  mode?: 'fields' | 'expr'
  logic: 'AND' | 'OR'
  items: EntryCondition[]
  /** mode === 'expr' 时的原始表达式字符串；不做语法校验，透传存储 */
  expr?: string
}

export interface OutputAdvanced {
  writeMode: 'upsert' | 'append'
  dedupeKey: string
  /** 失败策略（0707 恢复）：原挂在连线「失败动作」上，连线概念撤掉后归并到此——单一归属，不再两处维护 */
  failPolicy: string
}

/** 单个任务参数的取值：来自输入表字段，可选再经值函数处理。 */
export interface TaskParamValue {
  paramId: string
  fieldId?: string
  valueExpr?: string
}

/** 任务级配置：队列、URL 来源/规则及上下游字段映射，独立于节点处理逻辑。 */
export interface TaskConfig {
  queue: string
  /** 任务 URL 来源字段：从输入表 schema 中选择，供 urlRule 拼接引用（0707 补齐，原属于连线配置的"任务 URL 来源字段"） */
  urlSourceField?: string
  urlRule: string
  /** 当前节点已绑定参数的实际取值；参数集合由「参数配置」决定，不在此重复选择。 */
  paramValues?: TaskParamValue[]
  /** 随任务传递的输入表字段。 */
  contextMap?: string[]
  /** 当前节点输出表中保留并传给后续节点的字段。 */
  outColumns?: string[]
  /** @deprecated 旧版任务参数多选；加载时迁为 paramValues。 */
  paramRefs?: string[]
}

export type WebKind = 'list' | 'detail' | 'attachment'

/** 采集节点类型（0711 R7/R8：新增"浏览器抓取"/"公众号抓取"两个独立固定产物类型节点）。
 *  旧节点没有这个字段，用 inferCollectorKind() 从 snatchType/webKind 推导，不强制迁移数据。 */
export type CollectorKind = 'web' | 'browser_html' | 'wechat_official_html' | 'app' | 'file_download' | 'python'

/** 采集节点能力描述：固定产物类型节点的表/队列不可编辑，UI 与 store 双重防线都据此判断（0711 T5） */
export interface CollectorCapability {
  kind: CollectorKind
  label: string
  artifactType: 'structured' | 'html' | 'file'
  outputMode: 'selectable' | 'fixed'
  /** outputMode === 'fixed' 时的固定输出表（mock 环境直接给定值；真实环境应由后端按能力键解析，此处简化不做二次抽象） */
  fixedOutputTable?: string
  queueMode: 'editable' | 'fixed'
  /** queueMode === 'fixed' 时的固定队列名 */
  fixedQueue?: string
  supportsProxy: boolean
  supportsResume: boolean
  supportsLogin: boolean
  supportsUrlParams: boolean
}

/** 采集类节点的可编辑配置（0706 优化·源/节点配置分层后瘦身：源级字段迁至 Source，见 api/types.ts） */
export interface CollectConfig {
  snatchType: string
  webKind: WebKind
  url: string
  outputTable: string
  /** 输入表：空 = 自动继承上游节点输出表，显式设置即覆盖（0701 问题五） */
  inputTable: string
  /** 节点进入条件：语义为本采集步骤只处理满足条件的输入表行 */
  entryCondition?: ConditionGroup
  inputParams: string[]
  isDetail: boolean
  /** 采集节点类型（0711 R7/R8）：缺省时用 inferCollectorKind() 推导，不强制迁移旧数据 */
  collectorKind?: CollectorKind
  /** URL 参数绑定的参数 id 列表（0711 R9：源 URL 支持 $PARAM$_id 占位符）；与旧的 inputParams 是两个不同概念，互不覆盖。
   *  实际引用的参数 id 已经写死在 URL 的 $PARAM$_id token 里，这个列表是从 url 解析出的缓存/展示用途，不是"选择绑定哪个参数"。 */
  urlParamRefs?: string[]
  /** 每个参数 id 对应的选定取值（0711-B 拍板⑧：子源级可覆盖）——本字段随 collectCfg 一起活在"这个子源自己的 FlowDef"里，
   *  天然就是子源级：模板同步下发时所有子源起初相同，之后各子源独立编辑互不影响，和 url 字段完全同一套落点逻辑。
   *  缺省 = 用参数候选值列表的第一个值作为预览/试跑取值。 */
  urlParamValues?: Record<string, string>
  /** 运行设置（0711 R5：代理/断点续爬/登录从 Source 级迁到节点级，各节点可独立配置）。
   *  缺省 undefined 时由 NodeInspector 读一次 Source 同名旧字段做展示兜底（1:1+fallback），
   *  用户在本节点显式改过后才写入这里；Source 上的旧字段保留只读、不再新写入。 */
  useProxy?: boolean
  resume?: boolean
  needLogin?: boolean
  loginUrl?: string
  account?: string
  credentialRef?: string
  /** 定时策略只作用于首个采集节点；历史 Source/TaskConfig 同名字段在 load 时迁入。 */
  scheduleType?: string
  scheduleTime?: string
  weekdays?: number[]
  cron?: string
}

export type CollectorSchedule = Pick<CollectConfig, 'scheduleType' | 'scheduleTime' | 'weekdays' | 'cron'>

// ---------- 流程结构类型 ----------
/** 旁路分支种子（决定旁路节点纵向锚点与连线两端） */
export interface BranchSeed {
  id: string
  side: 'left' | 'right'
  rowAnchor: string
  edgeFrom: string
  edgeTo: string
}

/** 决策/分头节点的分支段（0707 优化·Phase6）：
 *  - 决策：数据行按 IF→ELIF→…→ELSE 顺序匹配，命中哪条走哪条子链（单路，A3）；
 *  - 分头：全部分支无条件并行走（多路）；
 *  - 汇合：分支段统一在主链 owner 的下一个节点收拢；不需要汇合的流程把决策放主链末端即可（汇合点 = 完成端），模型不用分叉出第二种形态（Q1）；
 *  - chain 内不允许再开新的 FlowBranchGroup（不支持嵌套分支），AddNodePopover 在「分支内添加」场景隐藏「逻辑」分组防误入。
 */
export interface FlowBranch {
  id: string
  /** 分支名（用户可编辑；如 "IF 命中"、"ELIF-n"、"ELSE 兜底"、"路径A"） */
  label: string
  /** 决策：按序匹配首个命中即走；undefined = ELSE 默认分支（必为最后一条）。分头节点忽略。 */
  condition?: ConditionGroup
  /** 分支内节点 id 序列；可为空（=直接到汇合点）。chain 内节点仍归 configs 所有，不重复存配置。 */
  chain: string[]
}

export interface FlowBranchGroup {
  /** 决策/分头节点 id；同一 FlowDef 内唯一 */
  ownerId: string
  /** 决策 ≥2（含 ELSE，ELSE.condition 为 undefined）；分头 ≥2（condition 忽略） */
  branches: FlowBranch[]
}

/** 流程定义（可序列化，用于保存 / 加载 / 多流程切换） */
export interface FlowDef {
  id: string
  name: string
  version: string
  main: string[]
  branches: BranchSeed[]
  configs: Record<string, NodeConfig>
  updatedAt: string
  /** 源级配置（0706 优化·源/节点配置分层）：未绑定源的草稿流程（空白/预置意图）为 undefined */
  source?: Source
  /** 决策/分头节点的分支段（散开→汇合，0707 优化·Phase6）；未配置 = 未声明分支 */
  branchGroups?: FlowBranchGroup[]
}

// 0707 澄清：连线（子步骤）不再是独立配置对象——原来挂在连线上的字段本来就该是下游节点自己的配置，
// 已按各自归属并回节点：步骤输入/输出表、步骤名称→节点自身字段；任务 URL 规则/来源字段、步骤执行条件→任务配置 Tab
// （urlRule/urlSourceField/trigger）；失败动作→表配置高级配置（failPolicy）；上下文来源→节点配置 Tab 的「输入映射」
// （inmap，采集/非采集节点统一显示）；出参列去除——下游「输入映射」的来源下拉本就能看到上游全部产物字段，无需再单独选一次。
// 连线在画布上纯粹是节点间的视觉连接，点击不再弹出独立检查器。

// ---------- 辅助函数（移植自原型） ----------
export function compactSub(sub: string): string {
  return String(sub || '').replace(/^\[[^\]]+\]\s*/, '')
}

export function isDecision(cfg: NodeConfig): boolean {
  return cfg.kind === 'decision' || /决策|条件路径/.test(cfg.title + cfg.sub)
}

/** 节点输出表统一读取口径（优化 0701 问题二）：采集类取 collectCfg.outputTable，其余取 outputTable */
export function nodeOutputTable(cfg: NodeConfig): string {
  return cfg.collectCfg?.outputTable || cfg.outputTable || ''
}

/** 节点输入表统一读取口径（0701 问题五）：仅返回显式设置值；空 = 未覆盖，由 effectiveInputTable 继续向上游解析 */
export function nodeInputTable(cfg: NodeConfig): string {
  return cfg.collectCfg?.inputTable || cfg.inputTable || ''
}

/** 节点任务队列统一读取口径（0706 调整4：队列归属统一收在 taskCfg，采集/非采集节点不再区分） */
export function nodeTaskQueue(cfg: NodeConfig): string {
  return cfg.taskCfg?.queue || ''
}

/** 节点进入条件统一读取口径：采集类取 collectCfg.entryCondition，非采集类取 cfg.entryCondition */
export function nodeEntryCondition(cfg: NodeConfig): ConditionGroup | undefined {
  return cfg.collectCfg?.entryCondition ?? cfg.entryCondition
}

/** 条件操作符文案（0701 问题十·方案B；0707 优化·Phase6 起仅给分支条件用） */
export const CONDITION_OP_OPTIONS: { value: ConditionOp; label: string }[] = [
  { value: 'contains', label: '包含' },
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'notEmpty', label: '非空' },
]

/** 单条件展示文案（0707 优化·Phase6 重构为内部 helper）：「标题 包含 "证券"」；fieldDesc 传字段中文名，缺省退回字段 prop。
 *  仅 conditionGroupLabel 内部使用；外部请走 conditionGroupLabel。 */
function entryConditionLabel(cond: EntryCondition | undefined, fieldDesc?: string): string {
  if (!cond || !cond.field) return ''
  const fieldLabel = fieldDesc || cond.field
  const opLabel = CONDITION_OP_OPTIONS.find((o) => o.value === cond.op)?.label ?? cond.op
  return cond.op === 'notEmpty' ? `${fieldLabel} 非空` : `${fieldLabel} ${opLabel} "${cond.value}"`
}

/** 条件组展示文案（0706 优化·主题二）：多条件按 AND/OR 拼接，如「标题 包含 "证券" 且 金额 大于 "100"」。 */
export function conditionGroupLabel(group: ConditionGroup | undefined, fieldDescOf?: (field: string) => string | undefined): string {
  if (!group) return ''
  if (group.mode === 'expr') return group.expr?.trim() ?? ''
  if (!group.items.length) return ''
  const sep = group.logic === 'OR' ? ' 或 ' : ' 且 '
  return group.items
    .map((c) => entryConditionLabel(c, fieldDescOf?.(c.field)))
    .filter(Boolean)
    .join(sep)
}

/** 条件组是否已配置（供校验/UI 判空共用）：表达式模式看 expr 非空，字段模式看 items 非空 */
export function conditionGroupIsSet(group: ConditionGroup | undefined): boolean {
  if (!group) return false
  return group.mode === 'expr' ? !!group.expr?.trim() : group.items.length > 0
}

/** 数据类节点 = "每个节点都落库"口径的适用范围；逻辑控制（决策/分头）与通知类（邮件/告警）、指标引用不产数据行，不要求输出表 */
export function isDataNode(cfg: NodeConfig): boolean {
  if (isDecision(cfg) || isParallel(cfg)) return false
  return !/邮件|告警|指标/.test(cfg.title + cfg.sub)
}

/**
 * 流程最终结果落表节点 = 主链末端、最后一个有输出表的非旁路节点。
 * 供 ResultView 与分屏对比共用（0701 问题二），两侧不再分叉。
 */
export function pickFinalMainNodeId(
  nodes: { id: string; cfg: NodeConfig; branch?: boolean }[],
): string {
  return [...nodes].reverse().find((n) => !n.branch && nodeOutputTable(n.cfg))?.id ?? ''
}

export function isParallel(cfg: NodeConfig): boolean {
  return cfg.kind === 'parallel' || /分头|多路径并行/.test(cfg.title + cfg.sub)
}

/** 决策/分头节点判定（0707 优化·Phase6）：复用 isDecision/isParallel 口径，给 NodeInspector 顶层 Tab 分流
 *  与 BranchEditor 渲染入口共用，避免两处各写文案正则导致口径漂移（此前 NodeInspector 把「分头」当决策识别，且漏「多路径并行」）。 */
export function decisionOrParallelKind(cfg: NodeConfig): 'decision' | 'parallel' | undefined {
  if (isDecision(cfg)) return 'decision'
  if (isParallel(cfg)) return 'parallel'
  return undefined
}

// ---------- 杂项（与 seeds/layout 无强耦合，独立放在 types 文件） ----------
/**
 * 参数源（0721 会议）：主链里排在最前面的采集节点，URL 强制取源的 urlTemplate（含 $PARAM$_id 占位符），
 * urlParamRefs 直接取源自己权威的 paramRefs——不用 extractUrlParamIds 从模板文本正则反推，部分历史参数
 * id 本身含 `-`（如 mock 的 p-fundcode）跟默认拼接符相邻时会有歧义，见 urlParams.ts 的坑记录。
 * 不管这个节点是刚手工插入的，还是套模板/AI 推荐重建 configs 带来的，只要是"这个源画布里最靠前的采集节点"
 * 就该顶着源的参数模板跑——否则套模板会把已经配好的参数配置悄悄冲掉（真实 bug，2026-07-21 会议反馈坐实）。
 */
export function applyParamSourceUrlToFirstCollectNode(main: string[], configs: Record<string, NodeConfig>, source: Source | null | undefined): void {
  if (source?.kind !== 'param' || !source.urlTemplate) return
  const firstCollectId = main.find((id) => configs[id]?.collectCfg)
  const cfg = firstCollectId ? configs[firstCollectId] : undefined
  if (!cfg?.collectCfg) return
  cfg.collectCfg.url = source.urlTemplate
  cfg.collectCfg.urlParamRefs = (source.paramRefs ?? []).map((ref) => ref.paramId)
}

/**
 * 网站统一流程的空白模板（0710 回退 0707 优化·补的"默认两节点骨架"）：新建/从未编排过的网站
 * 进画布应落在空白引导卡模式（§5.7 文案 + 「智能推荐模板」按需应用），而不是预置「列表抓取→详情解析」——
 * 预置骨架让用户误以为流程"已经获取到了"。id 固定 `site:${siteId}`，保证引导卡生成/保存都落对存档位。
 */
export function makeSiteBlankTemplate(site: Site): FlowDef {
  return {
    id: `site:${site.siteId}`,
    name: site.name,
    version: 'site-v1',
    main: ['start', 'end'],
    branches: [],
    configs: {},
    updatedAt: '',
  }
}

// ---------- 类型（仅接口；具体 build 在 seeds） ----------
export interface PresetIntent {
  key: string
  label: string
  keywords: string[]
  rationale: string
  build: () => FlowDef
}

export interface FlowRecommendation {
  flow: FlowDef
  /** 命中的流程模板；空值表示未能推荐出可直接应用的模板。 */
  templateId?: string
  rationale: string
  alternatives: { intent: string; name: string }[]
}

// ---------- Re-export（保持外部 import 路径 @/views/FlowCanvas/canvas/flowModel 仍能访问 seeds + layout 的 symbol） ----------
// 物理拆分（按 plan §A.5.2）：seeds 与 layout 独立可独立测试；本文件只留 types + 杂项。
// 外部 7 个引用方（stores × 3 + api × 4）只需把 'flowModel' 路径加上 'canvas/'，其他不变。
// FlowTemplate/index.vue 的 1 处 import 留到 Step 7 统一改（见 plan §A.5.3.5）。
export * from './flowModel.seeds'
export * from './flowModel.layout'
