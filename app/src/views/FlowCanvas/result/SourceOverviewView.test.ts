// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import SourceOverviewView from './SourceOverviewView.vue'
import { sourceApi, type Source } from '@/api'

const source: Source = {
  sourceId: 'src-1', name: '当前网站源', url: 'https://example.com', configId: 'cfg-1', mainTable: 'TB_1', owner: 'tester', state: 'C', siteId: 'site-current', dataCount: 3,
}

describe('SourceOverviewView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('请求始终带当前 siteId，没有范围/跨网站切换入口（0812 纠偏）', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: 'site-current' }))
    expect(wrapper.text()).toContain('当前网站源')
    expect(wrapper.find('[data-testid="source-overview-scope"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="source-overview-config"]').exists()).toBe(false)
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('所属网站')
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('配置 ID')
  })

  it('状态筛选按拆分字段发送：停用走 enable，不向旧接口发 state=disabled（0812 纠偏）', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-state"]').setValue('C')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'C', enable: '0' }))

    await wrapper.get('[data-testid="source-overview-state"]').setValue('disabled')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined, enable: '1' }))

    await wrapper.get('[data-testid="source-overview-state"]').setValue('all')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined, enable: undefined }))
  })

  it('排序仍然生效', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('th .sov-sort').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'SOURCE_ID', sorted: 1, type: 'ASC' }))
  })

  it('按源 ID 查询并从列表打开真实源', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-source-ids"]').setValue('src-1, src-2')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: 'src-1, src-2' }))
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('操作')

    await wrapper.get('[data-testid="source-overview-source-link"]').trigger('click')
    expect(wrapper.emitted('openSource')?.[0]).toEqual([source])
  })

  it('切换网站时重新按新 siteId 查询，页码重置', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.setProps({ currentSiteId: 'site-other' })
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: 'site-other', page: 1 }))
  })
})
