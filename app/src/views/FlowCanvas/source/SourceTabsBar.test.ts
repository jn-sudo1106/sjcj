// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SourceTabsBar from './SourceTabsBar.vue'
import { useWorkspaceStore } from '@/stores/workspace'

afterEach(() => sessionStorage.clear())

describe('SourceTabsBar', () => {
  it('切回流程视图页签时显式写入 view=flow，避免画布停留在上一源', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/canvas', component: { template: '<div />' } }],
    })
    await router.push({ path: '/canvas', query: { sourceId: 'source-b', view: 'flow' } })
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useWorkspaceStore()
    workspace.open('source-a', '源 A')
    workspace.open('source-b', '源 B')

    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    await wrapper.get('[title="源 A · source-a"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ sourceId: 'source-a', view: 'flow' })
  })

  // 2026-08-28 修的 bug：切到别的网站下的源时，左侧源列表整块消失。
  // 侧栏取的是 `flow.sourceCtx?.siteId || route.query.siteId`，而 `source/sourceDetail`
  // 生产实测返回 `siteId: null`——URL 再不带 siteId 就两头落空。页签快照是唯一能跨切换保住它的地方。
  it('切页签时带上快照里的 siteId，否则跨网站切换左侧源列表会空', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/canvas', component: { template: '<div />' } }],
    })
    await router.push({ path: '/canvas', query: { siteId: 'site-2', sourceId: 'source-b', view: 'flow' } })
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useWorkspaceStore()
    workspace.open('source-a', '源 A')
    workspace.saveSnapshot('source-a', { siteId: 'site-1' })
    workspace.open('source-b', '源 B')
    workspace.saveSnapshot('source-b', { siteId: 'site-2' })

    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    await wrapper.get('[title="源 A · source-a"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ siteId: 'site-1', sourceId: 'source-a', view: 'flow' })
  })

  it('快照里没有 siteId 时不往 URL 塞空值', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/canvas', component: { template: '<div />' } }],
    })
    await router.push({ path: '/canvas', query: { sourceId: 'source-b', view: 'flow' } })
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useWorkspaceStore()
    workspace.open('source-a', '源 A')
    workspace.open('source-b', '源 B')

    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    await wrapper.get('[title="源 A · source-a"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ sourceId: 'source-a', view: 'flow' })
  })
})

// 0915-02：「全部 · 网站名」页签——可多个、可关闭、与源页签共用 8 个额度
describe('SourceTabsBar 的「全部」页签', () => {
  async function mountBar(query: Record<string, string>) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/canvas', component: { template: '<div />' } }, { path: '/collect', component: { template: '<div />' } }],
    })
    await router.push({ path: '/canvas', query })
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const ws = useWorkspaceStore()
    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    return { wrapper, router, ws }
  }

  it('没有网站页签时不渲染；有了就显示「全部 · 网站名」', async () => {
    const { wrapper, ws } = await mountBar({ sourceId: 'source-a', view: 'flow' })
    ws.open('source-a', '源 A')
    await flushPromises()
    expect(wrapper.find('[data-testid="site-all-tab"]').exists()).toBe(false)

    ws.ensureSiteTab('site-1', '新浪财经')
    await flushPromises()
    expect(wrapper.get('[data-testid="site-all-tab"]').text()).toContain('全部 · 新浪财经')
  })

  it('多个网站各自一个页签，点谁进谁并恢复各自的视图', async () => {
    const { wrapper, router, ws } = await mountBar({ siteId: 'site-1', sourceId: 'source-a', view: 'flow' })
    ws.open('source-a', '源 A')
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.saveSiteSnapshot('site-1', { view: 'data' })
    ws.ensureSiteTab('site-2', '天天基金')
    ws.saveSiteSnapshot('site-2', { view: 'monitor' })
    await flushPromises()

    const tabs = wrapper.findAll('[data-testid="site-all-tab"]')
    expect(tabs).toHaveLength(2)
    // 后打开的排最左（2026-09-17，与源页签同一个方向）
    expect(tabs.map((t) => t.text())).toEqual(['全部 · 天天基金×', '全部 · 新浪财经×'])

    await tabs[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: 'site-2', view: 'monitor' })
    expect(ws.activeSourceId).toBe('')
  })

  it('没有快照时点「全部」落到源视图', async () => {
    const { wrapper, router, ws } = await mountBar({ siteId: 'site-1', sourceId: 'source-a', view: 'flow' })
    ws.ensureSiteTab('site-1', '新浪财经')
    await flushPromises()

    await wrapper.get('[data-testid="site-all-tab"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: 'site-1', view: 'source' })
  })

  it('网站聚合态下该网站的「全部」高亮，源页签不高亮', async () => {
    const { wrapper, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.open('source-a', '源 A')
    ws.ensureSiteTab('site-1', '新浪财经')
    await flushPromises()

    expect(wrapper.get('[data-testid="site-all-tab"]').classes()).toContain('on')
    expect(wrapper.get('[title="源 A · source-a"]').classes()).not.toContain('on')
  })

  it('× 关掉非当前网站：只去掉该页签，不跳转', async () => {
    const { wrapper, router, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.ensureSiteTab('site-2', '天天基金')
    await flushPromises()

    // 顺序是 [天天基金(site-2), 新浪财经(site-1)]，当前停在 site-1，所以下标 0 才是"非当前"
    await wrapper.findAll('[data-testid="site-all-tab-close"]')[0].trigger('click')
    await flushPromises()
    expect(ws.siteTabs.map((t) => t.name)).toEqual(['新浪财经'])
    expect(router.currentRoute.value.query).toEqual({ siteId: 'site-1', view: 'source' })
  })

  // 2026-09-17：关掉当前页签落到右邻，跟源页签一个口径——旁边还开着别的页签却把人甩回
  // 网站列表，是"明明还有地方可待却被踢出去"。
  it('× 关掉当前网站：落到右邻的网站页签，不回网站列表', async () => {
    const { wrapper, router, ws } = await mountBar({ siteId: 'site-2', view: 'source' })
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.ensureSiteTab('site-2', '天天基金')
    ws.saveSiteSnapshot('site-1', { view: 'data' })
    await flushPromises()

    // 顺序 [天天基金(site-2), 新浪财经(site-1)]，关掉当前的 site-2
    await wrapper.findAll('[data-testid="site-all-tab-close"]')[0].trigger('click')
    await flushPromises()
    expect(ws.siteTabs.map((t) => t.name)).toEqual(['新浪财经'])
    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query).toEqual({ siteId: 'site-1', view: 'data' })
  })

  it('× 关掉当前网站：右邻是源页签时切到那个源', async () => {
    const { wrapper, router, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.open('source-a', '源 A')
    ws.ensureSiteTab('site-1', '新浪财经') // 后开 → 排最左，右邻是 source-a
    await flushPromises()

    await wrapper.get('[data-testid="site-all-tab-close"]').trigger('click')
    await flushPromises()
    expect(ws.siteTabs).toEqual([])
    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query.sourceId).toBe('source-a')
    expect(ws.activeSourceId).toBe('source-a')
  })

  it('× 关掉当前所在的网站：一个页签都不剩才回网站列表', async () => {
    const { wrapper, router, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.ensureSiteTab('site-1', '新浪财经')
    await flushPromises()

    await wrapper.get('[data-testid="site-all-tab-close"]').trigger('click')
    await flushPromises()
    expect(ws.siteTabs).toEqual([])
    expect(router.currentRoute.value.path).toBe('/collect')
  })

  it('计数把网站页签算进 8 个总额度', async () => {
    const { wrapper, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.ensureSiteTab('site-2', '天天基金')
    for (let i = 0; i < 6; i += 1) ws.open(`s${i}`, `源 ${i}`)
    await flushPromises()
    expect(wrapper.text()).toContain('8/8')
  })

  // 2026-09-16 走查：之前整条页签条一起横向滚动，页签一多「清空」就被挤出屏幕，
  // 满 8 个想清理反而得先滚过去找按钮。操作区必须留在滚动容器**外面**。
  it('「n/8 清空」在固定操作区里，不随页签横向滚动', async () => {
    const { wrapper, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.ensureSiteTab('site-1', '新浪财经')
    for (let i = 0; i < 6; i += 1) ws.open(`s${i}`, `源 ${i}`)
    await flushPromises()

    const actions = wrapper.get('.rc-src-tabs-actions')
    expect(actions.find('.rc-src-clear').exists()).toBe(true)
    expect(actions.find('.rc-src-tabs-hint').exists()).toBe(true)
    // 反向确认：滚动区里不该有这两个
    const scroll = wrapper.get('.rc-src-tabs-scroll')
    expect(scroll.find('.rc-src-clear').exists()).toBe(false)
    expect(scroll.find('.rc-src-tabs-hint').exists()).toBe(false)
    // 页签仍在滚动区里
    expect(scroll.findAll('.rc-src-tab').length).toBe(8)
  })

  it('满额时计数标红提示要先关几个', async () => {
    const { wrapper, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.ensureSiteTab('site-1', '新浪财经')
    for (let i = 0; i < 5; i += 1) ws.open(`s${i}`, `源 ${i}`)
    await flushPromises()
    expect(wrapper.get('.rc-src-tabs-hint').classes()).not.toContain('full')

    ws.open('s5', '源 5')
    ws.open('s6', '源 6')
    await flushPromises()
    expect(wrapper.get('.rc-src-tabs-hint').classes()).toContain('full')
  })

  it('「清空」连网站页签一起清', async () => {
    const { wrapper, ws } = await mountBar({ siteId: 'site-1', view: 'source' })
    ws.ensureSiteTab('site-1', '新浪财经')
    ws.open('source-a', '源 A')
    await flushPromises()

    await wrapper.get('.rc-src-clear').trigger('click')
    await flushPromises()
    expect(ws.tabs).toEqual([])
    expect(ws.siteTabs).toEqual([])
  })
})

// ---- 右键菜单（2026-09-18）：对齐浏览器页签的三项 ----
describe('SourceTabsBar 右键菜单', () => {
  async function setup(activeSourceId = 'source-c') {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/canvas', component: { template: '<div />' } },
        { path: '/collect', component: { template: '<div />' } },
      ],
    })
    await router.push({ path: '/canvas', query: { sourceId: activeSourceId, view: 'flow' } })
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const ws = useWorkspaceStore()
    ws.open('source-a', '源 A')
    ws.open('source-b', '源 B')
    ws.open('source-c', '源 C')

    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    return { wrapper, ws, router }
  }

  it('右键页签弹出菜单，三项与浏览器一致', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('[data-testid="tab-context-menu"]').exists()).toBe(false)

    await wrapper.get('[title="源 B · source-b"]').trigger('contextmenu')
    const menu = wrapper.get('[data-testid="tab-context-menu"]')
    expect(menu.findAll('button').map((b) => b.text()))
      .toEqual(['关闭', '关闭其他标签页', '关闭右侧标签页'])
  })

  it('关闭其他：只剩右键的那个', async () => {
    const { wrapper, ws } = await setup()
    await wrapper.get('[title="源 B · source-b"]').trigger('contextmenu')
    await wrapper.get('[data-testid="tab-menu-close-others"]').trigger('click')
    await flushPromises()

    expect(ws.tabs.map((t) => t.sourceId)).toEqual(['source-b'])
  })

  it('关闭右侧：按屏幕顺序，后开的在左，所以「源 C」右侧是 B 和 A', async () => {
    const { wrapper, ws } = await setup()
    expect(ws.orderedTabs.map((t) => t.id)).toEqual(['source-c', 'source-b', 'source-a'])

    await wrapper.get('[title="源 C · source-c"]').trigger('contextmenu')
    await wrapper.get('[data-testid="tab-menu-close-right"]').trigger('click')
    await flushPromises()

    expect(ws.tabs.map((t) => t.sourceId)).toEqual(['source-c'])
  })

  it('最右侧那个页签的「关闭右侧」是灰的', async () => {
    const { wrapper } = await setup()
    await wrapper.get('[title="源 A · source-a"]').trigger('contextmenu')

    expect(wrapper.get('[data-testid="tab-menu-close-right"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="tab-menu-close-others"]').attributes('disabled')).toBeUndefined()
  })

  it('关掉的那批里含当前页签时，跳到右键的那个而不是甩回列表', async () => {
    const { wrapper, router } = await setup('source-c')
    // 右键「源 A」→ 关闭其他，会关掉正在看的 source-c
    await wrapper.get('[title="源 A · source-a"]').trigger('contextmenu')
    await wrapper.get('[data-testid="tab-menu-close-others"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query.sourceId).toBe('source-a')
  })

  // 2026-09-18 实测 bug：模板里写成 `closeTabMenu(); onTabClose(tabMenu.tab!)`，
  // 先执行的 closeTabMenu 已经把 tab 置成 null，传过去的就是 null，点「关闭」毫无反应。
  it('菜单里的「关闭」真的关掉这一个页签', async () => {
    const { wrapper, ws } = await setup()
    await wrapper.get('[title="源 B · source-b"]').trigger('contextmenu')
    await wrapper.get('[data-testid="tab-menu-close"]').trigger('click')
    await flushPromises()

    // tabs 数组按"后开的在前"存，这里只关心剩下哪两个，排序后比较
    expect(ws.tabs.map((t) => t.sourceId).sort()).toEqual(['source-a', 'source-c'])
  })

  it('关掉最后一个页签回网站列表', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/canvas', component: { template: '<div />' } },
        { path: '/collect', component: { template: '<div />' } },
      ],
    })
    await router.push({ path: '/canvas', query: { sourceId: 'only', view: 'flow' } })
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    const ws = useWorkspaceStore()
    ws.open('only', '唯一源')

    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    await wrapper.get('[title="唯一源 · only"]').trigger('contextmenu')
    await wrapper.get('[data-testid="tab-menu-close"]').trigger('click')
    await flushPromises()

    expect(ws.tabs).toEqual([])
    expect(router.currentRoute.value.path).toBe('/collect')
  })

  it('只剩一个页签时，「关闭其他」与「关闭右侧」都是灰的', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const ws = useWorkspaceStore()
    ws.ensureSiteTab('site-9', '资讯榜单')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/canvas', component: { template: '<div />' } }],
    })
    await router.push({ path: '/canvas', query: { siteId: 'site-9', view: 'source' } })
    await router.isReady()

    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    await wrapper.get('[data-testid="site-all-tab"]').trigger('contextmenu')

    expect(wrapper.get('[data-testid="tab-menu-close-others"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="tab-menu-close-right"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="tab-menu-close"]').attributes('disabled')).toBeUndefined()
  })

  it('关掉的那批不含当前页签时，不跳转', async () => {
    const { wrapper, router } = await setup('source-c')
    // 右键「源 C」（当前页签）→ 关闭右侧，关掉的是 B 和 A，当前页签留着
    await wrapper.get('[title="源 C · source-c"]').trigger('contextmenu')
    await wrapper.get('[data-testid="tab-menu-close-right"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.sourceId).toBe('source-c')
  })
})
