import { describe, expect, it } from 'vitest'
import { unsupportedNextStepBatchFilters } from './batchGuards'

describe('数据查看批量后续筛选门禁', () => {
  it('只拦截旧 nextStep2 不支持的查询条件', () => {
    expect(unsupportedNextStepBatchFilters({ nextFlag: '-1', sql: 'K1 IS NULL' })).toEqual([])
    expect(unsupportedNextStepBatchFilters({ dataId: '1', parentId: 'p-1', startTime: '2026-08-01', max: '9' })).toEqual([
      '数据 ID', '父 ID', '开始时间', '最大 ID',
    ])
  })
})
