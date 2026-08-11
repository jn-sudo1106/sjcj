// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteDetailView from './SiteDetailView.vue'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })

describe('SiteDetailView', () => {
  it('网站详情提供源视图页签，并通过站点路由展示', async () => {
    setActivePinia(createPinia())
    await router.push({ path: '/canvas', query: { siteId: 'site-zfb', view: 'data' } })
    const wrapper = shallowMount(SiteDetailView, {
      props: { siteId: 'site-zfb' },
      global: { plugins: [router], stubs: { ResultView: true, FileView: true, TaskView: true, SourceOverviewView: true } },
    })
    await flushPromises()

    await wrapper.get('[data-testid="site-source-view"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ siteId: 'site-zfb', view: 'source' })
    expect(wrapper.find('source-overview-view-stub').exists()).toBe(true)
  })
})
