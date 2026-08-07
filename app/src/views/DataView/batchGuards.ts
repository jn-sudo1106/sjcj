export interface NextStepBatchFilter {
  sql?: string
  nextFlag?: string
  dataId?: string
  parentId?: string
  startTime?: string
  endTime?: string
  min?: string | number
  max?: string | number
}

const UNSUPPORTED_FILTERS: Array<[keyof NextStepBatchFilter, string]> = [
  ['dataId', '数据 ID'],
  ['parentId', '父 ID'],
  ['startTime', '开始时间'],
  ['endTime', '结束时间'],
  ['min', '最小 ID'],
  ['max', '最大 ID'],
]

/** 旧平台 nextStep2 只支持源/状态/后续标识/SQL，其他查询条件不能假装透传。 */
export function unsupportedNextStepBatchFilters(filter: NextStepBatchFilter): string[] {
  return UNSUPPORTED_FILTERS
    .filter(([key]) => String(filter[key] ?? '').trim())
    .map(([, label]) => label)
}
