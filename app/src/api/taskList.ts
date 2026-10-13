// 任务实例（旧 data-view `src/api/task.js` → 旧页 `src/page/inst/TaskInst.vue`，路由 /inst/task-list）。
//
// 端点契约 1:1 对齐旧平台 api/task.js：
//   taskInstPaged  GET /v1/task/topTaskPaged    （旧层把 pageNo/pageSize 映射成 page/limit）
//   resendTask     GET /v1/task/resetTaskInsts  （?ids=a,b；**危险端点**，会把任务重置为待发送）
//
// 与旧层完全一致的两条口径：
//   1. **字段白名单**：只下发后端 TaskController.topTaskPaged 支持的 15 个过滤键
//      （taskId / state / sourceId / sourceIds / taskUrl / siteId / groupId /
//        configId / parentId / taskSpecId / fileId / taskTopic / startTime / endTime / all）。
//      旧页 queryParam 里还有 `title` 之类的历史遗留键，一律**不传**给后端。
//   2. **时间预校验**：仅接受 yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss；非法或 end < start 直接拒绝、
//      不发请求（与后端 code=1 同口径，提前拦截避免无效请求 / 长 SQL）。
//
// 逻辑名用 `task/taskListPaged`（本页专属，配了 mock 供 vitest / 离线演示），
// 真实请求路径交给 httpEndpoint: 'task/topTaskPaged'（已登记 live）——与 api/index.ts 的
// source/sourceTaskPaged 同一套「逻辑名 + 真实 path」写法。
// resend 直接复用已登记的 `task/resetTaskInsts`（danger + live，生产写白名单里已有）。
import { request } from './client'

/** 后端 topTaskPaged 支持的过滤键（顺序即旧 api/task.js 的 FIELDS） */
const FILTER_FIELDS = [
  'taskId', 'state', 'sourceId', 'sourceIds', 'taskUrl', 'siteId', 'groupId',
  'configId', 'parentId', 'taskSpecId', 'fileId', 'taskTopic',
  'startTime', 'endTime', 'all',
] as const

/** 任务实例行（字段名与后端/旧 column.config 一致；本页不做字段改名） */
export interface TaskRow {
  taskId: string
  state: string
  taskSpecId?: string
  /** 类型名（旧列 actionName） */
  actionName?: string
  taskName?: string
  sourceId?: string
  configId?: string
  /** 更新时间（旧列 updateDt，列表里走 timeago） */
  updateDt?: string
  /** 执行节点 */
  nodeCode?: string
  /** 主题（旧列 taskTopic） */
  taskTopic?: string
  parentId?: string
  flowId?: string
  bizId?: string
  domain?: string
  typeId?: string
  ptaskId?: string
  needLogin?: string
  fileId?: string
  createDt?: string
  startDt?: string
  endDt?: string
  params?: string
  taskResult?: string
  vars?: string
  taskUrl?: string
  [key: string]: unknown
}

/** 分页查询入参：旧页 queryParam 的全部可能键 + 分页（page/limit，不是 pageNo/pageSize） */
export interface TaskRowQuery {
  page?: number
  limit?: number
  taskId?: string
  state?: string
  sourceId?: string
  sourceIds?: string
  taskUrl?: string
  siteId?: string
  groupId?: string
  configId?: string
  parentId?: string
  taskSpecId?: string
  fileId?: string
  taskTopic?: string
  startTime?: string
  endTime?: string
  /** '1' = 不过滤展示类任务规格（1001/1002/1007）；不传或非 '1' 则排除 */
  all?: string
}

export interface TaskPage {
  total: number
  list: TaskRow[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
export const TIME_INVALID_MSG = '时间范围不合法：startTime/endTime 支持 yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss，且结束时间不能早于开始时间'

/** 仅日期时：开始按当天 00:00:00、结束按当天 23:59:59 计（旧 api/task.js 同款） */
function normalizeTime(v: string, isEnd: boolean): string {
  if (DATE_RE.test(v)) return isEnd ? `${v} 23:59:59` : `${v} 00:00:00`
  return v
}

/** 空串 / 纯空白视为未传（旧层口径），并做时间合法性预校验 */
export function buildTaskQuery(query: TaskRowQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  FILTER_FIELDS.forEach((key) => {
    const v = (query as Record<string, unknown>)[key]
    if (v === undefined || v === null) return
    const s = String(v).trim()
    if (!s) return
    params[key] = s
  })

  const start = params.startTime as string | undefined
  const end = params.endTime as string | undefined
  const badTime = (start && !DATE_RE.test(start) && !DATETIME_RE.test(start))
    || (end && !DATE_RE.test(end) && !DATETIME_RE.test(end))
  let orderOk = true
  if (!badTime && start && end) {
    const s = Date.parse(normalizeTime(start, false).replace(' ', 'T'))
    const e = Date.parse(normalizeTime(end, true).replace(' ', 'T'))
    orderOk = e >= s
  }
  if (badTime || !orderOk) throw new Error(TIME_INVALID_MSG)

  params.page = query.page ?? 1
  params.limit = query.limit ?? 20
  return params
}

/** 任务实例分页（旧 taskInstPaged）。时间不合法时同步抛错，调用方按错误提示展示。 */
export function taskInstPaged(query: TaskRowQuery): Promise<TaskPage> {
  const params = buildTaskQuery(query)
  return request<TaskPage>('task/taskListPaged', params, {
    method: 'GET',
    httpEndpoint: 'task/topTaskPaged',
  })
}

/** 重发任务实例（旧 resendTask）：把选中任务重置为待发送。danger 端点，UI 侧保留二次确认。 */
export function resendTask(ids: string[]): Promise<{ message?: string }> {
  return request<{ message?: string }>('task/resetTaskInsts', { ids: ids.join(',') }, { method: 'GET' })
}
