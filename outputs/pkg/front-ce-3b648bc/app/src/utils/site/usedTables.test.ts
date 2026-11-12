import { describe, expect, it } from 'vitest'
import { aggregateUsedTables, countSourcesWithoutFlow } from './usedTables'

const catalog = [
  { tableId: '900', tableName: 'sense_data.TB_CNEWS', name: '新闻表' },
  { tableId: '6200023', tableName: 'sense_data.TB_FILE', name: '文件资源表' },
]

describe('aggregateUsedTables', () => {
  // 形状取自 2026-09-24 生产站 89：1368 个源里 1366 个共用流程 1400774
  it('流程用到的表记到该流程下所有源头上，并上各源自己的主表', () => {
    const tables = aggregateUsedTables(
      [
        { sourceId: 's1', flowId: 'f1', mainTable: '900' },
        { sourceId: 's2', flowId: 'f1', mainTable: '900' },
        { sourceId: 's3', flowId: 'f2', mainTable: '6200027' },
      ],
      new Map([
        ['f1', [{ outputTable: '900' }, { inputTable: '900', outputTable: '6200023' }]],
        ['f2', [{ outputTable: '6200027' }]],
      ]),
      catalog,
    )
    expect(tables).toEqual([
      { tableId: '6200023', name: '文件资源表', tableName: 'sense_data.TB_FILE', sourceIds: ['s1', 's2'], sourceCnt: 2, role: 'STEP' },
      { tableId: '900', name: '新闻表', tableName: 'sense_data.TB_CNEWS', sourceIds: ['s1', 's2'], sourceCnt: 2, role: 'MAIN' },
      { tableId: '6200027', name: '6200027', tableName: '', sourceIds: ['s3'], sourceCnt: 1, role: 'MAIN' },
    ])
  })

  it('同一个源的主表和步骤表是同一张时只计一次', () => {
    const [table] = aggregateUsedTables(
      [{ sourceId: 's1', flowId: 'f1', mainTable: '900' }],
      new Map([['f1', [{ outputTable: '900' }, { inputTable: '900', outputTable: '900' }]]]),
      catalog,
    )
    expect(table).toMatchObject({ tableId: '900', sourceIds: ['s1'], sourceCnt: 1 })
  })

  it('没有 flowId 的源只计主表；流程没查回来（不在 Map 里）的也只计主表', () => {
    const tables = aggregateUsedTables(
      [
        { sourceId: 's1', mainTable: '900' },
        { sourceId: 's2', flowId: 'f-failed', mainTable: '900' },
      ],
      new Map(),
      catalog,
    )
    expect(tables.map((t) => [t.tableId, t.sourceCnt])).toEqual([['900', 2]])
  })

  it('空串和 0 不是表', () => {
    const tables = aggregateUsedTables(
      [{ sourceId: 's1', flowId: 'f1', mainTable: '0' }],
      new Map([['f1', [{ inputTable: '', outputTable: '0' }, { inputTable: undefined, outputTable: '900' }]]]),
      catalog,
    )
    expect(tables.map((t) => t.tableId)).toEqual(['900'])
  })

  it('源数相同时按表 ID 排，结果稳定', () => {
    const tables = aggregateUsedTables(
      [{ sourceId: 's1', mainTable: 'b' }, { sourceId: 's2', mainTable: 'a' }],
      new Map(),
      [],
    )
    expect(tables.map((t) => t.tableId)).toEqual(['a', 'b'])
  })
})

describe('countSourcesWithoutFlow', () => {
  it('flowId 为空或 0 都算没关联流程', () => {
    expect(countSourcesWithoutFlow([
      { sourceId: 's1', flowId: 'f1' },
      { sourceId: 's2' },
      { sourceId: 's3', flowId: '0' },
    ])).toBe(2)
  })
})
