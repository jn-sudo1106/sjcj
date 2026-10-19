import { BASE_URL, request } from './client'

/**
 * 通用埋点（`LogReportController`，后端前缀 `/api/v1/log-report`）。
 *
 * 三个接口、**两套响应信封**，这是本文件最容易踩的坑：
 * - `report` / `recent` 返回 `RspResult`：`success === true` 判成功，`code` 是**字符串**（"0" / "-1"）；
 * - `page` 返回 `Paged`：`code === 0` 判成功，`code` 是**数字**，且**参数非法时返回 1**（既不是 0 也不是 -1）。
 *
 * 约定（后端从登录会话取用户，前端不要传）：
 * - `USER_ID` / `GROUP_ID` 一律不传，传了也不生效；
 * - `contentType=SITE` 用于「最近打开的网站」（不是 SOURCE）；
 * - `ENTER` 返回 `visitId`，只有 `EXIT` 需要把它带回来；`closed === false` 是幂等正常态，不是错误；
 * - 上报是**尽力而为**：失败不弹提示、不阻塞主流程，调用方 `catch` 掉即可。
 *
 * 端点必须在 `api/endpoints.ts` 里登记且标 `live: true`，否则 mock 模式会抛「端点不在契约清单」；
 * 另外**绝不能标 `danger`**——生产写守卫只认 `DANGER_ENDPOINTS`，标了埋点在生产会被直接拦掉。
 */

/** 行为类型（后端枚举，大小写敏感） */
export type LogAction = 'ENTER' | 'EXIT' | 'CLICK' | 'EDIT' | 'CREATE' | 'DELETE' | 'SEARCH'

/** 内容类型（后端枚举，大小写敏感） */
export type LogContentType =
  | 'SOURCE'
  | 'FLOW'
  | 'CONFIG'
  | 'CATEGORY'
  | 'ENTRY_TYPE'
  | 'PARAM'
  | 'SITE'
  | 'GROUP'

/** `report` / `recent` 的信封：`code` 是字符串 */
export interface RspResult<T = unknown> {
  success: boolean
  code: string
  msg: string
  data: T
}

/** `page` 的信封：`code` 是数字（参数非法时为 1） */
export interface LogPaged<T> {
  code: number
  msg: string | null
  count: number
  data: T[]
  exts: null
}

/** `report` 返回的 data：ENTER 给 visitId，EXIT 给 closed，其它事件为 {} */
export interface LogReportAck {
  visitId?: string
  closed?: boolean
}

/** 上报入参（字段长度后端会自动截断，首尾空格会被去掉） */
export interface LogReportParams {
  action: LogAction
  /** action=EXIT 时必填，取自 ENTER 返回的 visitId */
  visitId?: string
  contentType?: LogContentType
  contentId?: string
  /** 建议必传：最近列表直接展示该值，不传标题会是空的 */
  contentTitle?: string
  /** 事件编码，最长 64 */
  eventCode?: string
  /** 事件显示名，最长 100 */
  eventName?: string
  /** 一级模块，最长 64 */
  firstModule?: string
  /** 页面名称，最长 100 */
  pageName?: string
  /** 页面入口来源，最长 100 */
  pageEntry?: string
  /** 搜索关键词，最长 500 */
  keyword?: string
  requestId?: string
  sourceFrom?: string
  sceneId?: string
  operationResults?: number
}

/** 最近列表项：后端只回这三个字段 */
export interface RecentLogItem {
  contentId: string
  contentTitle: string | null
  /** 该内容最近一次行为时间（yyyy-MM-dd HH:mm:ss） */
  createDt: string
}

/** 行为明细（`page` 返回，不去重，一次访问一条） */
export interface LogRecord {
  id: number
  userId: number
  groupId: number
  action: LogAction
  /** 只有 ENTER 行有值 */
  visitId: string | null
  eventCode: string | null
  eventName: string | null
  firstModule: string | null
  pageName: string | null
  pageEntry: string | null
  contentType: LogContentType
  contentId: string
  contentTitle: string | null
  /** 事件发生时间（ENTER 行即进入时间） */
  createDt: string
  /** EXIT 上报后才有值 */
  exitTime: string | null
  /** 停留时长（毫秒），EXIT 上报后才有值 */
  viewTime: number | null
  keyword: string | null
  requestId: string | null
  sourceFrom: string | null
  sceneId: string | null
  operationResults: number | null
  isDelete: number
}

export interface RecentLogQuery {
  contentType: LogContentType
  /** 多个用英文逗号分隔，默认 ENTER */
  action?: string
  /** 默认 20，最大 100 */
  limit?: number
}

export interface LogPageQuery {
  contentType?: LogContentType
  action?: string
  /** 默认 1 */
  page?: number
  /** 默认 20，最大 100 */
  limit?: number
}

// ---- 端点：相对 client.ts 的 BASE_URL（/api/v1/）----
const EP = {
  report: 'log-report/report',
  recent: 'log-report/recent',
  page: 'log-report/page',
} as const

export const logReportApi = {
  /**
   * 通用上报（返回原始信封）。
   * ENTER → 取 `data.visitId`；EXIT → 取 `data.closed`；其它事件 `data` 为 `{}`。
   */
  report(params: LogReportParams): Promise<RspResult<LogReportAck>> {
    return request<RspResult<LogReportAck>>(EP.report, { ...params }, { method: 'POST' })
  },

  /**
   * 最近列表（**原始信封**）。需要区分「成功但为空」与「请求失败」时用这个
   * （比如本地已有数据，失败要保留现状、不能当成空列表冲掉）。
   */
  recentRaw(query: RecentLogQuery): Promise<RspResult<RecentLogItem[]>> {
    return request<RspResult<RecentLogItem[]>>(EP.recent, { ...query }, { method: 'GET' })
  },

  /**
   * 最近列表（已按 contentId 去重、按时间倒序）。
   *
   * 这里**直接解包成数组**：埋点读取属于辅助信息，失败/空一律返回 `[]`，
   * 让调用方不用每次都判 `success`/`data`，也别因为埋点挂了打断页面。原始信封请用 {@link recentRaw}。
   */
  async recent(query: RecentLogQuery): Promise<RecentLogItem[]> {
    const res = await this.recentRaw(query)
    if (!res || res.success !== true || !Array.isArray(res.data)) return []
    return res.data
  },

  /** 行为明细分页（原始 `Paged`：调用方用 `code === 0` 判成功，注意参数非法时是 1） */
  page(query: LogPageQuery = {}): Promise<LogPaged<LogRecord>> {
    return request<LogPaged<LogRecord>>(EP.page, { ...query }, { method: 'GET' })
  },

  /**
   * 进入页面/详情：返回 `visitId` 供 EXIT 使用。
   * 失败返回 `null`（不抛），调用方照常跳转。
   */
  async enter(params: Omit<LogReportParams, 'action'>): Promise<string | null> {
    try {
      const res = await this.report({ ...params, action: 'ENTER' })
      return res?.success === true ? (res.data?.visitId ?? null) : null
    } catch {
      return null
    }
  },

  /** 退出页面：必须带 `visitId`；`closed === false` 表示已关过或记录不存在，属正常幂等 */
  async exit(params: Omit<LogReportParams, 'action' | 'visitId'> & { visitId: string }): Promise<boolean> {
    try {
      const res = await this.report({ ...params, action: 'EXIT' })
      return res?.success === true
    } catch {
      return false
    }
  },

  /**
   * 页面卸载兜底上报：用 `sendBeacon` 发，避免 `pagehide` 时普通请求被浏览器中断。
   *
   * ⚠️ `sendBeacon` 不能带自定义请求头，只适合**会话 Cookie 鉴权**的接口；
   * 这里只用于 EXIT 这类"丢了也无所谓"的尽力上报，失败静默。
   */
  beacon(params: LogReportParams): void {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
    try {
      const body = JSON.stringify(params)
      const url = `${BASE_URL}${EP.report}`
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
    } catch {
      /* 尽力而为 */
    }
  },
}
