import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({ request: vi.fn() }))

import { request } from './client'
import { getUserNav } from './menu'

describe('menu API', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset()
  })

  it('getUserNav: 发起 GET 请求至 sys/menu/user-nav 端点', async () => {
    const mockNav = {
      permissions: ['sys:menu:view'],
      menuGroups: [
        {
          groupKey: 'system',
          groupLabel: '系统管理',
          order: 1,
          items: [],
        },
      ],
    }
    vi.mocked(request).mockResolvedValue(mockNav)

    const res = await getUserNav()
    expect(vi.mocked(request)).toHaveBeenCalledWith('sys/menu/user-nav', {}, { method: 'GET' })
    expect(res).toEqual(mockNav)
  })
})
