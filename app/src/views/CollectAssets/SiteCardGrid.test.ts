// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteCardGrid from './SiteCardGrid.vue'
import { siteApi, sourceApi, type Site, type Source } from '@/api'
import { ElPopover } from 'element-plus'
import type { SiteCardSourceScope } from './siteCardQuery'
import * as sourceDirs from '@/api/sourceDirs'

const site: Site = {
  siteId: 'site-1', name: '测试网站', category: '新闻', owner: 'tester', sourceCount: 2, errorCount: 0,
}

function source(sourceId: string, dataCount: number | undefined): Source {
  return { sourceId, name: `源-${sourceId}`, url: 'https://example.com', configId: '', mainTable: '', owner: 'tester', state: 'C', dataCount, siteId: site.siteId }
}

async function mountGrid(sites: Site[] = [site], sourceScope?: SiteCardSourceScope) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })
  await router.push('/canvas')
  await router.isReady()
  const wrapper = shallowMount(SiteCardGrid, {
    props: { sites, sourceScope },
    global: { plugins: [router], components: { ElPopover } },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('SiteCardGrid 大源量加载', () => {
  afterEach(() => vi.restoreAllMocks())

  it('目录卡片使用命中预览和总数，更多源继续携带原筛选，不串入全站源或改写全站数据量', async () => {
    const preview = vi.spyOn(siteApi, 'siteSourcePreview')
    const all = vi.spyOn(siteApi, 'siteSources')
    const matched = Array.from({ length: 8 }, (_, i) => source(`s${i}`, 1))
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 8, list: matched })
    const { wrapper } = await mountGrid([{ ...site, sourceCount: 24, dataCount: 999 }], {
      query: { sourceIds: 's0,s1,s2,s3,s4,s5,s6,s7', name: '公告', state: 'E' },
      matches: { 'site-1': { total: 8, list: matched.slice(0, 5) } },
    })
    expect(preview).not.toHaveBeenCalled()
    expect(all).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="site-card-count"]').text()).toBe('命中 8 / 共 24 个源')
    expect(wrapper.text()).toContain('数据 999 条')
    wrapper.findComponent(ElPopover).vm.$emit('show')
    await flushPromises()
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sourceIds: 's0,s1,s2,s3,s4,s5,s6,s7', name: '公告', state: 'E', siteIds: 'site-1', page: 1, size: 500 }))
    expect(all).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('聚合卡片零补查、可信 0/未知数据分开，更多源仅加载一页且保留原始目录', async () => {
    const preview = vi.spyOn(siteApi, 'siteSourcePreview')
    const all = vi.spyOn(siteApi, 'siteSources')
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 80, list: Array.from({ length: 50 }, (_, i) => source(String(100-i), 0)) })
    const directory = { kind: 'biz' as const, mode: 'selected' as const, selections: [{ id: '900', includeDescendants: true }] }
    const { wrapper } = await mountGrid([{ ...site, sourceCount: 90, dataCount: 0 }], {
      serverPaged: true, query: { directory, count: 0, name: '公告' }, matches: { 'site-1': { total: 80, list: [source('100',0)] } },
    })
    expect(preview).not.toHaveBeenCalled(); expect(all).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('数据 0 条');
    wrapper.findComponent(ElPopover).vm.$emit('show'); await flushPromises()
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ directory, count: 0, name: '公告', siteIds: 'site-1', page: 1, size: 50 }))
    expect(all).not.toHaveBeenCalled()
    wrapper.unmount()
    const unknown = await mountGrid([{ ...site, dataCount: undefined }], { serverPaged: true, query: {}, matches: { 'site-1': { total: 1, list: [source('1',5)] } } })
    expect(unknown.wrapper.text()).toContain('数据 —')
    expect(all).not.toHaveBeenCalled()
    unknown.wrapper.unmount()
  })

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

  it('所有源都没有 dataCnt 统计时显示「数据 —」，不当成 0 条', async () => {
    // 回归：手动导入（saveEntryOne）的数据不经抓取任务，后端不回写源的 dataCnt。
    // 站 124 实测 43 行数据、源 dataCnt=null，卡片却显示「数据 0 条」，像是表里没数据。
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', undefined), source('s2', undefined)])

    const { wrapper } = await mountGrid()

    expect(wrapper.text()).toContain('数据 —')
    expect(wrapper.text()).not.toContain('数据 0 条')
  })

  it('列表给的站级 dataTotal=0 但有源时不直接采信，按源汇总后仍无统计显示「—」', async () => {
    // 后端 sitePaged 的 dataTotal 把源 dataCnt=null 汇成 0，前端分不清"0 条"和"没统计"
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', undefined)])

    const { wrapper } = await mountGrid([{ ...site, sourceCount: 1, dataCount: 0 }])

    expect(wrapper.text()).toContain('数据 —')
  })

  it('站级 dataTotal=0 且源统计确实是 0 时照常显示 0 条', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', 0)])

    const { wrapper } = await mountGrid([{ ...site, sourceCount: 1, dataCount: 0 }])

    expect(wrapper.text()).toContain('数据 0 条')
  })

  it('部分源有统计时只汇总有值的源', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([source('s1', 12), source('s2', undefined)])

    const { wrapper } = await mountGrid()

    expect(wrapper.text()).toContain('数据 12 条')
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

  it('菜单含「删除网站」项，点它向父组件抛出该网站（父组件负责二次确认）', async () => {
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([])
    const { wrapper } = await mountGrid()

    await wrapper.get('[data-testid="site-card-more"]').trigger('click')
    const delBtn = wrapper.get('[data-testid="site-card-menu-delete"]')
    expect(delBtn.text()).toContain('删除网站')
    await delBtn.trigger('click')

    expect(wrapper.emitted('delete-site')?.[0]).toEqual([site])
    // 选完即关
    expect(wrapper.find('[data-testid="site-card-menu"]').exists()).toBe(false)
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

// 1123 A4：卡片目录不明显 → 带图标的完整路径标签，可点击按系统目录筛；无目录显示「未分类」
describe('SiteCardGrid 目录标签', () => {
  afterEach(() => vi.restoreAllMocks())
  const preview = () => {
    vi.spyOn(sourceDirs, 'isBizDir').mockReturnValue(true)
    vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    return vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([])
  }

  it('有 dirId 时补齐完整路径，点击抛出目录 ID；无查询时底部只显示总数', async () => {
    preview()
    vi.spyOn(sourceDirs, 'loadDirPath').mockResolvedValue(['股票数据', '基本资料'])
    const { wrapper } = await mountGrid([{ ...site, category: '基本资料', categoryPath: '基本资料', dirId: '9011495' }])
    const tag = wrapper.get('[data-testid="site-card-dir"]')
    expect(tag.text()).toBe('股票数据 / 基本资料')
    await tag.trigger('click')
    expect(wrapper.emitted('open-dir')?.[0]?.[1]).toEqual({ id: '9011495', path: '股票数据 / 基本资料' })
    expect(wrapper.get('[data-testid="site-card-count"]').text()).toBe('2 个源')
    wrapper.unmount()
  })

  it('卡片视图无筛选（filtered=false）时底部只写总数，不显示「命中 N / 共 N」', async () => {
    preview()
    const { wrapper } = await mountGrid([site], { query: {}, matches: { [site.siteId]: { total: 2, list: [] } }, serverPaged: true, filtered: false })
    expect(wrapper.get('[data-testid="site-card-count"]').text()).toBe('2 个源')
    wrapper.unmount()
  })

  it('路径补齐失败按非业务目录处理（点了打不开），超过两级只显示最后两级', async () => {
    preview()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(sourceDirs, 'loadDirPath').mockImplementation(async id => {
      if (id === 'bad') throw new Error('目录不存在')
      return ['行业数据', '化工', '基础化工']
    })
    const { wrapper } = await mountGrid([
      { ...site, siteId: 'a', category: '基本资料', categoryPath: '基本资料', dirId: 'bad' },
      { ...site, siteId: 'b', category: '基础化工', dirId: 'deep' },
    ])
    const tags = wrapper.findAll('[data-testid="site-card-dir"]')
    expect(tags).toHaveLength(1)
    expect(tags[0].text()).toBe('… / 化工 / 基础化工')
    expect(tags[0].attributes('title')).toContain('行业数据 / 化工 / 基础化工')
    expect(wrapper.get('[data-testid="site-card-dir-none"]').text()).toBe('未分类')
    wrapper.unmount()
  })

  it('网站 categoryId 指向系统目录时按所属源的业务目录显示，点击只抛业务目录', async () => {
    preview()
    vi.mocked(sourceDirs.isBizDir).mockImplementation(id => id !== '9008995')
    vi.mocked(sourceDirs.bizMembership).mockResolvedValue(new Map([['s1', ['902']]]))
    // 小站（源数 ≤ 预览上限）预览就是完整源列表，直接拿来推导，不再单独查源
    vi.mocked(siteApi.siteSourcePreview).mockResolvedValue([source('s1', 0)])
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
    vi.spyOn(sourceDirs, 'loadDirPath').mockImplementation(async id => (id === '902' ? ['产业数据', '家电'] : ['广发', '家电', '奥维云网2-家电快报']))
    const { wrapper } = await mountGrid([{ ...site, dirId: '9008995' }])
    const tag = wrapper.get('[data-testid="site-card-dir"]')
    expect(tag.text()).toBe('产业数据 / 家电')
    expect(tag.attributes('title')).toContain('网站只挂了系统目录，按所属源的业务目录显示')
    await tag.trigger('click')
    expect(wrapper.emitted('open-dir')?.[0]?.[1]).toEqual({ id: '902', path: '产业数据 / 家电' })
    expect(paged).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('网站和所属源都没有目录时显示「未分类」，不可点', async () => {
    preview()
    vi.mocked(sourceDirs.bizMembership).mockResolvedValue(new Map([['other', ['900']]]))
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 2, list: [source('s1', 0), source('s2', 0)] })
    const { wrapper } = await mountGrid([{ ...site, category: '', categoryPath: undefined, dirId: undefined }])
    expect(wrapper.find('[data-testid="site-card-dir"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="site-card-dir-none"]').text()).toBe('未分类')
    wrapper.unmount()
  })

  it('网站没有分类时按所属源的业务目录显示，取源最多的目录，点击抛出该目录', async () => {
    preview()
    const membership = vi.mocked(sourceDirs.bizMembership).mockResolvedValue(new Map([
      ['s1', ['901']], ['s2', ['902']], ['s3', ['902']],
    ]))
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: [source('s1', 0), source('s2', 0), source('s3', 0)] })
    vi.spyOn(sourceDirs, 'loadDirPath').mockImplementation(async id => (id === '902' ? ['产业数据', '交通运输'] : ['其他']))
    const { wrapper } = await mountGrid([{ ...site, sourceCount: 30, category: '', categoryPath: undefined, dirId: undefined }])
    expect(membership).toHaveBeenCalled()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ siteIds: 'site-1', page: 1, size: 200 }))
    const tag = wrapper.get('[data-testid="site-card-dir"]')
    expect(tag.text()).toBe('产业数据 / 交通运输')
    expect(tag.classes()).toContain('derived')
    expect(tag.attributes('title')).toContain('按所属源的业务目录显示（源还分布在另外 1 个目录）')
    await tag.trigger('click')
    expect(wrapper.emitted('open-dir')?.[0]?.[1]).toEqual({ id: '902', path: '产业数据 / 交通运输' })
    wrapper.unmount()
  })

  it('网站自己有分类时不按源推导', async () => {
    preview()
    const membership = vi.mocked(sourceDirs.bizMembership)
    vi.spyOn(sourceDirs, 'loadDirPath').mockResolvedValue(['股票数据', '基本资料'])
    const { wrapper } = await mountGrid([{ ...site, dirId: '9011495' }])
    expect(membership).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="site-card-dir"]').classes()).not.toContain('derived')
    wrapper.unmount()
  })
})

describe('hasSourceFilter', () => {
  it('空查询与目录 none 视为无筛选；有值或选了目录视为有筛选', async () => {
    const { hasSourceFilter } = await import('./siteCardQuery')
    expect(hasSourceFilter({ tags: [], name: '', directory: { kind: 'biz', mode: 'none', selections: [] }, field: 'x', sorted: 1, dirLabel: 'y' })).toBe(false)
    expect(hasSourceFilter({ name: '资讯' })).toBe(true)
    expect(hasSourceFilter({ directory: { kind: 'sys', mode: 'selected', selections: [{ id: '1', includeDescendants: true }] } })).toBe(true)
  })
})
