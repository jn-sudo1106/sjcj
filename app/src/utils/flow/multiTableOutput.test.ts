import { describe, expect, it } from 'vitest'
import { readOutputTableConfig, writeOutputTableConfig } from './multiTableOutput'

describe('多表输出旧协议', () => {
  it('空配置可开始编辑，AUTO、非法 JSON 和未知结构保留为高级配置', () => {
    expect(readOutputTableConfig('')).toEqual({ config: {} })
    for (const text of ['AUTO', '{', '[]', '{"table":{"entryTypeId":900}}']) {
      expect(readOutputTableConfig(text).error).toContain('原内容已保留')
    }
  })

  it('可视化写入保留高级属性、映射扩展和更深层子表，不修改原对象', () => {
    const config = {
      globals: ['10'], once: ['20'], clearRules: { '10': 'trim' }, unknown: { keep: true },
      table: { entryTypeId: 900, keys: ['news'], colMap: [{ colId: '100', fromId: 'title', minRow: 2 }], subs: [
        { entryTypeId: 901, keys: ['files'], colMap: [], subs: [{ entryTypeId: 902, keys: ['more'], colMap: [] }] },
      ] },
    }
    const before = JSON.stringify(config)
    const read = readOutputTableConfig(before).config!
    const text = writeOutputTableConfig(read, { ...read.table!, keys: ['updated'] })
    expect(JSON.parse(text)).toEqual({ ...config, checkIds: [], table: { ...config.table, keys: ['updated'] } })
    expect(JSON.stringify(config)).toBe(before)
  })
})
