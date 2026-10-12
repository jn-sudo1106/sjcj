// 源 + 网站 + 模板域（P1-3 拆 8 域 · source 域）
// 包含 Source（源）/ Site（网站）/ Step（连线步骤）/ Task（任务实例）/
//       SourceCategory（分类目录树）/ CopySourceInput（复制源）/ SourceCloneRequest/Result（克隆）/
//       SourceLog（源日志）/ SourceTaskQuery（任务视图查询）/
//       CredentialRef（凭据引用）/ FlowNodeBinding/FlowDefinition/FlowRecord/FlowSaveInput（流程 4 件）/
//       FileResourceRecord/Query（file_resource 文件资源 2 件）
// 跨域被引用：data.DataRow.sourceId (string, 不是类型), overview.OverviewKpi.sources (number)
// 跨域引用：
//   - PageQuery (FileResourceQuery/SourceTaskQuery extends PageQuery)
//   - RunState (Source.state / Task.state)
//   - ConfigParamBinding (Site.params: ConfigParamBinding[])
//   - flowModel 类型（FlowNodeBinding.collect/entryCondition/task/outputAdvanced,
//                     FlowDefinition.branches/configs/branchGroups）
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
  /** 该源关联的流程（旧 `cs_source.FLOW_ID`）。**执行时后端按 FLOW_ID 反查配置后执行**
   *  （0903 H1 答复），所以这个字段决定这个源实际跑哪一套配置。
   *  2026-09-04 实测：`sourcePaged` 与 `sourceDetail` 都已返回（sourceDetail 是后端本次新加的）。
   *  1008-01：217 起后端改返回 `defaultFlowId`，适配器 `sourceFromLegacy` 把它映射进这里（老后端仍读 flowId），
   *  所以界面继续读 `flowId` 即可，不用关心后端用的是哪个字段名。 */
  flowId?: string
  /** 后端当前生效的默认流程（只读，217 起返回；组内源取来源组的默认流程）。展示 / 判断「有没有流程」读 `flowId`；
   *  这个字段原样保留，给来源组、多流程相关功能（1008-02 起）直接用。 */
  defaultFlowId?: string
  /** 所属来源组 ID（只读）；未入组为 undefined。入组的源统一使用组的流程，不能单独改绑。 */
  sourceGroupId?: string
  /** 当前源的主流程。多流程页面中 flowId 表示正在查看/编辑的流程，primaryFlowId 仍指向实际执行入口。 */
  primaryFlowId?: string
  /** 多流程模型中的稳定流程 ID；flowId 是当前查看的发布副本或草稿工作副本 ID。 */
  activeWorkflowId?: string
  primaryWorkflowId?: string
  workflowVersionStatus?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  workflowVersionNo?: number
  /** false 表示后端版本接口尚未部署，继续使用旧 flowId 编辑语义，不启用发布版只读锁。 */
  workflowVersionManaged?: boolean
  publishedFlowId?: string
  draftFlowId?: string
  /** 源所属流程的真实 ROOT 步骤 ID（只读，后端源列表/详情返回；新平台 ROOT 权威方案下
   *  首任务配置挂在 cs_item_config(IS_ROOT=1) 行上，cs_source.CONFIG_ID 已退出执行语义）。 */
  rootId?: string
  /** 源所属流程 ROOT 当前使用的配置 ID（只读，同 rootId 一起返回；空 = 草稿 ROOT 未选配置）。 */
  rootConfigId?: string
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
  /**
   * @deprecated 真实后端 source/sourcePaged 不返回「新入/成功」计数（Source 实体只有 dataCnt/jobCnt/alarmCnt
   * 和 lastInsert/lastSuccess 时间，见 设计稿/source-api.md）。旧平台的「新入/成功」列是 lastInsert/lastSuccess
   * 的相对时间——UI 已改用 lastInsertAt/lastSuccessAt + timeAgo()。这两个字段目前只有 mock 在填，勿再据此加展示。
   */
  newInCount?: number
  /** @deprecated 见 newInCount。 */
  successCount?: number
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
  /** @deprecated 旧平台 snatchSave 请求字段，复选框数组：`['1']` / `[]`（见 LegacySnatchSaveRequest.proxy）。 */
  proxy?: string[]
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.needLogin */
  needLogin?: boolean // 是否要求登陆（与 credentialRef 解耦：可先开关，后续再绑凭据）
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.loginUrl */
  loginUrl?: string // 登陆 URL
  /** @deprecated 节点级缺省值；已双轨至 CollectConfig.account */
  account?: string // 登陆用户名
  /** @deprecated 旧平台已存在登录模板的 ID；对应 snatchSave.authConfig。 */
  authConfig?: string
  createdAt?: string // 创建日期
  configMode?: 'new' | 'existing' // 选用配置：新建 / 使用已有。0824 起只读历史，新流程不得新写。
  configName?: string // 新建配置名称（configMode='new' 时）。0824 起只读历史。
  configTopic?: string // 新建配置 Topic（队列 fallback 提示用）。0824 起只读历史。
  configStrategy?: string // 新建配置运行策略：增量/全量/按需触发。0824 起只读历史。
  /** @deprecated 历史调度字段；读取流程时迁入首节点 TaskConfig，不再新写入。 */
  scheduleType?: string
  scheduleTime?: string
  weekdays?: number[]
  cron?: string
  // ---- 流程绑定：流程提供完整默认配置，源保存自己的同节点覆盖。 ----
  templateId?: string
  templateVersion?: number
  nodeBindings?: Record<string, FlowNodeBinding>
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

export type WorkflowBindingRole = 'MAIN' | 'BACKFILL' | 'AUX'
export type WorkflowVersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

/** 源（或其 SourceGroup）与流程的有效绑定。inherited=true 表示本行继承自 SourceGroup。 */
export interface WorkflowBinding {
  id: string
  bindType: 'SOURCE_GROUP' | 'SOURCE'
  bindId: string
  workflowId: string
  workflowVersionId?: string
  workflowCode: string
  workflowName: string
  description?: string
  versionNo?: number
  /** 当前已发布版本；没有值表示流程尚未发布。 */
  publishedVersionId?: string
  publishedVersionNo?: number
  publishedFlowId?: string
  /** 当前可编辑草稿；草稿使用独立 cs_flow 工作副本，不影响 publishedFlowId。 */
  draftVersionId?: string
  draftVersionNo?: number
  draftFlowId?: string
  versionStatus: WorkflowVersionStatus
  workflowStatus: 'ACTIVE' | 'DISABLED'
  /** 是否来自正式 workflow/workflow_version 接口；旧接口兼容行为 false。 */
  versionManaged?: boolean
  followsCurrentVersion: boolean
  role: WorkflowBindingRole
  primary: boolean
  priority: number
  status: 'ACTIVE' | 'DISABLED'
  inherited: boolean
  updatedAt?: string
}

/** 来源组状态（source-group/*，bee-config SourceGroupController） */
export type SourceGroupState = 'ACTIVE' | 'DISABLED'

/** 后端「来源组」：配置相同的源归一组，组绑定流程，成员继承（与 leo 的本地分组 sourceGroups.ts 是两个概念）。 */
export interface SourceGroup {
  sourceGroupId: string
  sourceGroupCode: string
  sourceGroupName: string
  description?: string
  state: SourceGroupState
  authGroupId?: number
  /** 当前可用默认；组停用时为空 */
  defaultFlowId?: string
  /** 启用中的绑定流程 */
  flowIds: string[]
  revision: number
  updatedAt?: string
}

/** 按筛选范围批量调整来源组成员的结果（source-group/changeMembersByRange）。 */
export interface MembershipRangeResult {
  total: number
  joined: number
  moved: number
  left: number
  unchanged: number
}

/** 来源 / 来源组的一条流程绑定原始行（source-group/sourceFlows 的 bindings，含停用行）。 */
export interface SourceFlowBind {
  id: string
  sourceId?: string
  /** 有值表示这条是来源组的统一绑定（入组的源读到的是组的行） */
  sourceGroupId?: string
  flowId: string
  isDefault: boolean
  state: SourceGroupState
  revision: number
  updatedAt?: string
}

/** source-group/sourceFlows 的返回：生效列表、默认流程和原始绑定行（保存时据此做并发快照）。 */
export interface SourceFlowsView {
  sourceId?: string
  /** 按 sourceId 查时，源已入组则非空——此时 flowIds 是组的统一流程，源不能单独改 */
  sourceGroupId?: string
  /** 生效（启用中）的流程 ID */
  flowIds: string[]
  defaultFlowId?: string
  bindings: SourceFlowBind[]
}

/** 同站源下拉选项（source/sourceSame，旧口径「[id]名称」，非完整 Source） */
export interface SourceOption {
  sourceId: string
  name: string
}

/** 流程内一个稳定节点对应的源覆盖配置；未覆盖时使用流程默认值。 */
export interface FlowNodeBinding {
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

/** 流程结构：稳定节点 ID、完整节点默认配置、顺序与连线。 */
export interface FlowDefinition {
  main: string[]
  branches: BranchSeed[]
  configs: Record<string, NodeConfig>
  branchGroups?: FlowBranchGroup[]
}

/**
 * 流程中心使用的正式前端 DTO。2026-09-02 起对接真实 `cs_flow`（/v1/flow/*）。
 *
 * `version` 是**可缺省**的：0818 配合事项 B4 要求的流程版本化（历史版本 / 回滚 / 指定版本下发 /
 * 记录版本号 / 查版本落后的源）后端最终没有实现——`cs_flow` 没有 version 列，`flowDetail` 也没有
 * version 入参，旧平台流程管理页同样全页无版本概念。真实流程读回来就是没有版本号，这里不造一个
 * 假的 1 顶上；本地 mock 模板仍带版本，两边共用同一个类型，所以设成可选。
 * 展示处一律 `version ? 'v' + version : ''`，不要输出 `vundefined`。
 */
export interface FlowRecord {
  id: string
  name: string
  version?: number
  definition: FlowDefinition
  updatedAt: string
  /** 关联源数量（后端计算列，口径 cs_source.IS_DELETE >= 0，含禁用源）；mock 不提供 */
  sourceCnt?: number
  /** 是不是流程模板（旧 `templateFlag` 0/1）。**模板是流程的一个属性，不是另一类对象**——
   *  模板与普通流程在同一个列表里，用 `flowPaged.templateFlag` 服务端过滤区分（0903 H24 / H7 答复）。
   *  2026-09-04 实测：传 1 得 0 条、传 0 得 738 条，服务端过滤确实生效。 */
  isTemplate?: boolean
  /** 由哪个模板复制而来（旧 `refFlowId`）。`copyFlow` / `copyTemplateSteps` 会自动回指，
   *  用于反查"谁用了这个模板"（此前只能看 sourceCnt，看不出来源）。 */
  fromTemplateId?: string

  // ---- 0929 F6：启停状态（后端 cs_flow.STATE / IS_DELETE）----
  /** 是否已禁用（旧 `is_delete=1`）。禁用 ≠ 删除：流程仍在列表与有效流程里，
   *  只是不能再作为目标（换绑/套用候选排除）；后端 changeFlowEnable 置 0/1。 */
  disabled?: boolean
  /** 生命周期状态（后端 `state`：'C' 草稿 / 'D' 已删）。'D' 只在 detail 回查时会碰到
   *  （paged 已过滤），保存链路据此识别"流程已被别的端删掉"（F8）。 */
  state?: string

  // ---- 0904 I17（Z7）：分类 / 标签 / 描述。后端 cs_flow 列全都现成，不新开表也不新开端点 ----
  /** 目录分类（旧 `categoryId`）。与源用的是同一套目录（`category/categoryPaged`）。
   *  2026-09-05 实测 200 条流程里只出现过一个值 `9009289`——**存量几乎没分过类**，
   *  所以列表里大多显示 `—` 是正常的，不是没读到。 */
  categoryId?: string
  /** 业务大类（旧 `bizType`）。⚠️ **2026-09-05 实测 200 条流程全为空**，
   *  生产里一个样本都没有，取值集合无从"照抄后端"（0904 Q3 仍未答复）。
   *  所以**不做成枚举下拉**——枚举不自造是 0824-11 §1.2d 定的规矩，
   *  在拿到集合前只读展示、不提供选择。 */
  bizType?: string
  /** 标签（旧 `flowTags`，逗号串）。与源标签同概念。实测存量同样全为空。 */
  flowTags?: string
  /** 流程描述（旧 `flowDesc`）。存量里这个值是后端从源/网站灌进来的，
   *  所以会看到「描述都是网站」——**如实展示，不清洗**（0904 I16-4）。 */
  description?: string
  /** 备注（旧 `remark`）。`copyFlow` 会写「copy from 1400978」这类来源说明。 */
  remark?: string
  /** 创建时间（旧 `createDt`）。列表原来只有更新时间。 */
  createdAt?: string
}

export interface FlowSaveInput {
  id?: string
  name: string
  definition: FlowDefinition
  /** 只在「标记/取消标记为模板」时传；不传则保持后端现值不变 */
  isTemplate?: boolean
  /** 下面几项同理：**只有显式传了才提交**。saveFlow 是全量保存端点，
   *  漏传等于让后端保持原值，传空串才是"清空"。 */
  categoryId?: string
  flowTags?: string
  description?: string
  remark?: string
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
  notifyCount?: number // 开了告警的源数（sitePaged 的 notifyCnt，2026-09-23 起有值）；> 0 即「告警网站」
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
  /** 本次保存成功的全部源 ID（按提交顺序），新建采集据此给整批源绑同一条流程 */
  sourceIds?: string[]
}

/** 网站列表的真实统计摘要（data-view `/v1/site/summary`）。 */
export interface SiteSummary {
  total: number
  sourceTotal: number
  notifyCount: number
  errorCount: number
}

/**
 * 源的定时任务（旧平台「定时列表」，`job/snatchJobPaged`）。
 *
 * ⚠️ 定时**不在** source / config 上：`sourceDetail.schedule` 实测恒为 null
 * （2026-09-18 抽查列表前 20 个源全空），真正的 cron 落在 job 表里。
 */
export interface SourceJob {
  jobId: string
  jobName: string
  sourceId: string
  /** Quartz cron，如 `0 0 16 * * ?` */
  schedule: string
  nextRun?: string
  lastRun?: string
  runCount: number
  successCount: number
  disabled: boolean
}

/** 子步骤 Step（item/next）— 连线详情字段 */
export interface Step {
  stepId: string
  /** 适用源，-1 表示该配置所有源。2026-08-26 核实：这是又一个和 urlSourceField/urlRule 同类
   *  的死字段——nextConfigPaged 的真实响应里从来没有 applySource 这个 key，只有 sourceId；
   *  UI 上"适用源"那一栏显示的其实就是 sourceId 本身。当前代码库里也没有任何地方读
   *  Step.applySource。真正承载"适用源"语义、且需要在写入 payload 里用到的是 sourceId，
   *  不是这个字段。保留字段定义只是不删除历史占位，不要指望它有值。 */
  applySource?: string // 适用源，-1 表示该配置所有源
  sourceId: string
  name: string
  /** 旧接口若返回节点类型，保留给流程视图选择节点模板；缺失时由名称/位置兼容推断。 */
  nodeType?: string
  /** 配置详情中的 configType；用于回读没有明确 nodeType 的规则型节点。 */
  configType?: string
  inputTable?: string // 步骤输入表
  // 步骤输出表（outEntry）。0929 放宽到 null：适配层对「库中 outEntry 为空」的存量行
  // 原样回读 null（legacyAdapters:1089），与「未提交」的 undefined 语义不同——ROOT 行
  // 输出表差异判断（useStepWrite）依赖这个三态。
  outputTable?: string | null
  configId?: string // 本步骤使用配置
  /** @deprecated 0804 拍板：任务 URL 来源字段已从 UI 删除，仅供历史流程回读，见开发方案 §2.3。
   *  2026-08-26 核实：这个字段名从未对上过真实响应（nextConfigPaged 没有 urlSourceField 这个
   *  key），恒为 undefined；"URL 来源字段"的真实语义是 itemId（见下）。此字段留作历史占位，
   *  不要指望它有值。 */
  urlSourceField?: string
  /** @deprecated 同上，任务 URL 规则已从 UI 删除。2026-08-26 核实：同样从未对上真实响应
   *  （没有 urlRule 这个 key），恒为 undefined；真实的"任务URL规则"值在 url 字段（见下）。 */
  urlRule?: string
  /** 任务URL规则（旧 nextConfigPaged.url / stepModify 写入时的 url 字段）。2026-08-26 生产
   *  实测：非首步骤这里是 "$VAL$"（默认从 itemId 指向的字段取值）或字段拼接表达式，如
   *  "K2+'#need_upload_xq/xq/'"；首步骤是该步骤自己的抓取 URL。新平台画布目前统一显示
   *  源的实际 URL，这个真实表达式没有展示位——不要跟上面已废弃的 urlRule 搞混，那个字段
   *  从未生效过，这个才是真值来源。 */
  url?: string
  condition?: string // 步骤执行条件（函数表达式）
  failAction?: string // 失败动作
  /** 该步骤所属源的主配置 ID（旧 mainConfig）。2026-08-26 生产实测：同一源的所有步骤
   *  mainConfig 相同、等于其首步骤自身的 configId，是"一包多 config"映射的关键锚点
   *  （对应 0824-08 的 LegacyConfigMapping）；写接口仍需要它定位配置，保留传递。
   *  0925 起步骤归属整体切到 flowId（见 flowId 字段），mainConfig 不再是归属锚点。 */
  mainConfig?: string
  /** 该步骤所属流程 ID（旧 FLOW_ID，bee-top useFlow）。0925 起步骤归属/保存一律按 flowId：
   *  源视角回读即源归属流程（cs_item_next.FLOW_ID），写 payload 显式携带；老后端不回此字段
   *  时为 undefined，双轨兼容。flowId 与 mainConfig 对存量数据恒等（flowId===configId===mainConfig）。 */
  flowId?: string
  /** 步骤模板编码（旧 flowCode，如 "WEB_SNATCH"）。实测样本中所有步骤取值一致，
   *  尚未见到非 WEB_SNATCH 的样本，无法确认完整枚举，仅做数据保留。 */
  flowCode?: string
  /** 旧步骤 itemId。采集后续步对应「任务URL来源字段」（2026-08-26 实测：itemId=9002 → 字段
   *  K2/URL）；规则处理步骤对应旧表单「规则ID选择」（未选为 -1，与编排脚本 ruleId 不是同一字段）。
   *  仅首步骤（无上游）可能没有这个值；同一 itemId 可能被多个步骤复用（见源 430016516 的
   *  itemConfig 39935/39944 共用 itemId 4103139）。画布规则节点会回填并随 stepModify 写回。 */
  itemId?: string
  /** 旧「扩展名」（旧 extName）。实测样本全部为空，字段存在但含义和触发场景未验证。 */
  extName?: string
  /** 该步骤是不是这个流程的根节点（旧 `IS_ROOT=1`）。
   *  **只有 `nextConfigPaged?flowId=&svg=true` 会返回这一行**——它是 `saveFlow` 新建流程时自动
   *  建的真实 `cs_item_config` 记录（2026-09-04 抽查 5 个流程，每个恰好 1 条）。
   *  `sourceId` 模式没有它，那边的起点是现算的 `itemConfig=0` 套壳行。两者占同一位置：
   *  子步骤的 `lastStep` 在源视角是哨兵 `'0'`，在流程视角被后端改写成这条的真实 ID。 */
  isRoot?: boolean
  /** 依赖的前置步骤 ID（旧 lastStep）；只用于拓扑排序，不是任务上下文字段。
   *  2026-08-26 生产实测（源 430016821）：lastStep 是单个步骤 itemConfig 值（如 "40597"），
   *  真实的上下文来源另在 context 字段（如 "K2,K17"），此前误把 lastStep 当成上下文来源用。 */
  dependsOn?: string[]
  contextMap?: string[] // 上下文来源（旧 context 字段，K{n} 字段代号列表）
  outColumns?: string[] // 出参列（旧 outContext 字段）
  /** 本步骤 configId 对应配置的真实队列（旧 config.topic）。nextConfigPaged 本身不带这个字段，
   *  由 sourceApi.sourceSteps 按 configId 另查 config/configDetail 回填；查不到时留空，
   *  由调用方回退到节点模板默认队列，不能把空值当成"该用默认值"以外的含义。 */
  topic?: string
  /** 本步骤 configId 对应配置是否为登录类（旧 config.templetCode === 'login'），随 topic
   *  一起由 sourceApi.sourceSteps 按 configId 查 config/configDetail 回填。2026-08-26 生产实测
   *  （配置 1400968「baidu-登陆」）：登录步骤的名字未必含"登录"二字（该样本是"登陆"），
   *  也没见到 nextConfigPaged 原始 type/nodeType 字段标出登录语义；节点模板路由不能只靠
   *  步骤名正则，这个字段才是可靠信号，查不到时才回退到名字正则。 */
  isLoginConfig?: boolean
  /** 本步骤 configId 对应配置的名称（旧 config.name），随 topic 一起由 sourceApi.sourceSteps 回填。
   *  展示在检查器「当前配置」条；新增/复制节点时与节点名称一致。
   *  已有配置要显示后端真名——configDetail 在加载源时本来就逐个查过，这里只是把 name 一起带出来，不额外发请求。 */
  configName?: string
  /** 本步骤配置自己的 URL（旧 config.configUrl），随 topic 一起由 sourceApi.sourceSteps 从 configDetail 回填。
   *  与源 URL 不是同一份，见 NodeConfig.configUrl。 */
  configUrl?: string
  /** 以下四项与 configName/topic 同批，由 sourceApi.sourceSteps 从 config/configDetail 回填。
   *  它们都是节点面板要展示、保存时又要原样回写的配置正文字段；不回填的话面板显示的是节点模板
   *  默认值，而「保存配置」会拿这个默认值把后端真值覆盖掉（2026-08-28 实测：配置 1400968
   *  templetCode='login' 会被写空，登录节点模板路由随之失效）。 */
  bizType?: string
  dedupType?: string
  codeRule?: string
  contentRule?: string
  /** 本步骤配置的核心参数（旧 config.coreParam），随 topic 一起由 sourceApi.sourceSteps
   *  从 configDetail 回填。打标签/摘要节点用它回填编排 Tab 的模型选择（保存时写回 core_param）。 */
  coreParam?: string
  /** 本步骤配置的运行策略原文（旧 config.runPolicy），由 configDetail 回填。 */
  runPolicy?: string
  /** 本步骤 configId 对应配置的旧 `isMulti` 原值，随 topic 一起由 sourceApi.sourceSteps 回填。
   *  旧平台是三态（旧前端 column.config.js:642 权威定义）：
   *    1 = 列表类[按去重字段去重]、0 = 详情类[按父ID去重]、2 = 更新父表[按父ID更新父表]。
   *  新平台的 CollectConfig.isDetail 只是布尔，压不下第三态——2026-08-26 生产实测 200 条配置
   *  分布为 isMulti=1:197 / isMulti=2:3（本环境无 0），若只留布尔，那 3 条"更新父表"回写时会
   *  被压成"列表类"，去重语义发生变化。故原样迁移这个数值，暂不展示，等新平台确定怎么表达
   *  第三态再接 UI；期间任何写回都应以这个原值为准，不要拿 isDetail 反推。 */
  multiMode?: number
  /** 本步骤 configId 对应配置绑定的参数（旧「使用参数」弹窗那张表），随 topic 一起由
   *  sourceApi.sourceSteps 从 config/configDetail 的 params 回填。2026-08-26 生产实测：
   *  在旧平台给配置 1400774 绑上「baidu-密码=aaaa」后，configDetail.params 与 config/configParams
   *  两个接口都能拿到，但此前新平台两边都没读，画布参数配置恒显示「暂无参数配置」——
   *  用户在旧平台配好的绑定迁过来会静默消失。注意 configDetail.paramCnt 恒为 0，不可用来判空。 */
  paramBindings?: { paramId: string; value?: string }[]
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

/** 旧 `GET /v1/source/copySource`。`flag=1` 同时复制配置，`flag=0` 只复制源、共用原配置。 */
export interface CopySourceInput {
  sourceId: string
  name: string
  url: string
  flag: 0 | 1
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
  /**
   * ⚠️ 数组，不是字符串。旧平台 Step1 的「使用代理」是 a-checkbox-group（值 `['1']` / `[]`），
   * 而 SourceBuildForm.commitAll 只对 keep / isMulti / loginTemplete 跑了 parseToString，
   * **唯独 proxy 不转**，原样以数组提交——后端 DTO 因此是 `List<String>`。
   * 发字符串会被 Jackson 顶回来：`Cannot coerce empty String ("") to element of ArrayList<String>`
   * （2026-09-03 生产实测，源保存整条失败但网站已经建了）。
   */
  proxy?: string[]
  /** 与 proxy 同源的复选框，但 commitAll 转过字符串，后端收 String：'1' / ''。 */
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
  id: string // 分类路径或 ID，如 /基金类 或 9009005；'' 表示全部
  name: string
  count?: number // 该分类直属 + 子级源总数；未返回时不以 0 代替
  seq?: number // 排序序号
  parentId?: string // 父级分类 ID
  path?: string // 祖先 ID 链
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

/** 任务查询：源态收窄当前源、网站态传 siteScopeId、任务中心两者都不传即查全平台。
 *  真实接口是 task/topTaskPaged：nodeId 只给 mock 按步骤筛；live 用该节点的 configId。 */
export interface SourceTaskQuery extends PageQuery {
  siteId: string // 当前页面上下文；全局任务中心传空串，不作为后端筛选条件
  sourceId?: string
  /**
   * 按网站圈定来源（后端 2026-09-16 加、2026-09-17 修好 SQL）——**作为筛选条件的站点**，
   * 跟上面表示「当前上下文」的 `siteId` 是两回事，故意分成两个字段：
   * `siteId` 源态也一直带着，直接透传会把源态查询的语义也改掉。只有网站态看「全部源」时才设它。
   * 后端实现是 `SOURCE_ID IN (SELECT SOURCE_ID FROM cs_source WHERE SITE_ID IN (?))`，
   * 实测站 11（6496 源）→ 6526 条、335ms。
   */
  siteScopeId?: string
  nodeId?: string
  configId?: string
  state?: RunState
  queue?: string
  topic?: string
  /** 精确匹配任务 ID（2026-09-23 实测后端生效） */
  taskId?: string
  /** 按数据 ID 查任务：触发任务的那条数据的 ENTRY_ID（2026-09-28 实测后端生效，旧平台「父ID」） */
  parentId?: string
  /** 按任务自身 URL（task_inst.TASK_URL）子串匹配（2026-09-29 后端上线，topTaskPaged-api.md） */
  taskUrl?: string
  /** 创建时间下界，`yyyy-MM-dd` 或 `yyyy-MM-dd HH:mm:ss`，闭区间 */
  startTime?: string
  /** 创建时间上界，格式同上；只给日期时后端按当天 23:59:59.999 计 */
  endTime?: string
}

/** 旧平台 /v1/config/loadParams 返回：每个配置下挂的一组抓取参数定义。 */
export interface SourceParamDef {
  paramId: string
  paramName: string
  /** 后端给的缺省值（单值字符串，可能为空串） */
  curValue?: string
  /** 可选值全集 */
  allValues?: string[]
  // ---- 以下字段仅前端参数弹窗内部使用，不进请求 ----
  /** 是否勾选该参数（弹窗 UI 态） */
  check?: boolean
  /** el-select multiple/tags 当前值；curValue 空则 []，否则 [curValue] */
  curValues?: string[]
  /** 下拉展示用的截断可选值（前 100） */
  showValues?: string[]
}

/** loadParams 返回结构：{ [configId]: SourceParamDef[] } */
export type SourceLoadParamsResult = Record<string, SourceParamDef[]>

/** 带参发抓取请求体（对应旧 /v1/source/sendSnatchWithParam） */
export interface SendSnatchWithParamPayload {
  ids: string[]
  /** 拼装好的参数：{ "configId_paramId": "v1;v2" } */
  param: Record<string, string>
  all: number
  include: string[]
  skip: number
  queue?: string
  /** 指定用哪条流程跑这一次（1008-04「指定流程运行一次」，旧平台 source.js 同口径，放 query） */
  flowId?: string
}
