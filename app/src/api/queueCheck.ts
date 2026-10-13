// 队列告警（旧 data-view `src/api/queue-check.js` → 队列校验配置）。
//
// 端点契约 1:1 对齐旧平台 api/queue-check.js：
//   pagedQueueCheck          GET  /v1/mq/check/paged          （旧层把 pageNo/pageSize 改名成 page/limit 再发）
//   addQueueCheck            POST /v1/mq/check/add            （body 为整条配置）
//   updateQueueCheck         POST /v1/mq/check/update         （body 为整条配置）
//   changeQueueCheckEnable   GET  /v1/mq/check/changeEnable   （?ids=a,b&enable= 0=启用 / 1=停用）
//   deleteQueueCheck         POST /v1/mq/check/delete         （ids 在 query，不是 body）
//
// ⚠️ enable 的语义与 isDelete 同向：**0 = 在用 / 1 = 停用**（与 sourceCheck 相同，不是反的）。
// 这 5 条在 endpoints.ts 里标了 live，接口层面直接走真实后端（不再落回 mock），
// 生产环境的写类端点还会被 client.ts 的写保护白名单拦一次（见 PRODUCTION_CREATE_ENDPOINTS）。
import { request } from './client'
import type { Paged } from './types/common'
import type { MqCheck, MqCheckQuery } from './types/monitor'

// ---- 端点路径：相对 client.ts BASE_URL (/api/v1/) ----
const EP = {
  paged: 'mq/check/paged',
  add: 'mq/check/add',
  delete: 'mq/check/delete',
  update: 'mq/check/update',
  changeEnable: 'mq/check/changeEnable',
} as const

/** 将旧平台分页参数（pageNo/pageSize）映射到契约口径（page/limit）。
 *  与 api/monitor.ts 的 adaptPage 同一口径，本文件独立一份，避免动到既有模块。 */
function adaptPage(q: Record<string, unknown>): Record<string, unknown> {
  const { pageNo, pageSize, page, limit, ...rest } = q
  return {
    ...rest,
    page: page ?? pageNo,
    limit: limit ?? pageSize,
  }
}

/** 分页查询队列校验配置（旧 pagedQueueCheck） */
export function pagedQueueCheck(query: MqCheckQuery): Promise<Paged<MqCheck>> {
  return request<Paged<MqCheck>>(EP.paged, adaptPage(query as unknown as Record<string, unknown>), { method: 'GET' })
}

/** 新增队列校验配置（旧 addQueueCheck） */
export function addQueueCheck(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.add, param, { method: 'POST' })
}

/** 修改队列校验配置（旧 updateQueueCheck） */
export function updateQueueCheck(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.update, param, { method: 'POST' })
}

/** 批量启停队列校验配置（旧 changeQueueCheckEnable(ids, enable)，enable 原样直传 0/1）。
 *  enable=true 表示「想启用」→ 发 '0'；false 表示「想停用」→ 发 '1'。 */
export function changeQueueCheckEnable(ids: string[], enable: boolean): Promise<unknown> {
  return request<unknown>(EP.changeEnable, { ids: ids.join(','), enable: enable ? '0' : '1' }, { method: 'GET' })
}

/** 批量删除队列校验配置。对齐旧平台：POST ?ids=a,b（参数在 query，不是 body）。
 *  显式 paramsIn:'query' 同时保证 mock 分支的 handler 也能收到 ids。 */
export function deleteQueueCheck(ids: string[]): Promise<unknown> {
  return request<unknown>(EP.delete, { ids: ids.join(',') }, { method: 'POST', paramsIn: 'query' })
}
