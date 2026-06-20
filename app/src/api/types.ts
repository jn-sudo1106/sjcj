// 领域模型 — 按 docs/数据中心现有功能逆向工程 + 源列表实测字段建模。
// mock 与未来真实 BFF 共用此类型；字段名尽量对齐数据采集平台原始口径。

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
  credentialRef?: string // 登录凭据引用（CredentialRef.refId，不存明文）
  updatedAt?: string // 更新时间
  color?: string // 颜色标识
  freqTag?: string // 频率标识：日度 / 周度 / 月度 / 旬度 / 季度 / 单次
  verified?: 'normal' | 'abnormal' | 'none' // 人工核验状态
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
  tableName: string // 如 sense_data.TB_ZFB_COMMENT
  fields: EntryField[]
  rowCount?: number
  sourceId?: string
  owner?: string
  updatedAt?: string
}

export interface EntryField {
  prop: string // 属性(api json key)，如 feed_id-K1
  desc: string // 中文描述
  type: 'string' | 'text' | 'longtext' | 'url'
  required: boolean
  width?: number
  preprocess?: string // 预处理清洗函数
  dedup?: boolean // 去重列
}

/** 参数 Parameter — 三类：列表 / 动态日期 / 序列 */
export interface Param {
  paramId: string
  name: string
  kind: 'list' | 'date' | 'sequence'
  values?: string[] // 列表
  dateExpr?: string // $CUR_DATA,偏移,格式
  seq?: { start: number; end: number; step: number }
  usedBy?: number // 被多少配置引用
  owner?: string
  updatedAt?: string
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

/** 工作台摘要项（首页摘要条） */
export interface WorkbenchSummary {
  label: string
  title?: string
  value?: string
  hint: string
  tone: string
}
