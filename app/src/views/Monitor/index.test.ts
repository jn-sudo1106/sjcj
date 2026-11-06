// @vitest-environment jsdom
// 监控中心 tab 壳：页内 tab 的数据源是后端菜单（dynamicRoutes 把 sys_menu 的 menu_type=2 记录
// 写进 route.meta.tabs）。这组用例锁死「后端下发的 key/顺序决定 tab」「key 带模块前缀也能匹配」
// 「匹配不到时给明确提示而不是空白」——后者是监控中心 tab 白屏那次踩过的坑。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import Monitor from './index.vue'

const router = vi.hoisted(() => ({ replace: vi.fn() }))
const routeQuery = vi.hoisted(() => ({ current: { tab: undefined as string | undefined } }))
const routeMeta = vi.hoisted(() => ({ current: { tabs: undefined as unknown } }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  routeQuery.current = reactive(routeQuery.current)
  routeMeta.current = reactive(routeMeta.current)
  return {
    useRoute: () => ({ query: routeQuery.current, meta: routeMeta.current }),
    useRouter: () => ({ replace: router.replace }),
  }
})

// 六个子页面全部打成桩：这里验的是「切哪个 key 渲染哪个组件」，不是子页面自己的逻辑
vi.mock('./sourceCheck/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'SourceCheck', setup: () => () => h('div', { class: 'stub-source-check' }) } }
})
vi.mock('./sourceIssues/SourceIssuesView.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'SourceIssuesView', setup: () => () => h('div', { class: 'stub-source-issues' }) } }
})
vi.mock('./queueCheck/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'QueueCheck', setup: () => () => h('div', { class: 'stub-queue-check' }) } }
})
vi.mock('./commJob/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'CommJob', setup: () => () => h('div', { class: 'stub-comm-job' }) } }
})
vi.mock('./taskList/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'TaskList', setup: () => () => h('div', { class: 'stub-task-list' }) } }
})
vi.mock('./taskStat/index.vue', async () => {
  const { h } = await import('vue')
  return { default: { name: 'TaskStat', setup: () => () => h('div', { class: 'stub-task-stat' }) } }
})

// 与后端 V3.6.0 种子数据一致（sys_menu: 5301-5306）
const BACKEND_TABS = [
  { id: 5301, key: 'sourceCheck', label: '数据源告警', permission: 'monitor', order: 1, componentPath: 'views/Monitor/sourceCheck/index.vue' },
  { id: 5302, key: 'sourceIssues', label: '源问题', permission: 'monitor', order: 2, componentPath: 'views/Monitor/sourceIssues/SourceIssuesView.vue' },
  { id: 5303, key: 'queueCheck', label: '队列告警', permission: 'monitor', order: 3, componentPath: 'views/Monitor/queueCheck/index.vue' },
  { id: 5304, key: 'commJob', label: '自定义告警', permission: 'monitor', order: 4, componentPath: 'views/Monitor/commJob/index.vue' },
  { id: 5305, key: 'taskList', label: '任务实例', permission: 'monitor', order: 5, componentPath: 'views/Monitor/taskList/index.vue' },
  { id: 5306, key: 'taskStat', label: '任务统计', permission: 'monitor', order: 6, componentPath: 'views/Monitor/taskStat/index.vue' },
]

function mountMonitor() {
  return mount(Monitor, { global: { plugins: [ElementPlus] } })
}

beforeEach(() => {
  router.replace.mockReset()
  routeQuery.current.tab = undefined
  routeMeta.current.tabs = undefined
})

describe('监控中心 · 页内 tab（后端驱动）', () => {
  it('后端下发 6 条 tab：文案与顺序按后端，默认渲染第一条', () => {
    routeMeta.current.tabs = BACKEND_TABS
    const wrapper = mountMonitor()

    expect(wrapper.findAll('.ra-tab-link').map((b) => b.text())).toEqual([
      '数据源告警',
      '源问题',
      '队列告警',
      '自定义告警',
      '任务实例',
      '任务统计',
    ])
    expect(wrapper.find('.ra-tab-link.active').text()).toBe('数据源告警')
    expect(wrapper.find('.stub-source-check').exists()).toBe(true)
  })

  it('点「源问题」切到对应组件并把 tab 写进地址', async () => {
    routeMeta.current.tabs = BACKEND_TABS
    const wrapper = mountMonitor()

    await wrapper.findAll('.ra-tab-link')[1]!.trigger('click')
    expect(router.replace).toHaveBeenLastCalledWith({ path: '/monitor', query: { tab: 'sourceIssues' } })

    // 地址变化后页面跟着切组件
    routeQuery.current.tab = 'sourceIssues'
    await nextTick()
    expect(wrapper.find('.stub-source-issues').exists()).toBe(true)
    expect(wrapper.find('.stub-source-check').exists()).toBe(false)
  })

  it('默认 tab 不带 tab 参数（地址干净）', async () => {
    routeMeta.current.tabs = BACKEND_TABS
    const wrapper = mountMonitor()

    await wrapper.findAll('.ra-tab-link')[0]!.trigger('click')
    expect(router.replace).toHaveBeenLastCalledWith({ path: '/monitor', query: {} })
  })

  it('后端 key 带模块前缀（老库脏数据 monitor:sourceIssues）也能匹配到组件', () => {
    routeMeta.current.tabs = [
      { id: 1, key: 'monitor:sourceIssues', label: '源问题', permission: 'monitor', order: 1 },
    ]
    const wrapper = mountMonitor()

    expect(wrapper.find('.stub-source-issues').exists()).toBe(true)
  })

  it('一条都没配可用组件时：整页退回本地 tab 列表，并把后端配置打出来', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    routeMeta.current.tabs = [
      { id: 1, key: 'unknown-tab', label: '未知页签', permission: 'monitor', order: 1 },
    ]
    const wrapper = mountMonitor()

    // 1106 调整：后端下发的 tab 一条都解析不到组件时，整页退回页面本地的 fallbackTabs。
    // 「tab 栏在、内容区全空」等于整页不可用（数据同步 / 问数系统配置 / 模板配置 / 基础配置 就这么废过），
    // 比退回旧列表更糟；部分缺失仍保留后端 tab 并显示空态（见下一条用例）。
    expect(wrapper.findAll('.ra-tab-link').map((b) => b.text())).toContain('数据源告警')
    expect(wrapper.find('.stub-source-check').exists()).toBe(true)
    // 开发态把后端下发的 key / component_path 打出来，方便对齐菜单配置
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown-tab'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fallbackTabs'))
    warn.mockRestore()
  })

  it('只有个别 tab 匹配不到组件时：保留该 tab（不顶掉后端配置）并在内容区给空态 + 警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    routeMeta.current.tabs = [
      { id: 5301, key: 'sourceCheck', label: '数据源告警', permission: 'monitor', order: 1, componentPath: 'views/Monitor/sourceCheck/index.vue' },
      { id: 5399, key: 'unknown-tab', label: '未知页签', permission: 'monitor', order: 2 },
    ]
    routeQuery.current.tab = 'unknown-tab'
    const wrapper = mountMonitor()

    expect(wrapper.findAll('.ra-tab-link').map((b) => b.text())).toEqual(['数据源告警', '未知页签'])
    expect(wrapper.find('.el-empty').exists()).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown-tab'))
    warn.mockRestore()
  })
})
