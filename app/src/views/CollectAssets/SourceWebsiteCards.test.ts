// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { ElPagination } from 'element-plus'
import SourceWebsiteCards from './SourceWebsiteCards.vue'
import { querySiteCards, type SiteCardResult } from './siteCardQuery'
import { favoriteSiteIds } from '@/utils/siteFavorites'
import type { Site } from '@/api'

vi.mock('./siteCardQuery', () => ({ querySiteCards: vi.fn() }))
enableAutoUnmount(afterEach)
beforeEach(() => { favoriteSiteIds.value = new Set() })
afterEach(() => vi.resetAllMocks())
const result = (names: string[], unbound = 0): SiteCardResult => ({ sites: names.map(name => ({ siteId: name, name, sourceCount: 1, errorCount: 0 } as Site)), unbound })
function mountCards(props = {}) {
  return mount(SourceWebsiteCards, {
    props: { query: {}, scopeEmpty: false, ...props },
    global: { components: { ElPagination }, stubs: { SiteCardGrid: { name: 'SiteCardGrid', props: ['sites'], template: '<div><span v-for="site in sites" :key="site.siteId">{{ site.name }}</span></div>' } } },
  })
}

describe('网站卡片加载状态与分页', () => {
  it('旧查询晚返回不能覆盖新条件的卡片', async () => {
    let resolveOld!: (value: SiteCardResult) => void
    vi.mocked(querySiteCards).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(result(['新结果']))
    const w = mountCards({ query: { name: '旧条件' } })
    await w.setProps({ query: { name: '新条件' } })
    await flushPromises()
    resolveOld(result(['旧结果']))
    await flushPromises()
    expect(w.text()).toContain('新结果')
    expect(w.text()).not.toContain('旧结果')
  })

  it('网站分页在完整网站集合上切片，改页大小回到第一页', async () => {
    vi.mocked(querySiteCards).mockResolvedValue(result(Array.from({ length: 25 }, (_,i) => `站${String(i).padStart(2, '0')}`)))
    const w = mountCards()
    await flushPromises()
    const grid = () => w.findComponent({ name: 'SiteCardGrid' })
    expect(grid().props('sites')).toHaveLength(20)
    const pager = w.findComponent(ElPagination)
    pager.vm.$emit('update:current-page', 2)
    await flushPromises()
    expect(grid().props('sites').map((s: Site) => s.siteId)).toEqual(['站20', '站21', '站22', '站23', '站24'])
    pager.vm.$emit('update:page-size', 10)
    pager.vm.$emit('size-change', 10)
    await flushPromises()
    expect(pager.props('currentPage')).toBe(1)
    expect(grid().props('sites')).toHaveLength(10)
    expect(querySiteCards).toHaveBeenCalledTimes(1)
  })

  it('加载失败展示真实错误，重试成功后恢复卡片', async () => {
    vi.mocked(querySiteCards).mockRejectedValueOnce(new Error('网络异常')).mockResolvedValueOnce(result(['恢复后的网站']))
    const w = mountCards()
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('网络异常')
    expect(w.findComponent({ name: 'SiteCardGrid' }).exists()).toBe(false)
    await w.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.text()).toContain('恢复后的网站')
  })

  it('空目录不发请求；未关联网站的源可切回源列表查看', async () => {
    const w = mountCards({ scopeEmpty: true, emptyText: '目录中还没有源' })
    expect(querySiteCards).not.toHaveBeenCalled()
    vi.mocked(querySiteCards).mockResolvedValue(result([], 12))
    await w.setProps({ scopeEmpty: false })
    await flushPromises()
    expect(w.get('[data-testid="website-unbound-sources"]').text()).toContain('12 个源未关联网站')
    await w.get('[data-testid="website-unbound-sources"] button').trigger('click')
    expect(w.emitted('showSources')).toHaveLength(1)
  })

  it('网站目录本身加载失败时，重试交由父级重新查询网站目录', async () => {
    const w = mountCards({ catalogError: '网站接口返回 502' })
    expect(querySiteCards).not.toHaveBeenCalled()
    expect(w.get('[role="alert"]').text()).toContain('网站接口返回 502')
    await w.get('[role="alert"] button').trigger('click')
    expect(w.emitted('retryCatalog')).toHaveLength(1)
  })
})
