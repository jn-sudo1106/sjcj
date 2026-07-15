// 领域模型 — 按 docs/数据中心现有功能逆向工程 + 源列表实测字段建模。
// mock 与未来真实 BFF 共用此类型；字段名尽量对齐数据采集平台原始口径。

import type {
  BranchSeed,
  CollectConfig,
  ConditionGroup,
  FlowBranchGroup,
  NodeConfig,
  OutputAdvanced,
  TaskConfig,
} from '../views/FlowCanvas/flowModel'

/** 通用分页返回 */
export interface Paged<T> {
  total: number
  list: T[]
}

/** 通用分页查询入参 */
export interface PageQuery {
  page?: number
  size?: number
  [key: string]: unknown
}

/** 任务/节点运行状态：L 处理中 / C 完成 / E 出错 */
export type RunState = 'L' | 'C' | 'E'

/** 源 Source — 源列表行与详情抽屉字段（实测） */
export interface Source {
  sourceId: string
  name: string
  url: string
  configId: string
  configId2?: string
  configId3?: string
  mainTable: string // 主表
  owner: string // 责任人
  category?: string // 大类
  categoryPath?: string // 目录路径
  tags?: string[]
  priority?: number
  disabled?: boolean // 是否停用；省略视为启用
  state: RunState | string // 出错 / 成功 等
  lastTaskAt?: string // 上次任务
  lastSuccessAt?: string // 上次成功
  dataCount?: number // 数据
  newInCount?: number // 新入
  successCount?: number // 成功
  remark?: string // 备注
  cycle?: string // 采集周期：实时 / 每日 / 每周 / 每月
  alarm?: boolean // 是否告警
  externalChanged?: boolean // 外部变更待确认（最后修改人 / 同步时间不一致）
  lastModifiedBy?: string // 最后修改人
  syncedAt?: string // 最近同步时间
  version?: number // 乐观锁版本号（并行操作校验）
  domain?: string // 域
  subCategory?: string // 子类别
  resume?: boolean // 断点续传
  coreParam?: string // 核心参数
  lastUrl?: string // 上次 URL
  dirId?: string // 目录 ID
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.credentialRef */
  credentialRef?: string // 登录凭据引用（CredentialRef.refId，不存明文）
  updatedAt?: string // 更新时间
  color?: string // 颜色标识
  freqTag?: string // 频率标识：日度 / 周度 / 月度 / 旬度 / 季度 / 单次
  verified?: 'normal' | 'abnormal' | 'none' // 人工核验状态
  // ---- 网站—子源父子模型（0707 优化·Phase2）：网站=流程模板+批量工具（不运行），子源=运行实体 ----
  siteId?: string // 所属网站；未分组的历史/草稿源可为空
  detached?: boolean // 子源流程已脱离网站统一模板（保存过自定义流程）；网站同步覆盖后重置为 false
  // ---- 源级配置（0706 优化·源/节点配置分层）：整条流程共享，编辑入口 = 源信息头编辑抽屉 / 新建源第一步 ----
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.useProxy */
  useProxy?: boolean // 是否使用代理
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.needLogin */
  needLogin?: boolean // 是否要求登陆（与 credentialRef 解耦：可先开关，后续再绑凭据）
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.loginUrl */
  loginUrl?: string // 登陆 URL
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.account */
  account?: string // 登陆用户名
  configMode?: 'new' | 'existing' // 选用配置：新建 / 使用已有
  configName?: string // 新建配置名称（configMode='new' 时）
  configTopic?: string // 新建配置 Topic（队列 fallback 提示用）
  configStrategy?: string // 新建配置运行策略：增量/全量/按需触发
  /** @deprecated 历史调度字段；读取流程时迁入首节点 TaskConfig，不再新写入。 */
  scheduleType?: string
  scheduleTime?: string
  weekdays?: number[]
  cron?: string
  // ---- 流程模板绑定（0714 会议 Task 5）：模板提供完整默认配置，子源保存自己的同节点覆盖。 ----
  templateId?: string
  templateVersion?: number
  nodeBindings?: Record<string, FlowTemplateNodeBinding>
}

/** 模板内一个稳定节点对应的子源覆盖配置；未覆盖时使用模板默认值。 */
export interface FlowTemplateNodeBinding {
  collect?: Partial<Pick<CollectConfig,
    | 'url'
    | 'outputTable'
    | 'inputTable'
    | 'entryCondition'
    | 'inputParams'
    | 'urlParamRefs'
    | 'urlParamValues'
    | 'useProxy'
    | 'resume'
    | 'needLogin'
    | 'loginUrl'
    | 'account'
    | 'credentialRef'
    | 'scheduleType'
    | 'scheduleTime'
    | 'weekdays'
    | 'cron'
  >>
  outputTable?: string
  inputTable?: string
  entryCondition?: ConditionGroup
  task?: TaskConfig
  outputAdvanced?: OutputAdvanced
}

/** 模板结构：稳定节点 ID、完整节点默认配置、顺序与连线。 */
export interface FlowTemplateDefinition {
  main: string[]
  branches: BranchSeed[]
  configs: Record<string, NodeConfig>
  branchGroups?: FlowBranchGroup[]
}

export interface FlowTemplate {
  id: string
  name: string
  version: number
  definition: FlowTemplateDefinition
  updatedAt: string
}

export interface FlowTemplateSaveInput {
  id?: string
  name: string
  definition: FlowTemplateDefinition
}

/** 网站 Site（0707 优化·Phase2）：父级，统一流程模板 + 批量工具，本身不实际采集运行；下辖多个子源（Source.siteId） */
export interface Site {
  siteId: string
  name: string
  category: string
  categoryPath?: string
  dirId?: string
  tags?: string[]
  owner: string
  sourceCount: number // 子源数（含站内所有子源，聚合统计）
  errorCount: number // 子源中出错（state='E'）的数量，供卡片红点 / 状态筛选
  updatedAt?: string
  // ---- 站级聚合展示字段（0707 采集资产表格样式：网站行直接带列值，均从子源聚合派生） ----
  dataCount?: number // 子源数据量合计
  cycle?: string // 子源中最常见的采集周期
  lastTaskAt?: string // 子源最近任务时间（同步状态列的时间戳）
}

/** 配置 Config(configId) */
export interface Config {
  configId: string
  name: string
  topic?: string // 主题(队列)
  policy?: string // 运行策略
  sourceId?: string
  enabled: boolean
  sourceCount?: number // 绑定源数
  paramRefs?: string[] // 绑定参数
  isDetail?: boolean // 详情类配置
  isLogin?: boolean // 登陆类配置
  owner?: string
  updatedAt?: string
}

/** 实体/表 EntryType */
export interface EntryType {
  tableId: string
  tableName: string // 如 sense_data.TB_ZFB_COMMENT（物理表名）
  name?: string // 表显示名（业务名）
  remark?: string // 备注
  fields: EntryField[]
  rowCount?: number
  sourceId?: string
  owner?: string
  updatedAt?: string
}

export interface EntryField {
  prop: string // 属性(api json key)，如 feed_id-K1
  desc: string // 中文描述
  type: 'string' | 'text' | 'longtext' | 'url' | 'number' | 'date' | 'json'
  required: boolean
  width?: number
  preprocess?: string // 预处理清洗函数
  dedup?: boolean // 去重列
}

/** 参数来源类型：与原系统参数列表一致。 */
export type ParamKind = 'list' | 'date' | 'sequence' | 'date_sequence' | 'database'

/** 参数定义：全局管理，节点只保存 paramId 绑定关系。 */
export interface Param {
  paramId: string
  name: string
  group?: string
  kind: ParamKind
  values?: string[] // 列表或数据库预览值
  defaultValue?: string
  dateExpr?: string // $CUR_DATE,偏移,格式
  seq?: { start: number; end: number; step: number }
  databaseQuery?: string
  usedBy?: number // 被多少配置引用
  owner?: string
  updatedAt?: string
}

export type ParamInput = Omit<Param, 'paramId' | 'usedBy' | 'updatedAt'> & { paramId?: string }

/** 原始文件（0711 R11：文件视图，仅子源态展示——"文件视图只有源才有"） */
export interface RawFile {
  fileId: string
  siteId: string
  sourceId: string
  nodeId: string
  fileName: string
  contentType: string
  size: number
  md5?: string
  attributes?: Record<string, unknown>
  createdAt: string
  viewUrl?: string
  downloadUrl?: string
}

export interface RawFileQuery extends PageQuery {
  siteId: string
  sourceId?: string
  nodeId?: string
  contentType?: string
  dateFrom?: string
  dateTo?: string
}

export interface RawFileStats {
  total: number
  totalSize: number
  latestCreatedAt?: string
}

export interface SourceCloneRequest {
  templateSourceId: string
  targetSiteId: string
  target: { name: string; url: string }
}

export interface SourceCloneResult {
  source: Source
  flowId: string
  tableIdMap: Record<string, string>
}

/** 节点粒度运行统计（0706 Phase4·任务视图=运行视图，0707 Phase5 起该形态退役，仅内部聚合用） */
export interface NodeRunStat {
  nodeId: string
  queue?: string // 队列归属（后端口径；前端本地 taskCfg.queue 优先）
  totalTasks: number // 总任务数
  processedTasks: number // 已处理数
  state?: RunState // 运行状态；缺省视为空闲
}

/** 队列粒度运行统计（0707 优化·Phase5·任务视图网站化）：网站下全部子源节点按队列去重聚合 */
export interface QueueStat {
  queue: string
  totalTasks: number
  processedTasks: number
  state?: RunState // 队列内任一 E → E；任一 L → L；否则有任务视为 C，无任务缺省
}

/** 子步骤 Step（item/next）— 连线详情字段 */
export interface Step {
  stepId: string
  applySource?: string // 适用源，-1 表示该配置所有源
  sourceId: string
  name: string
  inputTable?: string // 步骤输入表
  outputTable?: string // 步骤输出表
  configId?: string // 本步骤使用配置
  urlSourceField?: string // 任务 URL 来源字段
  urlRule?: string // 任务 URL 规则
  condition?: string // 步骤执行条件（函数表达式）
  failAction?: string // 失败动作
  contextMap?: string[] // 上下文来源
  outColumns?: string[] // 出参列
  enabled: boolean
}

/** 任务实例 Task */
export interface Task {
  taskId: string
  sourceId: string
  state: RunState
  startedAt?: string
  finishedAt?: string
  error?: string
}

/** 运行索引 RunIndex（采集配置中心服务层自有） */
export interface RunIndex {
  runId: string
  flowId: string
  startedAt: string
  state: RunState
}

/** 源分类目录树节点（多级，带计数）— 采集资产左侧目录 */
export interface SourceCategory {
  id: string // 分类路径，如 /基金类 或 /基金类/支付宝评论；'' 表示全部
  name: string
  count: number // 该分类直属 + 子级源总数
  children?: SourceCategory[]
}

/** 写类操作通用回执（mock：仅 ack，不落库） */
export interface Ack {
  ok: boolean
  demo?: boolean // 演示环境占位：未真正执行写操作
  message?: string
}

/* ---------------- M3 规则资产 ---------------- */

/** 规则组（规则包）— 按阶段聚合表达式 */
export interface RuleGroup {
  id: string
  name: string
  stage: string // 阶段：清洗 / 校验 / 打标 / 过滤
  count: number
}

export type RuleState = 'draft' | 'published' | 'deprecated'

/** 发布门禁三项 */
export interface RuleGate {
  syntax: 'pass' | 'fail'
  reference: 'pass' | 'warn' | 'fail'
  batchTest: 'pass' | 'fail' | 'pending' // pending = evaluate 待接口 / 未跑
}

/** 规则（表达式） */
export interface Rule {
  ruleId: string
  name: string
  groupId: string
  stage: string
  expr: string
  sharedConfigs?: string[] // 依赖的共享配置
  refCount: number
  refBy?: string[] // 被哪些流程 / 节点引用
  version: string
  state: RuleState
  gate: RuleGate
  owner: string
  updatedAt: string
}

/** 共享配置（规则间复用的常量 / 字典） */
export interface SharedConfig {
  id: string
  name: string
  desc?: string
}

/** 测试集样本 */
export interface RuleTestCase {
  caseId: string
  name: string
  context: Record<string, unknown>
  expected: string
  lastResult: 'pass' | 'fail' | 'pending'
  blocking: boolean // 是否阻断发布
}

/** 函数测试器求值结果 */
export interface EvalResult {
  ok: boolean
  value?: string
  branch?: string // 命中分支（IF-ELSE）
  trace?: string[] // 求值步骤
  error?: string
}

/** 规则编排列表项（规则引擎 rule-orchestration） */
export interface RuleOrchestrationItem {
  ruleId: string
  name: string
  describe: string
  script: string
  scriptPath: string
  enabled: boolean
  createdAt: string
}

/** 规则处理节点绑定的编排配置 */
export interface RuleOrchestration {
  mode: 'ref' | 'new'
  ruleId?: string
  name?: string
  describe: string
  systemPrompt?: string
  script?: string
  scriptPath?: string
  enabled?: boolean
}

export interface RuleOrchestrationGenerateResult {
  script: string
  scriptPath: string
}

export interface RuleOrchestrationTestResult {
  success: boolean
  result?: Record<string, unknown>
  error?: string
  executionTime: number
}

export interface RuleOrchestrationSaveResult {
  ruleId: string
  scriptPath: string
  message?: string
}

/* ---------------- M4 指标中心 ---------------- */

/** 指标数据集（dataset 层） */
export interface Dataset {
  datasetId: string
  name: string
  sourceTable: string // 来源表
  fields: string[] // 字段范围
  updatedAt: string
  state: 'ready' | 'stale' | 'building'
}

/** 指标定义（measure 层） */
export interface Measure {
  measureId: string
  name: string
  datasetId: string
  caliber: string // 口径
  cycle: string // 周期
  owner: string
  canvasRefs: number // 画布引用次数
  gate: 'pass' | 'warn' | 'fail' // 发布门禁
}

/* ---------------- M4 数据查看 ---------------- */

export interface DataTableMeta {
  tableId: string
  tableName: string
  rowCount: number
  fields: { prop: string; type: string; desc: string; sample?: string }[]
}

export interface DataRow {
  dataId: string
  title: string // 标题 / 文件
  summary: string // 字段摘要
  sourceId: string
  configId?: string
  taskId?: string
  runId?: string
  acceptState: 'accepted' | 'pending' | 'rejected' // 验收状态
  fileType?: 'html' | 'pdf' | 'json' | '-'
  parseState?: 'parsed' | 'failed' | 'none'
  parentId?: string // 父数据 ID（详情解析等子步骤反推列表）
  state?: string // 处理状态：C 完成 / E 出错 / L 处理中
  values?: Record<string, unknown> // 动态列值（按表 schema 的 fields[].prop 索引）
}

/** 结果视图查询入参 */
export interface RowQuery extends PageQuery {
  tableId: string
  sourceId?: string
  /** 网站粒度查询（0707 优化·Phase5）：圈定该网站下全部子源；与 sourceId 同传时 sourceId 在此范围内进一步收窄 */
  siteId?: string
  dataId?: string
  parentId?: string
  state?: string
  sql?: string
}

/* ---------------- M4 运行记录 ---------------- */

export interface RunRow {
  runId: string
  flow: string
  state: RunState
  startedAt: string
  finishedAt?: string
  owner: string
  ruleHits?: number
}

export interface RunNode {
  nodeId: string
  name: string
  state: RunState
  input?: string
  output?: string
  failAction?: string
  extTaskId?: string
  extTraceId?: string
}

/* ---------------- M4 监控工具 ---------------- */

export interface HealthCard {
  key: string
  name: string // 执行器(青龙) / 规则引擎网关 / MQ / 函数工具
  status: 'ok' | 'warn' | 'down'
  detail: string
}

export interface MqQueue {
  name: string
  pending: number // 积压
  failed: number
  state: 'ok' | 'warn' | 'err'
}

export interface SyncRow {
  client: string
  status: string
  diff: number // 差异条数
  externalChanged: boolean
}

export interface AlarmRow {
  alarmId: string
  level: 'fail' | 'block' | 'recover'
  text: string
  at: string
}

/* ---------------- M5 凭据 / 日志 / 任务实例 ---------------- */

/** 登录凭据引用 — 只存引用与脱敏信息，不存明文密码 */
export interface CredentialRef {
  refId: string
  name: string
  loginUrl?: string
  account?: string // 脱敏展示（如 dev_***）
  hasSecret: boolean // 仅标记是否已配置密码
}

/** 源操作日志 */
export interface SourceLog {
  logId: string
  sourceId: string
  action: string
  result: string
  remark?: string
  at: string
}

/** 任务实例（运行记录事实源之一） */
export interface TaskInst {
  taskId: string
  state: RunState
  typeName: string // 类型名，如 浏览器抓取
  taskName: string
  sourceId: string
  configId?: string
  node?: string // 执行节点
  topic?: string // 主题
  parentId?: string
  updatedAt: string
}

/** 子源任务视图查询：默认收窄当前子源；不传 sourceId 时查询网站下全部子源。 */
export interface SourceTaskQuery extends PageQuery {
  siteId: string
  sourceId?: string
  nodeId?: string
  state?: RunState
}

/** 工作台摘要项（首页摘要条） */
export interface WorkbenchSummary {
  label: string
  title?: string
  value?: string
  hint: string
  tone: string
}

/* ---------------- 采集资产总览（首页驾驶舱） ---------------- */

/** 总览 KPI —— 采集资产四类口径 + 运行 / 告警纳入 */
export interface OverviewKpi {
  sources: number // 采集源总数
  configs: number // 采集配置数
  tables: number // 实体表数
  params: number // 参数数
  successRate: string // 综合成功率，如 '98.6%'
  errorSources: number // 异常源数
  runningRuns: number // 运行中链路（纳入运行）
  alarms: number // 未恢复告警（纳入告警）
  newAssets7: number // 近 7 日新增资产
}

/** 占比 / 分布通用切片（环形、柱状共用） */
export interface OverviewSlice {
  label: string
  value: number
  tone?: 'primary' | 'cyan' | 'indigo' | 'amber' | 'ok' | 'err' | 'muted'
}

/** 重点采集源行 */
export interface OverviewTopSource {
  sourceId: string
  name: string
  category: string
  state: RunState | string
  dataCount: number
  lastSuccessAt?: string
}

/** 异常 / 待确认条目（可下钻到采集资产源列表） */
export interface OverviewException {
  sourceId: string
  name: string
  kind: 'error' | 'external' | 'disabled' | 'alarm'
  text: string
  at?: string
}

/** 采集网站全景节点 —— 与采集资产分类树使用同一 categoryPath 口径 */
export interface OverviewPanoramaNode {
  id: string
  label: string
  total: number // 网站数
  sourceCount: number // 网站下子源数
  error: number // 含异常子源的网站数
}

/** 一级分类节点，children 为当前分类树的二级分支 */
export interface OverviewPanoramaBranch extends OverviewPanoramaNode {
  children: OverviewPanoramaNode[]
}

/** 采集网站全景聚合 */
export interface OverviewPanorama {
  total: number // 网站总数
  sourceCount: number // 子源总数
  error: number // 异常网站数
  unclassified: number // 未进入任何一级分类的网站数
  branches: OverviewPanoramaBranch[]
}

/** 总览聚合返回（一次拉全，减少首屏请求） */
export interface OverviewSummary {
  kpi: OverviewKpi
  ecosystem: { sources: number; configs: number; tables: number; params: number }
  panorama: OverviewPanorama
  byCategory: OverviewSlice[] // 资产类型占比
  byCycle: OverviewSlice[] // 采集周期分布
  byState: OverviewSlice[] // 运行状态分布
  topSources: OverviewTopSource[]
  exceptions: OverviewException[]
  updatedAt: string // 总览更新时间
}

/** 采集任务趋势点 */
export interface TrendPoint {
  date: string // MM-DD
  snatch: number // 抓取量
  success: number // 成功量
}
