// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { TABS } from './tabs'
import { router } from './index'

describe('Phase 3.1 画布入口退役', () => {
  it('侧栏不再暴露独立流程画布菜单', () => {
    expect(TABS.some((t) => t.key === 'canvas' || t.label === '流程画布')).toBe(false)
    expect(TABS.some((t) => t.group === 'workbench')).toBe(false)
  })

  it('裸 /canvas 重定向到采集资产，仅 sourceId/mode=new 可进入画布', () => {
    // 登录迁移后业务路由嵌套在 AppShell 父路由（path: '/'）之下
    const shell = router.options.routes.find((r) => r.path === '/')
    const canvas = shell?.children?.find((r) => r.path === '/canvas')
    expect(canvas?.beforeEnter).toBeTypeOf('function')
    const beforeEnter = canvas?.beforeEnter as (to: { query: Record<string, unknown> }) => unknown

    expect(beforeEnter({ query: {} })).toEqual('/collect')
    expect(beforeEnter({ query: { sourceId: '391007768' } })).toBe(true)
    expect(beforeEnter({ query: { mode: 'new' } })).toBe(true)
  })

  it('「运行记录」改名「任务中心」，路径 /runs → /tasks 且保留查询条件（0819 N4-2 / 0812 M3-11）', () => {
    const tab = TABS.find((t) => t.key === 'tasks')
    expect(tab?.label).toBe('任务中心')
    expect(tab?.path).toBe('/tasks')
    expect(TABS.some((t) => t.key === 'runs' || t.label === '运行记录')).toBe(false)

    const shell = router.options.routes.find((r) => r.path === '/')
    expect(shell?.children?.some((r) => r.path === '/tasks')).toBe(true)
    // 旧链接仍要能用：各处已经发出去的 /runs?siteId= 不能因改名而失效
    const legacy = shell?.children?.find((r) => r.path === '/runs')
    expect(legacy?.redirect).toBeTypeOf('function')
    const redirect = legacy?.redirect as (to: { query: Record<string, unknown> }) => unknown
    expect(redirect({ query: { siteId: '1' } })).toEqual({ path: '/tasks', query: { siteId: '1' } })
  })

  it('旧 /tools 路径兼容跳转到 /monitor，并保留查询条件', () => {
    const shell = router.options.routes.find((r) => r.path === '/')
    const monitorAlias = shell?.children?.find((r) => r.path === '/tools')
    expect(monitorAlias?.redirect).toBeTypeOf('function')
    const redirect = monitorAlias?.redirect as (to: { query: Record<string, unknown> }) => unknown
    expect(redirect({ query: { state: 'E' } })).toEqual({ path: '/monitor', query: { state: 'E' } })
  })
})
