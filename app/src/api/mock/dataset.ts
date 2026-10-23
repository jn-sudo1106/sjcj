// 指标数据集（/v1/dataset/*）mock —— 旧 data-view `src/api/dataset.js` 的 7 个端点。
//
// 内存表：写操作真落库，刷新 paged 能看到变更（与 mock/queueCheck.ts、mock/monitor.ts 同一套路）。
// 契约口径都按旧平台页面语义对齐：
//   · 旧 s-table 发的是 pageNo/pageSize，api 层改写成 page/limit（本文件按改完的口径收参）；
//   · enable 与 isDelete 同向：'0'=在用 / '1'=停用 / '-1'=历史删除的 / ''=全部；
//   · 表头排序：sortField（列 dataIndex）+ sortOrder（'ascend' / 'descend'）。
//
// ⚠️ 旧页 loadData 是 `Object.assign(parameter, queryParam)`，所以 datasetId/sourceId/entryTypeId/
//    enable 四个筛选键 + 路由透传的 entryType/configId 都会进请求；entryType/configId 后端是不是真
//    认这两个键无从考证（数据集表上没有对应列），本 mock 忽略它们——筛选只看四个已知键。
// ⚠️ 删除做的是**物理删除**（演示上更直观）；真实后端的 `/delete` 也可能只是逻辑删除
//    （旧页「状态」筛选有「历史删除的」一档，说明存在 isDelete<0 的记录，如 ds-... 见 SEEDS 里的 1011）。
import type { DatasetRow, DatasetQuery } from '../dataset'
import type { Paged } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** 内存表：全部写操作落这里。字段名与真实后端一致（不做驼峰转换）。 */
const DATASETS: DatasetRow[] = [
  {
    datasetId: 1001, datasetName: '公告明细数据集', sourceId: 161725, entryTypeId: 1001,
    measureCnt: 6, lastId: 88213, schedule: '0 0 3 * * ?',
    lastRun: '2026-10-13 03:00:12', nextRun: '2026-10-14 03:00:00',
    runCnt: 412, successCnt: 408, state: 'C',
    filters: "STATE='C' AND K1='公告'", sqlDef: '', domain: 'sense', isDelete: 0, ver: 3,
    createDt: '2026-05-11 09:20:00', updateDt: '2026-10-13 03:00:12',
  },
  {
    datasetId: 1002, datasetName: '基金评论数据集', sourceId: 161801, entryTypeId: 1002,
    measureCnt: 3, lastId: 40921, schedule: '0 0/30 * * * ?',
    lastRun: '2026-10-13 08:30:04', nextRun: '2026-10-13 09:00:00',
    runCnt: 2861, successCnt: 2861, state: 'C',
    filters: '', sqlDef: 'SELECT ENTRY_ID, K1 FROM TB_TEST WHERE STATE = \'C\'', domain: 'sense', isDelete: 0, ver: 1,
    createDt: '2026-06-02 14:05:00', updateDt: '2026-10-13 08:30:04',
  },
  {
    datasetId: 1003, datasetName: '微博舆情数据集', sourceId: 162050, entryTypeId: 1003,
    measureCnt: 2, lastId: 7710, schedule: '',
    lastRun: '2026-10-13 07:45:31', nextRun: '—',
    runCnt: 96, successCnt: 71, state: 'E',
    filters: "K2 LIKE '%转发%'", sqlDef: '', domain: 'sense', isDelete: 0, ver: 5,
    createDt: '2026-07-18 10:00:00', updateDt: '2026-10-13 07:45:31',
  },
  {
    datasetId: 1004, datasetName: '行情快照数据集', sourceId: 161900, entryTypeId: 1004,
    measureCnt: 9, lastId: 1204551, schedule: '0/10 * * * * ?',
    lastRun: '2026-10-13 08:36:10', nextRun: '2026-10-13 08:36:20',
    runCnt: 88210, successCnt: 88103, state: 'C',
    filters: '', sqlDef: '', domain: 'quote', isDelete: 0, ver: 2,
    createDt: '2026-04-09 08:30:00', updateDt: '2026-10-13 08:36:10',
  },
  {
    datasetId: 1005, datasetName: '财经新闻数据集', sourceId: 161901, entryTypeId: 1005,
    measureCnt: 0, lastId: 0, schedule: 'AFTER:30',
    lastRun: '', nextRun: '',
    runCnt: 0, successCnt: 0, state: 'W',
    filters: "STATE='C'", sqlDef: '', domain: 'sense', isDelete: 0, ver: 1,
    createDt: '2026-10-12 16:20:00', updateDt: '2026-10-12 16:20:00',
  },
  {
    datasetId: 1006, datasetName: '招聘岗位数据集', sourceId: 161725, entryTypeId: 1006,
    measureCnt: 4, lastId: 20318, schedule: '0 0 22 * * ?',
    lastRun: '2026-10-12 22:00:09', nextRun: '2026-10-13 22:00:00',
    runCnt: 188, successCnt: 180, state: 'C',
    filters: '', sqlDef: '', domain: 'job', isDelete: 0, ver: 4,
    createDt: '2026-05-30 11:00:00', updateDt: '2026-10-12 22:00:09',
  },
  {
    datasetId: 1007, datasetName: '企业工商数据集', sourceId: 162050, entryTypeId: 1007,
    measureCnt: 1, lastId: 5312, schedule: '0 0 0 1 * ?',
    lastRun: '2026-10-01 00:00:31', nextRun: '2026-11-01 00:00:00',
    runCnt: 6, successCnt: 6, state: 'C',
    filters: "K1='工商'", sqlDef: '', domain: 'biz', isDelete: 0, ver: 2,
    createDt: '2026-06-20 09:00:00', updateDt: '2026-10-01 00:00:31',
  },
  {
    datasetId: 1008, datasetName: '论坛帖子数据集（已停用）', sourceId: 161801, entryTypeId: 1008,
    measureCnt: 2, lastId: 9930, schedule: '0 0 0/2 * * ?',
    lastRun: '2026-09-27 04:00:07', nextRun: '—',
    runCnt: 132, successCnt: 118, state: 'C',
    filters: '', sqlDef: '', domain: 'bbs', isDelete: 1, ver: 7,
    createDt: '2026-04-21 15:40:00', updateDt: '2026-09-27 04:00:07',
  },
  {
    datasetId: 1009, datasetName: '电商价格数据集', sourceId: 161900, entryTypeId: 1009,
    measureCnt: 5, lastId: 62140, schedule: '0 0 0/1 * * ?',
    lastRun: '2026-10-13 08:00:02', nextRun: '2026-10-13 09:00:00',
    runCnt: 1560, successCnt: 1547, state: 'C',
    filters: "K3 LIKE '%价格%'", sqlDef: '', domain: 'shop', isDelete: 0, ver: 6,
    createDt: '2026-03-15 10:10:00', updateDt: '2026-10-13 08:00:02',
  },
  {
    datasetId: 1010, datasetName: '物流轨迹数据集', sourceId: 161901, entryTypeId: 1010,
    measureCnt: 0, lastId: 0, schedule: '',
    lastRun: '', nextRun: '',
    runCnt: 0, successCnt: 0, state: 'W',
    filters: '', sqlDef: '', domain: 'logistics', isDelete: 0, ver: 0,
    createDt: '2026-10-13 15:10:00', updateDt: '2026-10-13 15:10:00',
  },
  {
    datasetId: 1011, datasetName: '旧版文章数据集', sourceId: 161725, entryTypeId: 1011,
    measureCnt: 0, lastId: 44120, schedule: '0 0 5 * * ?',
    lastRun: '2026-08-14 05:00:03', nextRun: '—',
    runCnt: 240, successCnt: 231, state: 'C',
    filters: '', sqlDef: '', domain: 'sense', isDelete: -1, ver: 9,
    createDt: '2026-02-02 09:00:00', updateDt: '2026-08-14 05:00:03',
  },
]

/** 主键自增：新增数据集（由源生成 / 制作副本）取 max+1，模拟后端自增 */
let nextDatasetId = Math.max(...DATASETS.map((d) => Number(d.datasetId))) + 1

/** 可分页排序的列（与列定义里的 sorter 一致）：其余字段一律忽略，避免脏参数影响演示。
 *  旧页 7 列可排序：datasetId / measureCnt / entryTypeId / lastId / lastRun / nextRun / sourceId。 */
const SORTABLE_FIELDS = new Set([
  'datasetId', 'measureCnt', 'entryTypeId', 'lastId', 'lastRun', 'nextRun', 'sourceId',
])
/** 按数值排的列；其余（lastRun / nextRun 是时间串）按字符串排 */
const NUMERIC_FIELDS = new Set(['datasetId', 'measureCnt', 'entryTypeId', 'lastId', 'sourceId'])

/** 分页查询：旧页面筛选口径（datasetId / sourceId / entryTypeId / enable→isDelete）+ 表头排序 */
export function mockDatasetPaged(params?: DatasetQuery): Paged<DatasetRow> {
  const datasetId = String(params?.datasetId ?? '').trim()
  const sourceId = String(params?.sourceId ?? '').trim()
  const entryTypeId = String(params?.entryTypeId ?? '').trim()
  const enable = String(params?.enable ?? '')
  const page = Math.max(1, Number(params?.page ?? 1) || 1)
  const limit = Math.max(1, Number(params?.limit ?? 10) || 10)
  const sortField = String(params?.sortField ?? '').trim()
  const sortOrder = String(params?.sortOrder ?? '').trim()

  const matched = DATASETS.filter((row) => {
    if (datasetId && !String(row.datasetId).includes(datasetId)) return false
    if (sourceId && !String(row.sourceId ?? '').includes(sourceId)) return false
    if (entryTypeId && !String(row.entryTypeId ?? '').includes(entryTypeId)) return false
    if (enable === '0' && Number(row.isDelete) !== 0) return false
    if (enable === '1' && Number(row.isDelete) !== 1) return false
    if (enable === '-1' && !(Number(row.isDelete) < 0)) return false
    return true
  })

  if (SORTABLE_FIELDS.has(sortField) && (sortOrder === 'ascend' || sortOrder === 'descend')) {
    const dir = sortOrder === 'ascend' ? 1 : -1
    // 注意 matched 是 filter 出来的新数组，排序不会动到内存表本身的顺序
    matched.sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      if (NUMERIC_FIELDS.has(sortField)) {
        return ((Number(av) || 0) - (Number(bv) || 0)) * dir
      }
      // 空值恒排最后（'—' 和空串都不该冒到前面）
      const at = String(av ?? '')
      const bt = String(bv ?? '')
      if (!at && !bt) return 0
      if (!at) return 1
      if (!bt) return -1
      return at.localeCompare(bt) * dir
    })
  }

  return { total: matched.length, list: matched.slice((page - 1) * limit, page * limit) }
}

/** 修改（按 datasetId 定位，只覆盖传了的字段） */
export function mockDatasetUpdate(params?: Record<string, unknown>) {
  const datasetId = String(params?.datasetId ?? '')
  const row = DATASETS.find((r) => String(r.datasetId) === datasetId)
  if (!row) return { ok: false, message: '未找到要修改的数据集' }
  const text = (key: string) => (params?.[key] == null ? undefined : String(params[key]))
  for (const key of ['datasetName', 'schedule', 'filters', 'sqlDef', 'domain'] as const) {
    const value = text(key)
    if (value !== undefined) row[key] = value
  }
  if (params?.sourceId != null) row.sourceId = params.sourceId as DatasetRow['sourceId']
  if (params?.entryTypeId != null) row.entryTypeId = params.entryTypeId as DatasetRow['entryTypeId']
  if (params?.lastId != null) row.lastId = Number(params.lastId) || 0
  row.updateDt = stamp(new Date())
  return { ok: true, message: '修改成功（演示）' }
}

/** 批量启停（enable 与 isDelete 同向：0=启用 / 1=停用） */
export function mockDatasetChangeEnable(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const enable = Number(params?.enable ?? 0)
  const nextIsDelete = enable === 0 ? 0 : 1
  let hit = 0
  for (const id of ids) {
    const row = DATASETS.find((r) => String(r.datasetId) === id)
    if (row) {
      row.isDelete = nextIsDelete
      row.updateDt = stamp(new Date())
      hit++
    }
  }
  return { ok: true, demo: true, message: hit > 0 ? (enable === 0 ? '已启用' : '已停用') : '未找到对应记录' }
}

/** 删除（ids 走 query，逗号分隔）。
 *  注意：这里做的是**物理删除**（演示上更直观）；真实后端的 `/delete` 也可能是逻辑删除
 *  （把 isDelete 置成负数，列表里仍能按「历史删除的」筛出来，比如 1011），联调时按真实回执确认。 */
export function mockDatasetDelete(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const before = DATASETS.length
  for (const id of ids) {
    const idx = DATASETS.findIndex((r) => String(r.datasetId) === id)
    if (idx >= 0) DATASETS.splice(idx, 1)
  }
  return { ok: true, message: `删除 ${before - DATASETS.length} 条成功（演示）` }
}

/** 由源快速生成数据集（源 + 表ID 生成一条空白数据集，指标数 0） */
export function mockDatasetGenFromSource(params?: Record<string, unknown>) {
  const sourceId = params?.sourceId as DatasetRow['sourceId']
  const entryTypeId = params?.entryTypeId as DatasetRow['entryTypeId']
  const row: DatasetRow = {
    datasetId: nextDatasetId++,
    datasetName: `数据集-${String(sourceId)}-${String(entryTypeId)}`,
    sourceId,
    entryTypeId,
    measureCnt: 0,
    lastId: 0,
    schedule: '',
    lastRun: '',
    nextRun: '',
    runCnt: 0,
    successCnt: 0,
    state: 'W',
    filters: '',
    sqlDef: '',
    domain: '',
    isDelete: 0,
    ver: 0,
    createDt: stamp(new Date()),
    updateDt: stamp(new Date()),
  }
  DATASETS.unshift(row)
  return { ok: true, id: row.datasetId, message: `已生成数据集 ${row.datasetId}` }
}

/** 制作副本（复制出一条同配置的新数据集，指标数归零——指标挂在原数据集上，不跟着复制） */
export function mockDatasetCopy(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  const src = DATASETS.find((r) => String(r.datasetId) === id)
  if (!src) return { ok: false, message: '未找到要复制的数据集' }
  const copy: DatasetRow = {
    ...src,
    datasetId: nextDatasetId++,
    datasetName: `${String(src.datasetName ?? '')}-副本`,
    measureCnt: 0,
    lastId: 0,
    runCnt: 0,
    successCnt: 0,
    state: 'W',
    lastRun: '',
    nextRun: '',
    ver: 0,
    isDelete: 0,
    createDt: stamp(new Date()),
    updateDt: stamp(new Date()),
  }
  DATASETS.unshift(copy)
  return { ok: true, id: copy.datasetId, message: `新数据集 ID:${copy.datasetId}` }
}

/** 立即执行指标（`last` 传了就是「从指定 ID 开始」，不传 = 从上次 ID 继续） */
export function mockDatasetRunNow(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const last = params?.last
  const from = last == null || last === '' ? '上次 ID' : `ID ${String(last)}`
  return { ok: true, message: `已提交 ${ids.length} 条数据集，从${from}开始` }
}
