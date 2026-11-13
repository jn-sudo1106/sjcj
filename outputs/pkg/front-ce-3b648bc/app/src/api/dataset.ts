// 指标数据集（旧 data-view `src/api/dataset.js` → /v1/dataset/*）。
//
// 端点契约 1:1 对齐旧平台 api/dataset.js：
//   datasetPaged          GET  /v1/dataset/dataSetPaged   （旧层把 pageNo/pageSize 改名成 page/limit 再发）
//   updateDataSet         POST /v1/dataset/updateDataSet  （body 为整条数据集）
//   deleteDataSets        POST /v1/dataset/delete         （ids 在 query，不是 body）
//   changeDatasetEnable   GET  /v1/dataset/changeEnable   （?ids=a,b&enable=）
//   genDatasetFromSource  GET  /v1/dataset/genFromSource  （?sourceId=&entryTypeId=）
//   copyDataset           GET  /v1/dataset/copy           （?id=&name=&sourceId=）
//   runMeasureNow         GET  /v1/dataset/runNow         （?ids=a,b&last=）
//
// ⚠️ 分页路径是 **dataSetPaged（大写 S）**，不是 datasetPaged —— 旧前端 src/api/dataset.js:6 就是这个写法。
// endpoints.ts 里另有一条 `dataset/datasetPaged`（全小写），那是逆向清单留下的**逻辑名**，只服务
// api/index.ts 里那套 M4 演示服务（metricApi.datasets）；拿它当 URL 打后端会 404，所以这里用真实路径，
// 并且把 live 标在 `dataset/dataSetPaged` 这条上（usesMockAdapter 按真实 httpEndpoint 查表）。
//
// ⚠️ enable 的语义与 isDelete 同向：0 = 在用 / 1 = 停用 / -1 = 历史删除的 / '' = 全部
// （与 mq/check 相同，不是反的）。
//
// ⚠️ 这 6 个写端点在 endpoints.ts 标了 live、并在 client.ts 的生产写白名单里，
// 所以非生产环境会真的打后端；生产环境仍会被写保护再拦一次（见 PRODUCTION_CREATE_ENDPOINTS）。
import { request } from './client'
import type { Paged } from './types/common'

/** 一条数据集。字段名对齐旧平台 `allColumns.DATASET` 与后端原始返回，不做重命名。 */
export interface DatasetRow {
  datasetId: string | number
  datasetName?: string
  /** 源ID */
  sourceId?: string | number | null
  /** 表ID（实体表 entryTypeId） */
  entryTypeId?: string | number | null
  /** 指标数 */
  measureCnt?: number | string | null
  /** 上次ID（增量抓取的游标） */
  lastId?: number | string | null
  /** 定时（cron 表达式） */
  schedule?: string
  /** 上次运行 */
  lastRun?: string
  /** 下次运行 */
  nextRun?: string
  /** 执行次数 */
  runCnt?: number | string | null
  /** 成功次数 */
  successCnt?: number | string | null
  state?: string
  /** SQL 条件片断（如 STATE='C' AND K1='123'） */
  filters?: string
  /** 自定义查询 SQL */
  sqlDef?: string
  domain?: string
  /** 0 = 在用 / 1 = 停用 / <0 = 历史删除的 */
  isDelete?: number | string | null
  ver?: number | string | null
  createDt?: string
  updateDt?: string
  /** 旧页面 `$route.query.configId` 会透传这个键（数据集本身没有该列） */
  configId?: string | number | null
  [key: string]: unknown
}

/** 分页查询入参（筛选键名与旧页 queryParam 一致）。 */
export interface DatasetQuery {
  datasetId?: string | number
  sourceId?: string | number
  entryTypeId?: string | number
  /** 旧页 `$route.query.entryType` 透传键（旧 created 里写进 queryParam，随请求发出） */
  entryType?: string | number
  /** '' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的 */
  enable?: string
  configId?: string | number
  page?: number
  limit?: number
  /** 表头排序：字段 = 列 dataIndex，方向 = 'ascend' | 'descend'（antd 口径） */
  sortField?: string
  sortOrder?: string
  [key: string]: unknown
}

/** 端点路径：相对 client.ts 的 BASE_URL（/api/v1/） */
const EP = {
  paged: 'dataset/dataSetPaged',
  update: 'dataset/updateDataSet',
  remove: 'dataset/delete',
  changeEnable: 'dataset/changeEnable',
  genFromSource: 'dataset/genFromSource',
  copy: 'dataset/copy',
  runNow: 'dataset/runNow',
} as const

/** 旧平台分页参数（pageNo/pageSize）→ 契约口径（page/limit）。
 *  与 api/queueCheck.ts 的 adaptPage 同一口径，本文件独立一份，避免动到既有模块。
 *  旧层是**只加不删**（page/pageNo 一起发），这里顺手把 pageNo/pageSize 去掉——它们对后端无意义。 */
function adaptPage(q: Record<string, unknown>): Record<string, unknown> {
  const { pageNo, pageSize, page, limit, ...rest } = q
  return {
    ...rest,
    page: page ?? pageNo,
    limit: limit ?? pageSize,
  }
}

/** 分页查询数据集（旧 datasetPaged） */
export function datasetPaged(query: DatasetQuery): Promise<Paged<DatasetRow>> {
  return request<Paged<DatasetRow>>(EP.paged, adaptPage(query as Record<string, unknown>), { method: 'GET' })
}

/** 修改数据集（旧 updateDataSet）。提交体需剔除 createDt / updateDt / lastRun / nextRun，剔除在弹窗侧做。 */
export function updateDataSet(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.update, param, { method: 'POST' })
}

/** 批量删除数据集（旧 deleteDataSets）。对齐旧平台：POST ?ids=a,b（参数在 query，不是 body）。 */
export function deleteDataSets(ids: Array<string | number>): Promise<unknown> {
  return request<unknown>(EP.remove, { ids: ids.join(',') }, { method: 'POST', paramsIn: 'query' })
}

/** 批量启停数据集（旧 changeDatasetEnable(ids, enable)，enable 原样直传 0/1）。
 *  注意语义与 isDelete 同向：0 = 在用 / 1 = 停用。 */
export function changeDatasetEnable(ids: Array<string | number>, enable: number | string): Promise<unknown> {
  return request<unknown>(EP.changeEnable, { ids: ids.join(','), enable }, { method: 'GET' })
}

/** 由源快速生成数据集（旧 genDatasetFromSource） */
export function genDatasetFromSource(
  sourceId: string | number,
  entryTypeId: string | number,
): Promise<unknown> {
  return request<unknown>(EP.genFromSource, { sourceId, entryTypeId }, { method: 'GET' })
}

/** 制作数据集副本（旧 copyDataset(id, name, sourceId)）。旧页只传 id。 */
export function copyDataset(
  id: string | number,
  name?: string,
  sourceId?: string | number,
): Promise<unknown> {
  return request<unknown>(EP.copy, { id, name, sourceId }, { method: 'GET' })
}

/** 立即执行指标（旧 runMeasureNow(ids, last)）。`last` 为 null 表示「从上次 ID 继续」。 */
export function runMeasureNow(ids: Array<string | number>, last?: number | string | null): Promise<unknown> {
  return request<unknown>(EP.runNow, { ids: ids.join(','), last }, { method: 'GET' })
}
