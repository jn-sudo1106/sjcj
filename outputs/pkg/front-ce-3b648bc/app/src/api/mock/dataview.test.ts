import { describe, expect, it } from 'vitest'
import { mockDataRowQueryPaged, mockDataTableMeta } from './dataview'
import { mockSourcePaged, mockSourceSteps } from './sources'

describe('结果视图 mock 数据', () => {
  it('按 sourceId 过滤共享输出表的数据', () => {
    const a = mockDataRowQueryPaged({ tableId: '2100157', sourceId: '301287174', size: 999 })
    const b = mockDataRowQueryPaged({ tableId: '2100157', sourceId: '301287169', size: 999 })

    expect(a.total).toBeGreaterThan(0)
    expect(b.total).toBeGreaterThan(0)
    expect(a.list.every((row) => row.sourceId === '301287174')).toBe(true)
    expect(b.list.every((row) => row.sourceId === '301287169')).toBe(true)
    expect(a.list.map((row) => row.dataId)).not.toEqual(b.list.map((row) => row.dataId))
  })

  it('每个源步骤输出表都有表元信息和样例行', () => {
    const sources = mockSourcePaged({ size: 999 }).list

    for (const source of sources) {
      for (const step of mockSourceSteps({ sourceId: source.sourceId })) {
        expect(mockDataTableMeta({ tableId: step.outputTable }), `${source.sourceId} ${step.outputTable} 缺表元信息`).not.toBeNull()
        expect(mockDataRowQueryPaged({ tableId: step.outputTable, sourceId: source.sourceId, size: 1 }).total, `${source.sourceId} ${step.outputTable} 缺样例行`).toBeGreaterThan(0)
      }
    }
  })
})
