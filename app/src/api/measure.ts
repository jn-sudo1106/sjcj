// 指标定义（旧 data-view `src/api/measure.js` → /v1/measure/*）。
//
// 端点契约 1:1 对齐旧平台 api/measure.js：
//   measurePaged          GET  /v1/measure/measurePaged   （旧层把 pageNo/pageSize 改名成 page/limit 再发）
//   addMeasure            POST /v1/measure/add            （body 为整条指标；旧层先 delete updateDt）
//   genMeasureFromSource  GET  /v1/measure/genMeasureFromSource （?sourceId=&entryTypeId=）
//   updateMeasure         POST /v1/measure/update         （body 为整条指标）
//   changeMeasureEnable   GET  /v1/measure/changeEnable   （?ids=a,b&enable=）
//   copyMeasure           GET  /v1/measure/copy           （?id=&name=&sourceId=）
//   deleteMeasures        POST /v1/measure/delete         （ids 在 query，不是 body）
//   deleteMeasurePhy      POST /v1/measure/deleteMeasurePhy（?id= 单个，物理删除）
//
// ⚠️ enable 的语义与 isDelete 同向：0 = 在用 / 1 = 停用 / -1 = 历史删除的 / '' = 全部
// （旧页「状态」下拉的四档就是这四个；与 dataset / mq-check 同一套）。
//
// ⚠️ 旧页 s-table 会把表头排序折算成 sortField（列 dataIndex）+ sortOrder（antd 原生
// 'ascend'/'descend'）一起发出去；MEASURE 只有 ID 一列带 `sorter`。后端认不认这两个键
// 未验证，这里**原样透传**（不删不改），与旧平台发出的请求体一致。
//
// ⚠️ 这 7 个写端点在 endpoints.ts 标了 live、并在 client.ts 的生产写白名单里，
// 所以非生产环境会真的打后端；生产环境仍会被写保护再拦一次（见 PRODUCTION_CREATE_ENDPOINTS）。
import { request } from './client'
import type { Paged } from './types/common'

/** 一条指标。字段名对齐旧平台 `allColumns.MEASURE` 与后端原始返回，不做重命名。 */
export interface MeasureRow {
  measureId: string | number
  /** 编码[唯一]（如 A00011） */
  measureCode?: string
  measureName?: string
  /** 源ID */
  sourceId?: string | number | null
  /** 指标类型 */
  measureType?: string
  /** 所属数据集 */
  datasetId?: string | number | null
  /** 条件表达式（匹配数据集字段，如 string.contains(K4,'环比涨跌') && K1=='沈阳'） */
  keyDef?: string
  /** 日期纬度 JSON（{"cols":"K2","type":"date",...}） */
  dimDef?: string
  /** 指标值1 JSON */
  val1Def?: string
  /** 指标值2 JSON（范围型指标才有） */
  val2Def?: string
  /** 单位（量纲）JSON */
  unitDef?: string
  /** 0 = 在用 / 1 = 停用 / <0 = 历史删除的 */
  isDelete?: number | string | null
  updateDt?: string
  /** 旧页「更多..」的「指标副本」不需要，但路由透传的 configId 会挂在 queryParam 上 */
  configId?: string | number | null
  [key: string]: unknown
}

/** 分页查询入参（筛选键名与旧页 queryParam 一致）。 */
export interface MeasureQuery {
  /** 数据集ID */
  datasetId?: string | number
  /** 源ID */
  sourceId?: string | number
  entryTypeId?: string | number
  /** 指标编码（模糊） */
  measureCode?: string
  /** '' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的 */
  enable?: string
  /** 分类筛选（左侧分类树 emit 出来的 categorys，逗号分隔） */
  categorys?: string
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
  paged: 'measure/measurePaged',
  add: 'measure/add',
  update: 'measure/update',
  changeEnable: 'measure/changeEnable',
  copy: 'measure/copy',
  remove: 'measure/delete',
  removePhy: 'measure/deleteMeasurePhy',
} as const

/** 旧平台分页参数（pageNo/pageSize）→ 契约口径（page/limit）。
 *  与 api/dataset.ts、api/queueCheck.ts 的 adaptPage 同一口径，本文件独立一份，避免动到既有模块。
 *  旧层是**只加不删**（page/pageNo 一起发），这里顺手把 pageNo/pageSize 去掉——它们对后端无意义。 */
function adaptPage(q: Record<string, unknown>): Record<string, unknown> {
  const { pageNo, pageSize, page, limit, ...rest } = q
  return {
    ...rest,
    page: page ?? pageNo,
    limit: limit ?? pageSize,
  }
}

/** 分页查询指标（旧 measurePaged） */
export function measurePaged(query: MeasureQuery): Promise<Paged<MeasureRow>> {
  return request<Paged<MeasureRow>>(EP.paged, adaptPage(query as Record<string, unknown>), { method: 'GET' })
}

/** 新增指标（旧 addMeasure）。旧层先 delete updateDt，剔除在调用侧做。 */
export function addMeasure(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.add, param, { method: 'POST' })
}

/** 修改指标（旧 updateMeasure） */
export function updateMeasure(param: Record<string, unknown>): Promise<unknown> {
  return request<unknown>(EP.update, param, { method: 'POST' })
}

/** 批量启停指标（旧 changeMeasureEnable(ids, enable)，enable 原样直传 0/1）。
 *  注意语义与 isDelete 同向：0 = 在用 / 1 = 停用。 */
export function changeMeasureEnable(ids: Array<string | number>, enable: number | string): Promise<unknown> {
  return request<unknown>(EP.changeEnable, { ids: ids.join(','), enable }, { method: 'GET' })
}

/** 复制/生成指标副本（旧 copyMeasure(id, name, sourceId)）。旧页只传 id。 */
export function copyMeasure(
  id: string | number,
  name?: string,
  sourceId?: string | number,
): Promise<unknown> {
  return request<unknown>(EP.copy, { id, name, sourceId }, { method: 'GET' })
}

/** 批量删除指标（旧 deleteMeasures）。对齐旧平台：POST ?ids=a,b（参数在 query，不是 body）。 */
export function deleteMeasures(ids: Array<string | number>): Promise<unknown> {
  return request<unknown>(EP.remove, { ids: ids.join(',') }, { method: 'POST', paramsIn: 'query' })
}

/** 物理删除单条指标（旧 deleteMeasurePhy(id)）。POST ?id=单个。 */
export function deleteMeasurePhy(id: string | number): Promise<unknown> {
  return request<unknown>(EP.removePhy, { id }, { method: 'POST', paramsIn: 'query' })
}

/** 由源生成指标（旧 genMeasureFromSource）。旧页 MeasureList 无入口；保留完整契约供后续接入。 */
export function genMeasureFromSource(
  sourceId: string | number,
  entryTypeId: string | number,
): Promise<unknown> {
  return request<unknown>('measure/genMeasureFromSource', { sourceId, entryTypeId }, { method: 'GET' })
}
