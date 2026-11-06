// @vitest-environment jsdom
// 路由 chunk 预取：只在「把鼠标移到菜单上 / 空闲」时提前拉一次页面文件，
// 不能重复拉、不能因为 chunk 404（发版中）把用户搞崩。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { prefetchRoute, resetPrefetchCache } from './prefetchRoute'

describe('prefetchRoute', () => {
  beforeEach(() => resetPrefetchCache())

  it('调用路由记录上的懒加载函数，同一地址（含不同 query）只触发一次', () => {
    const loader = vi.fn(async () => ({ default: {} }))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/p', component: loader }],
    })

    prefetchRoute(router, '/p')
    prefetchRoute(router, '/p?tab=a')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('已同步加载的组件、未匹配地址、空地址都安全跳过', () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/eager', component: { template: '<div />' } }],
    })

    expect(() => prefetchRoute(router, '/eager')).not.toThrow()
    expect(() => prefetchRoute(router, '/nowhere')).not.toThrow()
    expect(() => prefetchRoute(router, '')).not.toThrow()
  })

  it('预取失败（发版中 chunk 404）不抛出，且清掉标记允许下次重试', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/bad', component: loader as unknown as { template: string } }],
    })

    expect(() => prefetchRoute(router, '/bad')).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    prefetchRoute(router, '/bad')
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
