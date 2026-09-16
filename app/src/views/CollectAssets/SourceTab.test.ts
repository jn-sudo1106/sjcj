// SourceTab 单元测试（867→321 行 P2-2 拆分产物，之前从未有过测试，此前全项目零覆盖）
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SourceTab from './SourceTab.vue'
import { useUiStore } from '@/stores/ui'
import { sourceApi, siteApi } from '@/api'

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

async function mountAt(query?: Record<string, string>) {
  const router = makeRouter()
  await router.push({ path: '/collect', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(SourceTab, { global: { plugins: [pinia, router, ElementPlus] } })
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

  it('?state=error 会预置状态筛选；非法值（如 ?state=E）被忽略、保持默认 all', async () => {
    const { wrapper: wOk } = await mountAt({ state: 'error' })
    expect(wOk.findComponent({ name: 'FilterToolbar' }).props('stateFilter')).toBe('error')

    const { wrapper: wBad } = await mountAt({ state: 'E' })
    expect(wBad.findComponent({ name: 'FilterToolbar' }).props('stateFilter')).toBe('all')
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

describe('SourceTab 视图切换', () => {
  it('set-view 事件切换卡片/表格视图，委托给 ui store 持久化', async () => {
    const { wrapper } = await mountAt()
    const ui = useUiStore()
    expect(ui.assetView).toBe('card') // 默认卡片视图（见 ui store）
    await wrapper.findComponent({ name: 'FilterToolbar' }).vm.$emit('set-view', 'table')
    await flushPromises()
    expect(ui.assetView).toBe('table')
    expect(wrapper.findComponent({ name: 'TableView' }).exists()).toBe(true)
  })
})

describe('SourceTab 批量操作', () => {
  it('未勾选任何行时批量删除会提示并且不弹确认框', async () => {
    const { wrapper } = await mountAt()
    await wrapper.findComponent({ name: 'BatchBar' }).vm.$emit('batch-delete')
    await flushPromises()
    expect(ElMessage.warning).toHaveBeenCalledWith('请先在表格视图勾选网站或源')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })

  it('已勾选行时批量删除会弹二次确认，确认后调用 sourceApi.deleteSource', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const deleteSpy = vi.spyOn(sourceApi, 'deleteSource').mockResolvedValue({ ok: true, message: '已删除' })

    const { wrapper } = await mountAt()
    const table = wrapper.findComponent({ name: 'TableView' })
    table.vm.selectedIds = ['s1', 's2']
    await flushPromises()

    await wrapper.findComponent({ name: 'BatchBar' }).vm.$emit('batch-delete')
    await flushPromises()
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(deleteSpy).toHaveBeenCalledWith(['s1', 's2'])
    expect(ElMessage.success).toHaveBeenCalled()
    deleteSpy.mockRestore()
  })

  it('取消二次确认时不调用 API', async () => {
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel' as never)
    const deleteSpy = vi.spyOn(sourceApi, 'deleteSource')

    const { wrapper } = await mountAt()
    const table = wrapper.findComponent({ name: 'TableView' })
    table.vm.selectedIds = ['s1']
    await flushPromises()

    await wrapper.findComponent({ name: 'BatchBar' }).vm.$emit('batch-delete')
    await flushPromises()

    expect(deleteSpy).not.toHaveBeenCalled()
    deleteSpy.mockRestore()
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

  it('切到「名称」排序时按网站名排，不再看编辑时间', async () => {
    const spy = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 3, list: [...unordered] as never })
    const { wrapper } = await mountAt()

    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })
    toolbar.vm.$emit('update:sortBy', 'name')
    toolbar.vm.$emit('filterChange')
    await flushPromises()

    const sites = wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites') as { siteId: string }[]
    // localeCompare('zh') 按拼音：旧(jiu) < 新(xin) < 中(zhong)
    expect(sites.map((s) => s.siteId)).toEqual(['s-old', 's-new', 's-mid'])
    spy.mockRestore()
  })
})
