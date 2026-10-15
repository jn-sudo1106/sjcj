// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { SYSTEM_CONFIG_TABS, BASE_CONFIG_TABS, TABS, TEMPLATE_CONFIG_TABS } from './tabs'
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

  // 1013：旧 ai-chat-view「模板配置 → sql模板配置」迁到 front-ce，独立成一个菜单组。
  // 1015：组改名「问数配置」，组下只留「模板配置」一个入口，8 个子模块收进页内 tab
  // （元数据在 TEMPLATE_CONFIG_TABS，容器见 views/TemplateConfig/index.vue）。
  // 8 个子模块不再有独立地址，只通过 ?tab= 访问。
  // 1015（同日）：旧「系统配置」组迁入，问数配置组加第二个入口「问数系统配置」，
  // 参数设置 / 页面配置两个页内 tab（元数据在 SYSTEM_CONFIG_TABS）。
  // 1015：旧「基础配置」组迁入，问数配置组加第三个入口「基础配置」，**排在模板配置之前**，
  // 表字段管理一个页内 tab（元数据在 BASE_CONFIG_TABS）。
  it('侧栏暴露基础配置 + 模板配置 + 问数系统配置三个入口，子模块作为页内 tab', () => {
    const templateTabs = TABS.filter((t) => t.group === 'template')
    expect(templateTabs.map((t) => `${t.key}:${t.label}`)).toEqual(['base-config:基础配置', 'template-config:模板配置', 'system-config:问数系统配置'])

    const shell = router.options.routes.find((r) => r.path === '/')
    const baseRoute = shell?.children?.find((r) => r.path === '/base-config')
    expect(baseRoute?.component).toBeTruthy()
    const route = shell?.children?.find((r) => r.path === '/template-config')
    expect(route?.component).toBeTruthy()
    const systemRoute = shell?.children?.find((r) => r.path === '/system-config')
    expect(systemRoute?.component).toBeTruthy()

    expect(TEMPLATE_CONFIG_TABS.map((t) => t.key)).toEqual([
      'sql-template',
      'table-template',
      'dic-template',
      'question-dic',
      'data-index-sync',
      'data-index-config',
      'chat-flow-step',
      'word-segment-config',
    ])
    // 页内 tab 的权限码与原侧栏子项一一对应，接入菜单权限后 canAccess 直接按它过滤
    for (const t of TEMPLATE_CONFIG_TABS) {
      expect(t.permission).toBe(t.key)
    }
  })

  // 问数系统配置（1015 迁入旧「系统配置」组）：参数设置必须排第一 —— 无 ?tab= 时容器落 tabs[0]，
  // 需求明确「默认进来展示参数设置」。
  it('问数系统配置的页内 tab：参数设置在前（默认），权限码与 key 一致', () => {
    expect(SYSTEM_CONFIG_TABS.map((t) => `${t.key}:${t.label}`)).toEqual(['param-config:参数设置', 'page-config:页面配置'])
    for (const t of SYSTEM_CONFIG_TABS) {
      expect(t.permission).toBe(t.key)
    }
  })

  // 基础配置（1015 迁入旧「基础配置」组）：页内两个 tab，「表字段管理」是无 ?tab= 时的默认，
  // 「向量表数据浏览」同日迁入（旧 /demo/vector-data）。
  it('基础配置的页内 tab：表字段管理 + 向量表数据浏览，权限码与 key 一致', () => {
    expect(BASE_CONFIG_TABS.map((t) => `${t.key}:${t.label}`)).toEqual(['entity-config:表字段管理', 'vector-data:向量表数据浏览'])
    for (const t of BASE_CONFIG_TABS) {
      expect(t.permission).toBe(t.key)
    }
  })
})
