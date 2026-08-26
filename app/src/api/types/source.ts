// 源 + 网站 + 模板域（P1-3 拆 8 域 · source 域）
// 包含 Source（源）/ Site（网站）/ Step（连线步骤）/ Task（任务实例）/
//       SourceCategory（分类目录树）/ SourceCloneRequest/Result（克隆）/
//       SourceLog（源日志）/ SourceTaskQuery（任务视图查询）/
//       CredentialRef（凭据引用）/ FlowTemplateNodeBinding/Definition/FlowTemplate/SaveInput（流程模板 4 件）/
//       FileResourceRecord/Query（file_resource 文件资源 2 件）
// 跨域被引用：data.DataRow.sourceId (string, 不是类型), overview.OverviewKpi.sources (number)
// 跨域引用：
//   - PageQuery (FileResourceQuery/SourceTaskQuery extends PageQuery)
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
  /** 依赖的前置步骤 ID（旧 lastStep）；只用于拓扑排序，不是任务上下文字段。
   *  2026-08-26 生产实测（源 430016821）：lastStep 是单个步骤 itemConfig 值（如 "40597"），
   *  真实的上下文来源另在 context 字段（如 "K2,K17"），此前误把 lastStep 当成上下文来源用。 */
  dependsOn?: string[]
  contextMap?: string[] // 上下文来源（旧 context 字段，K{n} 字段代号列表）
  outColumns?: string[] // 出参列（旧 outContext 字段）
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

/**
 * `file_resource` 表的一行记录（旧 `entryDataPaged` 结果的最小系统字段 + K1～K15 动态列）。
 * K1～K15 的具体含义由 `tableMeta` 返回的字段定义决定，不能在 API 层假设固定逻辑字段名。
 */
export interface FileResourceRecord {
  dataId: string
  sourceId: string
  state?: string
  createDt?: string
  updateDt?: string
  fileId?: string
  /**
   * 产出该文件的采集配置 ID（旧行的 CONFIG_ID）。
   * 它对应源子步骤的 `Step.configId`，可经此反查到具体流程节点——注意不是节点 ID 本身，
   * 节点 ID 用的是 `Step.stepId`（旧字段 itemConfig）。2026-08-22 生产实测见 FileView 说明。
   */
  configId?: string
  /** 产出该文件的那条明细记录 ID（旧行的 DETAIL_ID），用于回溯到数据视图对应行。 */
  detailId?: string
  parentId?: string
  categoryId?: string
  seq?: string
  times?: string
  /** K0：原始 JSON ID，非空时可打开 readJson */
  k0?: string
  nextFlag?: string
  values: Record<string, unknown>
}

export interface FileResourceQuery extends PageQuery {
  tableId: string
  sourceId?: string
  state?: string
  /** K1/K6 文件名或展示名模糊查询，由 API 层转成旧端点 more 条件。 */
  fileName?: string
  /** K7 扩展名模糊查询。 */
  ext?: string
  /** 自定义 SQL 条件（如 `K1 IS NULL`），对齐旧平台 FileList2.vue 的同名筛选项，此前迁移时漏做。 */
  sql?: string
  /** 按产出节点筛选：传该节点对应的 `Step.configId`，落到 CONFIG_ID 等值条件。 */
  configId?: string
}

/** @deprecated 仅保留旧演示 mock 的数据形状，业务文件视图已迁移到 FileResourceRecord。 */
export interface RawFile {
  attachId: string
  fileId: string
  state: string
  siteId: string
  sourceId: string
  nodeId: string
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
  contentType: string
  attributes?: Record<string, unknown>
  viewUrl?: string
  downloadUrl?: string
}

/** @deprecated 仅保留旧演示 mock 的查询形状。 */
export interface RawFileQuery extends PageQuery {
  siteId: string
  sourceId?: string
  nodeId?: string
  state?: string
  attachId?: string
  fileId?: string
  ext?: string
}

/** @deprecated 旧 fileStats 没有真实平台契约，仅保留 mock 测试类型。 */
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
