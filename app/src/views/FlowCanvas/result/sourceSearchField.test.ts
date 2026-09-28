import { describe, expect, it } from 'vitest'
import { detectSourceSearchField, mightBeUrlFragment } from './sourceSearchField'

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
