import { describe, expect, it } from 'vitest'
import { toCsv, entryFieldsToRows } from './csvExport'
import type { EntryType } from '../api/types'

describe('toCsv 通用 CSV 构造', () => {
  it('字段值含逗号、双引号、换行都能正确转义（RFC 4180）', () => {
    const csv = toCsv([
      ['a', 'b', 'c'],
      ['hello, world', 'say "hi"', 'line1\nline2'],
    ])
    // 整体加双引号 + 内部双引号 → ""
    expect(csv).toContain('"hello, world"')
    expect(csv).toContain('"say ""hi"""')
    expect(csv).toContain('"line1\nline2"')
  })

  it('输出带 UTF-8 BOM 前缀（Excel 中文不乱码）', () => {
    const csv = toCsv([['标题', '内容']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('空数组返回仅 BOM 的字符串（不抛错）', () => {
    const csv = toCsv([])
    expect(csv).toBe('﻿')
  })

  it('非字符串字段会被 toString 转换（数字 / null）', () => {
    const csv = toCsv([[1, null, undefined, true]] as unknown as string[][])
    // null/undefined → 'null'/'undefined'（标准 String 行为），由调用方负责清洗
    expect(csv).toContain('"1"')
    expect(csv).toContain('"null"')
    expect(csv).toContain('"undefined"')
    expect(csv).toContain('"true"')
  })
})

describe('entryFieldsToRows 实体表字段 → CSV 行', () => {
  const baseEntry: EntryType = {
    tableId: 't1',
    tableName: 'tb_a',
    name: '测试表',
    fields: [
      { prop: 'title', desc: '标题', type: 'string', required: false, seq: 1, itemId: '1', columnName: 'K1', width: 1000 },
      { prop: 'author', desc: '作者', type: 'string', required: false, seq: 2, width: 5 },
      { prop: 'note', desc: '备注', type: 'text', required: false, seq: 3, width: 200 },
    ],
  }

  it('表头固定为 6 列：序号/内部ID/数据库列/字段编码/字段名称/数据类型', () => {
    const rows = entryFieldsToRows(baseEntry)
    expect(rows[0]).toEqual(['序号', '内部ID', '数据库列', '字段编码', '字段名称', '数据类型'])
  })

  it('string 字段宽度兜底走 getEffectiveWidth：< 10 → 255（与编辑器/提取字段一致）', () => {
    const rows = entryFieldsToRows(baseEntry)
    // title width=1000, ≥10 → 1000
    expect(rows[1][5]).toBe('varchar(1000)')
    // author width=5, <10 → 255 兜底
    expect(rows[2][5]).toBe('varchar(255)')
  })

  it('width=undefined 时也走 255 兜底（不复用旧 128 口径）', () => {
    const entry: EntryType = {
      tableId: 't1',
      tableName: 'tb_a',
      fields: [{ prop: 'a', desc: 'A', type: 'string', required: false, seq: 1 }],
    }
    const rows = entryFieldsToRows(entry)
    expect(rows[1][5]).toBe('varchar(255)')
  })

  it('非 string 字段直接显示原类型名，不加 varchar 包裹', () => {
    const rows = entryFieldsToRows(baseEntry)
    expect(rows[3][5]).toBe('text')  // note, type='text', width=200 但不影响显示
  })

  it('表名带 schema 前缀时（sense_data.TB_X）调用方负责截取——本函数只输出表名到文件名（不参与行内容）', () => {
    // 行为契约：entryFieldsToRows 不处理文件名（那是 exportFieldsAsCsv 的事）
    // 这里只验证 schema 前缀不影响行内容
    const entry: EntryType = {
      tableId: 't1',
      tableName: 'sense_data.TB_X',
      fields: [{ prop: 'a', desc: 'A', type: 'string', required: false, seq: 1 }],
    }
    const rows = entryFieldsToRows(entry)
    expect(rows[1][0]).toBe('1')  // 序号
    expect(rows[1][1]).toBe('')   // itemId 为 undefined → ''
    expect(rows[1][2]).toBe('')   // columnName 为 undefined → ''
  })

  it('itemId 缺失时输出空串（不影响列对齐）', () => {
    const entry: EntryType = {
      tableId: 't1',
      tableName: 'tb_a',
      fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, seq: 1 },  // 缺 itemId/columnName
      ],
    }
    const rows = entryFieldsToRows(entry)
    expect(rows[1]).toEqual(['1', '', '', 'a', 'A', 'varchar(255)'])
  })

  it('空 fields 列表只输出表头', () => {
    const entry: EntryType = { tableId: 't1', tableName: 'tb_a', fields: [] }
    const rows = entryFieldsToRows(entry)
    expect(rows.length).toBe(1)  // 仅表头
    expect(rows[0][0]).toBe('序号')
  })
})
