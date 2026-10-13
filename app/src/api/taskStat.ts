// 任务统计（旧 data-view `src/api/task.js` 的 taskStat → 旧页 `src/page/inst/TaskStat.vue`，路由 /inst/task-stat）。
//
// 端点契约 1:1 对齐旧平台：
//   taskStat  GET /v1/task/stat?date=&startTime=&endTime=&group=source|config|both&sourceId=&configId=&state=
//
// 两条旧层口径：
//   1. **参数**:时间三选一(不并存)——`date`(yyyy-MM-dd) 或 `startTime`/`endTime`(yyyy-MM-dd HH:mm:ss)；
//      `group` 决定聚合维度(source=按来源 / config=按配置 / both=来源+配置)；`sourceId`/`configId`/`state` 是过滤。
//      空串/纯空白一律不发（与旧页 buildParams 的「过滤为空字符串的参数」一致）。
//   2. **响应体不是分页信封，而是行数组**：`{sourceId, configId, cnt, state?}`。
//      · 不带 state 请求 → 行里没有 state 字段（总数视角）
//      · 带多状态请求（如 state=E,C,AC,W1,W,L）→ 行里带 state（后端支持多状态聚合的判据，见页面 v2/v1 探测）
//      旧层 `(res.data || [])` 取的就是这个数组（旧 axios 拦截器返回整个 envelope）。
//      新 client 的 normalizeHttpPayload 在「envelope 带了 count/total」时会把数组包成 {list,total}，
//      所以这里统一解包，两种形态都能吃（后端真给 total 也不会把页面打崩）。
import { request } from './client'

/** 统计行（字段名与后端一致，不做改名） */
export interface TaskStatRow {
  sourceId?: string | number | null
  configId?: string | number | null
  cnt: number | string
  /** 仅「带 state 的聚合请求」才会返回；后端支持多状态聚合（v2）的判据 */
  state?: string
}

/** 聚合维度：按来源 / 按配置 / 来源+配置 */
export type TaskStatGroup = 'source' | 'config' | 'both'

export interface TaskStatQuery {
  group?: TaskStatGroup
  sourceId?: string
  configId?: string
  /** 单状态过滤（'E' 等）或逗号分隔的多状态（'E,C,AC,W1,W,L'） */
  state?: string
  /** 指定日期（yyyy-MM-dd）；与 startTime/endTime 互斥，后端优先用时间范围 */
  date?: string
  startTime?: string
  endTime?: string
}

const FILTER_KEYS = ['group', 'sourceId', 'configId', 'state', 'date', 'startTime', 'endTime'] as const

/** 空串 / 纯空白视为未传（旧页 buildParams 的同款口径），数字 0 保留 */
export function buildStatParams(query: TaskStatQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  FILTER_KEYS.forEach((key) => {
    const v = query[key]
    if (v === undefined || v === null) return
    const s = String(v).trim()
    if (!s) return
    params[key] = s
  })
  return params
}

/**
 * 解包统计响应。
 * 正常形态就是行数组；兼容 `{list: [...]}`（envelope 里带了 count/total 时 client 的形态）
 * 与 `{data: [...]}`（万一有人把旧 envelope 原样透传过来）。
 */
function rowsOf(res: unknown): TaskStatRow[] {
  if (Array.isArray(res)) return res as TaskStatRow[]
  const holder = res as { list?: unknown; data?: unknown } | null
  if (holder && Array.isArray(holder.list)) return holder.list as TaskStatRow[]
  if (holder && Array.isArray(holder.data)) return holder.data as TaskStatRow[]
  return []
}

/**
 * 任务统计查询（旧 taskStat）。
 * @param signal 用于取消被取代的请求（旧层用的是 axios CancelToken，新 client 只认 AbortSignal）。
 */
export async function taskStat(query: TaskStatQuery, signal?: AbortSignal): Promise<TaskStatRow[]> {
  const res = await request<unknown>('task/stat', buildStatParams(query), { method: 'GET', signal })
  return rowsOf(res)
}
