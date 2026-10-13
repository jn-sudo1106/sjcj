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

  // useActiveNavKey 拿 route.path 的第一段去 TABS 里查，查不到会静默回退 TABS[0]（采集资产总览）。
  // 所以 key 与 path 段必须一致，否则那个模块的面包屑/侧栏高亮会指到别的模块，而且不报错。
  it('每个 TAB 的 key 等于其 path 的第一段', () => {
    const mismatched = TABS.filter((t) => t.key !== t.path.split('/')[1])
    expect(mismatched.map((t) => `${t.key} ≠ ${t.path}`)).toEqual([])
  })

  it('流程中心走 /flows，面包屑能查到自己而不是回退到总览', () => {
    const tab = TABS.find((t) => t.key === 'flows')
    expect(tab?.label).toBe('流程中心')
    expect(tab?.path).toBe('/flows')
  })

  it('旧 /tools 路径兼容跳转到 /monitor，并保留查询条件', () => {
    const shell = router.options.routes.find((r) => r.path === '/')
    const monitorAlias = shell?.children?.find((r) => r.path === '/tools')
    expect(monitorAlias?.redirect).toBeTypeOf('function')
    const redirect = monitorAlias?.redirect as (to: { query: Record<string, unknown> }) => unknown
    expect(redirect({ query: { state: 'E' } })).toEqual({ path: '/monitor', query: { state: 'E' } })
  })

  // 1013：旧 ai-chat-view「模板配置 → sql模板配置」迁到 front-ce，独立成「模板配置」组。
  // 这一组会随迁移逐个长出来（表模板 / 自动补全 / 问句改写 / 数据索引…），所以按组做通用断言：
  // TABS 里每个 template 入口都要有路由落点，且 meta.permission 与 TABS 的 permission 同值
  // ——侧栏读 TABS、路由守卫读 meta，两边不同值就会出现「菜单看得见、地址进不去」。
  it('模板配置组每个入口都有路由，且 permission 两侧同值', () => {
    const tab = TABS.find((t) => t.key === 'sql-template')
    expect(tab?.label).toBe('SQL模板配置')
    expect(tab?.group).toBe('template')

    const templateTabs = TABS.filter((t) => t.group === 'template')
    expect(templateTabs.length).toBeGreaterThan(0)
    const shell = router.options.routes.find((r) => r.path === '/')
    for (const t of templateTabs) {
      const route = shell?.children?.find((r) => r.path === t.path)
      expect(route, `路由缺 ${t.path}`).toBeTruthy()
      expect(route?.meta?.permission).toBe(t.permission)
    }
  })
})
