import { describe, expect, it } from 'vitest'
import { mergeEntryTypesPreservingFields } from './useEntryTableFieldsCache'
import type { EntryType } from '@/api'

const table = (tableId: string, fieldCount = 0): EntryType => ({
  tableId, tableName: `T_${tableId}`,
  fields: Array.from({ length: fieldCount }, (_, i) => ({ prop: `f${i}`, desc: `字段${i}`, type: 'string', required: false })),
})

describe('mergeEntryTypesPreservingFields', () => {
  it('清单里的表：已查过详情的保留字段，没查过的用清单值', () => {
    const merged = mergeEntryTypesPreservingFields([table('1', 3)], [table('1'), table('2')])
    expect(merged.map((t) => [t.tableId, t.fields.length])).toEqual([['1', 3], ['2', 0]])
  })

  // 2026-10-19：清单只拉前 100 张，排在后面的输入表先查到详情时不能被清单冲掉
  it('查过详情但不在清单里的表也保留', () => {
    const merged = mergeEntryTypesPreservingFields([table('900', 2)], [table('1'), table('2')])
    expect(merged.map((t) => [t.tableId, t.fields.length])).toEqual([['1', 0], ['2', 0], ['900', 2]])
  })
})
