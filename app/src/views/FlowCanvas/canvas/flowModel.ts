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
// 1008-BR-06：决策 / 分头结构节点已去掉，分支按旧平台语义由普通节点的上级（lastStep）表达
export type NodeKind = 'node'
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
  /** 物理列名（K1/K2/...）。条件/表达式等要拼真实语法的地方须用这个，prop 只是选字段用的业务标识
   *  （itemCode），两者不是同一套命名空间——2026-08-26 实测：真实 cond 用 "K6==nil" 这种物理列名，
   *  不是 itemCode；同一坑 DataGrid.vue/ResultView.vue/SiteDataView.vue 已经踩过一次。 */
  columnName?: string
}

type FieldOptionTable = {
  tableId: string
  fields: { prop: string; desc: string; columnName?: string }[]
}

export function fieldOptionsFromTableOrOutput(tableId: string, tables: FieldOptionTable[], fallbackOutput: FieldDef[] = []): FieldOption[] {
  const table = tables.find((t) => t.tableId === tableId)
  if (table) return table.fields.map((f) => ({ prop: f.prop, desc: f.desc, columnName: f.columnName }))
  return fallbackOutput.map((f) => ({ prop: f.name, desc: f.desc || f.type }))
}

export interface NodeConfig {
  title: string
  sub: string
  status: string
  planned: boolean
  collect?: boolean
  kind?: NodeKind
  /** 节点模板 key（LIB_GROUPS 里的 template，如 web/rule/monitor/decision…）。插入时写入，作结构信号区分
   *  复用同一种子的节点类型——典型：monitor 与 rule 都映射 rule 种子，靠它区分「数据监控」与「规则处理」。
   *  历史流程回读（从 Step 迁移）没有此字段，isMonitorNode 按 undefined 处理为普通规则节点。 */
  template?: string
  /** 节点类型 ID（旧平台「抓取类型」= config.configType，如 90 网页抓取、150 OCR抓取、800 翻译助手） */
  configType?: string
  /** 本节点引用的配置 ID（迁移数据来自 Step.configId）。0824-00 §1.1 的新模型里 FlowNode N:1 Config，
   *  节点必须且只能引用一个配置——这个字段就是那个引用。参数绑定/解绑要按它调 config/configParam* 接口。 */
  configId?: string
  /** 本节点引用配置的名称（config-meta，0824-06 §4）。已有配置来自 config/configDetail 回填，
   *  新增/复制节点时与节点名称一致，展示在检查器「当前配置」条，不在节点配置 Tab 里再填一遍。 */
  configName?: string
  /** 配置自己的 URL（旧平台「配置编辑」的 URL = `configUrl`）。
   *  与源 URL（`collectCfg.url` / `Source.url`）不是同一份：一份配置可被多个源复用，各源地址不同。 */
  configUrl?: string
  disabled?: boolean
  base: [string, string][]
  fields: [string, string][]
  inmap: InputMapping[]
  params: FieldDef[]
  output: FieldDef[]
  collectCfg?: CollectConfig
  /** 非采集类节点的产物落表绑定（采集类沿用 collectCfg.outputTable，二者不重复） */
  outputTable?: string
  /** 输出表去重方式：'source' 源内去重 / 'table' 表内去重 */
  dedupMode?: 'source' | 'table'
  /** 输出表选定的目标字段列表（默认包含全部字段） */
  outFields?: string[]
  /** 产物高级配置（原「落表输出」节点能力，降维为全节点通用；0701 问题四） */
  outputAdvanced?: OutputAdvanced
  /** 结构化配置（入库配置，0804 S3-1）：非采集类节点用这个，采集类走 collectCfg.structuredConfig（同 outputTable 的双轨模式） */
  structuredConfig?: string
  /** 正文规则（0804 S3-1）：非采集类节点用这个，采集类走 collectCfg.contentRules */
  contentRules?: string
  /** 配置核心参数（旧 coreParam）：打标签/摘要节点保存时把模型选择写这里
   *  （{"providerCode","model"}，2026-09-20 从 code_rule 调整到 core_param），
   *  翻译助手把源/目标语言与引擎写这里（{"from","to","engine"}，2026-09-21 从 code_rule 调整到 core_param），
   *  音频提取文字把转写配置写这里（provider/语言/区间/输出格式，2026-09-23 从 code_rule 调整到 core_param），
   *  回读后用于编排 Tab 回填模型 / 语言与引擎 / 音频配置下拉。 */
  coreParam?: string
  /** 非采集类节点的输入表（采集类沿用 collectCfg.inputTable）；空 = 自动继承上游节点输出表，显式设置即覆盖（0701 问题五） */
  inputTable?: string
  /** 表配置中已选的输入字段；未设置时默认使用输入表全部字段。 */
  inputFields?: string[]
  /** 节点进入条件：语义为本节点只处理满足条件的输入表行 */
  entryCondition?: ConditionGroup
  /** 任务级配置（队列/URL规则/拼接逻辑/触发条件），采集与非采集节点共用同一处（0706 调整4·任务配置独立化） */
  taskCfg?: TaskConfig
  /** 节点级定时策略：所有有执行语义的节点共用；旧采集/Source 字段仅作兼容读取。 */
  schedule?: CollectorSchedule
  /** 配置的旧运行策略原文（config.runPolicy）。只读迁移，确认写契约前不从节点表单回写。 */
  runPolicy?: string
  /**
   * 旧步骤 `itemId`。规则处理节点对应旧表单「规则ID选择」（未选是 `-1`）；
   * 采集后续步对应「任务 URL 来源字段」。写回 item/next 必须带上，缺了会被后端写成 null。
   */
  itemId?: string
  /**
   * 旧步骤「适用源」（`sourceId`）。`-1` 表示使用该配置的所有源。
   * 与画布当前源（`flow.sourceCfg.sourceId`）不是同一层：步骤可以挂在 -1 上被多源共用。
   */
  stepSourceId?: string
  /** 规则处理节点编排配置（0707 Phase 9：规则引擎 rule-orchestration） */
  ruleCfg?: RuleOrchestration
  /** 数据监控节点「监控方法」多选值（2026-09-01）。仅 monitor 模板使用，候选值见 MONITOR_METHODS。 */
  monitorMethods?: string[]
  /** 数据监控节点告警配置快照：由告警配置面板维护，保存 ck_source.check_conf 时合并进去。 */
  alertConfig?: MonitorAlertConfig
  /**
   * 非规则节点（采集/登录等）的编排配置（0804 S3-3，方案 §3.1 修正 C/D）：抓取配置 XML /
   * 登录配置，跟 ruleCfg 同构复用 RuleOrchestration（含 S3-2 加的 format 字段，此处恒为
   * 'xml'），只是换个字段名——不能直接塞进 ruleCfg，否则 isRuleNode() 会把这类节点误判成规则节点。
   */
  execCfg?: RuleOrchestration
}

export interface MonitorAlertChannelConfig {
  type: 'email' | 'dingtalk'
  enabled: boolean
  target?: string
}

export interface MonitorAlertPolicyConfig {
  name: string
  metric: string
  operator: string
  threshold: string
  consecutiveCount: number
  repeatMinutes: number
  recoveryNotify: boolean
  enabled: boolean
  channelTypes: Array<'email' | 'dingtalk'>
}

export interface MonitorAlertConfig {
  enabled: boolean
  policies: MonitorAlertPolicyConfig[]
  channels: MonitorAlertChannelConfig[]
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
// isEmpty/notContains 是 2026-08-26 按真实 cond 语法补的：`K17==nil`（为空）和
// `!string.contains(K2,'weixin.qq')`（不包含）都是生产在用的写法，此前没有对应的操作符，
// 迁移数据解析回字段模式时表达不了。语法细节见 utils/flow/conditionExpr.ts。
export type ConditionOp = 'contains' | 'notContains' | 'eq' | 'ne' | 'gt' | 'lt' | 'isEmpty' | 'notEmpty'

/** 结构化进入条件：语义"本节点只处理满足条件的行"，1:1 对应 Step.condition（函数表达式）契约 */
export interface EntryCondition {
  field: string
  op: ConditionOp
  value: string
  /** 与前一条条件的连接方式；旧数据缺省时沿用条件组 logic。 */
  joinWith?: 'AND' | 'OR'
}

/** 条件组：每条字段条件可指定与前一条的连接方式；组级 logic 用于兼容旧数据。
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

/** 任务级配置：队列及上下游字段映射，独立于节点处理逻辑。 */
export interface TaskConfig {
  queue: string
  /**
   * @deprecated 0804 拍板：任务 URL 来源字段/规则已从 UI 删除——当时保留是为了传参，
   * 现在在参数位置拼接即可（见开发方案 §2.3）。字段保留仅供历史流程回读，新建流程不再写入。
   */
  urlSourceField?: string
  /** @deprecated 同上，不再从 UI 写入 */
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
export type CollectorKind = 'web' | 'browser_html' | 'wechat_official_html' | 'app' | 'file_download' | 'python' | 'login'

/**
 * 登录节点使用的一条完整登录数据配置。
 *
 * 字段按旧平台 Step3 保持一致；一个登录节点可以配置多条，发起任务时再临时选择其中一条。
 */
export interface LoginConfigRef {
  id: string
  loginUrl: string
  loginName: string
  loginPwd: string
  newLoginConfig: '0' | '1'
  authConfig: string
  enabled: boolean
}

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

/** 代理明细（0804 S3-1）：勾选「使用代理」后才展开填写；下传时按抓取配置 XML 里的 Proxy JSON 形状序列化
 *（ip/port/账号/密码，其余字段用默认值，见开发方案 §3.1），本类型只存前端表单用得到的四项。 */
export interface CollectorProxyDetail {
  ip?: string
  port?: number
  account?: string
  password?: string
}

/** 采集类节点的可编辑配置（0706 优化·源/节点配置分层后瘦身：源级字段迁至 Source，见 api/types.ts） */
export interface CollectConfig {
  snatchType: string
  webKind: WebKind
  url: string
  outputTable: string
  /** 输出表去重方式：'source' 源内去重 / 'table' 表内去重 */
  dedupMode?: 'source' | 'table'
  /** 输出表选定的目标字段列表（默认包含全部字段） */
  outFields?: string[]
  /** 输入表：空 = 自动继承上游节点输出表，显式设置即覆盖（0701 问题五） */
  inputTable: string
  /** 节点进入条件：语义为本采集步骤只处理满足条件的输入表行 */
  entryCondition?: ConditionGroup
  inputParams: string[]
  isDetail: boolean
  /** 旧 `isMulti` 三态原值（1=列表类 / 0=详情类 / 2=更新父表），从迁移数据带过来只存不展示。
   *  isDetail 只能表达 0 与"非 0"，压不下第三态，所以两个字段并存：展示继续走 isDetail，
   *  写回旧平台时应以 multiMode 为准。详见 api/types/source.ts 的 Step.multiMode 注释。 */
  multiMode?: number
  /** 采集节点类型（0711 R7/R8）：缺省时用 inferCollectorKind() 推导，不强制迁移旧数据 */
  collectorKind?: CollectorKind
  /** URL 参数绑定的参数 id 列表（0711 R9：源 URL 支持 $PARAM$_id 占位符）；与旧的 inputParams 是两个不同概念，互不覆盖。
   *  实际引用的参数 id 已经写死在 URL 的 $PARAM$_id token 里，这个列表是从 url 解析出的缓存/展示用途，不是"选择绑定哪个参数"。 */
  urlParamRefs?: string[]
  /** 每个参数 id 对应的选定取值（0711-B 拍板⑧：源级可覆盖）——本字段随 collectCfg 一起活在"这个源自己的 FlowDef"里，
   *  天然就是源级：模板同步下发时所有源起初相同，之后各源独立编辑互不影响，和 url 字段完全同一套落点逻辑。
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
  /** 登录节点的多条旧平台登录配置。 */
  loginConfigs?: LoginConfigRef[]
  /** 默认登录配置；发起任务时可以临时覆盖，不修改此默认值。 */
  defaultLoginConfigId?: string
  /** 定时策略只作用于首个采集节点；历史 Source/TaskConfig 同名字段在 load 时迁入。 */
  scheduleType?: string
  scheduleTime?: string
  weekdays?: number[]
  cron?: string
  /** 业务类型（0804 S3-1）：规则名称维度的分类（如新闻/登录/分类），跟网页类型 webKind 是两个独立概念，别混 */
  bizType?: string
  /** 代理明细（0804 S3-1）：useProxy 勾选后才展开填写，未勾选时不下传 */
  proxyDetail?: CollectorProxyDetail
  /** 结构化配置（入库配置，0804 S3-1）：程序按此规则把抓取结果落进输出表；本期存不透明文本，具体 schema 由执行端解释 */
  structuredConfig?: string
  /** 正文规则（0804 S3-1）：按输出字段配置的处理规则（如 content=trim），本期存不透明文本，一行一条 */
  contentRules?: string
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

/** 分叉点以下的一条分支（旧平台语义，1008-BR-06）：每个节点一个上级，几个节点上级相同就是分叉；
 *  各后继按自己的进入条件独立判断（可同时命中，无 ELSE），分叉以下不再汇合。
 *  链里再遇分叉以 subGroups 嵌套承接（0925 完整还原，实拍源 430024432）。拓扑由 flowTopology.ts 推导。
 */
export interface FlowBranch {
  id: string
  /** 分支名：取链头节点名（旧平台没有分支标签）。条件不在分支上，属于链头节点自己的进入条件。 */
  label: string
  /** 分支内节点 id 序列。chain 内节点仍归 configs 所有，不重复存配置。 */
  chain: string[]
  /** 链内再分叉（0925 还原拓扑专用）：chain 走到某节点时该节点是另一个分支组的 owner。
   *  旧平台模型下 chain 遇分叉即止（每步只有一个 lastStep，分叉点以下全部进分支），
   *  所以每组至多一个嵌套组、owner 必为 chain 末节点；渲染 / 语义 / 写回全部按递归处理。 */
  subGroups?: FlowBranchGroup[]
}

export interface FlowBranchGroup {
  /**
   * 分叉点节点 id；同一 FlowDef 内唯一。
   *
   * 就是那个有多个后继的普通节点本身（0903 YB-B；1008-BR-06 起决策 / 分头节点已去掉）：
   * 旧平台没有结构节点，条件挂在各后继自己的 entryCondition 上而不是分支上。
   */
  ownerId: string
  /** ≥2 条，按同级展示顺序（还原时 = 接口顺序，即步骤 ID 升序） */
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
  /** 分叉点以下的分支（由各节点上级推导，见 flowTopology.ts）；无分叉 = 空 */
  branchGroups?: FlowBranchGroup[]
  /** 孤儿步骤标识（0925）：解析不出真实前置的步骤 id（无 lastStep / lastStep 指向集合外 /
   *  '0' 哨兵但无 '0' 行）。仅由步骤还原（buildSourceSeed）产出，随流程加载进画布；
   *  不参与保存（写 payload 只来自 configs），重新加载时重新推导。 */
  orphanIds?: string[]
}

// 0707 澄清：连线（子步骤）不再是独立配置对象——原来挂在连线上的字段本来就该是下游节点自己的配置，
// 已按各自归属并回节点：步骤输入/输出表、步骤名称→节点自身字段；步骤执行条件→任务配置 Tab（trigger）；
// 失败动作→表配置高级配置（failPolicy）；出参列去除——下游「输入映射」的来源下拉本就能看到上游全部产物字段，无需再单独选一次。
// 0804 拍板：任务 URL 规则/来源字段（urlRule/urlSourceField）、节点配置 Tab 的「输入映射」（inmap）
// 两处都已从 UI 删除，字段仅供历史流程回读（见开发方案 §2.3/§2.4，NodeConfig.inmap 类型定义不变）。
// 连线在画布上纯粹是节点间的视觉连接，点击不再弹出独立检查器。

// ---------- 辅助函数（移植自原型） ----------
export function compactSub(sub: string): string {
  return String(sub || '').replace(/^\[[^\]]+\]\s*/, '')
}

/** 节点输出表统一读取口径（优化 0701 问题二）：采集类取 collectCfg.outputTable，其余取 outputTable */
export function nodeOutputTable(cfg: NodeConfig): string {
  return cfg.collectCfg?.outputTable || cfg.outputTable || ''
}

/** 节点输入表统一读取口径（0701 问题五）：仅返回显式设置值；空 = 未覆盖，由 effectiveInputTable 继续向上游解析 */
export function nodeInputTable(cfg: NodeConfig): string {
  return cfg.collectCfg?.inputTable || cfg.inputTable || ''
}

/**
 * 节点有效输出表（0901）：显式值优先，未设置时按「输出表」编辑框自己的承诺
 * （RuleTableFieldBinder.vue「默认 = 输入表」）取本节点当前输入表。
 *
 * 不能改 nodeOutputTable 本身兜底——upstreamOutputTable/分支锚点那批链路反查要判断的是
 * 「这个节点有没有自己明确落过表」，兜底成输入表会让它们提前误判为"有"，链路血缘断在错误的节点上。
 * 只在"这个节点自己最终会落到哪张表"的场景（画布连线标注、保存到后端）用这个。
 */
export function effectiveOutputTable(cfg: NodeConfig): string {
  // 采集节点输出表必填（编辑框写的是「请选择输出表」），不回退输入表——0928 起新建采集节点也带
  // 输入表（取上游输出），回退的话缺输出表的采集节点会被当成「有表」，自动保存把输入表当输出表写。
  if (cfg.collectCfg) return nodeOutputTable(cfg)
  return nodeOutputTable(cfg) || nodeInputTable(cfg)
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
  { value: 'notContains', label: '不包含' },
  { value: 'eq', label: '等于' },
  { value: 'ne', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'isEmpty', label: '为空' },
  { value: 'notEmpty', label: '非空' },
]

/** 不需要填值的操作符（为空/非空）：UI 隐藏值输入框，生成表达式时也不带值 */
export function conditionOpNeedsValue(op: ConditionOp): boolean {
  return op !== 'isEmpty' && op !== 'notEmpty'
}

/** 单条件展示文案（0707 优化·Phase6 重构为内部 helper）：「标题 包含 "证券"」；fieldDesc 传字段中文名，缺省退回字段 prop。
 *  仅 conditionGroupLabel 内部使用；外部请走 conditionGroupLabel。 */
function entryConditionLabel(cond: EntryCondition | undefined, fieldDesc?: string): string {
  if (!cond || !cond.field) return ''
  const fieldLabel = fieldDesc || cond.field
  const opLabel = CONDITION_OP_OPTIONS.find((o) => o.value === cond.op)?.label ?? cond.op
  return conditionOpNeedsValue(cond.op) ? `${fieldLabel} ${opLabel} "${cond.value}"` : `${fieldLabel} ${opLabel}`
}

/** 条件组展示文案（0706 优化·主题二）：多条件按 AND/OR 拼接，如「标题 包含 "证券" 且 金额 大于 "100"」。 */
export function conditionGroupLabel(group: ConditionGroup | undefined, fieldDescOf?: (field: string) => string | undefined): string {
  if (!group) return ''
  if (group.mode === 'expr') return group.expr?.trim() ?? ''
  if (!group.items.length) return ''
  return group.items.reduce((text, item) => {
    const label = entryConditionLabel(item, fieldDescOf?.(item.field))
    if (!label) return text
    return text ? `${text}${(item.joinWith ?? group.logic) === 'OR' ? ' 或 ' : ' 且 '}${label}` : label
  }, '')
}

/** 条件组是否已配置（供校验/UI 判空共用）：表达式模式看 expr 非空，字段模式看 items 非空 */
export function conditionGroupIsSet(group: ConditionGroup | undefined): boolean {
  if (!group) return false
  return group.mode === 'expr' ? !!group.expr?.trim() : group.items.length > 0
}

/** 数据类节点 = "每个节点都落库"口径的适用范围；通知类（邮件/告警）、指标引用不产数据行，不要求输出表 */
export function isDataNode(cfg: NodeConfig): boolean {
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

/**
 * 规则处理节点判定（0801 方案 §6.1）：抽成共享函数供 nodeInspectorTabs（Tab 分流）、TableTab（渲染分支）、
 * ConfigTab、NodeInspector 共用同一口径，避免各自维护一份判断逻辑漂移。
 *
 * 0805 修正（真机验证发现）：原实现是 /规则/.test(cfg.title)——0804 拍板"规则名称 = 节点名称"后，
 * 节点标题变成用户可以随便改的自由文本，一旦改名不含"规则"两个字，节点就会被误判成非规则节点，
 * 表配置/编排配置的内容整个错位（RuleTableFieldBinder 消失、编排配置门禁失效）。改用结构信号：
 * 规则节点在插入时就带着 ruleCfg（来自 NODE_CONFIG_SEEDS.rule），其他节点类型从不带这个字段，
 * 这个信号不随改名变化，比正则可靠。
 */
export function isRuleNode(cfg?: NodeConfig): boolean {
  return !!cfg?.ruleCfg
}

/**
 * 数据监控节点判定（2026-09-01）：monitor 与 rule 复用同一个 rule 种子（TEMPLATE_TO_NODE.monitor='rule'），
 * isRuleNode 对两者都为 true，区分靠插入时写入的 `template` 结构信号。历史流程回读没有 template，
 * 按 undefined 处理为普通规则节点（monitor 是新增模板，历史不可能有）。命名/标题正则不可靠（用户可改名）。
 */
export function isMonitorNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  return cfg.template === 'monitor'
    || cfg.configType === '610'
    || (cfg.sub ?? '').includes('[610]')
}

/** 数据校验节点判定：复用规则种子，但不带数据监控的告警语义。 */
export function isDataValidationNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  return cfg.template === 'data-validation'
    || cfg.configType === '620'
    || (cfg.sub ?? '').includes('[620]')
}

/**
 * 节点类型判定：**不能只看 `template`**——`template` 只在插入时（insertAfter）以及后端回读的
 * monitor / data-validation 两条分支上被写入，其它类型回读后是 undefined。
 * 所以再兜底一条：节点种子副标题里的类型编号，如 ocr 种子的 `[150] OCR抓取 · 图片文字识别`
 *（与 iconFor() / nodeTypeLabel() 认类型的方式一致）。
 */
function hasNodeTypeCode(cfg: NodeConfig | NodeConfigSeed | undefined, template: string, code: string): boolean {
  if (!cfg) return false
  return cfg.template === template || (cfg as NodeConfig).configType === code || (cfg.sub ?? '').includes(`[${code}]`)
}

/** OCR 抓取节点（已并入规则式处理节点：表配置走 execCfg 绑定，编排配置是空白页）。 */
export function isOcrNode(cfg?: NodeConfig | NodeConfigSeed): boolean {
  if (!cfg) return false
  return hasNodeTypeCode(cfg, 'ocr', '150')
    || (cfg as NodeConfig).taskCfg?.queue === 'dev_web_snatch_ocr'
}

/**
 * PDF 抓取节点（configType 130）。
 *
 * 2026-09-29 产品口径：流程视图里 PDF 抓取节点的**节点配置 / 表配置 / 编排配置 / 任务配置**
 * 四个 Tab 渲染成与「规则处理」一致（含编排配置的 Python 脚本工作区）。
 * 但落库身份不变——仍靠 `collectCfg`（snatchType `[130]`）走采集类持久化（configType 130、
 * 步骤 nodeType 沿用快照、入出参取 taskCfg），故本谓词**只驱动 UI**，不进 `isRuleLikeNode`
 * （那会把 stepPersist 的 nodeType 改成 'rule'、context 改成读 execCfg，动了后端契约）。
 * PDF 的表/编排编辑内容落在 `execCfg`（不污染 configType），与翻译/打标签同一存储位。
 */
export function isPdfNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  return hasNodeTypeCode(cfg, 'pdf', '130')
    || (cfg.collectCfg?.snatchType ?? '').includes('[130]')
}

/**
 * 「编排/表/任务/节点配置四个 Tab 按规则处理形态渲染」的节点集合（2026-09-29）。
 *
 * = 真正的规则节点（`isRuleNode`，内容存 ruleCfg）+ PDF 抓取（`isPdfNode`，内容存 execCfg、
 * 落库仍是 130 采集身份）。仅供五个 inspector 组件在 UI 层分流用；持久化/落库口径
 * （nodeConfigPayload、stepPersist）不看它，仍按 `isRuleNode` / `isRuleLikeNode` 走。
 */
export function rendersAsRuleNode(cfg?: NodeConfig): boolean {
  return isRuleNode(cfg) || isPdfNode(cfg)
}

/** 视频提取音频节点（编排配置 Tab 用它决定要不要给「上传视频抽音轨」试跑区）。 */
export function isVideoAudioNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  return hasNodeTypeCode(cfg, 'video-audio', '700')
    || (cfg as NodeConfig).taskCfg?.queue === 'dev_web_videotoaudio'
}

/** 音频提取文字节点（编排配置 Tab 用它决定要不要给「上传音频转文字」试跑区）。 */
export function isAudioTextNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  if (isVideoAudioNode(cfg)) return false
  return hasNodeTypeCode(cfg, 'audio-text', '710')
    || (cfg as NodeConfig).taskCfg?.queue === 'dev_web_audiototext'
}

/** 文章生成摘要节点（编排配置 Tab 用它决定要不要给「上传文字生成摘要」区）。 */
export function isArticleSummaryNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  return hasNodeTypeCode(cfg, 'article-summary', '720')
}

/** 文章打标签节点（编排配置 Tab 用它决定要不要给「文本标注」区）。 */
export function isArticleTagNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  return hasNodeTypeCode(cfg, 'article-tag', '730')
}

/** 翻译助手节点（编排配置 Tab 用它决定要不要给「上传文件翻译」区）。 */
export function isTranslateNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  return hasNodeTypeCode(cfg, 'translate', '800')
    || (cfg as NodeConfig).taskCfg?.queue === 'dev_web_translate'
}

/**
 * 规则式表配置节点（2026-09-18）：翻译助手 / 文章打标签 / 文章生成摘要 / 音频提取文字 /
 * 视频提取音频与规则处理共用同一套「表配置」表单（RuleTableFieldBinder 的入参/出参字段绑定）
 * 与 tab 结构（无「参数配置」Tab），步骤 type 也统一写 'rule'（发后续按 type 派发执行器，
 * 写 entry 会 500）。
 * OCR 抓取（2026-09-22 并入，用户口径：表配置跟翻译助手做成一样）。
 *
 * 但编排内容仍分属 ruleCfg / execCfg 两处存储，不能直接并入 isRuleNode——那会把这几类
 * 误判成规则节点，编排配置 Tab 的模型/脚本工作区跟着串位（0917 已拍板这几类无脚本）。
 * 两处的表/字段绑定写入、步骤 context 持久化都按本谓词走同一口径。
 */
export function isRuleLikeNode(cfg?: NodeConfig): boolean {
  return isRuleNode(cfg)
    || isOcrNode(cfg)
    || isTranslateNode(cfg)
    || isArticleTagNode(cfg)
    || isArticleSummaryNode(cfg)
    || isAudioTextNode(cfg)
    || isVideoAudioNode(cfg)
}

/**
 * 「不给脚本编辑入口」的节点类型（2026-09-17 产品口径，用户逐个点掉后收敛成这张清单）。
 *
 * 这几类不在编排配置里生成脚本：OCR 识别、视频转音频、语音转文字、文章摘要、文章打标签、翻译助手都是现成的
 * 媒体 / 文本处理能力，既不需要写 Python 规则脚本，也没有可编辑的抓取配置 XML——
 * 工作区（描述 / 系统提示词 / 脚本正文 / 生成 / 保存）整个入口收掉，只留本类型自己的字段。
 * 想把某类加进来 / 拿出去，只改这两张表即可。
 */
const SCRIPTLESS_TEMPLATES = new Set(['ocr', 'video-audio', 'audio-text', 'article-summary', 'article-tag', 'translate'])
const SCRIPTLESS_TYPE_CODES = ['150', '700', '710', '720', '730', '800']

export function isScriptlessNode(cfg?: NodeConfig): boolean {
  if (!cfg) return false
  if (cfg.template && SCRIPTLESS_TEMPLATES.has(cfg.template)) return true
  const sub = cfg.sub ?? ''
  return SCRIPTLESS_TYPE_CODES.some((code) => sub.includes(`[${code}]`))
}

/** nextStep 目标 / 流程入口口径的真实节点：跳过 start/end 占位、停用、规划中。 */
function isRunnableFlowNode(id: string, configs: Record<string, NodeConfig>): boolean {
  if (id === 'start' || id === 'end') return false
  const cfg = configs[id]
  if (!cfg || cfg.disabled || cfg.planned) return false
  return true
}

/** 分支组里每条 chain 的首个真实节点。分叉点的后继是"每条分支各一个"，不是一个。 */
function branchGroupEntryIds(
  ownerId: string,
  branchGroups: FlowBranchGroup[],
  configs: Record<string, NodeConfig>,
): string[] {
  const g = branchGroupOf(branchGroups, ownerId)
  if (!g) return []
  return g.branches
    .map((b) => b.chain.find((nid) => isRunnableFlowNode(nid, configs)))
    .filter((nid): nid is string => !!nid)
}

// ---------- 分支组递归工具（0925 完整还原：分支组支持 subGroups 嵌套后，凡按个遍历组的
// 地方都要走这里，否则嵌套部分会漏） ----------

/** 全部分支组（含嵌套），按文档序拍平。 */
export function allBranchGroups(groups: FlowBranchGroup[] | undefined): FlowBranchGroup[] {
  const out: FlowBranchGroup[] = []
  const walk = (gs: FlowBranchGroup[]) => {
    for (const g of gs) {
      out.push(g)
      for (const b of g.branches) if (b.subGroups?.length) walk(b.subGroups)
    }
  }
  walk(groups ?? [])
  return out
}

/** 按 ownerId 递归找分支组（含嵌套）；没有返回 null。 */
export function branchGroupOf(groups: FlowBranchGroup[] | undefined, ownerId: string): FlowBranchGroup | null {
  for (const g of groups ?? []) {
    if (g.ownerId === ownerId) return g
    for (const b of g.branches) {
      if (b.subGroups?.length) {
        const found = branchGroupOf(b.subGroups, ownerId)
        if (found) return found
      }
    }
  }
  return null
}

/** 节点落在哪条分支链（递归，含嵌套）；不在任何链上返回 null。
 *  @param skip 本次查找跳过这些组（lastStepIdsFromCanvas 沿 owner 上溯时用，防重入自己）。 */
export function branchOfNode(
  groups: FlowBranchGroup[] | undefined,
  nodeId: string,
  skip?: Set<FlowBranchGroup>,
): { group: FlowBranchGroup; branch: FlowBranch; chainIndex: number } | null {
  for (const g of groups ?? []) {
    if (skip?.has(g)) continue
    for (const b of g.branches) {
      const ci = b.chain.indexOf(nodeId)
      if (ci >= 0) return { group: g, branch: b, chainIndex: ci }
      if (b.subGroups?.length) {
        const found = branchOfNode(b.subGroups, nodeId, skip)
        if (found) return found
      }
    }
  }
  return null
}

/** 全部分支链上的节点 id（递归，含嵌套），按文档序。 */
export function allBranchChainNodes(groups: FlowBranchGroup[] | undefined): string[] {
  const out: string[] = []
  const walk = (gs: FlowBranchGroup[]) => {
    for (const g of gs) {
      for (const b of g.branches) {
        out.push(...b.chain)
        if (b.subGroups?.length) walk(b.subGroups)
      }
    }
  }
  walk(groups ?? [])
  return out
}

/** 从 fromId 之后的主链往后看：真实节点，或落到分叉点的各分支 chain。 */
function laterRunnableIdsOnMain(
  main: string[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[],
  fromId: string,
): string[] {
  const idx = main.indexOf(fromId)
  if (idx < 0) return []
  for (let i = idx + 1; i < main.length; i++) {
    const nid = main[i]
    if (isRunnableFlowNode(nid, configs)) return [nid]
    const entries = branchGroupEntryIds(nid, branchGroups, configs)
    if (entries.length) return entries
  }
  return []
}

/**
 * 首个可执行节点判定（0812 计划 M2-10，方案 §6.7-A）：不能把所有"没有输入表"的节点都当成
 * 首节点——按主链顺序找第一个跳过 start/end 占位、未停用、非规划中的真实节点。
 * 只在主链上找：分支内节点天然有 owner 节点作为上游依赖，不可能是流程的入口。
 */
/** 主链上第一个可跑节点。数据视图默认落点（0831 F09），不要拿 layout.nodes[0] 代替——那会把停用/规划中节点算进去。 */
export function firstRunnableNodeId(main: string[], configs: Record<string, NodeConfig>): string {
  return main.find((nid) => isRunnableFlowNode(nid, configs)) ?? ''
}

export function isFirstRunnableNode(main: string[], configs: Record<string, NodeConfig>, id: string): boolean {
  return firstRunnableNodeId(main, configs) === id
}

/**
 * 是否有直接后继（0824：末节点无发后续）。末节点 = 已保存源流程里没有可发后续的下游，
 * 不是 main 数组里的最后一个 id（起止占位、停用/规划中都要跳过）。
 *
 * 主链：后面还有真实节点，或后续结构节点挂了可跑的分支 chain，或自身就是带 chain 的 owner。
 * 分支 chain 内：同链后续真实节点，或汇合点 = owner 之后的下一个主链真实节点；
 * 分支叶子且汇合处也没有真实节点 → false（保守，不让用户任意选节点）。
 */
export function hasDirectSuccessor(
  main: string[],
  configs: Record<string, NodeConfig>,
  id: string,
  branchGroups: FlowBranchGroup[] = [],
): boolean {
  return directSuccessorIds(main, configs, id, branchGroups).length > 0
}

/**
 * 直接后继的节点 id（0831 F10：数据视图要按"下一节点需要哪些字段"收敛默认列，
 * 光知道"有没有后继"不够，得知道是谁）。判定口径与 `hasDirectSuccessor` 完全一致
 * ——后者现在就是本函数的 `.length > 0`，两者不会各自漂移。
 *
 * 分叉点下游返回**每条分支的首个真实节点**（多个），调用方按需取并集。
 */
/**
 * 紧跟在 `id` 之后的节点，**不过滤停用**。
 *
 * `directSuccessorIds` 会跳过停用节点（`isRunnableFlowNode`）——那是对的，停用的节点不该
 * 被当成可发送目标。但调用方常常需要区分两种"没有后继"：
 *   ① 真的是末节点
 *   ② 后继存在，只是被停用了
 * 只看 `directSuccessorIds` 的话两者都返回空，界面就会把 ② 说成"末节点"（2026-09-04 实测：
 * 源 430016398 的规则处理节点后面挂着已停用的 40600，按钮却写「从上一节点重跑」）。
 */
export function directSuccessorIdsIncludingDisabled(
  main: string[],
  configs: Record<string, NodeConfig>,
  id: string,
  branchGroups: FlowBranchGroup[] = [],
): string[] {
  const groups = branchGroups ?? []
  const found = branchOfNode(groups, id)
  if (found) {
    const { branch, chainIndex } = found
    // 链内再分叉的 owner（0925 还原拓扑）：分支入口优先于空链尾
    if (branchGroupOf(groups, id)) return branchGroupEntryIds(id, groups, configs)
    for (let i = chainIndex + 1; i < branch.chain.length; i++) {
      const next = branch.chain[i]
      if (next !== 'start' && next !== 'end' && configs[next]) return [next]
    }
    return []
  }
  const idx = main.indexOf(id)
  if (idx < 0) return []
  // 分支入口（含停用的那些）
  const group = branchGroupOf(groups, id)
  if (group) {
    return group.branches
      .map((b) => b.chain.find((nid) => configs[nid]))
      .filter((nid): nid is string => !!nid)
  }
  for (let i = idx + 1; i < main.length; i++) {
    const next = main[i]
    if (next === 'end') return []
    if (configs[next]) return [next]
  }
  return []
}

export function directSuccessorIds(
  main: string[],
  configs: Record<string, NodeConfig>,
  id: string,
  branchGroups: FlowBranchGroup[] = [],
): string[] {
  const groups = branchGroups ?? []
  const found = branchOfNode(groups, id)
  if (found) {
    const { group, branch, chainIndex } = found
    // 链内再分叉的 owner（0925 还原拓扑）：分支入口优先于空链尾
    if (branchGroupOf(groups, id)) return branchGroupEntryIds(id, groups, configs)
    for (let i = chainIndex + 1; i < branch.chain.length; i++) {
      if (isRunnableFlowNode(branch.chain[i], configs)) return [branch.chain[i]]
    }
    // 分支叶子：汇合到 owner 之后的主链（owner 在嵌套链里时无主链汇合点 → 自然返回空）
    return laterRunnableIdsOnMain(main, configs, groups, group.ownerId)
  }
  if (!main.includes(id)) return []
  const branchEntries = branchGroupEntryIds(id, groups, configs)
  if (branchEntries.length) return branchEntries
  return laterRunnableIdsOnMain(main, configs, groups, id)
}

/**
 * 直接前驱（0831 X7-B：末节点从上一节点重跑）。
 * 就是把 directSuccessorIds 反过来扫一遍——不另写一套拓扑，避免两套口径各自漂移。
 */
export function directPredecessorIds(
  main: string[],
  configs: Record<string, NodeConfig>,
  id: string,
  branchGroups: FlowBranchGroup[] = [],
): string[] {
  const seen = new Set<string>([...main, ...allBranchChainNodes(branchGroups)])
  return [...seen].filter((nid) => nid !== id && isRunnableFlowNode(nid, configs) && directSuccessorIds(main, configs, nid, branchGroups).includes(id))
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
// 旧流程归档页仍复用此处模型；流程中心统一使用 FlowRecord/FlowDefinition DTO。
export * from './flowModel.seeds'
export * from './flowModel.layout'
