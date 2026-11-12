// @vitest-environment jsdom
// 1013 表 ID 列表收藏：结构同 sourceFavorites，类型是 ENTRY_TYPE。锁住乐观更新、失败回滚、加载标记。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus'
import { favoriteApi } from '@/api'
import { favoriteEntriesLoaded, favoriteEntryIds, isFavoriteEntry, loadFavoriteEntries, toggleFavoriteEntry } from './entryFavorites'

describe('entryFavorites', () => {
  beforeEach(() => {
    favoriteEntryIds.value = new Set()
    favoriteEntriesLoaded.value = false
  })
  afterEach(() => vi.restoreAllMocks())

  it('切换收藏：按 ENTRY_TYPE 类型调 add / remove，本地状态跟着变', async () => {
    const add = vi.spyOn(favoriteApi, 'add').mockResolvedValue({ ok: true, message: '' })
    const remove = vi.spyOn(favoriteApi, 'remove').mockResolvedValue({ ok: true, message: '' })

    expect(await toggleFavoriteEntry('620039')).toBe(true)
    expect(isFavoriteEntry('620039')).toBe(true)
    expect(add).toHaveBeenCalledWith('ENTRY_TYPE', '620039')

    expect(await toggleFavoriteEntry('620039')).toBe(false)
    expect(isFavoriteEntry('620039')).toBe(false)
    expect(remove).toHaveBeenCalledWith('ENTRY_TYPE', '620039')
  })

  it('点星立刻生效（不等请求回来）', async () => {
    let resolve!: () => void
    vi.spyOn(favoriteApi, 'add').mockReturnValue(new Promise((r) => { resolve = () => r({ ok: true, message: '' }) }))
    const pending = toggleFavoriteEntry('1')
    expect(isFavoriteEntry('1')).toBe(true)
    resolve()
    await pending
  })

  it('请求失败：星标改回去，并提示原因', async () => {
    vi.spyOn(favoriteApi, 'add').mockRejectedValue(new Error('未登录'))
    const err = vi.spyOn(ElMessage, 'error')

    expect(await toggleFavoriteEntry('1')).toBe(false)
    expect(isFavoriteEntry('1')).toBe(false)
    expect(err).toHaveBeenCalledWith('收藏失败：未登录')
  })

  it('从后端加载 ENTRY_TYPE 收藏，加载完打上已加载标记', async () => {
    const listIds = vi.spyOn(favoriteApi, 'listIds').mockResolvedValue(['1', '2'])
    await loadFavoriteEntries()
    expect(listIds).toHaveBeenCalledWith('ENTRY_TYPE')
    expect([...favoriteEntryIds.value]).toEqual(['1', '2'])
    expect(favoriteEntriesLoaded.value).toBe(true)
  })

  it('加载失败：保留已有状态，也算加载过（不能一直停在「加载中」）', async () => {
    favoriteEntryIds.value = new Set(['9'])
    vi.spyOn(favoriteApi, 'listIds').mockRejectedValue(new Error('网络错误'))
    await loadFavoriteEntries()
    expect([...favoriteEntryIds.value]).toEqual(['9'])
    expect(favoriteEntriesLoaded.value).toBe(true)
  })
})
