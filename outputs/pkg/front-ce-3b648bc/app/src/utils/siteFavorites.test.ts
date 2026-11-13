// @vitest-environment jsdom
// 0917-17 收藏；2026-09-23 起以后端为准（B30，favorite-api.md）。
// 锁住：点星先改本地再落库、失败回滚、从后端加载、旧 localStorage 一次性补传。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { favoriteApi } from '@/api'
import { favoriteSiteIds, isFavoriteSite, loadFavoriteSites, toggleFavoriteSite } from './siteFavorites'

const LEGACY_KEY = 'rc.site.favorites'

describe('siteFavorites', () => {
  beforeEach(() => {
    localStorage.clear()
    favoriteSiteIds.value = new Set()
  })
  afterEach(() => vi.restoreAllMocks())

  it('切换收藏：调 add / remove，本地状态跟着变', async () => {
    const add = vi.spyOn(favoriteApi, 'add').mockResolvedValue({ ok: true, message: '' })
    const remove = vi.spyOn(favoriteApi, 'remove').mockResolvedValue({ ok: true, message: '' })

    expect(await toggleFavoriteSite('11')).toBe(true)
    expect(isFavoriteSite('11')).toBe(true)
    expect(add).toHaveBeenCalledWith('SITE', '11')

    expect(await toggleFavoriteSite('11')).toBe(false)
    expect(isFavoriteSite('11')).toBe(false)
    expect(remove).toHaveBeenCalledWith('SITE', '11')
    // 不再写 localStorage
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('点星立刻生效（不等请求回来）', async () => {
    let resolve!: () => void
    vi.spyOn(favoriteApi, 'add').mockReturnValue(new Promise((r) => { resolve = () => r({ ok: true, message: '' }) }))
    const pending = toggleFavoriteSite('11')
    expect(isFavoriteSite('11')).toBe(true)
    resolve()
    await pending
  })

  it('请求失败：星标改回去，并提示原因', async () => {
    vi.spyOn(favoriteApi, 'add').mockRejectedValue(new Error('未登录'))
    const err = vi.spyOn(ElMessage, 'error')

    expect(await toggleFavoriteSite('11')).toBe(false)
    expect(isFavoriteSite('11')).toBe(false)
    expect(err).toHaveBeenCalledWith('收藏失败：未登录')
  })

  // Set 的 add/delete 是原地改，不会触发 ref 的依赖更新——列表就不会重排
  it('每次切换都换一个新 Set，保证依赖它的 computed / watch 会重跑', async () => {
    vi.spyOn(favoriteApi, 'add').mockResolvedValue({ ok: true, message: '' })
    const before = favoriteSiteIds.value
    await toggleFavoriteSite('11')
    expect(favoriteSiteIds.value).not.toBe(before)
  })

  it('空 siteId 什么都不做', async () => {
    const add = vi.spyOn(favoriteApi, 'add')
    expect(await toggleFavoriteSite('')).toBe(false)
    expect(add).not.toHaveBeenCalled()
  })

  it('loadFavoriteSites 用后端的全部收藏替换本地状态', async () => {
    favoriteSiteIds.value = new Set(['stale'])
    vi.spyOn(favoriteApi, 'listIds').mockResolvedValue(['11', '12'])
    await loadFavoriteSites()
    expect([...favoriteSiteIds.value].sort()).toEqual(['11', '12'])
  })

  it('加载失败（未登录 / 网络）不清空已有状态', async () => {
    favoriteSiteIds.value = new Set(['11'])
    vi.spyOn(favoriteApi, 'listIds').mockRejectedValue(new Error('未登录'))
    await loadFavoriteSites()
    expect(isFavoriteSite('11')).toBe(true)
  })

  it('旧 localStorage 收藏：只补后端没有的正整数 ID，全部成功后删掉本地那份', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['11', '12', 'site-zfb']))
    vi.spyOn(favoriteApi, 'listIds').mockResolvedValue(['11'])
    const add = vi.spyOn(favoriteApi, 'add').mockResolvedValue({ ok: true, message: '' })

    await loadFavoriteSites()

    // 11 后端已有、site-zfb 不是合法 ID：都不补
    expect(add.mock.calls).toEqual([['SITE', '12']])
    expect([...favoriteSiteIds.value].sort()).toEqual(['11', '12'])
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('补传有失败就留着本地那份，下次再补', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(['12']))
    vi.spyOn(favoriteApi, 'listIds').mockResolvedValue([])
    vi.spyOn(favoriteApi, 'add').mockRejectedValue(new Error('网络错误'))

    await loadFavoriteSites()

    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull()
    expect(isFavoriteSite('12')).toBe(false)
  })

  it('本地存的是坏 JSON 时忽略，不抛错', async () => {
    localStorage.setItem(LEGACY_KEY, '{not json')
    vi.spyOn(favoriteApi, 'listIds').mockResolvedValue(['11'])
    await expect(loadFavoriteSites()).resolves.toBeUndefined()
    expect(isFavoriteSite('11')).toBe(true)
  })
})
