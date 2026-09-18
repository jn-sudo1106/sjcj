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

  it('首屏只请求卡片需要的 5 个源，不拉完整源列表', async () => {
    const preview = vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', 12), source('s2', 30)])
    const all = vi.spyOn(siteApi, 'siteSources')

    const { wrapper } = await mountGrid()

    // 5 = CHIP_LIMIT：两列网格下 5 个 chip + 「+N」正好 6 格填满 3 行
    expect(preview).toHaveBeenCalledWith('site-1', 5)
    expect(all).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('数据 42 条')
  })

  it('大网站在卡片渲染后后台汇总完整源数据量', async () => {
    // 6 > CHIP_LIMIT(5)：预览拿不全，才需要后台补完整列表算数据量
    const large = { ...site, sourceCount: 6 }
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', 12)])
    const all = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', 12), source('s2', 30)])

    const { wrapper } = await mountGrid([large])

    expect(all).toHaveBeenCalledWith('site-1')
    expect(wrapper.text()).toContain('数据 42 条')
  })

  it('小站预览失败也会进汇总队列补全，数据量不落「—」', async () => {
    // 回归：queueDataCounts 原来按 sourceCount > CHIP_LIMIT 过滤，小站（≤5 源）预览失败
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

// 0915-01：卡片视图此前是唯一没有编辑入口的地方（表格视图有铅笔按钮，
// 源侧栏有右键菜单）。菜单只 emit 事件，弹窗仍由父组件 SourceTab 统一挂。
describe('SiteCardGrid 卡片操作菜单', () => {
  afterEach(() => vi.restoreAllMocks())

  it('点「⋯」打开菜单，选「编辑网站信息」向父组件抛出该网站', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([])
    const { wrapper } = await mountGrid()

    expect(wrapper.find('[data-testid="site-card-menu"]').exists()).toBe(false)
    await wrapper.get('[data-testid="site-card-more"]').trigger('click')
    expect(wrapper.find('[data-testid="site-card-menu"]').exists()).toBe(true)

    await wrapper.get('[data-testid="site-card-menu-edit"]').trigger('click')
    expect(wrapper.emitted('open-editor')?.[0]).toEqual([site])
    // 选完即关
    expect(wrapper.find('[data-testid="site-card-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('右键卡片打开同一个菜单，且不会冒泡成「进入网站」', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([])
    const { wrapper, router } = await mountGrid()

    await wrapper.get('.scg-card').trigger('contextmenu')
    expect(wrapper.find('[data-testid="site-card-menu"]').exists()).toBe(true)
    // 右键不该触发卡片本身的跳转
    expect(router.currentRoute.value.query.siteId).toBeUndefined()
    wrapper.unmount()
  })

  it('点「⋯」不会冒泡到卡片跳转（否则点编辑会先跳进网站）', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([])
    const { wrapper, router } = await mountGrid()

    await wrapper.get('[data-testid="site-card-more"]').trigger('click')
    expect(router.currentRoute.value.query.siteId).toBeUndefined()
    wrapper.unmount()
  })

  it('按 Esc 关闭菜单', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([])
    const { wrapper } = await mountGrid()

    await wrapper.get('[data-testid="site-card-more"]').trigger('click')
    expect(wrapper.find('[data-testid="site-card-menu"]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('[data-testid="site-card-menu"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
