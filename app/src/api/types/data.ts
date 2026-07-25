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
  dataId: string // ENTRY_ID
  sourceId: string // SOURCE_ID
  configId?: string // CONFIG_ID
  /** DETAIL_ID：任务实例 ID，行内「任务」列可点入口 */
  detailId?: string
  parentId?: string // PARENT_ID 父数据 ID（详情解析等子步骤反推列表）
  /** CATEGORY_ID：父数据所在表 ID；缺失时父 ID 列不可点（旧平台口径） */
  categoryId?: string
  state?: string // STATE 处理状态：C 初始 / AC 已审核 / NF 404 / E 出错
  nextFlag?: string // NEXT_FLAG 后续标识
  createDt?: string // CREATE_DT 生成时间
  updateDt?: string // UPDATE_DT 更新时间
  /** K0：原始 JSON ID，非空时「原始」列可点开 readJson */
  k0?: string
  seq?: string // SEQ
  times?: string // TIMES
  fileId?: string // FILE_ID
  values?: Record<string, unknown> // 动态列值（键 = 大写物理列名 K1/K2...）

  /** @deprecated mock 时代概念，无旧平台契约来源；随 mock 重做一并移除（E 包 T1c） */
  title: string
  /** @deprecated 同上 */
  summary: string
  /** @deprecated 同上 */
  acceptState: 'accepted' | 'pending' | 'rejected'
  /** @deprecated 同上 */
  fileType?: 'html' | 'pdf' | 'json' | '-'
  /** @deprecated 同上 */
  parseState?: 'parsed' | 'failed' | 'none'
  /** @deprecated 真实行的任务指针是 detailId */
  taskId?: string
  /** @deprecated 真实行无此列 */
  runId?: string
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
