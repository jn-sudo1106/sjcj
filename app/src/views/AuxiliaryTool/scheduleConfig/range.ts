// 调度范围参数工具 —— 旧 `src/utils/range.js` 的 1:1 移植。
//
// 调度那四个接口（scheduleSummary / jobsBySchedule / updateScheduleByCron / setScheduleByCategory）
// 共用同一组范围参数，语义是「页面上看到哪些源，统计/修改就是哪些源」。
// 这里的白名单是关键：分页/排序字段（page / limit / sorted / field / type）不能混进范围，
// 否则后端会把它们当成筛选条件，统计结果直接跑偏。

/** 合法的范围字段（顺序无关） */
export const RANGE_FIELDS = [
  'categoryIds',
  'ids',
  'sourceId',
  'name',
  'remark',
  'author',
  'entryTypeId',
  'siteIds',
  'configId',
  'configIds',
  'flowId',
  'sourceGroupId',
  'defaultFlowId',
  'state',
  'enable',
  'freq',
  'flag',
  'count',
  'dataDate',
  'sourceUrl',
  'tags',
  'topic',
  'notify',
  // 后端 scheduleSummary 等额外认的两个筛选参数，透传即可
  'cron',
  'alarm',
]

/** 空值判定：空数组（如默认的 tags: []）不算任何筛选条件 */
function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** 只保留「范围字段且非空」的参数 */
export function cleanRange(obj: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!obj) return out
  RANGE_FIELDS.forEach((key) => {
    if (!isBlank(obj[key])) out[key] = obj[key]
  })
  return out
}

/** 是否为空范围（空 = 全部源，批量接口要求 confirmAll 强确认） */
export function rangeIsEmpty(obj: Record<string, unknown> | null | undefined): boolean {
  return Object.keys(cleanRange(obj ?? {})).length === 0
}
