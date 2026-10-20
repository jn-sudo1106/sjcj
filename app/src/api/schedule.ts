// 调度配置（job 域）—— 旧 data-view `src/api/source-job.js` 里跟「调度整体配置 / 定时任务」相关的那些。
//
// 端点契约（逐条对齐旧文件；路径去掉 /v1/ 前缀）：
//   GET  job/scheduleSummary        ?<范围参数>                          → 按 cron 表达式汇总（裸数组）
//   GET  job/jobsBySchedule         ?cron=&<范围参数>                    → 某表达式下的任务明细（裸数组）
//   POST job/updateScheduleByCron   ?oldCron=&newCron=&jobStatus=&confirmAll=&<范围参数>
//                                                                        → 范围内统一改表达式 / 启停
//   POST job/setScheduleByCategory  ?newCron=&jobStatus=&jobEnable=&createIfMissing=&confirmAll=&<范围参数>
//                                                                        → 按范围统一定时（可新建）
//   GET  job/snatchJobPaged         ?pageNo=&pageSize=&schedule=&sourceId=&ids=   → 任务明细分页
//   GET  job/runJob                 ?id=                                 → 立即运行
//   GET  job/deleteJob              ?id=                                 → 删除任务
//   GET  job/enableJob|disableJob   ?ids=a,b                             → 启停任务
//   GET  job/updateJob              ?id=&cron=                            → 改单个任务的 cron
//   GET  source/lastRun             ?cron=                               → 最近若干次运行时间（裸数组）
//
// ⚠️ POST 的这两个批量接口参数走 **query**（旧代码 `method:'post', params`），body 是空的。
// ⚠️ `job/snatchJobPaged` 后端读的是 pageNo/pageSize，前端这层旧代码又补了 page/limit，
//    两组都发（与 mq/queues 同款口径），别只发一组。
// ⚠️ 批量接口的返回信封丢了 msg：client.ts 的 normalizeHttpPayload 在 data 是对象时只回 data，
//    所以 setScheduleByCategory 拿不到后端那句文案，页面用 data 里的计数自己拼提示。
import { request } from './client'

/** 范围参数（与 sourcePaged 同一参数组，调度四个接口共用） */
export type ScheduleCond = Record<string, unknown>

export interface ScheduleSummaryRow {
  /** 调度表达式（表格 rowKey） */
  schedule: string
  jobCnt: number
  enableCnt: number
  disableCnt: number
  runningCnt: number
  /** 最近的下次执行时间 */
  minNextRun?: string
  [key: string]: unknown
}

export interface ScheduleJob {
  jobId: string
  jobName?: string
  sourceId?: string
  schedule?: string
  /** 运行状态：L=执行中，其它=等待执行 */
  state?: string
  nextRun?: string
  lastRun?: string
  runCnt?: number
  successCnt?: number
  /** 0=启用 / 1=停用（启停状态存的就是它，不是 state） */
  isDelete?: number
  enabled?: boolean
  [key: string]: unknown
}

/** 批量改表达式 / 启停的返回（job/updateScheduleByCron） */
export interface ScheduleUpdateResult {
  affected?: number
  total?: number
  skipped?: number
  skippedIds?: string[]
  [key: string]: unknown
}

/** 按范围统一定时的返回（job/setScheduleByCategory） */
export interface SetScheduleResult {
  total?: number
  created?: number
  updated?: number
  existed?: number
  skipped?: number
  skippedJobIds?: string[]
  [key: string]: unknown
}

/** 裸数组 / 分页信封 / {data:[...]} 三种形状都兜住 */
function pickList<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[]
  const box = res as { list?: unknown; data?: unknown } | null
  if (box && Array.isArray(box.list)) return box.list as T[]
  if (box && Array.isArray(box.data)) return box.data as T[]
  return []
}

/** 按 cron 表达式汇总：统计范围内每个表达式有多少任务、多少启用/停用/执行中（旧 getScheduleSummary） */
export async function getScheduleSummary(cond: ScheduleCond = {}): Promise<ScheduleSummaryRow[]> {
  const res = await request<unknown>('job/scheduleSummary', { ...cond }, { method: 'GET' })
  return pickList<ScheduleSummaryRow>(res)
}

/** 某表达式下的任务明细（旧 getJobsBySchedule）：cron 是主参数，cond 里即使有 cron 也剥掉 */
export async function getJobsBySchedule(cron: string, cond: ScheduleCond = {}): Promise<ScheduleJob[]> {
  // cond 里的 cron 是范围筛选的残留，必须剥掉，否则会盖掉真正的表达式参数
  const rest: ScheduleCond = { ...cond }
  delete rest.cron
  const res = await request<unknown>('job/jobsBySchedule', { cron, ...rest }, { method: 'GET' })
  return pickList<ScheduleJob>(res)
}

/**
 * 范围内统一修改表达式 / 启停（旧 updateScheduleByCron）。
 * @param oldCron  必填，当前表达式
 * @param newCron  新表达式；只启停时不传
 * @param opt.jobStatus  0 启用 / 1 停用（0 是有效值，不能按 falsy 过滤掉）
 * @param opt.confirmAll 无任何范围（=全部源）时必须显式带
 */
export async function updateScheduleByCron(
  oldCron: string,
  newCron: string | undefined,
  cond: ScheduleCond = {},
  opt: { jobStatus?: 0 | 1; confirmAll?: boolean } = {},
): Promise<ScheduleUpdateResult> {
  const params: Record<string, unknown> = { oldCron, ...cond }
  if (newCron !== undefined && newCron !== null && String(newCron).trim() !== '') {
    params.newCron = String(newCron).trim()
  }
  if (opt.jobStatus !== undefined && opt.jobStatus !== null) params.jobStatus = opt.jobStatus
  if (opt.confirmAll) params.confirmAll = true
  const res = await request<unknown>('job/updateScheduleByCron', params, {
    method: 'POST',
    paramsIn: 'query',
  })
  return (res ?? {}) as ScheduleUpdateResult
}

/** 按范围统一定时（旧 setScheduleByCategory）：范围内已有任务改 cron / 启停，没有的按选项新建 */
export async function setScheduleByCategory(param: Record<string, unknown>): Promise<SetScheduleResult> {
  const res = await request<unknown>('job/setScheduleByCategory', param, {
    method: 'POST',
    paramsIn: 'query',
  })
  return (res ?? {}) as SetScheduleResult
}

/** 任务明细分页（旧 snatchJobPaged）：pageNo/pageSize 与 page/limit 两组都发 */
export async function snatchJobPaged(query: {
  page?: number
  limit?: number
  schedule?: string
  sourceId?: string
  ids?: string
} = {}): Promise<{ list: ScheduleJob[]; total: number }> {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const params: Record<string, unknown> = { pageNo: page, pageSize: limit }
  if (query.schedule) params.schedule = query.schedule
  if (query.sourceId) params.sourceId = query.sourceId
  if (query.ids) params.ids = query.ids
  params.page = page
  params.limit = limit

  const res = await request<unknown>('job/snatchJobPaged', params, { method: 'GET' })
  const box = res as { list?: unknown; total?: unknown; data?: unknown; count?: unknown } | null
  const list = pickList<ScheduleJob>(res)
  const total = Number(box?.total ?? box?.count ?? list.length) || 0
  return { list, total }
}

/** 立即运行（旧 runJobs(jobId)） */
export async function runJob(jobId: string): Promise<unknown> {
  return request<unknown>('job/runJob', { id: jobId }, { method: 'GET' })
}

/** 删除任务（旧 deleteJobs(jobId)） */
export async function deleteJob(jobId: string): Promise<unknown> {
  return request<unknown>('job/deleteJob', { id: jobId }, { method: 'GET' })
}

/** 启停任务（旧 changeJobState(ids, checked)）：enable=true 走 enableJob，否则 disableJob，ids 逗号分隔 */
export async function changeJobState(ids: string[], enabled: boolean): Promise<unknown> {
  return request<unknown>(enabled ? 'job/enableJob' : 'job/disableJob', { ids: ids.join(',') }, { method: 'GET' })
}

/** 改单个任务的 cron（旧 updateSourceJob 只带 id + cron 的那条最常用路径） */
export async function updateJobCron(jobId: string, cron: string): Promise<unknown> {
  return request<unknown>('job/updateJob', { id: jobId, cron }, { method: 'GET' })
}

/**
 * 按条件枚举全部匹配的 jobId（旧 snatchJobIdsByCond）。
 * snatchJobPaged 要求至少一个过滤条件（id / sourceId / ids / schedule），
 * 所以 cond 全空时返回空列表；翻页上限 20000，超过就标 truncated。
 */
export async function snatchJobIdsByCond(
  cond: ScheduleCond,
  max = 20000,
): Promise<{ ids: string[]; truncated: boolean }> {
  const pageSize = 1000
  const seen = new Set<string>()
  const ids: string[] = []
  let page = 1
  let truncated = false
  // 页数硬上限：接口异常返回同一页时不至于死循环
  for (let guard = 0; guard < 50; guard += 1) {
    const { list, total } = await snatchJobPaged({
      page,
      limit: pageSize,
      schedule: cond.schedule == null ? undefined : String(cond.schedule),
      sourceId: cond.sourceId == null ? undefined : String(cond.sourceId),
      ids: cond.ids == null ? undefined : String(cond.ids),
    })
    list.forEach((job) => {
      const id = String(job.jobId ?? '')
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    })
    if (ids.length >= max) {
      truncated = ids.length > max || (total > 0 && total > max)
      ids.length = Math.min(ids.length, max)
      break
    }
    if (!list.length || list.length < pageSize) break
    if (total > 0 && page * pageSize >= total) break
    page += 1
  }
  return { ids, truncated }
}

/** cron 预览：最近若干次运行时间（旧 checkCron，裸数组） */
export async function previewCronTimes(cron: string): Promise<string[]> {
  const res = await request<unknown>('source/lastRun', { cron: cron.trim() }, { method: 'GET' })
  if (Array.isArray(res)) return res.map((item) => String(item))
  const box = res as { data?: unknown } | null
  if (box && Array.isArray(box.data)) return box.data.map((item) => String(item))
  return []
}
