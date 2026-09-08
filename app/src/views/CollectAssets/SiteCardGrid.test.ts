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

async function mountGrid(sites: Site[] = [site]) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push('/canvas')
  await router.isReady()
  const wrapper = shallowMount(SiteCardGrid, {
    props: { sites },
    global: { plugins: [router] },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('SiteCardGrid 大源量加载', () => {
  afterEach(() => vi.restoreAllMocks())

  it('首屏只请求卡片需要的 4 个源，不拉完整源列表', async () => {
    const preview = vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', 12), source('s2', 30)])
    const all = vi.spyOn(siteApi, 'siteSources')

    const { wrapper } = await mountGrid()

    expect(preview).toHaveBeenCalledWith('site-1', 4)
    expect(all).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('数据 42 条')
  })

  it('大网站在卡片渲染后后台汇总完整源数据量', async () => {
    const large = { ...site, sourceCount: 5 }
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', 12)])
    const all = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', 12), source('s2', 30)])

    const { wrapper } = await mountGrid([large])

    expect(all).toHaveBeenCalledWith('site-1')
    expect(wrapper.text()).toContain('数据 42 条')
  })

  it('小站预览失败也会进汇总队列补全，数据量不落「—」', async () => {
    // 回归：queueDataCounts 原来按 sourceCount > CHIP_LIMIT 过滤，小站（≤4 源）预览失败
    // 时既没有完整列表也进不了队列，数据量永远显示「—」、chips 误显「暂无源」。
    const small = { ...site, sourceCount: 2 }
    vi.spyOn(siteApi, 'siteSourcePreview').mockRejectedValue(new Error('preview failed'))
    const all = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', 12), source('s2', 30)])

    const { wrapper } = await mountGrid([small])

    expect(all).toHaveBeenCalledWith('site-1')
    expect(wrapper.text()).toContain('数据 42 条')
    expect(wrapper.text()).not.toContain('暂无源')
  })

  it('预览成功的小站不重复进汇总队列', async () => {
    const small = { ...site, sourceCount: 2 }
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', 12), source('s2', 30)])
    const all = vi.spyOn(siteApi, 'siteSources')

    await mountGrid([small])

    // 小站预览即完整列表（childrenComplete 已置位），队列应跳过它
    expect(all).not.toHaveBeenCalled()
  })

  it('点击网站卡片默认进入网站源视图', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([])

    const { wrapper, router } = await mountGrid()
    await wrapper.get('.scg-card').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toMatchObject({ siteId: 'site-1', view: 'source' })
  })
})
