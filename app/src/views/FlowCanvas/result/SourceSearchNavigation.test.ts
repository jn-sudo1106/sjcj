// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { ElPagination } from 'element-plus'
import { dataApi, favoriteApi, flowCenterApi, sourceApi, type Source } from '@/api'
import { useSourceSearchStore } from '@/stores/sourceSearch'
import { useWorkspaceStore } from '@/stores/workspace'
import { blankSourceListViewState } from './sourceListViewState'
import SourceOverviewView from './SourceOverviewView.vue'

const row = { sourceId: '1', name: '公告一', siteId: '20', siteName: '网站 B', url: 'https://example.com', dataCount: 3 } as Source
const navigation = { returnTo: '/collect?tab=source', label: '系统目录' }
const directory = { kind: 'biz' as const, mode: 'selected' as const, selections: [{ id: '10', includeDescendants: true }] }
beforeEach(() => {
  sessionStorage.clear(); setActivePinia(createPinia())
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 40, list: [row] })
  vi.spyOn(sourceApi, 'sourceTags').mockResolvedValue([])
  vi.spyOn(favoriteApi, 'listIds').mockResolvedValue([])
  vi.spyOn(dataApi, 'tables').mockResolvedValue([])
  vi.spyOn(flowCenterApi, 'list').mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())
function mountList(restoreId?: string) {
  return shallowMount(SourceOverviewView, { props: {
    currentSiteId: '', scopeSourceIds: ['1', '2'], scopeDirectory: directory, scopeSourceGroupId: '88',
    searchNavigation: { ...navigation, ...(restoreId ? { restoreId } : {}) },
    viewState: { ...blankSourceListViewState(), conditions: [{ field: 'name', op: 'like', value: '公告' }], countMax: '0' },
  }, global: { components: { ElPagination } } })
}
describe('源列表进入搜索工作区', () => {
  it('恢复请求未完成时再次查询，迟到的恢复不能覆盖新结果的滚动位置', async () => {
    const id = useSourceSearchStore().create({ query: { name: '公告' }, empty: false, viewState: { ...blankSourceListViewState(), conditions: [{ field: 'name', op: 'like', value: '公告' }] }, page: 2, total: 40, scrollTop: 244, scrollLeft: 72, label: '系统目录', returnTo: navigation.returnTo })
    let complete!: (value: { list: Source[]; total: number }) => void
    vi.mocked(sourceApi.sourcePaged).mockImplementationOnce(() => new Promise(resolve => { complete = resolve })).mockResolvedValue({ list: [row], total: 1 })
    const wrapper = mountList(id)
    await flushPromises()
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('新查询')
    await wrapper.findAll('button').find(button => button.text() === '查询')!.trigger('click')
    await flushPromises()
    const table = wrapper.get('.sov-table-wrap').element as HTMLElement
    table.scrollTop = 30
    complete({ list: [row], total: 40 }); await flushPromises()
    expect(table.scrollTop).toBe(30)
    expect((wrapper.get('[data-testid="source-overview-search-text"]').element as HTMLTextAreaElement).value).toBe('新查询')
    wrapper.unmount()
  })
  it('复制最后成功执行的查询与范围，不把尚未查询的输入带入；重新挂载可恢复页码和滚动，清掉勾选', async () => {
    const wrapper = mountList()
    await flushPromises()
    const pager = wrapper.findComponent(ElPagination)
    pager.vm.$emit('update:current-page', 2); pager.vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('尚未查询的草稿')
    await wrapper.get('[data-testid="source-check-1"]').setValue(true)
    const table = wrapper.get('.sov-table-wrap').element as HTMLElement
    table.scrollTop = 244; table.scrollLeft = 72
    await wrapper.get('[data-testid="source-overview-source-link"]').trigger('click')
    const id = wrapper.emitted('openSource')?.[0]?.[1] as string
    const context = useSourceSearchStore().get(id)!
    expect(context.query).toMatchObject({ name: '公告', sourceGroupId: '88', sourceIds: '1,2', count: 0, directory })
    expect(context).toMatchObject({ page: 2, scrollTop: 244, scrollLeft: 72 })
    expect(context.viewState.conditions[0]?.value).toBe('公告')
    wrapper.unmount()
    const restored = mountList(id)
    await flushPromises()
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, name: '公告', sourceGroupId: '88', directory }))
    expect((restored.get('.sov-table-wrap').element as HTMLElement).scrollTop).toBe(244)
    expect((restored.get('.sov-table-wrap').element as HTMLElement).scrollLeft).toBe(72)
    expect((restored.get('[data-testid="source-check-1"]').element as HTMLInputElement).checked).toBe(false)
    restored.unmount()
  })
  it('页签满额不再拦住打开新源，额度由画布统一腾位（2026-11-05 用户反馈）', async () => {
    const workspace = useWorkspaceStore()
    for (let i = 0; i < 8; i++) workspace.open(`other-${i}`, `其他源${i}`)
    const wrapper = mountList(); await flushPromises()
    await wrapper.get('[data-testid="source-overview-source-link"]').trigger('click')
    // 列表只管把「带着搜索范围打开这个源」发出去；关哪个页签由画布决定（关最右侧腾位）
    expect(wrapper.emitted('openSource')).toHaveLength(1)
    expect(workspace.tabs).toHaveLength(8)
    wrapper.unmount()
  })
})
