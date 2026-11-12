// 通用定时任务 / 自定义告警（旧 data-view `src/api/comm-job.js` → 旧页 CommJobList.vue）。
//
// 端点契约 1:1 对齐旧平台 api/comm-job.js：
//   pagedCommJobCheck          GET  /v1/comm-job/paged          （旧层把 pageNo/pageSize 改名成 page/limit 再发）
//   addCommJobCheck            POST /v1/comm-job/add            （body 为整条配置）
//   updateCommJobCheck         POST /v1/comm-job/update         （body 为整条配置）
//   changeCommJobCheckEnable   GET  /v1/comm-job/changeEnable   （?ids=a,b&enable= 0=启用 / 1=停用）
//   deleteCommJobCheck         POST /v1/comm-job/delete         （ids 在 query，不是 body）
//   commJobCopy                POST /v1/comm-job/copy           （?id=xx，**在 query**）
//   runCommJob                 POST /v1/comm-job/run            （?id=xx，**在 query**）
//
// ⚠️ 1. enable 的语义与 isDelete 同向：**0 = 在用 / 1 = 停用**（与 sourceCheck / queueCheck 一致，不是反的）。
//    2. copy / run 是 POST 但参数走 query（旧层写的就是 `method:'post', params`），所以显式标 paramsIn:'query'。
//    3. 旧清单里的 comm-job/enable 与 comm-job/disable 两条是早期按后缀猜的，真实前端从未调用过；
//       实际只有单条 changeEnable（见 endpoints.ts 的修正注释）。
//
// 这 7 条在 endpoints.ts 里都标了 live，接口层面直接走真实后端（不再落回 mock），
// 生产环境的写类端点还会被 client.ts 的写保护白名单拦一次（见 PRODUCTION_CREATE_ENDPOINTS）。
import { request } from './client'
import type { Paged } from './types/common'
import type { CommJob, CommJobQuery } from './types/monitor'

// ---- 端点路径：相对 client.ts BASE_URL (/api/v1/) ----
const EP = {
  paged: 'comm-job/paged',
  add: 'comm-job/add',
  update: 'comm-job/update',
  delete: 'comm-job/delete',
  changeEnable: 'comm-job/changeEnable',
  copy: 'comm-job/copy',
  run: 'comm-job/run',
} as const

/** 将旧平台分页参数（pageNo/pageSize）映射到契约口径（page/limit）。
 *  与 api/queueCheck.ts 的 adaptPage 同一口径，本文件独立一份，避免动到既有模块。 */
function adaptPage(q: Record<string, unknown>): Record<string, unknown> {
  const { pageNo, pageSize, page, limit, ...rest } = q
  return {
    ...rest,
    page: page ?? pageNo,
    limit: limit ?? pageSize,
  }
}

/** 分页查询通用任务（旧 pagedCommJobCheck） */
export function pagedCommJobCheck(query: CommJobQuery): Promise<Paged<CommJob>> {
  return request<Paged<CommJob>>(EP.paged, adaptPage(query as unknown as Record<string, unknown>), { method: 'GET' })
}

/** 新增通用任务（旧 addCommJobCheck） */
export function addCommJobCheck(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.add, param, { method: 'POST' })
}

/** 修改通用任务（旧 updateCommJobCheck） */
export function updateCommJobCheck(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.update, param, { method: 'POST' })
}

/** 批量启停通用任务（旧 changeCommJobCheckEnable(ids, enable)，enable 原样直传 0/1）。
 *  enable=true 表示「想启用」→ 发 '0'；false 表示「想停用」→ 发 '1'。 */
export function changeCommJobCheckEnable(ids: string[], enable: boolean): Promise<unknown> {
  return request<unknown>(EP.changeEnable, { ids: ids.join(','), enable: enable ? '0' : '1' }, { method: 'GET' })
}

/** 批量删除通用任务。对齐旧平台：POST ?ids=a,b（参数在 query，不是 body）。
 *  显式 paramsIn:'query' 同时保证 mock 分支的 handler 也能收到 ids。 */
export function deleteCommJobCheck(ids: string[]): Promise<unknown> {
  return request<unknown>(EP.delete, { ids: ids.join(',') }, { method: 'POST', paramsIn: 'query' })
}

/** 复制一条通用任务（旧 commJobCopy(record.jobId)，POST ?id=xx） */
export function commJobCopy(id: string): Promise<unknown> {
  return request<unknown>(EP.copy, { id }, { method: 'POST', paramsIn: 'query' })
}

/** 立即运行一条通用任务（旧 runCommJob(record.jobId)，POST ?id=xx） */
export function runCommJob(id: string): Promise<unknown> {
  return request<unknown>(EP.run, { id }, { method: 'POST', paramsIn: 'query' })
}
