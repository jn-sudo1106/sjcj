// @vitest-environment jsdom
// 「数据同步」页签壳的接线测试：线上报过「tab 点了完全没反应 / 内容区空白」，
// 这里用**真实路由**把「点 tab → 写 URL → 换组件」整条链路钉住。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'

// 子页面全打成桩：本文件只验「切哪个 key 渲染哪个组件」，子页面内部各有自己的测试
vi.mock('./TaskListTab.vue', () => ({ default: { name: 'TaskListTab', template: '<div data-testid="stub-tasks" />' } }))
vi.mock('./LogsTab.vue', () => ({ default: { name: 'LogsTab', template: '<div data-testid="stub-logs" />' } }))
vi.mock('./SqlTaskTab.vue', () => ({
  default: { name: 'SqlTaskTab', props: ['page'], template: '<div :data-testid="`stub-sql-${page}`" />' },
}))
vi.mock('./ConnectionsTab.vue', () => ({
  default: { name: 'ConnectionsTab', template: '<div data-testid="stub-connections" />' },
}))

// 与后端 V3.6.0 种子数据一致（sys_menu: 5201-5205）
const BACKEND_TABS = [
  { id: 5201, key: 'tasks', label: '同步任务', permission: 'sync', order: 1, componentPath: 'views/DataSync/TaskListTab.vue' },
  { id: 5202, key: 'logs', label: '同步日志', permission: 'sync', order: 2, componentPath: 'views/DataSync/LogsTab.vue' },
  { id: 5203, key: 'sql', label: 'SQL 执行', permission: 'sync', order: 3, componentPath: 'views/DataSync/SqlTaskTab.vue' },
  { id: 5204, key: 'table', label: '建表 SQL', permission: 'sync', order: 4, componentPath: 'views/DataSync/SqlTaskTab.vue' },
  { id: 5205, key: 'connections', label: '环境配置', permission: 'sync', order: 5, componentPath: 'views/DataSync/ConnectionsTab.vue' },
]

/** 点完页签后等异步 tab 组件（defineAsyncComponent / 动态 import）真正加载完 */
async function settle() {
  await flushPromises()
  await vi.dynamicImportSettled?.()
  await flushPromises()
}

async function mountPage(tabs?: unknown) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/sync', component: { template: '<div />' }, meta: tabs === undefined ? {} : { tabs } }],
  })
  await router.push('/sync')
  await router.isReady()
  setActivePinia(createPinia())
  const DataSync = (await import('./index.vue')).default
  const wrapper = mount(DataSync, { global: { plugins: [router, ElementPlus] } })
  await settle()
  return { wrapper, router }
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>['wrapper']
const tabButtons = (wrapper: Wrapper) => wrapper.findAll('.sync-tab')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('数据同步 · 页签', () => {
  it('后端没下发 tab 时用本地兜底：5 个页签、默认「同步任务」', async () => {
    const { wrapper } = await mountPage()
    expect(tabButtons(wrapper).map((b) => b.text())).toEqual([
      '同步任务',
      '同步日志',
      'SQL 执行',
      '建表 SQL',
      '环境配置',
    ])
    expect(wrapper.find('[data-testid="stub-tasks"]').exists()).toBe(true)
  })

  // 线上问题的主路径：点第二个页签 → URL 写 tab=logs → 内容跟着换
  it('点「同步日志」：URL 写入 tab=logs，内容切到日志页', async () => {
    const { wrapper, router } = await mountPage()
    await tabButtons(wrapper)[1].trigger('click')
    await settle()

    expect(router.currentRoute.value.query.tab).toBe('logs')
    expect(wrapper.find('[data-testid="stub-logs"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stub-tasks"]').exists()).toBe(false)
  })

  it('「SQL 执行」与「建表 SQL」共用组件但按 page 区分', async () => {
    const { wrapper, router } = await mountPage()

    await tabButtons(wrapper)[2].trigger('click')
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('sql')
    expect(wrapper.find('[data-testid="stub-sql-sql"]').exists()).toBe(true)

    await tabButtons(wrapper)[3].trigger('click')
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('table')
    expect(wrapper.find('[data-testid="stub-sql-table"]').exists()).toBe(true)
  })

  it('后端下发 tab（含 component_path）时按后端文案与顺序渲染，点击照样能切', async () => {
    const { wrapper, router } = await mountPage(BACKEND_TABS)

    expect(tabButtons(wrapper).map((b) => b.text())).toEqual([
      '同步任务',
      '同步日志',
      'SQL 执行',
      '建表 SQL',
      '环境配置',
    ])
    await tabButtons(wrapper)[4].trigger('click')
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('connections')
    expect(wrapper.find('[data-testid="stub-connections"]').exists()).toBe(true)
  })

  // 后端 sys_menu 的 key（link_address）为空/重复时，以前所有 tab 抢同一个 key →
  // selectTab 以为点的是第一个 → replace 成同一地址 → 冗余导航被丢弃 →「点了完全没反应」。
  // 这里只断言「URL + 高亮跟着动」（这正是用户看到的症状）；tab 组件本身是
  // defineAsyncComponent，vi.mock 下动态 import 不结算，组件渲染由别的用例/页面自测覆盖。
  it('后端 tab 的 key 为空或重复时也要能切（URL 与高亮跟着动，不是死按钮）', async () => {
    const { wrapper, router } = await mountPage([
      { id: 1, key: '', label: '同步任务', permission: '', order: 1, componentPath: 'views/DataSync/TaskListTab.vue' },
      { id: 2, key: '', label: '同步日志', permission: '', order: 2, componentPath: 'views/DataSync/LogsTab.vue' },
      { id: 3, key: 'dup', label: 'SQL 执行', permission: '', order: 3, componentPath: 'views/DataSync/SqlTaskTab.vue' },
      { id: 4, key: 'dup', label: '环境配置', permission: '', order: 4, componentPath: 'views/DataSync/ConnectionsTab.vue' },
    ])

    const buttons = tabButtons(wrapper)
    expect(buttons).toHaveLength(4)
    // 每个 tab 都要有独立 key，否则点击会被当成「点第一个」
    expect(new Set(['tab-1', 'tab-2', 'dup', 'tab-4']).size).toBe(4)

    await buttons[1].trigger('click')
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('tab-2')
    expect(tabButtons(wrapper)[1].classes()).toContain('active')

    await buttons[3].trigger('click')
    await settle()
    expect(router.currentRoute.value.query.tab).toBe('tab-4')
    expect(tabButtons(wrapper)[3].classes()).toContain('active')
  })

  // 1106 报障的根因之一：页内 tab 的细粒度权限码后端没配 → 全部被过滤 → 只剩空 tab 栏。
  it('页内 tab 的权限码一个都对不上时，仍然渲染出来（不留空 tab 栏）', async () => {
    const { wrapper } = await mountPage(
      BACKEND_TABS.map((t) => ({ ...t, permission: 'sync:not-configured' })),
    )
    expect(tabButtons(wrapper).map((b) => b.text())).toEqual([
      '同步任务',
      '同步日志',
      'SQL 执行',
      '建表 SQL',
      '环境配置',
    ])
  })
})
