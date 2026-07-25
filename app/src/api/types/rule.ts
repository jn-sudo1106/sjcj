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
