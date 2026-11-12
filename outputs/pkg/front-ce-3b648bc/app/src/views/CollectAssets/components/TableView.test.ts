// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import TableView from './TableView.vue'
import { siteApi, type Site, type Source } from '@/api'

const site: Site = {
  siteId: 'site-1', name: '测试网站', category: '新闻', owner: 'tester', sourceCount: 2, errorCount: 0,
}

function source(sourceId: string, dataCount: number): Source {
  return { sourceId, name: `源-${sourceId}`, url: 'https://example.com', configId: '', mainTable: '', owner: 'tester', state: 'C', dataCount, siteId: site.siteId }
}

describe('TableView 数据量', () => {
  afterEach(() => vi.restoreAllMocks())

  it('表格站级行按同页源 dataCount 汇总', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', 12), source('s2', 30)])
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
    await router.push('/canvas')
    await router.isReady()

    const wrapper = shallowMount(TableView, {
      props: { sites: [site], loading: false, total: 1, page: 1, size: 10, selectedIds: [] },
      global: { plugins: [router] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('42 条')
  })
})
