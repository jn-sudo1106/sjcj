// 范围参数工具回归：白名单过滤（分页/排序字段不能混进范围）、空数组不算条件、空范围判定。
import { describe, expect, it } from 'vitest'
import { cleanRange, RANGE_FIELDS, rangeIsEmpty } from './range'

describe('cleanRange', () => {
  it('只留范围字段，分页/排序字段被剔除', () => {
    const out = cleanRange({ sourceId: '1001', name: '新闻', page: 1, limit: 20, sorted: 'asc', field: 'id', type: 'x' })
    expect(out).toEqual({ sourceId: '1001', name: '新闻' })
  })

  it('空值 / 空数组不算条件', () => {
    expect(cleanRange({ sourceId: '', name: null, ids: [], tags: [] })).toEqual({})
    expect(cleanRange({ ids: ['1', '2'] })).toEqual({ ids: ['1', '2'] })
  })

  it('空对象 / undefined 返回空对象', () => {
    expect(cleanRange({})).toEqual({})
    expect(cleanRange(undefined)).toEqual({})
    expect(cleanRange(null)).toEqual({})
  })

  it('白名单里确实包含调度需要的几个关键字段', () => {
    for (const key of ['categoryIds', 'sourceId', 'ids', 'enable', 'entryTypeId', 'cron', 'alarm']) {
      expect(RANGE_FIELDS).toContain(key)
    }
    // 分页 / 排序字段绝不能在里面
    expect(RANGE_FIELDS).not.toContain('page')
    expect(RANGE_FIELDS).not.toContain('limit')
  })
})

describe('rangeIsEmpty', () => {
  it('无有效范围 = 空（会触发 confirmAll 强确认）', () => {
    expect(rangeIsEmpty({})).toBe(true)
    expect(rangeIsEmpty({ page: 1, limit: 20 })).toBe(true)
    expect(rangeIsEmpty({ sourceId: '' })).toBe(true)
  })

  it('有任何一个有效范围 = 非空', () => {
    expect(rangeIsEmpty({ sourceId: '1001' })).toBe(false)
    expect(rangeIsEmpty({ categoryIds: '12,34' })).toBe(false)
    expect(rangeIsEmpty({ enable: '0' })).toBe(false)
  })
})
