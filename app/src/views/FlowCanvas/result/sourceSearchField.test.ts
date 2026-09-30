import { describe, expect, it } from 'vitest'
import {
  defaultSourceCondOp,
  detectSourceSearchField,
  mightBeUrlFragment,
  sourceCondActive,
  sourceConditionParams,
} from './sourceSearchField'

describe('detectSourceSearchField', () => {
  it.each([
    ['430016214', 'sourceIds'],
    ['430016214,430016215', 'sourceIds'],
    ['430016214， 430016215 430016216', 'sourceIds'],
    ['https://www.sanyoumed.com/zh/news', 'sourceUrl'],
    ['http://mp.weixin.qq.com/s?__biz=x', 'sourceUrl'],
    ['www.cls.cn', 'sourceUrl'],
    ['cls.cn/telegraph', 'sourceUrl'],
    ['mykj-sz.com', 'sourceUrl'],
    ['三友医疗-新闻中心', 'name'],
    ['centec', 'name'],
    ['v2.0', 'name'],
    ['ST 东智', 'name'],
  ])('%s → %s', (input, expected) => {
    expect(detectSourceSearchField(input)).toBe(expected)
  })

  it('空输入不识别', () => {
    expect(detectSourceSearchField('  ')).toBeNull()
  })
})

describe('mightBeUrlFragment', () => {
  it('不含空白的可见 ASCII 词才算', () => {
    expect(mightBeUrlFragment('centec')).toBe(true)
    expect(mightBeUrlFragment('san-you_med')).toBe(true)
    expect(mightBeUrlFragment('三友')).toBe(false)
    expect(mightBeUrlFragment('two words')).toBe(false)
  })
})

describe('sourceConditionParams（多条件，2026-09-28）', () => {
  it('每行落到各自的参数上，一起发（后端取交集）', () => {
    expect(sourceConditionParams([
      { field: 'name', op: 'like', value: ' 盛科 ' },
      { field: 'sourceUrl', op: 'like', value: 'centec' },
      { field: 'sourceIds', op: 'eq', value: '1, 2' },
      { field: 'remark', op: 'like', value: '超时' },
    ])).toEqual({ name: '盛科', sourceUrl: 'centec', sourceIds: '1, 2', remark: '超时' })
  })

  it('备注非空 = %、为空 = NULL，与后端既有约定一致；此时忽略框里残留的值', () => {
    expect(sourceConditionParams([{ field: 'remark', op: 'notEmpty', value: '残留' }])).toEqual({ remark: '%' })
    expect(sourceConditionParams([{ field: 'remark', op: 'empty', value: '' }])).toEqual({ remark: 'NULL' })
  })

  it('要填值的条件没填值，等于没有这一行', () => {
    expect(sourceConditionParams([{ field: 'name', op: 'like', value: '  ' }])).toEqual({})
    expect(sourceCondActive({ field: 'name', op: 'like', value: '' })).toBe(false)
  })

  // 2026-09-29 后端上线：sourceUrl=NULL / NOT NULL（站 12：393 + 5635 = 全部 6028）。
  // 注意「非空」与备注口径不同——备注是 %，URL 是 NOT NULL。
  it('URL 为空 = NULL、非空 = NOT NULL，忽略框里残留的值；默认条件仍是包含', () => {
    expect(sourceConditionParams([{ field: 'sourceUrl', op: 'empty', value: 'x' }])).toEqual({ sourceUrl: 'NULL' })
    expect(sourceConditionParams([{ field: 'sourceUrl', op: 'notEmpty', value: 'x' }])).toEqual({ sourceUrl: 'NOT NULL' })
    expect(sourceConditionParams([{ field: 'remark', op: 'notEmpty', value: '' }])).toEqual({ remark: '%' })
    // 0930-15：流程 ID 只有「等于」
    expect(sourceConditionParams([{ field: 'flowId', op: 'eq', value: ' 14009350 ' }])).toEqual({ flowId: '14009350' })
    expect(defaultSourceCondOp('sourceUrl')).toBe('like')
  })
})
