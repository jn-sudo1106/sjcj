// @vitest-environment jsdom
// 0924-08 源收藏：结构同 siteFavorites，类型是 SOURCE。锁住乐观更新、失败回滚、加载标记。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus'
import { favoriteApi } from '@/api'
import { favoriteSourceIds, favoriteSourcesLoaded, isFavoriteSource, loadFavoriteSources, toggleFavoriteSource } from './sourceFavorites'

describe('sourceFavorites', () => {
  beforeEach(() => {
    favoriteSourceIds.value = new Set()
    favoriteSourcesLoaded.value = false
  })
  afterEach(() => vi.restoreAllMocks())

  it('切换收藏：按 SOURCE 类型调 add / remove，本地状态跟着变', async () => {
    const add = vi.spyOn(favoriteApi, 'add').mockResolvedValue({ ok: true, message: '' })
    const remove = vi.spyOn(favoriteApi, 'remove').mockResolvedValue({ ok: true, message: '' })

    expect(await toggleFavoriteSource('430024431')).toBe(true)
    expect(isFavoriteSource('430024431')).toBe(true)
    expect(add).toHaveBeenCalledWith('SOURCE', '430024431')

    expect(await toggleFavoriteSource('430024431')).toBe(false)
    expect(isFavoriteSource('430024431')).toBe(false)
    expect(remove).toHaveBeenCalledWith('SOURCE', '430024431')
  })

  it('点星立刻生效（不等请求回来）', async () => {
    let resolve!: () => void
    vi.spyOn(favoriteApi, 'add').mockReturnValue(new Promise((r) => { resolve = () => r({ ok: true, message: '' }) }))
    const pending = toggleFavoriteSource('1')
    expect(isFavoriteSource('1')).toBe(true)
    resolve()
    await pending
  })

  it('请求失败：星标改回去，并提示原因', async () => {
    vi.spyOn(favoriteApi, 'add').mockRejectedValue(new Error('未登录'))
    const err = vi.spyOn(ElMessage, 'error')

    expect(await toggleFavoriteSource('1')).toBe(false)
    expect(isFavoriteSource('1')).toBe(false)
    expect(err).toHaveBeenCalledWith('收藏失败：未登录')
  })

  it('从后端加载 SOURCE 收藏，加载完打上已加载标记', async () => {
    const listIds = vi.spyOn(favoriteApi, 'listIds').mockResolvedValue(['1', '2'])
    await loadFavoriteSources()
    expect(listIds).toHaveBeenCalledWith('SOURCE')
    expect([...favoriteSourceIds.value]).toEqual(['1', '2'])
    expect(favoriteSourcesLoaded.value).toBe(true)
  })

  it('加载失败：保留已有状态，也算加载过（不能一直停在「加载中」）', async () => {
    favoriteSourceIds.value = new Set(['9'])
    vi.spyOn(favoriteApi, 'listIds').mockRejectedValue(new Error('网络错误'))
    await loadFavoriteSources()
    expect([...favoriteSourceIds.value]).toEqual(['9'])
    expect(favoriteSourcesLoaded.value).toBe(true)
  })
})
