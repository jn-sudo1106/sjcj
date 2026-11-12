// 任务实例页列定义 —— 1:1 迁移旧 data-view `src/config/column.config.js` 的
// `allColumns.TASK_LIST`（base 12 列 + other 13 列）与 `allColumns.CONFIG`（配置模板详情用）。
//
// 旧页面 TaskInst.vue 用两份列集：
//   · 表格列   = TASK_LIST.base（s-table 的 :columns）
//   · 弹窗/抽屉 = base + other 按 noEdit / noDetail 过滤（editCols / detailCols）
// 注意：旧页的**编辑弹窗是死代码**（见 index.vue 文件头「有意偏差 1」），所以这里不再导出
// editColumns；只保留表格列与详情列。CONFIG 的三份列集供「配置模板详情」抽屉使用。
//
// 列宽口径（与 queueCheck / commJob 同一套约定，旧版把要显示的列都写死 width）：
//   · 文本列（任务名 / 执行节点 / 主题）给 `minWidth` → 自适应
//   · 短列（ID / 状态 / 类型 / 类型名 / 源ID / 配置ID / 两个 ID / 更新时间 / 操作）给 `width` → 定宽
// 旧 width 原值保留在注释里方便对照。
import type { TaskRow } from '@/api/taskList'

export type { TaskRow }

export interface TaskColumn {
  title: string
  dataIndex: string
  /** el-descriptions 的栅格占位（旧 a-descriptions 是 4 列） */
  span?: number
  /** 表格列固定宽（短列用） */
  width?: number
  /** 表格列最小宽（文本列用：el-table 用它吃掉剩余空间） */
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  /** 表单控件类型（旧 BaseEdit / BaseDetail 的 item.type 口径） */
  type?: 'textArea' | 'json' | 'SELECT' | 'INT_BOOL'
  values?: Array<{ text: string; value: unknown }>
  /** 旧列的取值函数（详情里 item.fun 优先于直接渲染） */
  fun?: (value: unknown) => string
  noEdit?: boolean
  noAdd?: boolean
  noDetail?: boolean
  /** 表格列固定在右侧 */
  fixed?: 'right'
}

/** `allColumns.TASK_LIST.base`（12 列，表格列集） */
export const TASK_LIST_BASE: TaskColumn[] = [
  // 旧 width 110px；表格里走 idSlot：前面一个状态圆点（C/E/AC/其它 四态）
  { title: '任务ID', dataIndex: 'taskId', span: 2, width: 130 },
  // 旧 width 60px；直接显示状态码（详情里走 stateFilter）
  { title: '状态', dataIndex: 'state', span: 2, width: 70, align: 'center' },
  { title: '类型', dataIndex: 'taskSpecId', span: 2, width: 90, align: 'center' }, // 旧 width 70px
  // 旧 width 100px；表格里走 nameSlot（纯文本）
  { title: '类型名', dataIndex: 'actionName', span: 2, width: 110 },
  { title: '任务名', dataIndex: 'taskName', span: 2, minWidth: 200 }, // 旧无 width（自适应）
  { title: '源ID', dataIndex: 'sourceId', span: 2, width: 100 }, // 旧 width 100px
  // 旧 width 90px；表格里走 configShowSlot（蓝色 tag，点击看配置模板详情）
  { title: '配置ID', dataIndex: 'configId', span: 2, width: 100 },
  // 旧 width 100px；表格里走 lastDateSlot → timeago（悬停看绝对时间）
  { title: '更新时间', dataIndex: 'updateDt', span: 2, width: 120 },
  { title: '执行节点', dataIndex: 'nodeCode', span: 2, minWidth: 180 }, // 旧无 width
  { title: '主题', dataIndex: 'taskTopic', span: 2, minWidth: 160 }, // 旧无 width
  { title: '父ID', dataIndex: 'parentId', span: 2, width: 100 }, // 旧 width 90px
  // 旧 width 110px + fixed:'right'；详情 | 重发（**没有编辑**）
  {
    title: '操作', dataIndex: 'action', span: 2, width: 120,
    noEdit: true, noDetail: true, fixed: 'right', align: 'center',
  },
]

/** `allColumns.TASK_LIST.other`（13 列：只进详情抽屉，不进表格） */
export const TASK_LIST_OTHER: TaskColumn[] = [
  { title: '流程ID', dataIndex: 'flowId', span: 2 },
  { title: '业务ID', dataIndex: 'bizId', span: 2 },
  { title: '域', dataIndex: 'domain', span: 2 },
  { title: '处理机类型', dataIndex: 'typeId', span: 2 },
  { title: '父任务', dataIndex: 'ptaskId', span: 2 },
  { title: '要求登陆', dataIndex: 'needLogin', span: 2 },
  { title: '文件ID', dataIndex: 'fileId', span: 2 },
  { title: '生成时间', dataIndex: 'createDt', span: 2 },
  { title: '开始时间', dataIndex: 'startDt', span: 2 },
  { title: '结束时间', dataIndex: 'endDt', span: 2 },
  // 旧配置里这一项只有 `{ title: '', span: 2 }`、没有 dataIndex（一个占位空格子，让后面三个
  // span:4 的长文本从新行开始）。el-descriptions 的 item 需要稳定 key，这里补一个占位 dataIndex。
  { title: '', dataIndex: 'blank_placeholder', span: 2 },
  { title: '参数', dataIndex: 'params', span: 4, type: 'textArea' },
  { title: '结果', dataIndex: 'taskResult', span: 4, type: 'textArea' },
  { title: '上下文', dataIndex: 'vars', span: 4, type: 'textArea' },
  { title: '任务URL', dataIndex: 'taskUrl', span: 4 },
]

/** 全部列（base + other），对应旧 `[...this.columns, ...this.otherCols]` */
export const TASK_LIST_ALL: TaskColumn[] = [...TASK_LIST_BASE, ...TASK_LIST_OTHER]

/** 表格列（旧 `columns: allColumns.TASK_LIST.base`） */
export function listColumns(): TaskColumn[] {
  return TASK_LIST_BASE
}

/** 详情抽屉字段：排除 noDetail（旧 detailCols） */
export function detailColumns(): TaskColumn[] {
  return TASK_LIST_ALL.filter((c) => !c.noDetail)
}

// ---------------------------------------------------------------------------
// 状态：旧页搜索栏的 17 个 a-select-option（值 + 原文案，1:1 照抄）
// ---------------------------------------------------------------------------
export const STATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '-不限-' },
  { value: 'WD', label: '等待下载-WD' },
  { value: 'WC', label: '等待配置-WC' },
  { value: 'W1', label: '排队-W1' },
  { value: 'W0', label: '等待补全-W0' },
  { value: 'W', label: '待处理-W' },
  { value: 'D', label: '删除-D' },
  { value: 'C', label: '完成-C' },
  { value: 'E', label: '出错-E' },
  { value: 'L', label: '处理中-L' },
  { value: 'T', label: '测试-T' },
  { value: 'WA', label: '待审核-WA' },
  { value: 'A', label: '已审核-A' },
  { value: 'AC', label: '跳过-AC' },
  { value: 'K', label: '仅记录-K' },
  { value: 'RL', label: '重试中-RL' },
  { value: 'RC', label: '已生成重试-RC' },
]

/** 旧全局过滤器 `stateFilter`（utils/filter.js:32）：只映射 5 个值，其余原样返回。
 *  注意 'AC' → '已审核' 与上面选项里的 '跳过-AC' 文案不一致——这是旧代码原样，照抄不改。 */
export function stateText(value: unknown): string {
  switch (value) {
    case 'C':
      return '正常'
    case 'E':
      return '出错'
    case 'L':
      return '处理中'
    case 'AC':
      return '已审核'
    case 'W':
      return '待处理'
    default:
      return value == null ? '' : String(value)
  }
}

/** 任务ID 前的状态圆点：C→成功(绿) / E→出错(红) / AC→默认(灰) / 其余→进行中(蓝)。
 *  对应旧模板的 `a-badge status="success|error|default|processing"`。 */
export type TaskDotTone = 'success' | 'error' | 'default' | 'processing'
export function taskDotTone(state: unknown): TaskDotTone {
  if (state === 'C') return 'success'
  if (state === 'E') return 'error'
  if (state === 'AC') return 'default'
  return 'processing'
}

/**
 * 旧全局过滤器 `timeago`（core/lazy_use.js:43）：
 *   `if (!val) return '-'` + `moment(val, 'YYYY-MM-DD hh:mm:ss').fromNow()` + `.replace('内','后')`
 * 与 commJob/columns.ts 里的同款实现（本页 updateDt 都是过去时间，只会出「前」）。
 * 阈值按 moment.fromNow(zh-cn) 的口径近似：45s / 90s / 45min / 90min / 22h / 36h / 26d / 46d / 320d / 548d。
 */
export function timeAgoText(value?: string | null): string {
  if (!value) return '-'
  const raw = String(value).trim()
  const t = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T')).getTime()
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

// ---------------------------------------------------------------------------
// 配置模板详情（旧 ConfigDetail.vue → `allColumns.CONFIG.columns + other`）
// 只有 TASK_LIST 的「配置ID」蓝色 tag 点进来时才用得到。
// ---------------------------------------------------------------------------
export const CONFIG_COLUMNS: TaskColumn[] = [
  { title: 'ID', dataIndex: 'configId', span: 2, width: 90 },
  { title: '名称', dataIndex: 'configName', span: 2, width: 180 },
  { title: 'URL', dataIndex: 'configUrl', span: 4 },
  { title: '主题', dataIndex: 'topic', span: 2 },
  { title: '表ID', dataIndex: 'entryTypeId', span: 2 },
  { title: '更新时间', dataIndex: 'updateDt', span: 2 },
  { title: '域', dataIndex: 'domain', span: 2 },
  { title: '备注', dataIndex: 'remark', span: 2 },
  // 旧 columns 里的 action 带 noDetail → 不进详情
  { title: '操作', dataIndex: 'action', span: 2, noDetail: true },
]

export const CONFIG_OTHER: TaskColumn[] = [
  { title: '代理', dataIndex: 'proxyConf', span: 4 },
  { title: '核心参数', dataIndex: 'coreParam', span: 4, type: 'json' },
  { title: '运行策略', dataIndex: 'runPolicy', span: 4, type: 'textArea' },
  { title: '抓取配置', dataIndex: 'snatchConf', span: 4, type: 'textArea' },
  { title: '下载配置', dataIndex: 'downConf', span: 4, type: 'textArea' },
  { title: '正文规则', dataIndex: 'contentRule', span: 4, type: 'textArea' },
  { title: '结构化配置', dataIndex: 'codeRule', span: 4, type: 'textArea' },
  { title: '去重类型', dataIndex: 'snatchDrepeat', span: 2 },
  { title: '业务类型', dataIndex: 'templetCode', span: 2 },
  { title: '是否列表', dataIndex: 'isMulti', span: 2 },
  { title: '抓取类型', dataIndex: 'configType', span: 2 },
  { title: '日期', dataIndex: 'createDt', span: 2 },
]

/** 配置模板详情字段：CONFIG columns + other，排除 noDetail（旧 ConfigDetail 的 detailCols） */
export function configDetailColumns(): TaskColumn[] {
  return [...CONFIG_COLUMNS, ...CONFIG_OTHER].filter((c) => !c.noDetail)
}

/** 配置模板详情里的「参数列表」表头（旧 allColumns.CONFIG.params） */
export const CONFIG_PARAM_COLUMNS: Array<{ title: string; dataIndex: string }> = [
  { title: 'ID', dataIndex: 'paramId' },
  { title: '参数名称', dataIndex: 'paramName' },
  { title: '参数类型', dataIndex: 'paramType' },
  { title: '参考值', dataIndex: 'valueShow' },
]
