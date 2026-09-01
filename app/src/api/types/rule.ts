// 规则资产域（P1-3 拆 8 域 · rule 域）
// 包含 RuleGroup（规则组）/ RuleState（规则状态）/ RuleGate（发布门禁）/
//       Rule（规则表达式）/ SharedConfig（共享配置）/ RuleTestCase（测试集样本）/
//       EvalResult（求值结果）/ RuleOrchestration*（规则编排 5 个）
// 跨域被引用：源节点（flowModel）通过 NodeConfig 间接引 RuleOrchestration，
//             但 NodeConfig 不在本文件，跨域引用关系由 source 域 FlowNodeBinding 维持
// 跨域引用：无（自包含，RuleOrchestration 不直接引 Source/Config）
// 无外部 import。

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

// 规则编排字段与旧 vrule 平台字段名不同（见 0801 方案 §4.2 实测），
// 差异一律在 legacyAdapters 里转换，本文件与业务组件只用下面这套语义命名。
export type RuleDataSource = 'dp-news' | 'dp-wwdata' | 'dp-swdata' | (string & {})

/** 规则编排列表项（规则引擎 rule-orchestration） */
export interface RuleOrchestrationItem {
  ruleId: string
  name: string
  describe: string
  script: string
  scriptPath: string
  enabled: boolean
  createdAt: string
  dataSource?: RuleDataSource
  inputTable?: string
  inputFields?: string[]
  outputFields?: string[]
  /** 0805 追加：归属租户（服务端 userCode），供「选择已有规则」按登录账号过滤用 */
  userCode?: string
}

export interface ModelProviderOption {
  providerCode: string
  providerName: string
}

export interface ModelOption {
  modelCode: string
  modelName: string
}

export type PromptCategory =
  | '网页抓取'
  | 'APP抓取'
  | '文件下载'
  | 'Python抓取'
  | '浏览器抓取'
  | '公众号抓取'
  | '网页登录'
  | '数据处理'
  | '决策分支'
  | '分头处理'
  | '规则处理'
  | '数据监控'
  | '指标引用'
  | '提取数据发邮件'
  | '异常告警'
  | '自定义节点'

/** 规则处理节点绑定的编排配置 */
export interface RuleOrchestration {
  /** ref=查看已保存的编排；new=新建中（尚未保存元数据或未切到 ref） */
  mode: 'ref' | 'new'
  ruleId?: string
  /** 0804 拍板：= 节点名称（NodeConfig.title），不再单独输入；保存/查看态均由调用方用 cfg.title 覆盖 */
  name?: string
  /** = 旧 nlDescribe；旧系统无独立「用户提示词」字段，本字段已兼任，不要另加 */
  describe: string
  systemPrompt?: string
  /** 提示词分类（前端草稿字段）；按当前节点类型自动预填，随编排配置一起保存。 */
  promptCategory?: PromptCategory
  /** 模型供应商（前端草稿字段）；由 /api/model/providers 提供。 */
  modelProviderCode?: string
  /** 模型（前端草稿字段）；由 /api/model/default-models 提供。 */
  modelCode?: string
  /** 详情接口不返回脚本正文，需单独调读脚本端点后回填 */
  script?: string
  /** = 旧 codePath */
  scriptPath?: string
  /** = 旧 state（1 → true） */
  enabled?: boolean

  /** 数据源；0804 拍板固定为采集库，不再可选（见 RULE_DATA_SOURCE） */
  dataSource?: RuleDataSource
  /** 输入表物理表名（发给 vrule 用，= 旧 targetTable） */
  inputTable?: string
  /** 输入表 tableId；0803 起改走 vrule 表搜索（news-getTableList），不再是采集中心 entryType 的 tableId */
  inputTableId?: string
  /** 输出表物理表名；本期由采集中心侧存储，vrule 是否接收待确认（拍板 #5） */
  outputTable?: string
  outputTableId?: string
  /** 入参字段编码（itemCode），>=1 */
  inputFields?: string[]
  /** 出参字段编码（itemCode），>=1，多选 */
  outputFields?: string[]
  /** 结构化配置（入库配置，0804 S3-1）：本期存不透明文本，具体 schema 由执行端解释 */
  structuredConfig?: string
  /** 正文规则（0804 S3-1）：按输出字段配置的处理规则（如 content=trim），本期存不透明文本，一行一条 */
  contentRules?: string
  /**
   * 0803 追加：规则所属租户（旧 userCode）。查看详情时从 getComposeById 的 userCode 字段回填，
   * 仅作透传展示。0804 起表搜索固定按登录账号单租户查，保存业务规则时不再需要从这里回传租户——
   * orchestrationSaveMeta 未收到 userCode 时自会回退到登录账号。
   */
  userCode?: string
  /**
   * S3-2 追加：产物类型，纯前端本地字段，只用于渲染/解析分支选择（Python 预览 vs XML 编辑器、
   * 流式正文剥标记行后按什么校验），不进 ruleOrchestrationGenerateToLegacy/SaveMetaToLegacy/
   * SaveScriptToLegacy 的请求体——生成接口零改动复用（方案 §3.1 修正 E），产物类型由 systemPrompt
   * 内容本身决定，后端不需要知道这个字段。缺省视为 'python'（规则节点现状）。
   */
  format?: 'python' | 'xml'
}

/**
 * 非规则节点（采集/登录等，S3-3 起）的执行配置数据模型（方案 §3.1 修正 C/D，计划 S3-2）。
 * 字段语义对齐 RuleOrchestration 的同名概念（见下方 ≙ 标注），复用同一套生成/保存/读取接口——
 * S3-3 接入时把 NodeExecConfig 映射成 RuleOrchestration 形状再调用 ruleApi，不新增端点。
 */
export interface NodeExecConfig {
  configId?: string
  /** 仅前端用于渲染/解析分发，不进请求体（同 RuleOrchestration.format） */
  format: 'xml' | 'python'
  /** ≙ RuleOrchestration.script */
  content?: string
  /** ≙ RuleOrchestration.scriptPath */
  filePath?: string
  /** ≙ RuleOrchestration.describe */
  describe?: string
  /** ≙ RuleOrchestration.systemPrompt */
  systemPrompt?: string
}

/** 字段选项 */
export interface RuleFieldOption {
  itemCode: string
  itemName: string
  /** 物理列名 K1/K2…；测试取数回填入参只能靠它匹配（行数据里没有 itemCode） */
  columnName?: string
  dataType?: string
  itemDesc?: string
  /** < 0 为系统固定字段（ID/SOURCE_ID/UPDATE_DT/CREATE_DT），UI 默认折叠 */
  seq?: number
}

export interface RuleOrchestrationGenerateResult {
  script: string
  scriptPath: string
}

/** 测试执行请求。左栏单选（会议 20:51），故 rows 本期恒为 1 条；接口预留多条 */
export interface RuleOrchestrationTestRequest {
  ruleId?: string
  script?: string
  inputTable: string
  inputFields: string[]
  outputFields: string[]
  rows: Array<Record<string, string>>
}

/** 一条输入可产出多条输出记录（实测：zb_value 与 zb_tb 同时有值 → 2 条），故为数组，非单对象 */
export interface RuleOrchestrationTestResult {
  success: boolean
  outputs?: Array<Record<string, unknown>>
  error?: string
  /** 秒，= 旧 execution_time */
  executionTime: number
  /** 脚本指纹，= 旧 code_hash，可用于标记结果对应的脚本版本 */
  codeHash?: string
}

/** 保存业务规则元数据（路径 A，对应旧 custom-compose/save）：换取 ruleId 供生成脚本使用 */
export interface RuleOrchestrationSaveMetaResult {
  ruleId: string
  message?: string
}

/** 保存脚本（路径 B，对应旧 dashscope/script/edit） */
export interface RuleOrchestrationSaveResult {
  ruleId: string
  scriptPath: string
  message?: string
}
