// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { sourceApi, type Source } from '@/api'
import { useSourceSearchStore, type SourceSearchOrigin } from '@/stores/sourceSearch'
import { blankSourceListViewState } from '../result/sourceListViewState'
import SourceSearchSidebar from './SourceSearchSidebar.vue'

const row = { sourceId: '2', name: '跨网站的公告', siteId: '20', siteName: '网站 B' } as Source
function origin(patch: Partial<SourceSearchOrigin> = {}): SourceSearchOrigin {
  return { query: { name: '公告', count: 0, viewCategoryId: '10', field: 'SOURCE_ID', type: 'DESC' }, empty: false,
    viewState: blankSourceListViewState(), page: 1, total: 30, scrollTop: 0, scrollLeft: 0,
    label: '我的视图 · 目录一', returnTo: '/collect?tab=views&viewId=8', ...patch }
}
beforeEach(() => { sessionStorage.clear(); setActivePinia(createPinia()) })
afterEach(() => vi.restoreAllMocks())
async function setup(patch: Partial<SourceSearchOrigin> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/collect', component: { template: '<div />' } }] })
  await router.push('/collect')
  const store = useSourceSearchStore()
  const id = store.create(origin(patch))
  const wrapper = mount(SourceSearchSidebar, { props: { contextId: id, siteId: '10', activeKey: '1' }, global: { plugins: [router], stubs: { SiteSourceSwitcher: true } } })
  await flushPromises()
  return { router, wrapper, store, id }
}
describe('搜索结果侧栏', () => {
  it('按原目录和排序一次取回本次结果，侧栏不分页；点选源不切源，返回恢复原列表地址', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [row] })
    const { wrapper, router, id } = await setup()
    expect(paged).toHaveBeenLastCalledWith({ name: '公告', count: 0, viewCategoryId: '10', field: 'SOURCE_ID', type: 'DESC', page: 1, size: 200 })
    expect(wrapper.text()).not.toContain('上一页')
    expect(wrapper.text()).not.toContain('下一页')
    expect(wrapper.emitted('pick')).toBeUndefined()
    await wrapper.get('.search-item').trigger('click')
    expect(wrapper.emitted('pick')?.[0]).toEqual([row])
    await wrapper.get('.search-return').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ tab: 'views', viewId: '8', sourceSearchReturn: id })
    wrapper.unmount()
  })
  it('错误和空集合不退到不限网站查询，重试沿用原条件', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockRejectedValueOnce(new Error('网络失败')).mockResolvedValue({ total: 1, list: [row] })
    const { wrapper } = await setup()
    expect(wrapper.get('[role="alert"]').text()).toContain('网络失败')
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ name: '公告', viewCategoryId: '10' }))
    wrapper.unmount(); paged.mockClear()
    const empty = await setup({ query: { sourceIds: '' }, empty: true })
    expect(paged).not.toHaveBeenCalled()
    expect(empty.wrapper.text()).toContain('没有符合原查询条件的源')
    empty.wrapper.unmount()
  })
  it('上下文失效时明确要求重新查询，不显示网站全部源', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [row] })
    const { wrapper } = await setup()
    paged.mockClear()
    await wrapper.setProps({ contextId: 'expired' }); await flushPromises()
    expect(wrapper.text()).toContain('本次搜索已失效')
    expect(wrapper.findComponent({ name: 'SiteSourceSwitcher' }).exists()).toBe(false)
    expect(paged).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('切到另一个查询后丢弃迟到响应；网站范围用下拉切换并可切回本次结果', async () => {
    let complete!: (value: { total: number; list: Source[] }) => void
    vi.spyOn(sourceApi, 'sourcePaged').mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue({ total: 30, list: [row] })
    const { wrapper, store } = await setup()
    const second = store.create(origin({ query: { name: '新公告' } }))
    await wrapper.setProps({ contextId: second }); await flushPromises()
    complete({ total: 1, list: [{ ...row, name: '旧响应' }] }); await flushPromises()
    expect(wrapper.text()).not.toContain('旧响应')
    await wrapper.get('[data-testid="search-mode"]').setValue('site')
    expect(store.get(second)?.mode).toBe('site')
    expect(wrapper.findComponent({ name: 'SiteSourceSwitcher' }).exists()).toBe(true)
    await wrapper.get('[data-testid="search-mode"]').setValue('search'); await flushPromises()
    expect(store.get(second)?.mode).toBe('search')
    expect(wrapper.findAll('.search-item')).toHaveLength(1)
    wrapper.unmount()
  })
})
