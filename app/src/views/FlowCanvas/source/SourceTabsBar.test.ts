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
