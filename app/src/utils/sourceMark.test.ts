// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  colorFromFlag,
  colorFromLegacy,
  colorValue,
  flagFromColor,
  mergeIssueTags,
  issueTagForWrite,
  issueTagsForWrite,
  normalizeIssueTag,
  parseIssueTags,
  readRecentIssueTags,
  rememberIssueTags,
  visibleIssueTags,
} from './sourceMark'

describe('sourceMark', () => {
  afterEach(() => localStorage.clear())

  it('去掉首尾空白和旧平台 # 前缀，按名称去重', () => {
    expect(normalizeIssueTag('  #日期错误待重跑  ')).toBe('日期错误待重跑')
    expect(parseIssueTags('#正文缺失, 内容重复，#正文缺失')).toEqual(['正文缺失', '内容重复'])
  })

  it('写回旧接口时每个标签补 #，多个逗号分隔', () => {
    expect(issueTagForWrite(' 内容重复 ')).toBe('#内容重复')
    expect(issueTagForWrite('#内容重复')).toBe('#内容重复')
    expect(issueTagsForWrite(['正文缺失', '#内容重复'])).toBe('#正文缺失,#内容重复')
  })

  it('合并标签时保留已有项并把新项追加在后', () => {
    expect(mergeIssueTags(['正文缺失'], ['内容重复', '正文缺失'])).toEqual(['正文缺失', '内容重复'])
  })

  it('问题标记列最多展示 2 个，其余收成 +N', () => {
    expect(visibleIssueTags(['a', 'b', 'c'])).toEqual({ shown: ['a', 'b'], extra: 1 })
    expect(visibleIssueTags([])).toEqual({ shown: [], extra: 0 })
  })

  it('旧 usedFlag 是 1-based 下标，不是颜色名', () => {
    expect(colorFromFlag(2)).toBe('orange')
    expect(flagFromColor('red')).toBe(1)
    expect(colorValue('blue')).toBe('#3b82f6')
    expect(colorFromLegacy({ usedFlag: 1 })).toBe('red')
    expect(colorFromLegacy({ color: 'cyan' })).toBe('cyan')
  })

  it('最近使用把新标签放到最前，并保留默认项', () => {
    expect(readRecentIssueTags()[0]).toBe('日期错误待重跑')
    expect(rememberIssueTags(['分页异常'])[0]).toBe('分页异常')
    expect(readRecentIssueTags()).toContain('正文缺失')
  })
})
