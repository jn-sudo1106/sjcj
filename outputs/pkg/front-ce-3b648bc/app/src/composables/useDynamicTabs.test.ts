// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, KeepAlive, type Component } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { useDynamicTabs } from './useDynamicTabs'
import { useAuthStore } from '@/stores/auth'
import type { NavTab } from '@/api/menu'

const DummyCompA = defineComponent({ render: () => h('div', 'Comp A') })
const DummyCompB = defineComponent({ render: () => h('div', 'Comp B') })

describe('useDynamicTabs Composable', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('使用 fallbackTabs 能正常按 order 升序排列并赋默认激活项', () => {
    const auth = useAuthStore()
    auth.roles = ['admin']

    const { tabs, activeTab } = useDynamicTabs({
      componentMap: {
        tabB: DummyCompB,
        tabA: DummyCompA,
      },
      fallbackTabs: [
        { key: 'tabB', label: '标签B', order: 2 },
        { key: 'tabA', label: '标签A', order: 1 },
      ],
    })

    expect(tabs.value.length).toBe(2)
    expect(tabs.value[0].key).toBe('tabA')
    expect(tabs.value[1].key).toBe('tabB')
    expect(activeTab.value?.key).toBe('tabA')
    expect(activeTab.value?.comp).toBe(DummyCompA)
  })

  // 1106 报障根因：页内 tab 的细粒度权限码（sql-template / param-config / entity-config…）
  // 后端菜单没配 → canAccess 判成无权限 → 整页 tab 被过滤光，只剩空 tab 栏（「tab 页打不开」）。
  it('页内 tab 的权限码全对不上时退回显示全部，但 adminOnly 的不会外泄', () => {
    const auth = useAuthStore()
    auth.roles = ['operator'] // 非 admin
    auth.isMenusLoaded = true
    auth.permissions = ['something-else']

    const { tabs } = useDynamicTabs({
      fallbackTabs: [
        { key: 'a', label: '标签A', order: 1, permission: 'not-configured:a' },
        { key: 'b', label: '标签B', order: 2, permission: 'not-configured:b' },
        { key: 'admin-tab', label: '管理员页签', order: 3, permission: 'not-configured:c', adminOnly: true },
      ],
    })

    expect(tabs.value.map((t) => t.key)).toEqual(['a', 'b'])
  })

  // 1106 需求：root 超级管理员什么都不校验，adminOnly 的页签也要能看到
  it('root 用户能看到 adminOnly 的页签（权限码也不看）', () => {
    const auth = useAuthStore()
    auth.roles = ['root']
    auth.isMenusLoaded = true
    auth.permissions = []

    const { tabs } = useDynamicTabs({
      fallbackTabs: [
        { key: 'a', label: '标签A', order: 1, permission: 'not-configured:a' },
        { key: 'admin-tab', label: '管理员页签', order: 2, permission: 'not-configured:b', adminOnly: true },
      ],
    })

    expect(tabs.value.map((t) => t.key)).toEqual(['a', 'admin-tab'])
  })

  it('非 admin 用户按权限码过滤 Tab', () => {
    const auth = useAuthStore()
    auth.roles = ['read']
    auth.isMenusLoaded = true
    auth.permissions = ['perm:a'] // 仅有 perm:a

    const { tabs } = useDynamicTabs({
      fallbackTabs: [
        { key: 'tabA', label: '标签A', permission: 'perm:a', order: 1 },
        { key: 'tabB', label: '标签B', permission: 'perm:b', order: 2 },
      ],
    })

    expect(tabs.value.length).toBe(1)
    expect(tabs.value[0].key).toBe('tabA')
  })

  // 后端 sys_menu 的每条 menu_type=2 记录都带 component_path，页内 tab 因此能做到
  // 「后端新增一条就显示、前端不改代码」；页面自己的 componentMap 仍然优先。
  it('后端 meta.tabs 带 componentPath 时按它懒加载组件（页面不用写 componentMap）', async () => {
    const { api } = await mountWithMetaTabs([
      { id: 1, key: 'unknown-backend-tab', label: '后端新页签', permission: '', order: 1, componentPath: 'views/Settings/CategoryTab.vue' },
    ])

    expect(api.tabs.value.map((t) => t.label)).toEqual(['后端新页签'])
    const comp = api.currentComponent.value as unknown as { __asyncLoader?: unknown }
    expect(comp).toBeTruthy()
    // defineAsyncComponent 的产品：带 __asyncLoader
    expect(typeof comp.__asyncLoader).toBe('function')
  })

  it('页面的 componentMap 优先于后端 componentPath（同 key 时）', async () => {
    const { api } = await mountWithMetaTabs(
      [{ id: 1, key: 'tabA', label: '标签A', permission: '', order: 1, componentPath: 'views/Settings/CategoryTab.vue' }],
      { tabA: DummyCompA },
    )

    expect(api.currentComponent.value).toBe(DummyCompA)
  })

  it('既没有 componentMap 也没有后端 componentPath 时不给组件（按空白处理，不崩）', async () => {
    const { api } = await mountWithMetaTabs([
      { id: 1, key: 'tab-without-component', label: '无组件页签', permission: '', order: 1 },
    ])

    expect(api.tabs.value).toHaveLength(1)
    expect(api.currentComponent.value).toBeUndefined()
  })

  // 线上问题（2026-11-06）：数据同步 / 问数系统配置 / 模板配置 / 基础配置 的页签「点了完全没反应」。
  // 成因是后端 sys_menu 的 menu_type=2 记录 key（link_address）为空或重复：所有 tab 的 key 都相同 →
  // selectTab 认为点的是第一个 tab（保持地址干净）→ replace 成同一个地址 → 冗余导航直接被丢掉。
  it('后端 tab 的 key 缺失或重复时，每个 tab 仍要有唯一 key，点了能真的切过去', async () => {
    const { api, router, wrapper } = await mountNavHarness([
      { id: 1, key: '', label: '参数设置', permission: '', order: 1, componentPath: 'views/Settings/CategoryTab.vue' },
      { id: 2, key: '', label: '页面配置', permission: '', order: 2, componentPath: 'views/Settings/NodeTypeTab.vue' },
      { id: 3, key: 'dup', label: '重复键 A', permission: '', order: 3 },
      { id: 4, key: 'dup', label: '重复键 B', permission: '', order: 4 },
    ])

    const keys = api.tabs.value.map((t) => t.key)
    expect(keys.every((k) => k.length > 0)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)

    const buttons = wrapper.findAll('button.nav-tab')
    expect(buttons).toHaveLength(4)
    await buttons[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe(keys[1])
    expect(api.activeTab.value?.label).toBe('页面配置')

    await buttons[3].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe(keys[3])
    expect(api.activeTab.value?.label).toBe('重复键 B')
  })

  // 同上：后端只配了菜单项、没配 component_path（或配的路径已被删）时，
  // 页签栏在、内容区全空。此时整体退回页面本地的 fallbackTabs，别留一个空壳页。
  it('后端 tab 全部解析不到组件时，整体退回 fallbackTabs（不出现「tab 栏在、内容全空」）', async () => {
    const { api } = await mountWithMetaTabs(
      [
        { id: 1, key: 'backend-only-a', label: '后端页签A', permission: '', order: 1 },
        { id: 2, key: 'backend-only-b', label: '后端页签B', permission: '', order: 2 },
      ],
      { tabA: DummyCompA, tabB: DummyCompB },
      [
        { key: 'tabA', label: '标签A', order: 1 },
        { key: 'tabB', label: '标签B', order: 2 },
      ],
    )

    expect(api.tabs.value.map((t) => t.key)).toEqual(['tabA', 'tabB'])
    expect(api.currentComponent.value).toBe(DummyCompA)
  })

  // 2026-11-06 反馈「数据同步点 tab，地址栏闪一下但没切过去」的机制复现：
  // AppShell 用 <KeepAlive :include="['CollectAssets','TaskCenter']"> 缓存任务中心，
  // 而缓存组件里注册的 ?tab= 纠偏 watch 不会随 deactivate 停掉——它在别的页面上
  // 用自己那份 tab 表把 URL「纠正」走，本页的纠偏再跟着改回来，来回一闪停在原地。
  it('被 KeepAlive 缓存的页面不拿自己的 tab 表去纠偏别的页面的 ?tab=', async () => {
    const page = (name: string, cls: string, tabs: { key: string; label: string }[]) =>
      defineComponent({
        name,
        setup() {
          const api = useDynamicTabs({ fallbackTabs: tabs.map((t, i) => ({ ...t, order: i + 1 })) })
          return () =>
            h(
              'div',
              api.tabs.value.map((t) =>
                h('button', { class: cls, key: t.key, onClick: () => api.selectTab(t.key) }, t.label),
              ),
            )
        },
      })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/tasks', component: page('TaskCenter', 'task-tab', [{ key: 'collection', label: '采集任务' }, { key: 'code-generation', label: '代码生成' }]) },
        { path: '/sync', component: page('DataSync', 'sync-tab', [{ key: 'tasks', label: '同步任务' }, { key: 'logs', label: '同步日志' }]) },
      ],
    })

    const Shell = defineComponent({
      setup() {
        return () =>
          h(RouterView, null, {
            default: (slot: { Component?: Component }) =>
              slot.Component ? h(KeepAlive, { include: ['TaskCenter'] }, [h(slot.Component)]) : null,
          })
      },
    })

    await router.push('/tasks')
    await router.isReady()
    const shell = mount(Shell, { global: { plugins: [router] } })
    await flushPromises()
    expect(shell.findAll('.task-tab')).toHaveLength(2)

    await router.push('/sync')
    await flushPromises()
    const syncTabs = shell.findAll('.sync-tab')
    expect(syncTabs).toHaveLength(2)

    await syncTabs[1]!.trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 30))

    expect(router.currentRoute.value.path).toBe('/sync')
    expect(router.currentRoute.value.query.tab).toBe('logs')
    shell.unmount()
  })
})

async function mountWithMetaTabs(
  tabs: NavTab[],
  componentMap?: Record<string, Component>,
  fallbackTabs?: { key: string; label: string; order?: number }[],
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/t', component: { template: '<div />' }, meta: { tabs } }],
  })
  await router.push('/t')
  await router.isReady()

  let api: ReturnType<typeof useDynamicTabs> | undefined
  const Probe = defineComponent({
    setup() {
      api = useDynamicTabs({ componentMap, fallbackTabs, autoNormalizeQuery: false })
      return () => h('div')
    },
  })
  mount(Probe, { global: { plugins: [router] } })
  return { api: api! }
}

/**
 * 带按钮的探针：真实复刻页面的用法（每个 tab 一个 button，点击调 selectTab），
 * 用来验证「点 tab 到底有没有真的切过去」。
 */
async function mountNavHarness(tabs: NavTab[], componentMap?: Record<string, Component>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/t', component: { template: '<div />' }, meta: { tabs } }],
  })
  await router.push('/t')
  await router.isReady()

  let api: ReturnType<typeof useDynamicTabs> | undefined
  const Probe = defineComponent({
    setup() {
      api = useDynamicTabs({ componentMap })
      return () =>
        h(
          'div',
          api!.tabs.value.map((t) =>
            h('button', { class: 'nav-tab', onClick: () => api!.selectTab(t.key) }, t.label),
          ),
        )
    },
  })
  const wrapper = mount(Probe, { global: { plugins: [router] } })
  return { api: api!, router, wrapper }
}

