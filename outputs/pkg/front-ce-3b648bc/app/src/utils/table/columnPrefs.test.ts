// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  columnPrefsKey,
  mergeColumnOrder,
  mergeFilteredReorder,
  readColumnPrefs,
  reorderProps,
  writeColumnPrefs,
} from './columnPrefs'

describe('columnPrefs', () => {
  it('mergeColumnOrder：已存顺序保留、新列接末尾、已删列丢掉', () => {
    expect(mergeColumnOrder(['a', 'b', 'c'], ['c', 'gone', 'a'])).toEqual(['c', 'a', 'b'])
    expect(mergeColumnOrder(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('reorderProps 把 from 插到 to 的位置', () => {
    expect(reorderProps(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(reorderProps(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(reorderProps(['a', 'b'], 'x', 'b')).toEqual(['a', 'b'])
  })

  it('mergeFilteredReorder 只重排筛选命中的那些位置', () => {
    expect(mergeFilteredReorder(
      ['ENTRY_ID', '源', '标题-K1', 'URL-K2', 'K17'],
      ['标题-K1', 'K17'],
      ['K17', '标题-K1'],
    )).toEqual(['ENTRY_ID', '源', 'K17', 'URL-K2', '标题-K1'])
  })

  it('按 tableId 读写 localStorage，脏数据当没有', () => {
    localStorage.clear()
    expect(readColumnPrefs('t1')).toBeNull()
    writeColumnPrefs('t1', { hidden: ['K17'], order: ['K1', 'K17'] })
    expect(localStorage.getItem(columnPrefsKey('t1'))).toContain('K17')
    expect(readColumnPrefs('t1')).toEqual({ hidden: ['K17'], order: ['K1', 'K17'] })

    localStorage.setItem(columnPrefsKey('t2'), '{not json')
    expect(readColumnPrefs('t2')).toBeNull()
  })

  it('支持列宽 widths 的读取与保存，自动过滤无效宽度', () => {
    localStorage.clear()
    writeColumnPrefs('t3', {
      hidden: [],
      order: ['K1', 'K2'],
      widths: { K1: 300, K2: 450, invalid: -10, nan: NaN as unknown as number },
    })
    expect(readColumnPrefs('t3')).toEqual({
      hidden: [],
      order: ['K1', 'K2'],
      widths: { K1: 300, K2: 450 },
    })
  })
})
