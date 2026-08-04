import { describe, it, expect } from 'vitest'
import { isSystemField, mapRowToInputFields } from './ruleOrchestration'

describe('isSystemField（seq < 0 为系统固定字段）', () => {
  it('负数 seq 判定为系统字段', () => {
    expect(isSystemField({ seq: -100 })).toBe(true)
  })
  it('非负 seq 判定为业务字段', () => {
    expect(isSystemField({ seq: 1 })).toBe(false)
    expect(isSystemField({})).toBe(false)
  })
})

describe('mapRowToInputFields（0801 §8.6：行数据只有物理列，只能靠 columnName 匹配）', () => {
  const fields = [
    { itemCode: 'date', columnName: 'K1' },
    { itemCode: 'zb_value', columnName: 'K7' },
    { itemCode: 'category2', columnName: 'K5' },
  ]
  it('按 columnName 取值，itemCode 本身不出现在行数据里', () => {
    const row = { ENTRY_ID: '1000520', K1: '2025年', K7: '49.7' }
    expect(mapRowToInputFields(row, ['date', 'zb_value'], fields)).toEqual({ date: '2025年', zb_value: '49.7' })
  })
  it('行缺列时填空串，不抛错', () => {
    const row = { ENTRY_ID: '1000524', K1: '2025年' }
    expect(mapRowToInputFields(row, ['date', 'category2'], fields)).toEqual({ date: '2025年', category2: '' })
  })
  it('入参字段没有对应的字段定义时也填空串', () => {
    const row = { K1: '2025年' }
    expect(mapRowToInputFields(row, ['unknown_field'], fields)).toEqual({ unknown_field: '' })
  })
})
