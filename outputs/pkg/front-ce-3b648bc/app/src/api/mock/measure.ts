// 指标定义（/v1/measure/*）mock —— 旧 data-view `src/api/measure.js` 的 8 个端点。
//
// 内存表：写操作真落库，刷新 paged 能看到变更（与 mock/dataset.ts、mock/queueCheck.ts 同一套路）。
// 契约口径都按旧平台页面语义对齐：
//   · 旧 s-table 发的是 pageNo/pageSize，api 层改写成 page/limit（本文件按改完的口径收参）；
//   · enable 与 isDelete 同向：'0'=在用 / '1'=停用 / '-1'=历史删除的 / ''=全部；
//   · 表头排序：sortField（列 dataIndex）+ sortOrder（'ascend' / 'descend'），MEASURE 只有 measureId 可排；
//   · 旧页 loadData 是 `Object.assign(parameter, queryParam)`，所以 datasetId / sourceId /
//     measureCode / enable 四个键都会进请求；`categorys`（左侧分类树 emit）+ 路由透传的
//     entryTypeId / configId 后端是不是真认无从考证（指标表上没有分类列），本 mock 忽略它们。
//
// ⚠️ 删除做的是**物理删除**（演示上更直观）；真实后端的 `/delete` 也可能只是逻辑删除
//    （旧页「状态」下拉有「历史删除的」一档，说明存在 isDelete<0 的记录，见 SEEDS 里的 20012）。
import type { MeasureRow, MeasureQuery } from '../measure'
import type { Paged } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** 内存表：全部写操作落这里。字段名与真实后端一致（不做驼峰转换）。 */
const MEASURES: MeasureRow[] = [
  {
    measureId: 20001, measureCode: 'A00011', measureName: '公告日新增量',
    sourceId: 161725, measureType: '日频', datasetId: 1001,
    keyDef: "string.contains(K1, '公告')", dimDef: '{"cols":"K2","type":"date","clearRule":"","nvl":"","from":"yyyy年M月","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K3","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"K3","type":"string","clearRule":"","nvl":"篇"}',
    isDelete: 0, updateDt: '2026-10-13 03:00:12',
  },
  {
    measureId: 20002, measureCode: 'A00012', measureName: '公告覆盖股票数',
    sourceId: 161725, measureType: '日频', datasetId: 1001,
    keyDef: "K1 == '公告'", dimDef: '{"cols":"K2","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K4","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"K4","type":"string","clearRule":"","nvl":"只"}',
    isDelete: 0, updateDt: '2026-10-12 03:00:09',
  },
  {
    measureId: 20003, measureCode: 'B00021', measureName: '评论情感均分',
    sourceId: 161801, measureType: '日频', datasetId: 1002,
    keyDef: "string.contains(K5, '基金')", dimDef: '{"cols":"K1","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K9","type":"num","clearRule":"string.replace_all(value, \',\', \'\')","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"分"}',
    isDelete: 0, updateDt: '2026-10-13 08:30:04',
  },
  {
    measureId: 20004, measureCode: 'B00022', measureName: '评论日活跃量',
    sourceId: 161801, measureType: '日频', datasetId: 1002,
    keyDef: '', dimDef: '{"cols":"K1","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K3","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"条"}',
    isDelete: 0, updateDt: '2026-10-12 08:30:02',
  },
  {
    measureId: 20005, measureCode: 'C00031', measureName: '微博话题热度（范围）',
    sourceId: 162050, measureType: '实时', datasetId: 1003,
    keyDef: "K1 == '微博'", dimDef: '{"cols":"K2","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K4","type":"num","clearRule":"","nvl":"0"}', val2Def: '{"cols":"K5","type":"num","clearRule":"","nvl":"0"}',
    unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"次"}',
    isDelete: 0, updateDt: '2026-10-13 07:45:31',
  },
  {
    measureId: 20006, measureCode: 'D00041', measureName: '成交量分钟聚合',
    sourceId: 161900, measureType: '实时', datasetId: 1004,
    keyDef: '', dimDef: '{"cols":"K1","type":"date","clearRule":"","nvl":"","from":"yyyy-MM-dd hh:mm:ss","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K3","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"手"}',
    isDelete: 0, updateDt: '2026-10-13 08:36:10',
  },
  {
    measureId: 20007, measureCode: 'D00042', measureName: '行情振幅',
    sourceId: 161900, measureType: '实时', datasetId: 1004,
    keyDef: "K2 LIKE '%涨跌%'", dimDef: '{"cols":"K1","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K6","type":"num","clearRule":"","nvl":"0"}', val2Def: '{"cols":"K7","type":"num","clearRule":"","nvl":"0"}',
    unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"%"}',
    isDelete: 0, updateDt: '2026-10-13 08:36:10',
  },
  {
    measureId: 20008, measureCode: 'E00051', measureName: '招聘岗位数',
    sourceId: 161725, measureType: '日频', datasetId: 1006,
    keyDef: "string.contains(K1, '招聘')", dimDef: '{"cols":"K2","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K3","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"个"}',
    isDelete: 0, updateDt: '2026-10-12 22:00:09',
  },
  {
    measureId: 20009, measureCode: 'F00061', measureName: '企业注册量',
    sourceId: 162050, measureType: '月频', datasetId: 1007,
    keyDef: "K1 == '工商'", dimDef: '{"cols":"K2","type":"date","clearRule":"","nvl":"","from":"yyyyMM","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K3","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"家"}',
    isDelete: 0, updateDt: '2026-10-01 00:00:31',
  },
  {
    measureId: 20010, measureCode: 'G00071', measureName: '论坛发帖量（已停用）',
    sourceId: 161801, measureType: '日频', datasetId: 1008,
    keyDef: '', dimDef: '{"cols":"K1","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K3","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"帖"}',
    isDelete: 1, updateDt: '2026-09-27 04:00:07',
  },
  {
    measureId: 20011, measureCode: 'H00081', measureName: '电商价格中位数',
    sourceId: 161900, measureType: '日频', datasetId: 1009,
    keyDef: "string.contains(K3, '价格')", dimDef: '{"cols":"K1","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K5","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"元"}',
    isDelete: 0, updateDt: '2026-10-13 08:00:02',
  },
  {
    measureId: 20012, measureCode: 'Z00091', measureName: '旧版文章计数（历史删除）',
    sourceId: 161725, measureType: '日频', datasetId: 1011,
    keyDef: '', dimDef: '{"cols":"K1","type":"date","clearRule":"","nvl":"","from":"","to":"yyyy-MM-dd"}',
    val1Def: '{"cols":"K3","type":"num","clearRule":"","nvl":"0"}', val2Def: '', unitDef: '{"cols":"","type":"string","clearRule":"","nvl":"篇"}',
    isDelete: -1, updateDt: '2026-08-14 05:00:03',
  },
]

/** 主键自增：新增指标 / 生成副本取 max+1，模拟后端自增 */
let nextMeasureId = Math.max(...MEASURES.map((m) => Number(m.measureId))) + 1

/** 可分页排序的列：MEASURE 列定义里只有 ID 带 `sorter`。 */
const SORTABLE_FIELDS = new Set(['measureId'])

/** 分页查询：旧页面筛选口径（datasetId / sourceId / measureCode / enable→isDelete）+ 表头排序 */
export function mockMeasurePaged(params?: MeasureQuery): Paged<MeasureRow> {
  const datasetId = String(params?.datasetId ?? '').trim()
  const sourceId = String(params?.sourceId ?? '').trim()
  const measureCode = String(params?.measureCode ?? '').trim()
  const enable = String(params?.enable ?? '')
  const page = Math.max(1, Number(params?.page ?? 1) || 1)
  const limit = Math.max(1, Number(params?.limit ?? 20) || 20)
  const sortField = String(params?.sortField ?? '').trim()
  const sortOrder = String(params?.sortOrder ?? '').trim()

  const matched = MEASURES.filter((row) => {
    if (datasetId && !String(row.datasetId ?? '').includes(datasetId)) return false
    if (sourceId && !String(row.sourceId ?? '').includes(sourceId)) return false
    if (measureCode && !String(row.measureCode ?? '').includes(measureCode)) return false
    if (enable === '0' && Number(row.isDelete) !== 0) return false
    if (enable === '1' && Number(row.isDelete) !== 1) return false
    if (enable === '-1' && !(Number(row.isDelete) < 0)) return false
    return true
  })

  if (SORTABLE_FIELDS.has(sortField) && (sortOrder === 'ascend' || sortOrder === 'descend')) {
    const dir = sortOrder === 'ascend' ? 1 : -1
    // matched 是 filter 出来的新数组，排序不会动到内存表本身的顺序
    matched.sort((a, b) => ((Number(a[sortField]) || 0) - (Number(b[sortField]) || 0)) * dir)
  }

  return { total: matched.length, list: matched.slice((page - 1) * limit, page * limit) }
}

/** 新增（旧 addMeasure）。旧层提交前 delete updateDt，本 mock 补一条新记录并自增 ID。 */
export function mockMeasureAdd(params?: Record<string, unknown>) {
  const row: MeasureRow = {
    measureId: nextMeasureId++,
    measureCode: String(params?.measureCode ?? ''),
    measureName: String(params?.measureName ?? ''),
    sourceId: (params?.sourceId ?? null) as MeasureRow['sourceId'],
    measureType: (params?.measureType ?? null) as MeasureRow['measureType'],
    datasetId: (params?.datasetId ?? null) as MeasureRow['datasetId'],
    keyDef: String(params?.keyDef ?? ''),
    dimDef: String(params?.dimDef ?? ''),
    val1Def: String(params?.val1Def ?? ''),
    val2Def: String(params?.val2Def ?? ''),
    unitDef: String(params?.unitDef ?? ''),
    isDelete: 0,
    updateDt: stamp(new Date()),
  }
  MEASURES.unshift(row)
  return { ok: true, id: row.measureId, msg: `指标 ID:${row.measureId}` }
}

/** 修改（按 measureId 定位，只覆盖传了的字段） */
export function mockMeasureUpdate(params?: Record<string, unknown>) {
  const measureId = String(params?.measureId ?? '')
  const row = MEASURES.find((m) => String(m.measureId) === measureId)
  if (!row) return { ok: false, msg: '未找到要修改的指标' }
  const text = (key: string) => (params?.[key] == null ? undefined : String(params[key]))
  for (const key of [
    'measureCode', 'measureName', 'measureType', 'keyDef', 'dimDef', 'val1Def', 'val2Def', 'unitDef',
  ] as const) {
    const value = text(key)
    if (value !== undefined) row[key] = value
  }
  if (params?.sourceId != null) row.sourceId = params.sourceId as MeasureRow['sourceId']
  if (params?.datasetId != null) row.datasetId = params.datasetId as MeasureRow['datasetId']
  row.updateDt = stamp(new Date())
  return { ok: true, msg: '修改成功（演示）' }
}

/** 批量启停（enable 与 isDelete 同向：0=启用 / 1=停用） */
export function mockMeasureChangeEnable(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const enable = Number(params?.enable ?? 0)
  const nextIsDelete = enable === 0 ? 0 : 1
  let hit = 0
  for (const id of ids) {
    const row = MEASURES.find((m) => String(m.measureId) === id)
    if (row) {
      row.isDelete = nextIsDelete
      row.updateDt = stamp(new Date())
      hit++
    }
  }
  return { ok: true, demo: true, msg: hit > 0 ? (enable === 0 ? '已启用' : '已停用') : '未找到对应记录' }
}

/** 删除（ids 走 query，逗号分隔）。
 *  注意：这里做的是**物理删除**（演示上更直观）；真实后端的 `/delete` 也可能是逻辑删除
 *  （把 isDelete 置成负数，列表里仍能按「历史删除的」筛出来，比如 20012），联调时按真实回执确认。 */
export function mockMeasureDelete(params?: Record<string, unknown>) {
  const ids = String(params?.ids ?? '').split(',').filter(Boolean)
  const before = MEASURES.length
  for (const id of ids) {
    const idx = MEASURES.findIndex((m) => String(m.measureId) === id)
    if (idx >= 0) MEASURES.splice(idx, 1)
  }
  return { ok: true, msg: `删除 ${before - MEASURES.length} 条成功（演示）` }
}

/** 物理删除单条（旧 deleteMeasurePhy，id 单个） */
export function mockMeasureDeletePhy(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  const idx = MEASURES.findIndex((m) => String(m.measureId) === id)
  if (idx < 0) return { ok: false, msg: '未找到该指标' }
  MEASURES.splice(idx, 1)
  return { ok: true, msg: `物理删除成功，ID:${id}` }
}

/** 指标副本（复制出一条同配置的新指标；编码后加 -C，避免主键/编码重复） */
export function mockMeasureCopy(params?: Record<string, unknown>) {
  const id = String(params?.id ?? '')
  const src = MEASURES.find((m) => String(m.measureId) === id)
  if (!src) return { ok: false, msg: '未找到要复制的指标' }
  const copy: MeasureRow = {
    ...src,
    measureId: nextMeasureId++,
    measureCode: `${String(src.measureCode ?? '')}-C`,
    measureName: `${String(src.measureName ?? '')}-副本`,
    isDelete: 0,
    updateDt: stamp(new Date()),
  }
  MEASURES.unshift(copy)
  return { ok: true, id: copy.measureId, msg: `新指标 ID:${copy.measureId}（为避免编码重复，编码后加 -C，可在编辑里改名）` }
}

/** 由源生成指标（旧 genMeasureFromSource）。旧页无入口，保留 handler 让契约完整。 */
export function mockMeasureGenFromSource(params?: Record<string, unknown>) {
  const row: MeasureRow = {
    measureId: nextMeasureId++,
    measureCode: `SRC${String(params?.sourceId ?? '')}`,
    measureName: `指标-${String(params?.sourceId ?? '')}-${String(params?.entryTypeId ?? '')}`,
    sourceId: (params?.sourceId ?? null) as MeasureRow['sourceId'],
    datasetId: null,
    keyDef: '', dimDef: '', val1Def: '', val2Def: '', unitDef: '',
    isDelete: 0,
    updateDt: stamp(new Date()),
  }
  MEASURES.unshift(row)
  return { ok: true, id: row.measureId, msg: `已生成指标 ${row.measureId}` }
}
