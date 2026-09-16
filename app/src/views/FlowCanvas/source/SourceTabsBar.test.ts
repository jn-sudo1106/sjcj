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

    await tabs[1].trigger('click')
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

    await wrapper.findAll('[data-testid="site-all-tab-close"]')[1].trigger('click')
    await flushPromises()
    expect(ws.siteTabs.map((t) => t.name)).toEqual(['新浪财经'])
    expect(router.currentRoute.value.query).toEqual({ siteId: 'site-1', view: 'source' })
  })

  it('× 关掉当前所在的网站：回网站列表', async () => {
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
