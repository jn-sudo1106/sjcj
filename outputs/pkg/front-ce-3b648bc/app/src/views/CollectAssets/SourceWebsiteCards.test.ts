// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { ElPagination } from 'element-plus'
import SourceWebsiteCards from './SourceWebsiteCards.vue'
import { querySiteCards, type SiteCardResult } from './siteCardQuery'
import type { Site } from '@/api'
vi.mock('./siteCardQuery', () => ({ querySiteCards: vi.fn() }))
enableAutoUnmount(afterEach)
afterEach(() => vi.resetAllMocks())
const result = (names: string[], total = 25): SiteCardResult => ({ sites: names.map(name => ({ siteId: name, name, sourceCount: 1, errorCount: 0 } as Site)), total, matchedSourceTotal: 999, unbound: 0 })
function mountCards(props = {}) {
  return mount(SourceWebsiteCards, { props: { query: {}, scopeEmpty: false, ...props },
    global: { components: { ElPagination }, stubs: { SiteCardGrid: { name: 'SiteCardGrid', props: ['sites'], template: '<div><span v-for="site in sites" :key="site.siteId">{{ site.name }}</span></div>' } } } })
}
describe('网站服务端分页交互', () => {
  it('过期响应不能覆盖新筛选', async () => {
    let finish!: (r: SiteCardResult) => void
    vi.mocked(querySiteCards).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(result(['新结果']))
    const w = mountCards({ query: { name: '旧' } }); await w.setProps({ query: { name: '新' } }); await flushPromises()
    finish(result(['旧结果'])); await flushPromises()
    expect(w.text()).toContain('新结果'); expect(w.text()).not.toContain('旧结果')
  })
  it('仅渲染服务端当前页，翻页、改页大小各发一次请求，不浏览器切片', async () => {
    vi.mocked(querySiteCards).mockResolvedValueOnce(result(['第一页'])).mockResolvedValueOnce(result(['第二页'])).mockResolvedValueOnce(result(['十条每页']))
    const w = mountCards(); await flushPromises()
    const pager = w.findComponent(ElPagination)
    expect(pager.props('total')).toBe(25)
    pager.vm.$emit('update:current-page', 2); await flushPromises()
    expect(querySiteCards).toHaveBeenLastCalledWith({}, expect.objectContaining({ page: 2, size: 20 }))
    expect(w.text()).toContain('第二页')
    pager.vm.$emit('update:page-size', 10); await flushPromises()
    expect(pager.props('currentPage')).toBe(1)
    expect(querySiteCards).toHaveBeenCalledTimes(3)
  })
  it('排序改变回第一页；隐藏切换保留排序和页大小，不在隐藏时查询', async () => {
    vi.mocked(querySiteCards).mockResolvedValue(result(['网站']))
    const w = mountCards(); await flushPromises()
    await w.get('[data-testid="website-sort"]').setValue('siteIdDesc'); await flushPromises()
    expect(querySiteCards).toHaveBeenLastCalledWith({}, expect.objectContaining({ sort: 'siteIdDesc', page: 1 }))
    await w.setProps({ active: false }); const calls = vi.mocked(querySiteCards).mock.calls.length
    await w.setProps({ refreshVersion: 1 }); await flushPromises(); expect(querySiteCards).toHaveBeenCalledTimes(calls)
    await w.setProps({ active: true }); await flushPromises()
    expect(querySiteCards).toHaveBeenLastCalledWith({}, expect.objectContaining({ sort: 'siteIdDesc' }))
  })
  it('失败保留真实错误，重试不走旧扫描', async () => {
    vi.mocked(querySiteCards).mockRejectedValueOnce(new Error('接口 404')).mockResolvedValueOnce(result(['恢复']))
    const w = mountCards(); await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('接口 404')
    await w.get('[role="alert"] button').trigger('click'); await flushPromises(); expect(w.text()).toContain('恢复')
  })
  it('外部空范围不请求，未关联源有源列表入口', async () => {
    const w = mountCards({ scopeEmpty: true }); expect(querySiteCards).not.toHaveBeenCalled()
    vi.mocked(querySiteCards).mockResolvedValue({ ...result([], 0), unbound: 12 })
    await w.setProps({ scopeEmpty: false }); await flushPromises()
    await w.get('[data-testid="website-unbound-sources"] button').trigger('click'); expect(w.emitted('showSources')).toHaveLength(1)
  })
})
