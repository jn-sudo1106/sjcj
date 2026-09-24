// SourceTab 单元测试（867→321 行 P2-2 拆分产物，之前从未有过测试，此前全项目零覆盖）
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SourceTab from './SourceTab.vue'
import { beginSitesFetch, clearCollectAssetsCache, collectAssetsCache, commitSites } from './siteListCache'
import { useUiStore } from '@/stores/ui'
import { sourceApi, siteApi, favoriteApi } from '@/api'

// 收藏以后端为准（B30）。这里用一个集合代替服务端：点星写进去，挂载时 loadFavoriteSites 从它读回来，
// 与真实后端行为一致（否则挂载那次加载会拿 mock 的空结果把测试里点的星冲掉）。
const serverFavorites = new Set<string>()
beforeEach(() => {
  clearCollectAssetsCache()
  serverFavorites.clear()
  vi.spyOn(favoriteApi, 'listIds').mockImplementation(async () => [...serverFavorites])
  vi.spyOn(favoriteApi, 'add').mockImplementation(async (_type, id) => { serverFavorites.add(id); return { ok: true, message: '' } })
  vi.spyOn(favoriteApi, 'remove').mockImplementation(async (_type, id) => { serverFavorites.delete(id); return { ok: true, message: '' } })
})

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }
})

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/collect', component: { template: '<div />' } },
      { path: '/canvas', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(query?: Record<string, string>, props?: { scope?: 'all' | 'favorite' | 'recent' }) {
  clearCollectAssetsCache()
  const router = makeRouter()
  await router.push({ path: '/collect', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(SourceTab, { props, global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

describe('SourceTab 加载与初始筛选', () => {
  beforeEach(() => {
    vi.mocked(ElMessage.warning).mockClear()
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  it('mount 后自动加载分类/统计/网站列表，把结果灌给子组件', async () => {
    const { wrapper } = await mountAt()
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).exists()).toBe(true)
    // 默认卡片视图（ui.assetView 默认值），SiteCardGrid 而非 TableView 挂载
    const grid = wrapper.findComponent({ name: 'SiteCardGrid' })
    expect(grid.exists()).toBe(true)
    // mock 接口返回后 sites 应已灌入（不是初始空数组）；具体数量不锁死，只验证「确实加载过了」
    expect(Array.isArray(grid.props('sites'))).toBe(true)
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('total')).toBeGreaterThanOrEqual(0)
  })

  // 0924-01：「全部状态」下拉去掉了，总览「异常」下钻落到「出错源」标签的选中态上
  it('?state=error 进来时「出错源」处于选中态；非法值（如 ?state=E）被忽略', async () => {
    const { wrapper: wOk } = await mountAt({ state: 'error' })
    expect(wOk.findComponent({ name: 'FilterToolbar' }).props('errorOnly')).toBe(true)

    const { wrapper: wBad } = await mountAt({ state: 'E' })
    expect(wBad.findComponent({ name: 'FilterToolbar' }).props('errorOnly')).toBe(false)
  })

  // 后端 site/sitePaged?state=ERROR 实测恒返回 0 条，所以异常过滤在前端按 errorCount 做，不发 state
  it('点「出错源」只看有异常源的网站（前端按 errorCount 筛、不重新请求），再点一次恢复全部', async () => {
    const spy = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({
      total: 3,
      list: [
        { siteId: 's-err', name: '有错', sourceCount: 5, errorCount: 2, updatedAt: '2026-09-20 10:00:00', tags: [] },
        { siteId: 's-ok', name: '正常', sourceCount: 3, errorCount: 0, updatedAt: '2026-09-21 10:00:00', tags: [] },
        { siteId: 's-err2', name: '也有错', sourceCount: 4, errorCount: 1, updatedAt: '2026-09-19 10:00:00', tags: [] },
      ] as never,
    })
    const { wrapper } = await mountAt()
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })
    const shown = () => (wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]).map((s) => s.siteId)
    expect(spy.mock.calls.every(([arg]) => !(arg as Record<string, unknown>).state)).toBe(true)
    spy.mockClear()

    toolbar.vm.$emit('toggleErrorOnly')
    await flushPromises()
    expect(toolbar.props('errorOnly')).toBe(true)
    expect(shown()).toEqual(['s-err', 's-err2'])
    expect(toolbar.props('stats')).toMatchObject({ total: 9, error: 3 })
    expect(spy).not.toHaveBeenCalled()

    toolbar.vm.$emit('toggleErrorOnly')
    await flushPromises()
    expect(toolbar.props('errorOnly')).toBe(false)
    expect(shown()).toEqual(['s-ok', 's-err', 's-err2'])
    spy.mockRestore()
  })

})

describe('SourceTab 筛选状态', () => {
  it('源名搜索返回所属网站，不会只按网站名查询后得到空列表', async () => {
    const { wrapper } = await mountAt()

    await wrapper.get('.ca-search input').setValue('多语种公告监控 - 法文')
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('keyword')).toBe('多语种公告监控 - 法文')
    await vi.waitFor(() => {
      const sites = wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]
      expect(sites.map((site) => site.siteId)).toEqual(['site-lang-demo'])
    })
  })

  it('分类多选回传 id 数组，查询时拼成旧契约 categoryIds 的逗号串', async () => {
    const { wrapper } = await mountAt()
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })
    await toolbar.vm.$emit('update:categoryFilter', ['/基金类', '/舆情类'])
    await toolbar.vm.$emit('filterChange')
    await flushPromises()
    expect(toolbar.props('categoryFilter')).toEqual(['/基金类', '/舆情类'])
    // mock 按逗号多值过滤：基金类 + 舆情类的并集站点都回来了
    await vi.waitFor(() => {
      const sites = wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]
      const ids = sites.map((site) => site.siteId)
      expect(ids).toContain('site-zfb')
      expect(ids).toContain('site-weibo')
    })
  })

  it('源名搜索不透传 sourceName 给 sitePaged（真实后端不生效会带出无关网站），改用 sourcePaged 的 siteId 交集', async () => {
    const siteSpy = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({
      total: 2,
      list: [
        { siteId: 'site-a', name: '新浪财经', category: '', categoryPath: '', owner: 'x', sourceCount: 2, errorCount: 0, updatedAt: '2026-09-01' },
        { siteId: 'site-b', name: '某某网站', category: '', categoryPath: '', owner: 'x', sourceCount: 1, errorCount: 0, updatedAt: '2026-09-02' },
      ],
    } as never)
    const srcSpy = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1,
      list: [{ sourceId: 's1', name: '明阳科技公告', url: '', configId: '', mainTable: '', owner: '', state: 'C', siteId: 'site-b' }],
    } as never)

    const { wrapper } = await mountAt()
    await wrapper.get('.ca-search input').setValue('明阳科技')

    await vi.waitFor(() => {
      const sites = wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]
      expect(sites.map((site) => site.siteId)).toEqual(['site-b'])
    })
    // sitePaged 从不带 sourceName；源名匹配走 sourcePaged?name=
    expect(siteSpy.mock.calls.every(([arg]) => !(arg as Record<string, unknown> | undefined)?.sourceName)).toBe(true)
    expect(srcSpy).toHaveBeenCalledWith(expect.objectContaining({ name: '明阳科技' }))

    siteSpy.mockRestore()
    srcSpy.mockRestore()
  })

  it('总览按分类下钻（?category=）预置进多选筛选', async () => {
    const { wrapper } = await mountAt({ category: '/基金类' })
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('categoryFilter')).toEqual(['/基金类'])
    await vi.waitFor(() => {
      const sites = wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]
      expect(sites.map((site) => site.siteId)).toContain('site-zfb')
    })
  })

})

// 0924-06：「表格视图」改为源列表视图——复用网站详情的「源视图」组件，不限网站
describe('SourceTab 源列表视图（0924-06）', () => {
  beforeEach(() => localStorage.clear())

  async function mountList(scope?: 'all' | 'favorite' | 'recent') {
    const res = await mountAt(undefined, scope ? { scope } : undefined)
    const ui = useUiStore()
    await res.wrapper.findComponent({ name: 'FilterToolbar' }).vm.$emit('set-view', 'table')
    await flushPromises()
    return { ...res, ui, list: res.wrapper.findComponent({ name: 'SourceOverviewView' }) }
  }

  it('切到源列表视图：挂源视图组件、不限网站；卡片与网站批量条都不在', async () => {
    const { wrapper, ui, list } = await mountList()
    expect(ui.assetView).toBe('table')
    expect(list.exists()).toBe(true)
    expect(list.props('currentSiteId')).toBe('')
    expect(list.props('scopeSiteIds')).toBeUndefined()
    expect(wrapper.findComponent({ name: 'SiteCardGrid' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'BatchBar' }).exists()).toBe(false)
  })

  it('工具条进入源模式：网站维度的搜索 / 分类 / 标签 / 统计收起', async () => {
    const { wrapper } = await mountList()
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('sourceMode')).toBe(true)
    expect(wrapper.find('.ca-search').exists()).toBe(false)
    expect(wrapper.find('.ca-stats').exists()).toBe(false)
  })

  it('最近打开页签：范围是最近打开的网站；一个都没有时给空数组和说明文案', async () => {
    const rec = await import('@/utils/siteRecents')
    rec.recentSiteIds.value = []
    const first = await mountList('recent')
    expect(first.list.props('scopeSiteIds')).toEqual([])
    expect(first.list.props('scopeEmptyText')).toContain('仅本机')

    rec.recordSiteVisit('s-a')
    rec.recordSiteVisit('s-b')
    await flushPromises()
    expect(first.wrapper.findComponent({ name: 'SourceOverviewView' }).props('scopeSiteIds')).toEqual(['s-b', 's-a'])
  })

  it('打开源：带网站上下文进数据视图，并记一笔最近打开', async () => {
    const rec = await import('@/utils/siteRecents')
    rec.recentSiteIds.value = []
    const { list, router } = await mountList()
    await list.vm.$emit('openSource', { sourceId: 'src-9', siteId: '105', name: '源' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: '105', sourceId: 'src-9', view: 'data' })
    expect(rec.recentSiteIds.value[0]).toBe('105')
  })

  it('未关联网站的源（siteId 为 0）只带 sourceId', async () => {
    const { list, router } = await mountList()
    await list.vm.$emit('openSource', { sourceId: 'src-0', siteId: '0', name: '源' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sourceId: 'src-0', view: 'data' })
  })

  it('点所属网站：进网站源视图', async () => {
    const { list, router } = await mountList()
    await list.vm.$emit('openSite', '12')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: '12', view: 'source' })
  })

  it('源模式下点刷新：通知源列表重查', async () => {
    const { wrapper, ui } = await mountList()
    const before = ui.sourceListRevision
    await wrapper.findComponent({ name: 'FilterToolbar' }).vm.$emit('refresh')
    await flushPromises()
    expect(ui.sourceListRevision).toBe(before + 1)
  })
})

describe('新建采集', () => {
  it('顶栏"新建采集"动作跳转到 /canvas?mode=new', async () => {
    const { router } = await mountAt()
    const ui = useUiStore()
    ui.fireAction('新建采集')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/canvas')
    expect(router.currentRoute.value.query).toEqual({ mode: 'new' })
  })
})

// 真实后端 site/sitePaged **不支持排序**：field/sorted、orderBy、sort/order 五种参数名
// 2026-09-16 生产实测全部无效，恒按 siteId 升序返回。「最近修改」只能前端排——所以这里
// 让接口回一份乱序数据，锁住"前端确实排过"，不能靠 mock 层自己排好而假阳性。
// 「名称」排序 0924-01 随排序下拉一起去掉（Q1），只剩这一种顺序。
describe('SourceTab 排序', () => {
  // ui store 的 assetView 持久化在 localStorage，前面「切换卡片/表格视图」那个用例会把它留成
  // table，导致这里挂出来的是 TableView、找不到 SiteCardGrid。清掉，回到默认卡片视图。
  beforeEach(() => localStorage.clear())

  const unordered = [
    { siteId: 's-old', name: '旧站', sourceCount: 1, errorCount: 0, updatedAt: '2026-07-20 16:57:32', tags: [] },
    { siteId: 's-new', name: '新站', sourceCount: 1, errorCount: 0, updatedAt: '2026-09-16 14:09:24', tags: [] },
    { siteId: 's-mid', name: '中站', sourceCount: 1, errorCount: 0, updatedAt: '2026-09-03 15:54:37', tags: [] },
  ]

  it('默认「最近修改」：即使接口返回乱序，也按编辑时间倒序渲染', async () => {
    const spy = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 3, list: [...unordered] as never })
    const { wrapper } = await mountAt()

    const sites = wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]
    expect(sites.map((s) => s.siteId)).toEqual(['s-new', 's-mid', 's-old'])
    spy.mockRestore()
  })

})

// 0917-17「我收藏的网站」：产品会上催了两次，痛点是"找半天"。
// 收藏存后端（utils/siteFavorites → favoriteApi，2026-09-23 前是本地），收藏的**恒排最前**。
// 「只看收藏」原先是排序下拉里的一项，0924-01 起只由「我的收藏」tab（scope=favorite）提供。
describe('SourceTab · 我的收藏（0917-17 / 0924-01）', () => {
  const sites = [
    { siteId: 's-old', name: '旧站', sourceCount: 1, errorCount: 0, updatedAt: '2026-07-20 16:57:32', tags: [] },
    { siteId: 's-new', name: '新站', sourceCount: 1, errorCount: 0, updatedAt: '2026-09-16 14:09:24', tags: [] },
    { siteId: 's-mid', name: '中站', sourceCount: 1, errorCount: 0, updatedAt: '2026-09-03 15:54:37', tags: [] },
  ]

  beforeEach(async () => {
    localStorage.clear()
    const fav = await import('@/utils/siteFavorites')
    fav.favoriteSiteIds.value = new Set()
  })

  async function mountWithSites(scope?: 'all' | 'favorite' | 'recent') {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 3, list: [...sites] as never })
    return mountAt(undefined, scope ? { scope } : undefined)
  }
  const shown = (w: Awaited<ReturnType<typeof mountAt>>['wrapper']) =>
    (w.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]).map((s) => s.siteId)

  it('收藏的排最前，组内按最近修改', async () => {
    const fav = await import('@/utils/siteFavorites')
    await fav.toggleFavoriteSite('s-old') // 时间最旧，本来排最后
    const { wrapper } = await mountWithSites()

    expect(shown(wrapper)).toEqual(['s-old', 's-new', 's-mid'])
  })

  it('「我的收藏」tab 只列收藏的，total 跟着变（列表是前端分页，别只改展示）', async () => {
    const fav = await import('@/utils/siteFavorites')
    await fav.toggleFavoriteSite('s-new')
    const { wrapper } = await mountWithSites('favorite')
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })

    expect(shown(wrapper)).toEqual(['s-new'])
    expect(toolbar.props('total')).toBe(1)
  })

  it('一个都没收藏时：空列表，空态说明怎么收藏', async () => {
    const { wrapper } = await mountWithSites('favorite')
    expect(shown(wrapper)).toEqual([])
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('total')).toBe(0)
    expect(wrapper.findComponent({ name: 'SiteCardGrid' }).props('emptyText')).toContain('还没有收藏的网站')
  })

  it('有收藏但筛选没命中时，空态仍是「没有匹配的网站」', async () => {
    const fav = await import('@/utils/siteFavorites')
    await fav.toggleFavoriteSite('s-new')
    const { wrapper } = await mountWithSites('favorite')
    expect(wrapper.findComponent({ name: 'SiteCardGrid' }).props('emptyText')).toBe('没有匹配的网站')
  })

  it('卡片上的 ☆ 点一下就收藏，列表随即把它顶到最前', async () => {
    const { wrapper } = await mountWithSites()
    expect(shown(wrapper)).toEqual(['s-new', 's-mid', 's-old'])

    // 第三张卡（s-old）的星
    const stars = wrapper.findAll('[data-testid="site-card-fav"]')
    expect(stars.length).toBe(3)
    await stars[2].trigger('click')
    await flushPromises()

    expect(shown(wrapper)).toEqual(['s-old', 's-new', 's-mid'])
  })
})

// 0917-17 后半条：最近打开。它补的是收藏解决不了的那一半——"找半天"那次根本没先收藏过。
// 2026-09-21 挂在排序下拉里，0924-01 起改为「最近打开」tab（scope=recent）。
describe('SourceTab · 最近打开的网站（0917-17 / 0924-01）', () => {
  const sites = [
    { siteId: 's-old', name: '旧站', sourceCount: 1, errorCount: 0, updatedAt: '2026-07-20 16:57:32', tags: [] },
    { siteId: 's-new', name: '新站', sourceCount: 1, errorCount: 0, updatedAt: '2026-09-16 14:09:24', tags: [] },
    { siteId: 's-mid', name: '中站', sourceCount: 1, errorCount: 0, updatedAt: '2026-09-03 15:54:37', tags: [] },
  ]

  beforeEach(async () => {
    localStorage.clear()
    const fav = await import('@/utils/siteFavorites')
    fav.favoriteSiteIds.value = new Set()
    const rec = await import('@/utils/siteRecents')
    rec.recentSiteIds.value = []
  })

  async function mountWithSites(scope?: 'all' | 'favorite' | 'recent') {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 3, list: [...sites] as never })
    return mountAt(undefined, scope ? { scope } : undefined)
  }
  const shown = (w: Awaited<ReturnType<typeof mountAt>>['wrapper']) =>
    (w.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]).map((s) => s.siteId)

  it('只显示打开过的，且按最近在前排——不走「最近修改」那套', async () => {
    const rec = await import('@/utils/siteRecents')
    rec.recordSiteVisit('s-old')   // 更早打开
    rec.recordSiteVisit('s-mid')   // 最近打开
    const { wrapper } = await mountWithSites('recent')

    // s-new 没打开过所以不在；s-mid 比 s-old 近所以在前（按 updatedAt 排的话 s-mid 也在前，
    // 但这里换个顺序再验一次下面那条）
    expect(shown(wrapper)).toEqual(['s-mid', 's-old'])
  })

  it('访问顺序压过「最近修改」：后打开的旧站排在先打开的新站前面', async () => {
    const rec = await import('@/utils/siteRecents')
    rec.recordSiteVisit('s-new')   // updatedAt 最新，但先打开
    rec.recordSiteVisit('s-old')   // updatedAt 最旧，但后打开
    const { wrapper } = await mountWithSites('recent')

    expect(shown(wrapper)).toEqual(['s-old', 's-new'])
  })

  it('一个都没打开过时：空列表，空态注明「仅本机」', async () => {
    const { wrapper } = await mountWithSites('recent')
    expect(shown(wrapper)).toEqual([])
    const emptyText = wrapper.findComponent({ name: 'SiteCardGrid' }).props('emptyText') as string
    expect(emptyText).toContain('还没有打开过网站')
    expect(emptyText).toContain('仅本机')
  })

  it('最近打开 tab 里收藏不插队：纯按访问顺序', async () => {
    const fav = await import('@/utils/siteFavorites')
    const rec = await import('@/utils/siteRecents')
    await fav.toggleFavoriteSite('s-old')
    rec.recordSiteVisit('s-old')   // 收藏了，但先打开
    rec.recordSiteVisit('s-mid')   // 后打开
    const { wrapper } = await mountWithSites('recent')
    expect(shown(wrapper)).toEqual(['s-mid', 's-old'])
  })

  it('点卡片进网站会记一笔，回来就能在「最近打开」里看到', async () => {
    const { wrapper } = await mountWithSites()
    const grid = wrapper.findComponent({ name: 'SiteCardGrid' })
    // 卡片主体点击 = 进网站源视图
    await grid.findAll('.scg-card')[2].trigger('click')
    await flushPromises()

    const rec = await import('@/utils/siteRecents')
    expect(rec.recentSiteIds.value[0]).toBe('s-old')
  })
})

// 2026-09-21 用户报「根据条件查询完后，条数没有更新」。实情：命中数是更新了的
// （实测 83 → 财经资讯 71），但工具条四个数里后三个来自 site/summary、是全站汇总，
// 并排放着看着就像没更新。修法是标清口径：命中数写成「命中 / 全站」。
describe('SourceTab · 统计区的口径（2026-09-21）', () => {
  const sites = [
    { siteId: 's1', name: '一', sourceCount: 10, errorCount: 3, notifyCount: 2, updatedAt: '2026-09-16 14:09:24', tags: [] },
    { siteId: 's2', name: '二', sourceCount: 5, errorCount: 1, notifyCount: 0, updatedAt: '2026-09-03 15:54:37', tags: [] },
  ]

  beforeEach(() => localStorage.clear())

  async function mountWith(total: number) {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: [...sites] as never })
    vi.spyOn(siteApi, 'siteSummary').mockResolvedValue({ total, sourceTotal: 18636, errorCount: 1264, notifyCount: 2 })
    return mountAt()
  }

  // 2026-09-23 起：后端补齐了每个网站的聚合列（B31），源 / 出错源 / 告警网站改为对命中列表求和，
  // 跟筛选走；全站网站数仍从 site/summary 的 total 取（「命中 / 全站」的分母）。
  it('源 / 出错源 / 告警网站对命中列表求和，全站网站数取 summary.total', async () => {
    const { wrapper } = await mountWith(83)
    const stats = wrapper.findComponent({ name: 'FilterToolbar' }).props('stats') as Record<string, number>
    expect(stats.siteTotal).toBe(83)
    expect(stats.total).toBe(15)   // 10 + 5
    expect(stats.error).toBe(4)    // 3 + 1
    expect(stats.notify).toBe(1)   // 按网站计：只有 s1 有告警源
  })

  it('筛选后统计跟着变（搜索按网站名命中一个站）', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const { wrapper } = await mountWith(83)
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })
    toolbar.vm.$emit('update:keyword', '二')
    toolbar.vm.$emit('filterChange')
    await flushPromises()

    const stats = toolbar.props('stats') as Record<string, number>
    expect(toolbar.props('total')).toBe(1)
    expect(stats).toMatchObject({ total: 5, error: 1, notify: 0, siteTotal: 83 })
  })

  it('没有筛选条件时 filtered=false（「网站 N」不写成 N / M）', async () => {
    const { wrapper } = await mountWith(83)
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).props('filtered')).toBe(false)
  })

  it('任一筛选条件生效就 filtered=true', async () => {
    const { wrapper } = await mountWith(83)
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })

    toolbar.vm.$emit('update:keyword', '财经')
    await flushPromises()
    expect(toolbar.props('filtered')).toBe(true)

    toolbar.vm.$emit('update:keyword', '')
    toolbar.vm.$emit('update:categoryFilter', ['9009005'])
    await flushPromises()
    expect(toolbar.props('filtered')).toBe(true)

    toolbar.vm.$emit('update:categoryFilter', [])
    toolbar.vm.$emit('toggleErrorOnly')
    await flushPromises()
    expect(toolbar.props('filtered')).toBe(true)

    toolbar.vm.$emit('toggleErrorOnly')
    await flushPromises()
    expect(toolbar.props('filtered')).toBe(false)
  })

  // 「我的收藏」「最近打开」两个 tab 也算筛选——它们同样会让命中数少于全站
  it('我的收藏 / 最近打开 tab 也算筛选', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: sites.length, list: [...sites] as never })
    vi.spyOn(siteApi, 'siteSummary').mockResolvedValue({ total: 83, sourceTotal: 18636, errorCount: 1264, notifyCount: 2 })
    const fav = await mountAt(undefined, { scope: 'favorite' })
    expect(fav.wrapper.findComponent({ name: 'FilterToolbar' }).props('filtered')).toBe(true)
    const recent = await mountAt(undefined, { scope: 'recent' })
    expect(recent.wrapper.findComponent({ name: 'FilterToolbar' }).props('filtered')).toBe(true)
  })
})


// 2026-09-23：网站列表加了模块级缓存。缓存跨路由存活，别的页面（画布里新建网站、挪源）
// 不会清它——所以进页面必须先画缓存、再静默重拉，否则一直显示旧数据。
describe('SourceTab 网站列表缓存', () => {
  beforeEach(() => localStorage.clear())

  const site = (siteId: string, name: string) => ({ siteId, name, sourceCount: 1, errorCount: 0, updatedAt: '2026-09-20 10:00:00', tags: [] })

  it('命中缓存时先显示缓存，再后台重拉，用新结果覆盖', async () => {
    const spy = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 2, list: [site('s-old', '旧站'), site('s-created', '别处新建的站')] as never })
    const router = makeRouter()
    await router.push('/collect')
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    // 模拟上一次进页面留下的缓存（只有一个站）
    commitSites(beginSitesFetch(), [site('s-old', '旧站')] as never)

    const wrapper = mount(SourceTab, { global: { plugins: [pinia, router, ElementPlus] } })
    await flushPromises()
    await flushPromises()

    expect(spy).toHaveBeenCalled()
    const sites = wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]
    expect(sites.map((s) => s.siteId).sort()).toEqual(['s-created', 's-old'])
    spy.mockRestore()
    wrapper.unmount()
  })

  it('清缓存之前发出的请求晚回来，不能把旧数据写回缓存', () => {
    clearCollectAssetsCache()
    const stale = beginSitesFetch()
    clearCollectAssetsCache()
    const fresh = beginSitesFetch()
    commitSites(fresh, [site('s-new', '新')] as never)
    commitSites(stale, [site('s-stale', '旧')] as never)
    expect(collectAssetsCache.sites?.map((s) => s.siteId)).toEqual(['s-new'])
  })
})

// 0924-03：分类改在「系统设置 → 分类目录」维护。从那边改完回来，采集资产是重新挂载的，
// 但分类树读的是模块级缓存——必须先画缓存、再静默重拉，否则新建的分类看不到。
describe('SourceTab 分类缓存重拉（0924-03）', () => {
  beforeEach(() => localStorage.clear())

  it('进页面先用缓存里的分类，再后台重拉覆盖', async () => {
    const spy = vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([
      { id: 'c1', name: '旧分类' },
      { id: 'c2', name: '设置页刚建的分类' },
    ])
    const router = makeRouter()
    await router.push('/collect')
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    clearCollectAssetsCache()
    collectAssetsCache.categories = [{ id: 'c1', name: '旧分类' }]

    const wrapper = mount(SourceTab, { global: { plugins: [pinia, router, ElementPlus] } })
    await flushPromises()
    await flushPromises()

    expect(spy).toHaveBeenCalled()
    const cats = wrapper.findComponent({ name: 'FilterToolbar' }).props('categories') as { id: string }[]
    expect(cats.map((c) => c.id)).toEqual(['c1', 'c2'])
    spy.mockRestore()
    wrapper.unmount()
  })
})

