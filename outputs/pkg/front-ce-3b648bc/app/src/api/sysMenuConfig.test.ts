import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({ request: vi.fn() }))

import { request } from './client'
import { LIVE_ENDPOINTS } from './endpoints'
import { deleteMenu, getMenuTree, saveMenu, updateMenuSort } from './sysMenuConfig'

describe('sysMenuConfig API', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset()
  })

  // 2026-11-06 回归：删除曾传 httpEndpoint=`sys/menu/${id}`，而 live 判定优先用 httpEndpoint，
  // 动态路径命不中 LIVE_ENDPOINTS → 请求被 mock 接管，页面提示「删除成功」但库里一条没删。
  it('deleteMenu: 走逻辑键 sys/menu/delete，不带参数化 httpEndpoint', async () => {
    await deleteMenu(8300)
    expect(vi.mocked(request)).toHaveBeenCalledWith('sys/menu/delete', { id: 8300 }, { method: 'POST' })
  })

  it('菜单配置的写端点都已登记为 live', () => {
    expect(LIVE_ENDPOINTS.has('sys/menu/tree')).toBe(true)
    expect(LIVE_ENDPOINTS.has('sys/menu/save')).toBe(true)
    expect(LIVE_ENDPOINTS.has('sys/menu/sort')).toBe(true)
    expect(LIVE_ENDPOINTS.has('sys/menu/delete')).toBe(true)
  })

  it('saveMenu / updateMenuSort / getMenuTree: 逻辑键与真实路径一致', async () => {
    const form = { parentId: 8000, name: '新的菜单', type: 1 }
    const items = [{ id: 8100, order: 2 }]
    vi.mocked(request).mockResolvedValue([])

    await saveMenu(form)
    await updateMenuSort(items)
    await getMenuTree()

    expect(vi.mocked(request)).toHaveBeenNthCalledWith(1, 'sys/menu/save', form, { method: 'POST' })
    expect(vi.mocked(request)).toHaveBeenNthCalledWith(2, 'sys/menu/sort', items, { method: 'POST' })
    expect(vi.mocked(request)).toHaveBeenNthCalledWith(3, 'sys/menu/tree', {}, { method: 'GET' })
  })
})
