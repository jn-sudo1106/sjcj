import { describe, it, expect } from 'vitest'
import { tableNameFromEntryName } from './entryTableName'

describe('按名称生成物理表名', () => {
  it('TB_ + 拼音首字母大写，英文原样转大写', () => {
    expect(tableNameFromEntryName('统计局指标')).toBe('TB_TJJZB')
    expect(tableNameFromEntryName('AI测试Skill商品价格')).toBe('TB_AICSSKILLSPJG')
    expect(tableNameFromEntryName('')).toBe('')
  })
})
