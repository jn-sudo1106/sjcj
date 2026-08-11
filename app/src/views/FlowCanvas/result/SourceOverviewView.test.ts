// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import SourceOverviewView from './SourceOverviewView.vue'
import { siteApi, sourceApi, type Site, type Source } from '@/api'

const currentSite: Site = {
  siteId: 'site-current', name: '当前网站', category: '测试', owner: 'tester', sourceCount: 1, errorCount: 0,
}
const anotherSite: Site = {
  siteId: 'site-other', name: '其他网站', category: '测试', owner: 'tester', sourceCount: 1, errorCount: 0,
}
const source: Source = {
  sourceId: 'src-1', name: '当前网站子源', url: 'https://example.com', configId: 'cfg-1', mainTable: 'TB_1', owner: 'tester', state: 'C', siteId: 'site-current', dataCount: 3,
}

describe('SourceOverviewView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('默认查询当前网站，切换到全部网站后取消 siteId 限定', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 2, list: [currentSite, anotherSite] })
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: 'site-current', state: 'all' }))
    expect(wrapper.text()).toContain('当前网站子源')

    await wrapper.get('[data-testid="source-overview-scope"]').setValue('all')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: undefined }))
  })

  it('按源 ID 查询并从列表打开真实子源', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 1, list: [currentSite] })
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-source-ids"]').setValue('src-1, src-2')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: 'src-1, src-2' }))

    await wrapper.get('.sov-link').trigger('click')
    expect(wrapper.emitted('openSource')?.[0]).toEqual([source])
  })
})
