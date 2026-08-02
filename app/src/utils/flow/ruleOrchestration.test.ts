import { describe, it, expect } from 'vitest'
import { isSystemField, mapRowToInputFields, ruleTableOptionFromEntryType, ruleFieldOptionFromEntryField } from './ruleOrchestration'

describe('ruleTableOptionFromEntryType（0801 §4.3：两侧 tableName 含义相反）', () => {
  it('EntryType.tableName（物理表名）映射为 dbTableName，name（中文名）映射为 tableName', () => {
    const opt = ruleTableOptionFromEntryType({
      tableId: '2102154',
      tableName: 'sense_data.TB_JD_SKU_BASE',
      name: 'JD-商品基础',
      keyField: 'K1,K10',
    })
    expect(opt).toEqual({
      tableId: '2102154',
      tableName: 'JD-商品基础',
      dbTableName: 'sense_data.TB_JD_SKU_BASE',
      keyField: 'K1,K10',
    })
  })
  it('无中文名时退回物理表名，避免下拉无文案', () => {
    const opt = ruleTableOptionFromEntryType({ tableId: '1', tableName: 'sense_data.TB_X', keyField: undefined })
    expect(opt.tableName).toBe('sense_data.TB_X')
  })
})

describe('ruleFieldOptionFromEntryField', () => {
  it('prop→itemCode，desc→itemName，columnName/type/seq 透传', () => {
    const opt = ruleFieldOptionFromEntryField({
      prop: 'sku_id', desc: '商品ID', type: 'string', required: false, columnName: 'K1', seq: 1,
    })
    expect(opt).toEqual({ itemCode: 'sku_id', itemName: '商品ID', columnName: 'K1', dataType: 'string', seq: 1 })
  })
})

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
