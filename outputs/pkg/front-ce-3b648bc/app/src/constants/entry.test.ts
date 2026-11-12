import { describe, expect, it } from 'vitest'
import { ENTRY_FIELD_DEFAULT_WIDTH, ENTRY_FIELD_MIN_REASONABLE_WIDTH, getEffectiveWidth } from './entry'

describe('getEffectiveWidth 字段列宽兜底', () => {
  it('正常字段（width >= 10）原样返回', () => {
    expect(getEffectiveWidth(10)).toBe(10)
    expect(getEffectiveWidth(100)).toBe(100)
    expect(getEffectiveWidth(255)).toBe(255)
    expect(getEffectiveWidth(1000)).toBe(1000)
  })

  it('null / undefined 一律兜底为默认值', () => {
    expect(getEffectiveWidth(undefined)).toBe(ENTRY_FIELD_DEFAULT_WIDTH)
    expect(getEffectiveWidth(null)).toBe(ENTRY_FIELD_DEFAULT_WIDTH)
  })

  it('0 / 负数 / 低于合理下限（<10）兜底为默认值', () => {
    // 边界：<=0
    expect(getEffectiveWidth(0)).toBe(ENTRY_FIELD_DEFAULT_WIDTH)
    expect(getEffectiveWidth(-1)).toBe(ENTRY_FIELD_DEFAULT_WIDTH)
    // 边界：1..9
    expect(getEffectiveWidth(1)).toBe(ENTRY_FIELD_DEFAULT_WIDTH)
    expect(getEffectiveWidth(5)).toBe(ENTRY_FIELD_DEFAULT_WIDTH)
    expect(getEffectiveWidth(9)).toBe(ENTRY_FIELD_DEFAULT_WIDTH)
  })

  it('常量值稳定：255 / 10（未来如要改需同步更新 review 文档）', () => {
    expect(ENTRY_FIELD_DEFAULT_WIDTH).toBe(255)
    expect(ENTRY_FIELD_MIN_REASONABLE_WIDTH).toBe(10)
  })

  it('边界值 10 是有效输入（<10 才兜底，=10 不兜底）', () => {
    expect(getEffectiveWidth(10)).toBe(10)  // 10 不算「未配置」
  })
})
