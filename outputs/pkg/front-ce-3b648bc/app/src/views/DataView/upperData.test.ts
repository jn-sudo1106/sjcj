import { describe, expect, it } from 'vitest'
import { upperDataId, upperDataText } from './upperData'

describe('upperData · 上层数据显示（1021-05）', () => {
  it('-1 / -2 / 0 / 空都显示「—」', () => {
    for (const v of ['-1', '-2', '0', '', '  ', undefined, null]) {
      expect(upperDataId(v), String(v)).toBe('')
      expect(upperDataText(v, '公告表'), String(v)).toBe('—')
    }
  })

  it('有上层：知道上层表显示「来自 表名 #ID」，不知道只显示 ID', () => {
    expect(upperDataId('5501')).toBe('5501')
    expect(upperDataText('5501', '公告表')).toBe('来自 公告表 #5501')
    expect(upperDataText('5501')).toBe('5501')
  })
})
