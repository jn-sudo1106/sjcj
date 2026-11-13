// 流程中心「模板 → 实例」交互原型的数据契约（1109 方案 §5、§12 C02/C09/C10/C12）。
//
// 只描述原型里真正用到的字段：模板摘要、实例行（含覆盖网站/覆盖源数）、
// 范围意图与预览（C09）、实例草稿（C12）、批量绑定作业、配置差异、未归类核对。
// 后端能力未就绪时由 mock 层按同一形状回演示数据，页面无需分支。

/** 模板结构里的节点类别，决定结构预览的节点样式（与原型 .node/.rule/.out 对应）。 */
export type StructureNodeKind = 'start' | 'capture' | 'rule' | 'out' | 'end' | 'other'

export interface StructureNode {
  id: string
  kind: StructureNodeKind
  label: string
  /** 节点类型码，如 web-list / web-detail / rule-1 / db-out */
  code?: string
}

export interface TemplateStructure {
  nodes: StructureNode[]
  /** 分支说明，如「详情采集 → 翻译」；无分支为空数组 */
  branches: string[]
  /** 结构指纹（展示用，原型 #8f3c-6n-2b） */
  fingerprint: string
}

export interface TemplateMeta {
  id: string
  name: string
  /** 覆盖源数（当前账号可见） */
  sourceCount: number
  /** 实例数 */
  instanceCount: number
  updatedAt: string
  structure: TemplateStructure
  disabled?: boolean
}

export interface InstanceRow {
  id: string
  name: string
  templateId: string
  templateName: string
  /** 覆盖网站（首个为主网站，其余在行内显示「+N 个网站」） */
  sites: string[]
  /** 配置摘要片段：输出表、脚本版本等，行内以 → 连接 */
  summary: string[]
  sourceCount: number
  /** 被多少个源设为默认流程 */
  defaultSourceCount: number
  /** 维护人（原型里的「张工 维护」，没有就空） */
  maintainer?: string
  updatedAt: string
  /** 草稿实例：只记录目标范围意图，未建立绑定，不可执行 */
  draft?: boolean
  /** 草稿的目标范围源数 */
  scopeIntentCount?: number
  disabled?: boolean
}

export interface InstancePageCond {
  templateId?: string
  site?: string
  status?: 'all' | 'draft' | 'active'
  keyword?: string
  page?: number
  pageSize?: number
}

export interface Paged<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 新建实例第 3 步的范围选择：四选一，互斥。 */
export type ScopeMode = 'site-all' | 'unbound' | 'manual' | 'skip'

export interface ScopeIntent {
  /** 覆盖网站（多选） */
  sites: string[]
  mode: ScopeMode
  /** mode=manual 时手选的源 ID */
  manualSourceIds: string[]
  /** 是否把这些源设为该实例的默认流程（默认 false，对应 R02 决策表） */
  setDefault: boolean
}

export interface ScopePreview {
  templateId: string
  /** 冻结范围内的源总数 */
  total: number
  /** 预计新增（可绑定） */
  toAdd: number
  /** 预计跳过（已绑本实例） */
  toSkip: number
  /** 组内源（由来源组统一指定，不参与单源绑定） */
  groupSources: number
  /** 预计不可操作（并发快照变化等，执行时复核） */
  expectedUnavailable: number
  /** 预计补默认数量：不计入合计，属已成功绑定源的子指标 */
  defaultFilled: number
}

export interface InstanceDraftPayload {
  name: string
  templateId: string
  scope: ScopeIntent
}

export interface InstanceDraftResult {
  id: string
  name: string
  templateId: string
  scopeIntentCount: number
  createdAt: string
}

export type BatchJobStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed'

export interface BatchFailure {
  sourceId: string
  sourceName: string
  reason: string
}

export interface BatchJob {
  jobId: string
  instanceId: string
  /** 冻结范围的幂等键：预览时生成，提交时原样带回 */
  scopeToken: string
  batchIndex: number
  batchTotal: number
  batchSize: number
  total: number
  processed: number
  added: number
  skipped: number
  failed: number
  /** 补默认单独统计，不计入「新增/跳过/失败」合计 */
  defaultFilled: number
  status: BatchJobStatus
  /** 待开始的源数（未进入任何批次） */
  pending: number
  /** 执行中的源数（当前批） */
  running: number
  failures: BatchFailure[]
}

export interface StartBatchPayload {
  instanceId: string
  scopeToken: string
  scope: ScopeIntent
}

export interface ConfigDiffItem {
  label: string
  base: string
  compare: string
}

export interface ConfigDiffSection {
  title: string
  items: ConfigDiffItem[]
}

export interface SourceScheduleRow {
  sourceName: string
  taskName: string
  at: string
}

export interface ConfigDiffResult {
  base: { id: string; name: string }
  compare: { id: string; name: string }
  baseSourceCount: number
  compareSourceCount: number
  sections: ConfigDiffSection[]
  /** 实例自身没有调度：运行情况单列「使用源的调度」（F06） */
  schedules: SourceScheduleRow[]
  changedCount: number
}

export type UnclassifiedStatus = 'pending' | 'confirmed' | 'skipped'

export interface UnclassifiedRow {
  id: string
  name: string
  /** 旧归集模板名，未归集为空 */
  oldTemplate: string
  /** 节点类型及边，如「列表采集→详情采集→规则处理」 */
  chain: string
  suggestedTemplateId: string | null
  suggestedTemplateName: string
  /** 原因/状态：结构一致仅配置不同 / 节点数与连接不同 / 边信息不完整 … */
  reason: string
  status: UnclassifiedStatus
}

export interface UnclassifiedResult {
  list: UnclassifiedRow[]
  total: number
  scannedAt: string
}