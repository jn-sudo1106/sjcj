import { describe, expect, it } from 'vitest'
import { BIZ_TYPE_OPTIONS, MULTI_MODE_OPTIONS } from './flowModel'

// 这两个下拉的值直接写进旧平台的 config 表，必须与旧前端 column.config.js 逐字一致。
// 2026-08-28 事故：业务类型曾按会议口头举例编成 news/login/分类/公告——
// 「分类」「公告」后端不存在（选了写脏数据），而真实存在的 data（另类）不在列表里，
// 导致旧平台设成「另类」的配置在新平台 select 匹配不到 option、静默显示成空。
describe('旧平台枚举必须逐字一致', () => {
  it('业务类型 = 旧 templetCode（column.config.js:620）', () => {
    expect(BIZ_TYPE_OPTIONS).toEqual([
      { value: 'data', label: '另类' },
      { value: 'news', label: '新闻' },
      { value: 'login', label: '登陆' },
    ])
  })

  it('是否列表 = 旧 isMulti 三态（column.config.js:640）', () => {
    expect(MULTI_MODE_OPTIONS).toEqual([
      { value: 1, label: '列表类[根据去重字段去重]' },
      { value: 0, label: '详情类[根据父ID去重]' },
      { value: 2, label: '更新父表[根据父ID更新父表]' },
    ])
  })

  it('不含旧平台没有的臆造值', () => {
    const values = BIZ_TYPE_OPTIONS.map((o) => o.value)
    expect(values).not.toContain('category')
    expect(values).not.toContain('announcement')
  })
})
