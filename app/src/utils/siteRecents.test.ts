// @vitest-environment jsdom
// 0917-17 后半条：最近打开。跟收藏的区别是——有上限、有序、隐式记录。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { recentSiteIds, recordSiteVisit, recentRankOf } from './siteRecents'

const KEY = 'rc.site.recent'

describe('siteRecents', () => {
  beforeEach(() => {
    localStorage.clear()
    recentSiteIds.value = []
  })
  afterEach(() => vi.restoreAllMocks())

  it('记一次访问：最近的排最前', () => {
    recordSiteVisit('a')
    recordSiteVisit('b')
    expect(recentSiteIds.value).toEqual(['b', 'a'])
    expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual(['b', 'a'])
  })

  it('再次打开同一个网站：置顶而不是出现两次', () => {
    recordSiteVisit('a')
    recordSiteVisit('b')
    recordSiteVisit('a')
    expect(recentSiteIds.value).toEqual(['a', 'b'])
  })

  // 连着点同一个网站（比如从卡片进去又退回来再进）不该反复写 localStorage
  it('已经在最前面时不重复写', () => {
    recordSiteVisit('a')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    recordSiteVisit('a')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('最多留 10 条，超了挤掉最旧的', () => {
    for (let i = 1; i <= 12; i++) recordSiteVisit(`s${i}`)
    expect(recentSiteIds.value.length).toBe(10)
    expect(recentSiteIds.value[0]).toBe('s12')
    expect(recentSiteIds.value).not.toContain('s1')
    expect(recentSiteIds.value).not.toContain('s2')
  })

  it('空 siteId 不记', () => {
    recordSiteVisit('')
    expect(recentSiteIds.value).toEqual([])
  })

  it('每次都换一个新数组，依赖它的 watch 才会重跑', () => {
    recordSiteVisit('a')
    const before = recentSiteIds.value
    recordSiteVisit('b')
    expect(recentSiteIds.value).not.toBe(before)
  })

  it('recentRankOf：越近越小，不在列表里排最后', () => {
    recordSiteVisit('a')
    recordSiteVisit('b')
    expect(recentRankOf('b')).toBe(0)
    expect(recentRankOf('a')).toBe(1)
    expect(recentRankOf('never')).toBe(10)
  })

  it('localStorage 写入抛异常时不崩，内存里仍然生效', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(() => recordSiteVisit('a')).not.toThrow()
    expect(recentSiteIds.value).toEqual(['a'])
  })

  it('存的是坏数据时当成空，不抛错', () => {
    for (const bad of ['{不是 JSON', '{"a":1}', 'null']) {
      localStorage.setItem(KEY, bad)
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
      expect(recentSiteIds.value).toEqual([])
    }
  })

  it('另一个标签页打开了网站，本页跟着同步', () => {
    localStorage.setItem(KEY, JSON.stringify(['x', 'y']))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(recentSiteIds.value).toEqual(['x', 'y'])
  })
})
