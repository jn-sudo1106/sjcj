// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SourceTabsBar from './SourceTabsBar.vue'
import { useWorkspaceStore } from '../../../stores/workspace'

afterEach(() => sessionStorage.clear())

describe('SourceTabsBar', () => {
  it('切回流程视图页签时显式写入 view=flow，避免画布停留在上一子源', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/canvas', component: { template: '<div />' } }],
    })
    await router.push({ path: '/canvas', query: { sourceId: 'source-b', view: 'flow' } })
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const workspace = useWorkspaceStore()
    workspace.open('source-a', '子源 A')
    workspace.open('source-b', '子源 B')

    const wrapper = mount(SourceTabsBar, { global: { plugins: [pinia, router] } })
    await wrapper.get('[title="子源 A · source-a"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ sourceId: 'source-a', view: 'flow' })
  })
})
