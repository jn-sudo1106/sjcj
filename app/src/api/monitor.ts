import { request } from './client'
import type { Paged } from './types/common'
import type {
  SourceCheck,
  SourceCheckDetailPayload,
  SourceCheckLog,
  SourceCheckLogQuery,
  SourceCheckQuery,
  SourceCheckRunAccepted,
  SourceCheckRunItem,
  SourceCheckRunPage,
} from './types/monitor'

// ---- 端点路径：相对 client.ts BASE_URL (/api/v1/) ----
const EP = {
  paged: 'source/check/paged',
  add: 'source/check/add',
  delete: 'source/check/delete',
  update: 'source/check/update',
  changeEnable: 'source/check/changeEnable',
  runNow: 'source/check/runNow',
  checkOne: 'source/check/check-one',
  pagedLogs: 'source/check/paged-logs',
  lastRun: 'source/lastRun',
  /** C07 首期：源维度聚合（服务端按源分页，含未配置检查的源） */
  sourceSummary: 'source/check/sourceSummary',
  sourceSummaryStats: 'source/check/sourceSummaryStats',
  /** C01 单条检查项详情（monitor + 解析后的 checkConf + 有效版本） */
  detail: 'source/check/detail',
  /** C06 运行记录分页 / 单次运行详情 / 手动运行受理 */
  runs: 'source/check/runs',
  run: 'source/check/run',
} as const

// ---- 入参适配：旧平台用 pageNo/pageSize，新平台 mock + client.ts 契约统一 page/limit ----

/** 将旧平台分页参数（pageNo/pageSize）映射到契约口径（page/limit） */
function adaptPage(q: Record<string, unknown>): Record<string, unknown> {
  const { pageNo, pageSize, page, limit, ...rest } = q as Record<string, unknown>
  return {
    ...rest,
    page: page ?? pageNo,
    limit: limit ?? pageSize,
  }
}

// ---- API ----

/** 分页查询源检查列表 */
export function pagedSourceCheck(query: SourceCheckQuery): Promise<Paged<SourceCheck>> {
  return request<Paged<SourceCheck>>(EP.paged, adaptPage(query), { method: 'GET' })
}

/** 源维度聚合（C07 首期）。
 * 与 `paged` 的区别：行是「源」不是「检查记录」，未配置检查的源也会返回，
 * 由服务端按登录用户分组过滤（不要在前端拼全量源目录代替）。
 */
export function pagedSourceSummary(query: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(EP.sourceSummary, adaptPage(query), { method: 'GET' })
}

/** 源维度聚合的全站/本组统计（不分页，只按 siteId+keyword 收范围） */
export function pagedSourceSummaryStats(query: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(EP.sourceSummaryStats, adaptPage(query), { method: 'GET' })
}

/** 分页查询源检查历史日志 */
export function pagedCheckJobLogs(query: SourceCheckLogQuery): Promise<Paged<SourceCheckLog>> {
  return request<Paged<SourceCheckLog>>(EP.pagedLogs, adaptPage(query), { method: 'GET' })
}

/** 执行一次源检查 */
export function checkOneManual(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.checkOne, param, { method: 'POST' })
}

/** 新增源检查 */
export function addSourceCheck(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.add, param, { method: 'POST' })
}

/** 修改源检查 */
export function updateSourceCheck(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.update, param, { method: 'POST' })
}

/** 批量启停源检查
 * 旧契约 enable 语义是反的：'0' = 启用, '1' = 停用（与 isDelete 同口径）。
 * 入参 enable=true 表示"想启用" → 发 '0'，enable=false 表示"想停用" → 发 '1'。
 * 方法对齐旧平台 `changeState`（GET /v1/source/check/changeEnable?ids=&enable=）。
 */
export function changeSourceCheckEnable(ids: string[], enable: boolean): Promise<unknown> {
  return request<unknown>(EP.changeEnable, { ids: ids.join(','), enable: enable ? '0' : '1' }, {
    method: 'GET',
  })
}

/** 批量启停源检查（原名 changeState，保持向后兼容） */
export const changeState = changeSourceCheckEnable

/** 批量删除源检查。对齐旧平台：POST /v1/source/check/delete?ids= （ids 放 query，无 body）。
 *  显式 paramsIn:'query' 有两个作用：http 保持旧契约（query 传参）；mock 分支 handler 也能收到 ids。 */
export function deleteSourceCheck(ids: string[]): Promise<unknown> {
  return request<unknown>(EP.delete, { ids: ids.join(',') }, { method: 'POST', paramsIn: 'query' })
}

/** 立即运行源检查。对齐旧平台 `handleRunNow`（GET /v1/source/check/runNow?ids=） */
export function handleRunNow(ids: string[]): Promise<unknown> {
  return request<unknown>(EP.runNow, { ids: ids.join(',') }, { method: 'GET' })
}

/**
 * 定时预览：按 cron 表达式推算最近若干次运行时间（「定时」弹窗的「测试」按钮）。
 * 对齐旧平台 `checkCron`（GET /v1/source/lastRun?cron=），返回**裸数组**（旧前端直接当数组用）。
 * cron 里的 `?` / `/` / `*` 由 appendQuery 统一 URL 编码，不要手工再 encode 一次。
 */
export function checkCron(cron: string): Promise<string[]> {
  return request<string[]>(EP.lastRun, { cron }, { method: 'GET' })
}

// ---------- C01 / C05 / C06 结构化接口 ----------
//
// 后端新加的单条详情 / 运行记录 / 手动运行端点，尚未登记进 `api/endpoints.ts` 的契约清单
// （该文件不在本次改动范围）。不登记时 mock 模式会直接抛「端点不在契约清单」，
// 所以这里按调用强制 `mode: 'http'`，与 sourceIssues / sourceViews 的做法一致：
// 契约不完整时按调用走真实，而不是把端点硬塞进清单。

/** 运行记录查询入参（GET /source/check/runs；monitorId / sourceId 至少给一个） */
export interface CheckRunsQuery {
  monitorId?: string
  sourceId?: string
  /** ck_source 口径：C=完成 / E=异常 */
  state?: string
  page?: number
  limit?: number
}

/** 单次运行详情的定位参数（GET /source/check/run/{runId}） */
export interface CheckRunLookup {
  monitorId?: string
  /** 旧日志用 job-log 的 logId 兜底定位 */
  logId?: string
}

/** C01 单条检查项详情：monitor 行 + 服务端解析后的 checkConf + 当前有效版本 */
export function getSourceCheckDetail(monitorId: string): Promise<SourceCheckDetailPayload> {
  return request<SourceCheckDetailPayload>(EP.detail, { monitorId }, { method: 'GET', mode: 'http' })
}

/** C06 运行记录分页（代替旧的 paged-logs：REMARKS 已在服务端结构化） */
export function pagedCheckRuns(params: CheckRunsQuery): Promise<SourceCheckRunPage> {
  return request<SourceCheckRunPage>(EP.runs, { ...params }, { method: 'GET', mode: 'http' })
}

/** C06 单次运行详情；找不到时后端回 success:false（client 解包成 reject） */
export function getCheckRun(runId: string, params: CheckRunLookup = {}): Promise<SourceCheckRunItem> {
  return request<SourceCheckRunItem>(`${EP.run}/${encodeURIComponent(runId)}`, { ...params }, {
    method: 'GET',
    mode: 'http',
  })
}

/**
 * C05 手动运行：一次带上全部 ids，由服务端按配置分流（rule 走旧规则引擎 / ai 走执行器）。
 * `apply=false` 只预览不落库。
 */
export function runChecksNow(ids: Array<string | number>, apply?: boolean): Promise<SourceCheckRunAccepted> {
  const monitorIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
  const body: { ids: number[]; apply?: boolean } = { ids: monitorIds }
  if (apply !== undefined) body.apply = apply
  return request<SourceCheckRunAccepted>(EP.run, body, { method: 'POST', mode: 'http' })
}
