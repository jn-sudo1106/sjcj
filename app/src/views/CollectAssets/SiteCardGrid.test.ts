// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteCardGrid from './SiteCardGrid.vue'
import { siteApi, type Site, type Source } from '@/api'

const site: Site = {
  siteId: 'site-1', name: '测试网站', category: '新闻', owner: 'tester', sourceCount: 2, errorCount: 0,
}

function source(sourceId: string, dataCount: number): Source {
  return { sourceId, name: `源-${sourceId}`, url: 'https://example.com', configId: '', mainTable: '', owner: 'tester', state: 'C', dataCount, siteId: site.siteId }
}

async function mountGrid() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push('/canvas')
  await router.isReady()
  const wrapper = shallowMount(SiteCardGrid, {
    props: { sites: [site] },
    global: { plugins: [router] },
  })
  await flushPromises()
  return wrapper
}

describe('SiteCardGrid 数据量', () => {
  afterEach(() => vi.restoreAllMocks())

  it('站级数据量缺失时按源 dataCount 汇总，不显示误导性的 0 条', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', 12), source('s2', 30)])

    const wrapper = await mountGrid()

    expect(wrapper.text()).toContain('数据 42 条')
  })
})
