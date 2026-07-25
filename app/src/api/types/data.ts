// 数据查看 + 运行记录域（P1-3 拆 8 域 · data 域）
// 包含 Dataset（指标数据集）/ Measure（指标定义）/ DataTableMeta（表元信息）/
//       DataRow（数据行）/ RowQuery（结果视图查询）/ RunIndex/RunRow/RunNode（运行记录 3 件）/
//       TaskInst（任务实例）
// 跨域被引用：overview.OverviewKpi.tables 引用 table 数（不是类型）
// 跨域引用：PageQuery（RowQuery extends PageQuery）/ RunState（RunIndex/RunRow/RunNode/TaskInst.state）
// import type 严格模式避免运行时循环

import type { PageQuery, RunState } from './common'

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
  nextFlag?: string
  min?: string | number
  max?: string | number
  sorted?: number
}

/* ---------------- M4 运行记录 ---------------- */

export interface RunIndex {
  runId: string
  flowId: string
  startedAt: string
  state: RunState
}

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
