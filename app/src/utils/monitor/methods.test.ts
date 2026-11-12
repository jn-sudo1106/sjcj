import { describe, expect, it } from 'vitest'
import { ALL_METHODS, METHOD_GROUPS, defaultDescription, defaultSystemPrompt, isKnownMethod, methodLabel, normalizeMethod } from './methods'

describe('方法元数据', () => {
  it('8 类共 24 个方法（1110 §4.1）', () => {
    expect(METHOD_GROUPS).toHaveLength(8)
    expect(ALL_METHODS).toHaveLength(24)
    expect(new Set(ALL_METHODS.map((m) => m.code)).size).toBe(24)
  })

  it('旧中文方法名映射到稳定 code，映射不到原样保留（R08：不丢、不替换成别的值）', () => {
    expect(normalizeMethod('字段完整性')).toBe('required_null')
    expect(normalizeMethod('标题模式')).toBe('title_pattern')
    expect(normalizeMethod('平台早期自定义方法')).toBe('平台早期自定义方法')
    expect(methodLabel('字段完整性')).toBe('必填字段非空')
    expect(methodLabel('平台早期自定义方法')).toBe('平台早期自定义方法')
  })

  it('已知/未知判定用于给旧值加「未映射」提示', () => {
    expect(isKnownMethod('required_null')).toBe(true)
    expect(isKnownMethod('字段完整性')).toBe(true)
    expect(isKnownMethod('平台早期自定义方法')).toBe(false)
  })

  it('默认描述只给模板，不凭方法名补造阈值', () => {
    const text = defaultDescription({ sourceName: '上市公司新闻', tableName: 'news_main', methods: ['today_landed', 'required_null'] })
    expect(text).toContain('上市公司新闻 / news_main')
    expect(text).toContain('当日正常入库')
    expect(text).toContain('必填字段非空')
    expect(text).not.toMatch(/\d+\s*(条|%)/)
  })

  it('默认描述不留占位符，按选择写入空值/无数据口径', () => {
    const text = defaultDescription({
      sourceName: '圣路易斯联储-批发商库存',
      tableName: 'sense_data.fred_monthly',
      methods: ['today_landed'],
      window: '当日 00:00 至当前（Asia/Shanghai 业务时区）',
      nullPolicy: 'allow',
      noDataPolicy: 'alarm',
    })
    expect(text).not.toContain('【')
    expect(text).not.toContain('业务约定')
    expect(text).toContain('字段值为空按允许处理')
    expect(text).toContain('判为异常并告警')
    expect(text).toContain('Asia/Shanghai')
  })

  it('默认系统提示词非空且约束只读（空串会让 data-engine 直接报错）', () => {
    const text = defaultSystemPrompt()
    expect(text.trim().length).toBeGreaterThan(10)
    expect(text).toContain('只读')
    expect(text).toContain('checkedCount')
  })
})

