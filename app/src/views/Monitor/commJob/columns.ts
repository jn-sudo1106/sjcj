// 自定义告警（通用定时任务）列定义 —— 1:1 迁移旧 data-view `src/config/column.config.js` 的
// `allColumns.COMM_JOB`（base 13 列 + other 1 列）。
//
// 旧页面 CommJobList.vue 用两份列集：
//   · 表格列  = base（s-table 的 :columns）——other 里的 isDelete 带 `noList: true`，不进表格
//   · 弹窗/抽屉 = base + other 按 noEdit / noAdd / noDetail 过滤（editCols / addCols / detailCols）
// 所以这里把 14 列放一份，再导出三个派生函数，口径与旧 computed 完全一致。
//
// `span` 是旧 a-descriptions :column="4" 的栅格（span=2 → 半行，span=4 → 整行）。
// 旧 COMM_JOB 的列**没有任何 sorter**，所以本页表头不排序（不必挂 sortable）。
//
// 列宽口径（与 queueCheck 同一套约定，旧版把所有列都写死 width）：
//   · 文本列（定时名 / 执行信息 / SQL定义 / 告警条件 / 运行参数）给 `minWidth` → 自适应
//   · 短列（ID / 类型 / 定时策略 / 两个时间列 / 两个计数 / 操作）给 `width` → 定宽
// 旧 width 原值都保留在注释里方便对照。

export interface CommJobColumn {
  title: string
  dataIndex: string
  /** el-descriptions 的栅格占位（旧 a-descriptions 是 4 列） */
  span?: number
  /** 表格列固定宽（短列用） */
  width?: number
  /** 表格列最小宽（文本列用：el-table 用它吃掉剩余空间） */
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /** 表单控件类型：旧 BaseEdit 的 item.type 口径，缺省 = 普通输入框 */
  type?: 'INT_BOOL' | 'textArea' | 'span' | 'checkbox' | 'SELECT'
  values?: Array<{ text: string; value: unknown }>
  /** 旧列的取值函数（详情抽屉里 item.fun 优先于直接渲染；isDelete 走 enableFilter 优先于 fun） */
  fun?: (value: unknown) => string
  noAdd?: boolean
  noEdit?: boolean
  noDetail?: boolean
  /** 旧配置里的 `noList: true`：不进表格列（只有 other 里的 isDelete 带这个标记） */
  noList?: boolean
  /** 表格列固定在右侧（旧 action 列的 `fixed: 'right'`） */
  fixed?: 'right'
}

/** `allColumns.COMM_JOB.base`（13 列，表格列集） */
export const COMM_JOB_BASE: CommJobColumn[] = [
  // 旧 width 80；表格里走 idSlot：点击整格进详情，按 isDelete 三态上色
  { title: '定时ID', dataIndex: 'jobId', span: 2, width: 90 },
  // 旧 width 90；表格里走 jobTypeSlot → typeFilter（sql→定时Job / sqlCheck→SQL-告警）；表单是 SELECT
  {
    title: '类型', dataIndex: 'jobType', span: 2, width: 100,
    type: 'SELECT',
    values: [
      { text: '定时Job', value: 'sql' },
      { text: 'SQL-告警', value: 'sqlCheck' },
    ],
  },
  { title: '定时名', dataIndex: 'jobName', span: 4, width: 100, minWidth: 180 }, // 旧 width 100
  { title: '执行信息', dataIndex: 'lastMsg', span: 4, width: 200, minWidth: 240 }, // 旧 width 200
  { title: 'SQL定义', dataIndex: 'sqlDef', span: 4, width: 300, minWidth: 260, type: 'textArea' }, // 旧 width 300
  { title: '告警条件', dataIndex: 'ruleDef', span: 4, width: 100, minWidth: 160, type: 'textArea' }, // 旧 width 100
  { title: '运行参数', dataIndex: 'jobParam', span: 4, width: 200, minWidth: 200, type: 'textArea' }, // 旧 width 200
  { title: '定时策略', dataIndex: 'schedule', span: 2, width: 130 }, // 旧 width 120
  { title: '下次运行', dataIndex: 'nextRun', span: 2, width: 120, noEdit: true, noAdd: true }, // 旧 width 90
  { title: '总运行次', dataIndex: 'runCnt', span: 2, width: 90, noEdit: true, noAdd: true }, // 旧 width 100
  { title: '成功次', dataIndex: 'successCnt', span: 2, width: 90, noEdit: true, noAdd: true }, // 旧 width 100
  { title: '上次运行', dataIndex: 'lastRun', span: 2, width: 120, noEdit: true, noAdd: true }, // 旧 width 100
  // 旧 width 150 + fixed:'right'（列宽总和超过容器，操作列钉在右边）
  {
    title: '操作', dataIndex: 'action', span: 2, width: 150,
    noEdit: true, noAdd: true, noDetail: true, fixed: 'right',
    align: 'center',
  },
]

/** `allColumns.COMM_JOB.other`（1 列：isDelete，带 `noList: true` → 只进表单/详情，不进表格） */
export const COMM_JOB_OTHER: CommJobColumn[] = [
  {
    title: '禁用', dataIndex: 'isDelete', span: 2, width: 80, noList: true, type: 'INT_BOOL',
    // 旧配置里的 fun：1 → 禁用 / 其余 → 启用（详情抽屉里 isDelete 实际走 enableFilter，见 display()）
    fun: (v: unknown) => (v === 1 ? '禁用' : '启用'),
  },
]

/** 全部列（base + other），对应旧 `[...this.columns, ...this.otherCols]` */
export const COMM_JOB_ALL: CommJobColumn[] = [...COMM_JOB_BASE, ...COMM_JOB_OTHER]

/** 表格列（旧 `columns: allColumns.COMM_JOB.base`，isDelete 因 noList 不在其中） */
export function listColumns(): CommJobColumn[] {
  return COMM_JOB_BASE
}

/** 编辑弹窗字段：排除 noEdit（旧 editCols） */
export function editColumns(): CommJobColumn[] {
  return COMM_JOB_ALL.filter((c) => !c.noEdit)
}

/** 新增弹窗字段：排除 noAdd（旧 addCols） */
export function addColumns(): CommJobColumn[] {
  return COMM_JOB_ALL.filter((c) => !c.noAdd)
}

/** 详情抽屉字段：排除 noDetail（旧 detailCols） */
export function detailColumns(): CommJobColumn[] {
  return COMM_JOB_ALL.filter((c) => !c.noDetail)
}

/** 旧全局过滤器 `enableFilter`（utils/filter.js）：只认 1/0 */
export function enableText(value: unknown): string {
  if (value === 1) return '是[1]'
  if (value === 0) return '否[0]'
  return String(value ?? '')
}

/** 旧 CommJobList 的 `typeFilter`：sql → 定时Job / sqlCheck → SQL-告警 / 其它原样返回 */
export function jobTypeText(value: unknown): string {
  switch (value) {
    case 'sql':
      return '定时Job'
    case 'sqlCheck':
      return 'SQL-告警'
    default:
      return value == null ? '' : String(value)
  }
}

/**
 * 旧全局过滤器 `timeago`（core/lazy_use.js:43）：
 *   `if (!val) return '-'` + `moment(val, 'YYYY-MM-DD hh:mm:ss').fromNow()` + `.replace('内','后')`
 * 这里用原生 Date 复刻，**过去/未来双向**都出相对描述（nextRun 是未来时间，moment 会写「3 小时内」，
 * 旧代码把「内」替换成「后」→「3 小时后」）。
 * 阈值按 moment.fromNow(zh-cn) 的口径近似：45s / 90s / 45min / 90min / 22h / 36h / 26d / 46d / 320d / 548d。
 */
export function timeAgoText(value?: string | null): string {
  if (!value) return '-'
  const raw = String(value).trim()
  const t = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T')).getTime()
  // 不是时间串（例如占位符 '—'）原样返回，不显示 'Invalid date'
  if (Number.isNaN(t)) return raw

  const diffSec = Math.round((t - Date.now()) / 1000) // 正数 = 未来
  const future = diffSec > 0
  const sec = Math.abs(diffSec)
  const tail = future ? '后' : '前'

  if (sec < 45) return future ? '几秒后' : '几秒前'
  if (sec < 90) return `1 分钟${tail}`
  if (sec < 45 * 60) return `${Math.round(sec / 60)} 分钟${tail}`
  if (sec < 90 * 60) return `1 小时${tail}`
  if (sec < 22 * 3600) return `${Math.round(sec / 3600)} 小时${tail}`
  if (sec < 36 * 3600) return `1 天${tail}`
  if (sec < 26 * 86400) return `${Math.round(sec / 86400)} 天${tail}`
  if (sec < 46 * 86400) return `1 个月${tail}`
  if (sec < 320 * 86400) return `${Math.round(sec / (30 * 86400))} 个月${tail}`
  if (sec < 548 * 86400) return `1 年${tail}`
  return `${Math.round(sec / (365 * 86400))} 年${tail}`
}
