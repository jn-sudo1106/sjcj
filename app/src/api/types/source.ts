// 源 + 网站 + 模板域（P1-3 拆 8 域 · source 域）
// 包含 Source（源）/ Site（网站）/ Step（连线步骤）/ Task（任务实例）/
//       SourceCategory（分类目录树）/ SourceCloneRequest/Result（克隆）/
//       SourceLog（源日志）/ SourceTaskQuery（任务视图查询）/
//       CredentialRef（凭据引用）/ FlowTemplateNodeBinding/Definition/FlowTemplate/SaveInput（流程模板 4 件）/
//       RawFile/Query/Stats（原始文件 3 件）
// 跨域被引用：data.DataRow.sourceId (string, 不是类型), overview.OverviewKpi.sources (number)
// 跨域引用：
//   - PageQuery (RawFileQuery/SourceTaskQuery extends PageQuery)
//   - RunState (Source.state / Task.state)
//   - ConfigParamBinding (Site.params: ConfigParamBinding[])
//   - flowModel 类型（FlowTemplateNodeBinding.collect/entryCondition/task/outputAdvanced,
//                     FlowTemplateDefinition.branches/configs/branchGroups）
//     —— api → view 是 plan §十 已识别的分层倒置，P1-3 暂不解决，保持 import type 不产生运行时依赖
// import type 严格模式

import type { Ack, PageQuery, RunState } from './common'
import type { ConfigParamBinding } from './collect'
import type {
  BranchSeed,
  CollectConfig,
  ConditionGroup,
  FlowBranchGroup,
  NodeConfig,
  OutputAdvanced,
  TaskConfig,
} from '@/views/FlowCanvas/canvas/flowModel'

/** 源 Source — 源列表行与详情抽屉字段（实测） */
export interface Source {
  sourceId: string
  name: string
  url: string
  configId: string
  /** @deprecated 旧平台 snatchSave 请求字段；读取旧源时保留，业务层不再新写。 */
  sourceType?: string | number
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
  /** 旧平台 lastInsert：最近一次新入数据时间。 */
  lastInsertAt?: string
  /** 旧平台 jobCnt/categoryId：详情中保留原有运行摘要口径。 */
  jobCount?: number
  stepCount?: number
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
  // ---- 网站—源父子模型（0707 优化·Phase2）：网站=流程模板+批量工具（不运行），源=运行实体 ----
  siteId?: string // 所属网站；未分组的历史/草稿源可为空
  siteName?: string // 真实源接口直接返回的网站名称；未关联源为空
  detached?: boolean // 源流程已脱离网站统一模板（保存过自定义流程）；网站同步覆盖后重置为 false
  // ---- 源级配置（0706 优化·源/节点配置分层）：整条流程共享，编辑入口 = 源信息头编辑抽屉 / 新建源第一步 ----
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.useProxy */
  useProxy?: boolean // 是否使用代理
  /** @deprecated 旧平台 snatchSave 请求字段，值为 '1' / ''。 */
  proxy?: string
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.needLogin */
  needLogin?: boolean // 是否要求登陆（与 credentialRef 解耦：可先开关，后续再绑凭据）
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.loginUrl */
  loginUrl?: string // 登陆 URL
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.account */
  account?: string // 登陆用户名
  /** @deprecated 旧平台已存在登录模板的 ID；对应 snatchSave.authConfig。 */
  authConfig?: string
  createdAt?: string // 创建日期
  configMode?: 'new' | 'existing' // 选用配置：新建 / 使用已有
  configName?: string // 新建配置名称（configMode='new' 时）
  configTopic?: string // 新建配置 Topic（队列 fallback 提示用）
  configStrategy?: string // 新建配置运行策略：增量/全量/按需触发
  /** @deprecated 历史调度字段；读取流程时迁入首节点 TaskConfig，不再新写入。 */
  scheduleType?: string
  scheduleTime?: string
  weekdays?: number[]
  cron?: string
  // ---- 流程模板绑定（0714 会议 Task 5）：模板提供完整默认配置，源保存自己的同节点覆盖。 ----
  templateId?: string
  templateVersion?: number
  nodeBindings?: Record<string, FlowTemplateNodeBinding>
  // ---- 参数源（0721 会议：加源支持"普通源 / 参数源"两种类型）----
  /** 省略视为 'normal'；'param' 时 baseUrl/urlTemplate/paramRefs 生效，源列表仍只存这 1 条记录，展开为 N 个 URL 在任务层做 */
  kind?: 'normal' | 'param'
  /** 参数源专用：不含占位符的基础地址，如 http://FundComment-2017052400023003000000000013026 */
  baseUrl?: string
  /** 参数源专用：基础url + 拼接符 + $PARAM$_id 占位符序列，可手动编辑覆盖默认生成 */
  urlTemplate?: string
  /** 参数源专用：本源绑定的参数及其分组——分组是"这次用在这个源里"的用法属性，独立于 Param.group（参数定义自带的全局分组），
   *  同 group 值 = 顺序拼（对齐取值，要求同组各参数值数一致）；不同 group / 无 group = 组间笛卡尔积。
   *  分组由 views/FlowCanvas/source/ParamSourceEditor.vue 的分组选择器维护（新建组/选组/取消组），
   *  展开算法见 utils/flow/urlParams.ts 的 ParamGroupRef / joinType() / groupMismatchWarnings()。 */
  paramRefs?: { paramId: string; group?: string | null }[]
}

/** 同站源下拉选项（source/sourceSame，旧口径「[id]名称」，非完整 Source） */
export interface SourceOption {
  sourceId: string
  name: string
}

/** 模板内一个稳定节点对应的源覆盖配置；未覆盖时使用模板默认值。 */
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
    | 'loginConfigs'
    | 'defaultLoginConfigId'
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

/** 网站 Site（0707 优化·Phase2）：父级，统一流程模板 + 批量工具，本身不实际采集运行；下辖多个源（Source.siteId） */
export interface Site {
  siteId: string
  name: string
  category: string
  categoryPath?: string
  dirId?: string
  tags?: string[]
  owner: string
  sourceCount: number // 源数（含站内所有源，聚合统计）
  errorCount: number // 源中出错（state='E'）的数量，供卡片红点 / 状态筛选
  updatedAt?: string
  // ---- 站级聚合展示字段（0707 采集资产表格样式：网站行直接带列值，均从源聚合派生） ----
  dataCount?: number // 源数据量合计
  cycle?: string // 源中最常见的采集周期
  lastTaskAt?: string // 源最近任务时间（同步状态列的时间戳）
  params?: ConfigParamBinding[]
}

/** 旧平台 /v1/site/add 的独立建站请求；不携带源数组。 */
export interface SiteCreateInput {
  siteName: string
  siteDomain?: string
  bizType?: string
  stdSiteName?: string
  categoryId?: number
  seq?: number
  remark?: string
}

/** 独立建站回执；siteId 可能由响应直接返回，也可能需要创建后回查。 */
export interface SiteCreateResult extends Ack {
  siteId?: string
  sourceId?: string
}

/** 网站列表的真实统计摘要（data-view `/v1/site/summary`）。 */
export interface SiteSummary {
  total: number
  sourceTotal: number
  notifyCount: number
  errorCount: number
}

/** 子步骤 Step（item/next）— 连线详情字段 */
export interface Step {
  stepId: string
  applySource?: string // 适用源，-1 表示该配置所有源
  sourceId: string
  name: string
  /** 旧接口若返回节点类型，保留给流程视图选择节点模板；缺失时由名称/位置兼容推断。 */
  nodeType?: string
  inputTable?: string // 步骤输入表
  outputTable?: string // 步骤输出表
  configId?: string // 本步骤使用配置
  /** @deprecated 0804 拍板：任务 URL 来源字段已从 UI 删除，仅供历史流程回读，见开发方案 §2.3 */
  urlSourceField?: string
  /** @deprecated 同上，任务 URL 规则已从 UI 删除 */
  urlRule?: string
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

/** 原始文件（0711 R11 落地；0812 计划 M3-1 对齐旧平台 `page/inst/FileList.vue`/`/v1/filePaged`
 *  字段 1:1）。`attachId` 才是主键，`fileId` 是"批次ID"——此前误把 `fileId` 当主键用，
 *  2026-08-15 按旧平台改正。`nodeId`/`contentType`/`viewUrl`/`downloadUrl` 是新平台专属
 *  （流程节点归属 + 站内安全预览，旧平台没有这些概念），其余字段名直接沿用旧平台。 */
export interface RawFile {
  attachId: string
  fileId: string // 批次ID（不是主键）
  state: string // C 初始 / AC 被消重（旧平台口径；具体取值范围待后端确认，见计划文档 Q5）
  siteId: string
  sourceId: string
  nodeId: string // 新平台专属：按流程节点归属
  realName: string
  storePath?: string
  fileSize: number
  ip?: string
  encode?: string
  downUrl?: string
  createDt: string
  parentId?: string
  md5?: string
  taskId?: string
  remarks?: string
  contentType: string // 新平台专属：用于预览类型判断
  attributes?: Record<string, unknown>
  viewUrl?: string // 新平台专属：站内安全预览（M3-5）
  downloadUrl?: string // 新平台专属：下载链接
}

export interface RawFileQuery extends PageQuery {
  siteId: string
  sourceId?: string
  nodeId?: string // 新平台专属：按流程节点筛选
  state?: string
  attachId?: string
  fileId?: string
  ext?: string
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

/** 旧平台 /v1/snatch/snatchSave 的完整新建源请求字段。字段名按旧 Step1/2/3 原样保留。 */
export interface LegacySnatchSaveRequest {
  sourceType?: string | number
  sourceUrl: string
  sourceName: string
  categoryId?: string
  proxy?: string
  keep?: string
  cron?: string
  tags?: string
  newConfig: '0' | '1'
  configId?: string
  isMulti: string
  loginTemplete: string
  entryTypeId?: string
  params: { paramId: string }[]
  reqLogin: '0' | '1'
  newLoginConfig?: '0' | '1'
  authConfig?: string
  loginUrl?: string
  loginName?: string
  /** 仅允许由提交动作临时传入，不进入 FlowDef。 */
  loginPwd?: string
}

/** 旧平台登录提交的临时敏感字段，不随流程快照保存。 */
export interface LegacyLoginSubmission {
  /** 从多条 loginConfigs 中指定本次提交到旧平台的那一条。 */
  configId?: string
  newLoginConfig: '0' | '1'
  authConfig?: string
  loginPwd?: string
}

export interface LegacySnatchSaveResult extends Ack {
  sourceId?: string
}

/** 源分类目录树节点（多级，计数仅在后端返回时展示）— 采集资产左侧目录 */
export interface SourceCategory {
  id: string // 分类路径，如 /基金类 或 /基金类/支付宝评论；'' 表示全部
  name: string
  count?: number // 该分类直属 + 子级源总数；未返回时不以 0 代替
  children?: SourceCategory[]
}

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

/** 源任务视图查询：默认收窄当前源；不传 sourceId 时查询网站下全部源。 */
export interface SourceTaskQuery extends PageQuery {
  siteId: string
  sourceId?: string
  nodeId?: string
  state?: RunState
}
