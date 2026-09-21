// @vitest-environment jsdom
// 0917-17：收藏存本地。这里锁住三件容易出事的事——坏数据、存不下、跨标签页。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { favoriteSiteIds, isFavoriteSite, toggleFavoriteSite } from './siteFavorites'

const KEY = 'rc.site.favorites'

describe('siteFavorites', () => {
  beforeEach(() => {
    localStorage.clear()
    favoriteSiteIds.value = new Set()
  })
  afterEach(() => vi.restoreAllMocks())

  it('切换收藏：写进 localStorage，再切一次取消', () => {
    expect(toggleFavoriteSite('site-1')).toBe(true)
    expect(isFavoriteSite('site-1')).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual(['site-1'])

    expect(toggleFavoriteSite('site-1')).toBe(false)
    expect(isFavoriteSite('site-1')).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual([])
  })

  // Set 的 add/delete 是原地改，不会触发 ref 的依赖更新——列表就不会重排
  it('每次切换都换一个新 Set，保证依赖它的 computed / watch 会重跑', () => {
    const before = favoriteSiteIds.value
    toggleFavoriteSite('site-1')
    expect(favoriteSiteIds.value).not.toBe(before)
  })

  it('空 siteId 不写进去', () => {
    expect(toggleFavoriteSite('')).toBe(false)
    expect(favoriteSiteIds.value.size).toBe(0)
  })

  // 隐私模式下 localStorage 会抛；存不下也得让本次会话能用，不能白屏
  it('localStorage 写入抛异常时不崩，内存里仍然生效', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(() => toggleFavoriteSite('site-1')).not.toThrow()
    expect(isFavoriteSite('site-1')).toBe(true)
  })

  it('另一个标签页改了收藏，本页跟着同步', () => {
    localStorage.setItem(KEY, JSON.stringify(['site-9']))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(isFavoriteSite('site-9')).toBe(true)
  })

  // 老版本写的、被手改的值：一行坏数据不该把网站列表带崩
  it('存的是坏 JSON / 不是数组时当成没有收藏，不抛错', () => {
    for (const bad of ['{不是 JSON', '{"a":1}', '"site-1"', 'null']) {
      localStorage.setItem(KEY, bad)
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
      expect(favoriteSiteIds.value.size).toBe(0)
    }
    // 数组里混了非字符串：把能认的留下
    localStorage.setItem(KEY, JSON.stringify(['site-1', 3, null, '', 'site-2']))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect([...favoriteSiteIds.value]).toEqual(['site-1', 'site-2'])
  })

  it('别的键的 storage 事件不影响收藏', () => {
    toggleFavoriteSite('site-1')
    localStorage.setItem('rc.dataview.appendSize', '100')
    window.dispatchEvent(new StorageEvent('storage', { key: 'rc.dataview.appendSize' }))
    expect(isFavoriteSite('site-1')).toBe(true)
  })
})
