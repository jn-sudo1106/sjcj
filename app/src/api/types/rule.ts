// 规则资产域（P1-3 拆 8 域 · rule 域）
// 包含 RuleGroup（规则组）/ RuleState（规则状态）/ RuleGate（发布门禁）/
//       Rule（规则表达式）/ SharedConfig（共享配置）/ RuleTestCase（测试集样本）/
//       EvalResult（求值结果）/ RuleOrchestration*（规则编排 5 个）
// 跨域被引用：源节点（flowModel）通过 NodeConfig 间接引 RuleOrchestration，
//             但 NodeConfig 不在本文件，跨域引用关系由 source 域 FlowTemplateNodeBinding 维持
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

/** 规则编排列表项（规则引擎 rule-orchestration，本期编排列表后置，暂无消费方） */
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
}

/** 规则处理节点绑定的编排配置 */
export interface RuleOrchestration {
  /** ref=查看已保存的编排；new=新建中（尚未保存元数据或未切到 ref） */
  mode: 'ref' | 'new'
  ruleId?: string
  name?: string
  /** = 旧 nlDescribe；旧系统无独立「用户提示词」字段，本字段已兼任，不要另加 */
  describe: string
  systemPrompt?: string
  /** 详情接口不返回脚本正文，需单独调读脚本端点后回填 */
  script?: string
  /** = 旧 codePath */
  scriptPath?: string
  /** = 旧 state（1 → true） */
  enabled?: boolean

  /** 数据源；默认 dp-wwdata（采集库） */
  dataSource?: RuleDataSource
  /** 输入表物理表名（发给 vrule 用，= 旧 targetTable） */
  inputTable?: string
  /** 输入表 tableId（与采集中心 NodeConfig.inputTable 同步用，两者同源同编号空间） */
  inputTableId?: string
  /** 输出表物理表名；本期由采集中心侧存储，vrule 是否接收待确认（拍板 #5） */
  outputTable?: string
  outputTableId?: string
  /** 入参字段编码（itemCode），>=1 */
  inputFields?: string[]
  /** 出参字段编码（itemCode），>=1，多选 */
  outputFields?: string[]
}

/** 表选项：统一 vrule dbTableName / 采集中心 EntryType 两侧命名（两者 tableName 含义相反，见 §4.3） */
export interface RuleTableOption {
  tableId: string
  /** 中文业务名 */
  tableName: string
  /** 物理表名，发给 vrule 用 */
  dbTableName: string
  /** 去重列，逗号分隔，如 "K1,K10" */
  keyField?: string
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
