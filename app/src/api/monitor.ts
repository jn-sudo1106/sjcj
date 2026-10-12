import { request } from './client'
import type { Paged } from './types/common'
import type { SourceCheck, SourceCheckLog, SourceCheckQuery, SourceCheckLogQuery } from './types/monitor'

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
