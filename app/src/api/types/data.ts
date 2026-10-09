// 数据查看 + 运行记录域（P1-3 拆 8 域 · data 域）
// 包含 Dataset（指标数据集）/ Measure（指标定义）/ DataTableMeta（表元信息）/
//       DataRow（数据行）/ RowQuery（结果视图查询）/ RunIndex/RunRow/RunNode（运行记录 3 件）/
//       TaskInst（任务实例）
// 跨域被引用：overview.OverviewKpi.tables 引用 table 数（不是类型）
// 跨域引用：PageQuery（RowQuery extends PageQuery）/ RunState（RunIndex/RunRow/RunNode/TaskInst.state）
// import type 严格模式避免运行时循环

import type { PageQuery, RunState } from './common'
import type { EntryType } from './collect'

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
  /** 旧表详情的业务名称；tableName 是物理表名，两者不能混用。 */
  name?: string
  /** 后端 dataCnt；表详情接口不返回时为 undefined，不能当 0 展示（0930-04） */
  rowCount?: number
  /** C 测试表 / AC 正式表——删除数据入口仅测试表显示（方案 §1.4-4） */
  state?: string
  /** 去重列（逗号分隔的 columnName），手动修改弹窗副标题展示（方案 §1.6-2） */
  keyField?: string
  /** 去重方式：'source' 源内去重 / 'table' 表内去重 */
  dedupMode?: 'source' | 'table'
  remark?: string
  updatedAt?: string
  /** 旧表详情中的表级规则字段。 */
  recFlag?: string | number
  checkFlag?: string | number
  checkRule?: string
  coreParam?: string
  fields: {
    prop: string
    type: string
    desc: string
    sample?: string
    columnName?: string // 物理列名（大写，K1/K2...），rowQueryPaged 行数据按此取值
    required?: boolean // 动态列渲染只取 required 的前 20 个（旧平台口径）
    width?: number
    itemId?: string
    seq?: number
    preprocess?: string
    dedup?: boolean
    checkRule?: string
  }[]
}

/**
 * 选表分组（旧 config/queryEntryTypesGroup 返回形状；对照真实源码 EntryList2.vue loadEntryTypes 修正）：
 * main 不是第 4 个列表，是默认选中的 entryTypeId（标量）；三个真正的表分组是 list1/list2/list3，
 * UI 分组标签「main/subs/other」对应的正是 list1/list2/list3（见 EntryTypeSelectMulti.vue），
 * 与响应字段名 main 是两回事，容易混淆。
 */
export interface EntryTypeGroup {
  /** 默认选中的表 ID；未设置时旧前端回退到 list3[0] */
  main?: string
  list1: EntryType[]
  list2: EntryType[]
  /** 旧前端对 list3 做了 reverse，此处已反转 */
  list3: EntryType[]
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
  /** SOURCE_NAME：源名称（entryDetail 返回；列表行通常没有，详情抽屉展示） */
  sourceName?: string
  /** ENTRY_TYPE_ID：表 ID（entryDetail 返回；旧平台详情顶部「类型ID」） */
  entryTypeId?: string
  /** ENTRY_TYPE_NAME：表名（entryDetail 返回；旧平台详情顶部「类型名」） */
  entryTypeName?: string
  /** VER：版本（entryDetail 返回；旧平台详情顶部「版本」） */
  ver?: string
  /** FLAG1：抓取日期（entryDetail 返回；旧平台详情顶部「抓取日期」） */
  flag1?: string
  values?: Record<string, unknown> // 动态列值（键 = 大写物理列名 K1/K2...）

  /** @deprecated mock 时代概念，无旧平台契约来源；随 DataView UI 重做一并移除（UI 仍在读，先留存避免编译中断） */
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

/** 数据详情：entryDetail 返回行 + showItems（反填编辑表单用）+ subs（子列表） */
export interface EntryDetailItem {
  itemId?: string
  columnName: string
  itemName?: string
  value: unknown
}

/**
 * 子行（下游数据）。后端 `entryDetail` 的 `subs` 里每条都是一个完整的详情对象——
 * 自带 `showItems`（实测 24 个字段全带）和 `entryTypeId/entryTypeName`，
 * 所以详情抽屉里展开子表**不需要再发请求**（旧平台 BaseDetail.vue 也是直接渲染它）。
 */
export interface EntrySubRow {
  row: DataRow
  showItems: EntryDetailItem[]
  /** 子行所在表，异表链路下必须显示——用户得知道这是哪张表的数据 */
  tableId?: string
  tableName?: string
}
export interface EntryDetail {
  row: DataRow
  showItems: EntryDetailItem[]
  subs?: EntrySubRow[]
  /**
   * 子行**总数**。详情接口可能只带回前几条（旧平台界面上写的就是「本页展示子数据 3/6 条」），
   * 用它跟 `subs.length` 比，才知道要不要给"查看全部"的出口。
   */
  subsCnt?: number
}

/** 统计行：动态分组列（键名取决于 summaryFields）+ 固定 CNT 计数列 */
export type SummaryRow = Record<string, unknown> & { CNT: number }

/** 结果视图查询入参 */
export interface RowQuery extends PageQuery {
  tableId: string
  sourceId?: string
  /** 网站粒度查询（0707 优化·Phase5）：圈定该网站下全部源；与 sourceId 同传时 sourceId 在此范围内进一步收窄 */
  siteId?: string
  dataId?: string
  parentId?: string
  /** 多选状态由调用方 join(',') 传入（如 'C,AC'）；空则不随载荷携带该键 */
  state?: string
  /** 数据查看页基础时间范围，默认针对 CREATE_DT 查询；由旧适配层合并到 more */
  startTime?: string
  endTime?: string
  sql?: string
  nextFlag?: string
  min?: string | number
  max?: string | number
  /**
   * 排序列：对照真实源码 EntryList2.vue handleSortChange 修正——该页表格用 u-table，
   * 排序一律走 @sort-change 设置 field='(列名+ 0)'/type=' ASC '|' DESC '（含 ENTRY_ID 本身）；
   * entry.js 里 sortField==='ENTRY_ID' → sorted±1 的分支是给另一套表格组件（s-table/AntD sorter）
   * 准备的，此页从不设置 sortField/sortOrder，是死分支，不迁移。
   */
  sortField?: string
  sortOrder?: 'ascend' | 'descend'
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
  /** 任务级临时选择的登录配置快照（不保存密码等敏感信息）。 */
  loginConfigId?: string
  loginAccount?: string
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
  /** 任务规格 ID（类型代码），任务实例弹窗筛选/展示用（方案 §1.6-5 TaskInst） */
  taskSpecId?: string
  /** 业务数据 ID（0917-01） */
  bizId?: string
  /** 任务目标 URL（0917-01） */
  taskUrl?: string
  /** 关联文件 ID（0917-01） */
  fileId?: string
  /** 所属流程 ID（0917-01） */
  flowId?: string
  /** 任务入参（0917-01） */
  params?: string
  /** 任务执行结果（0917-01） */
  taskResult?: string
  /** 上下文变量（0917-01） */
  vars?: string
  /** 生成时间（0917-01） */
  createdAt?: string
  /** 开始执行时间（0917-01） */
  startedAt?: string
  /** 执行结束时间（0917-01） */
  endedAt?: string
}

/** 任务实例分页查询（TaskInstDialog，方案 §1.6-5） */
export interface TaskInstQuery extends PageQuery {
  taskId?: string
  sourceId?: string
  configId?: string
  parentId?: string
  fileId?: string
  taskSpecId?: string
  state?: string
  queue?: string
  topic?: string
}
