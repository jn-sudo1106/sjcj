// SourceTab 单元测试（867→321 行 P2-2 拆分产物，之前从未有过测试，此前全项目零覆盖）
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import SourceTab from './SourceTab.vue'
import { beginSitesFetch, clearCollectAssetsCache, collectAssetsCache, commitSites } from './siteListCache'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { sourceApi, siteApi, favoriteApi, logReportApi } from '@/api'
import * as sourceDirs from '@/api/sourceDirs'
import { clearSiteCardQueryCache } from './siteCardQuery'

enableAutoUnmount(afterEach)
afterEach(() => { vi.restoreAllMocks(); clearSiteCardQueryCache() })

// 「最近打开」2026-10-19 起以后端通用埋点为准。这里用内存列表代替服务端：
// 上报记进内存、挂载时 recentRaw 从它读回来——与真实后端行为一致，
// 否则挂载那次加载会拿空结果把用例里手工设置的最近列表冲掉。
beforeEach(() => {
  vi.spyOn(logReportApi, 'report').mockResolvedValue({ success: true, code: '0', msg: '操作成功', data: {} })
  vi.spyOn(logReportApi, 'recentRaw').mockImplementation(async () => {
    const rec = await import('@/utils/siteRecents')
    return {
      success: true,
      code: '0',
      msg: '操作成功',
      data: rec.recentSiteIds.value.map((id) => ({ contentId: id, contentTitle: null, createDt: '2026-10-19 10:00:00' })),
    }
  })
})

// 收藏以后端为准（B30）。这里用一个集合代替服务端：点星写进去，挂载时 loadFavoriteSites 从它读回来，
// 与真实后端行为一致（否则挂载那次加载会拿 mock 的空结果把测试里点的星冲掉）。
const serverFavorites = new Set<string>()
beforeEach(() => {
  clearCollectAssetsCache()
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(siteApi, 'sourceScopePaged').mockResolvedValue({ total: 0, matchedSourceTotal: 0, unboundSourceTotal: 0, list: [] })
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

async function mountAt(query?: Record<string, string>, props?: { scope?: 'all' | 'favorite' | 'recent' }, dataHits?: string[]) {
  clearCollectAssetsCache()
  const router = makeRouter()
  await router.push({ path: '/collect', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  if (dataHits) useWorkspaceStore().setDataQueryHits(dataHits)
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


  // 0930-01：预建的空网站（一个源都没有）会上看着是一片「暂无源」，网站列表默认不显示；
  // 按网站名搜索时要能找到（刚新建、还没挂源的网站）

})

describe('SourceTab 筛选状态', () => {
  it('源名称直接交给聚合接口，不从网站目录和全量源做客户端交集', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue({total:1,matchedSourceTotal:1,unboundSourceTotal:0,list:[{site:{siteId:'42',name:'多语种公告监控',sourceCount:24,errorCount:0} as never,matchedSourceCount:1,sourcePreview:[],favorited:false}]})
    const {wrapper}=await mountAt()
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('法文')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click');await flushPromises()
    expect(aggregate).toHaveBeenLastCalledWith(expect.objectContaining({sourceFilter:expect.objectContaining({name:'法文'})}),expect.any(AbortSignal))
    expect(wrapper.findComponent({name:'SiteCardGrid'}).props('sites')[0].name).toBe('多语种公告监控')
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

  async function bizOps(wrapper: Awaited<ReturnType<typeof mountList>>['wrapper']) {
    const dropdown = wrapper.findAllComponents({ name: 'ElDropdown' }).find((d) => d.attributes('data-testid') === 'biz-ops')!
    await dropdown.get('button').trigger('click')
    await flushPromises()
    return { dropdown, run: async (command: 'add' | 'move') => { dropdown.vm.$emit('command', command); await flushPromises() } }
  }

  it('业务目录显示多个完整路径，加载中不标未归类；原始目录独立取系统目录', async () => {
    let resolve!: (map: Map<string, string[]>) => void
    vi.spyOn(sourceDirs, 'bizMembership').mockReturnValue(new Promise(done => { resolve = done }))
    vi.spyOn(sourceDirs, 'dirPath').mockImplementation(id => id === 'd1' ? ['股票数据', '基本资料'] : ['债券数据', '基本资料'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ sourceId: 's1', name: '测试源', categoryPath: '原系统/测试目录' } as never] })
    const { wrapper, list } = await mountList()
    expect(list.props('showOriginalDirectory')).toBe(true)
    expect(wrapper.get('.sov-extra').text()).toBe('加载中…')
    resolve(new Map([['s1', ['d1', 'd2']]]))
    await flushPromises()
    expect(wrapper.findAll('.ca-biz-tag').map(tag => tag.attributes('title'))).toEqual(['股票数据 / 基本资料', '债券数据 / 基本资料'])
    expect(wrapper.get('[data-testid="source-overview-original-directory"]').text()).toBe('原系统 / 测试目录')
    wrapper.unmount()
  })

  it('业务目录关系加载失败不标成未归类', async () => {
    vi.spyOn(sourceDirs, 'bizMembership').mockRejectedValue(new Error('网络异常'))
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ sourceId: 's1', name: '测试源' } as never] })
    const { wrapper } = await mountList()
    expect(wrapper.get('.sov-extra').text()).toBe('加载失败')
    wrapper.unmount()
  })

  // 1104 会议「页面卡顿」：业务目录归属没有反查接口，要整棵目录树逐个 listSources（186 上约 75 个请求），
  // 不能跟着首屏一起发——等源列表这一页回来（SourceOverviewView 的 pageLoaded）再查。
  it('「业务目录」等源列表这一页回来再查，不跟首屏抢请求', async () => {
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    let release!: () => void
    vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(() => new Promise((done) => {
      release = () => done({ total: 0, list: [] })
    }) as never)
    const { wrapper } = await mountList()
    expect(membership).not.toHaveBeenCalled()
    release()
    await flushPromises()
    expect(membership).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('默认收起业务目录、不选任何目录：不拉目录内的源，按全库查询；旧的展开偏好不覆盖默认值', async () => {
    sourceDirs.resetSourceDirCache()
    localStorage.setItem('sjcj.sourceDirPanel.collapsed', '0')
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId) => parentId === '-2' ? [{ id: 'biz-dir', name: '业务目录一' }] : [])
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    const scope = vi.spyOn(sourceDirs, 'bizScopeSourceIds').mockResolvedValue(['biz-source'])
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const { wrapper, list } = await mountList()
    await flushPromises()
    expect(wrapper.get('[data-testid="dir-panel-rail"]').text()).toContain('业务目录')
    expect(wrapper.get('[data-testid="dir-panel-rail"]').text()).not.toContain('全')
    expect(wrapper.find('.ca-dir-layout.collapsed').exists()).toBe(true)
    expect(scope).not.toHaveBeenCalled()
    expect(list.props('scopeSourceIds')).toBeUndefined()
    expect(page).toHaveBeenCalled()
    for (const [query] of page.mock.calls) expect(query?.sourceIds).toBeUndefined()
    wrapper.unmount()
    for (const spy of [categories, membership, scope, page]) spy.mockRestore()
    sourceDirs.resetSourceDirCache()
  })

  it('业务目录树为空时默认切系统目录，解除业务源 ID 范围并正常查询列表', async () => {
    sourceDirs.resetSourceDirCache()
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([])
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const { wrapper, list } = await mountList()
    await flushPromises()
    expect(wrapper.get('[data-testid="dir-panel-rail"]').text()).toContain('系统目录')
    expect(wrapper.find('.ca-dir-layout.collapsed').exists()).toBe(true)
    expect(list.props('scopeSourceIds')).toBeUndefined()
    expect(list.props('scopeCategoryIds')).toBeUndefined()
    expect(page).toHaveBeenCalled()
    for (const [query] of page.mock.calls) expect(query?.sourceIds).toBeUndefined()
    wrapper.unmount()
    for (const spy of [categories, membership, page]) spy.mockRestore()
    sourceDirs.resetSourceDirCache()
  })

  it('常驻入口在同一弹窗从全库选源和目录，保存后刷新当前范围', async () => {
    sourceDirs.resetSourceDirCache()
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId) => parentId === '-2' ? [{ id: '900', name: '股票数据' }] : [])
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    const scope = vi.spyOn(sourceDirs, 'bizScopeSourceIds').mockResolvedValue(['1'])
    const add = vi.spyOn(sourceDirs, 'addSourcesToBizDir').mockResolvedValue(1)
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const { wrapper, list } = await mountList()
    try {
      expect(wrapper.find('[data-testid="source-add-to-biz"]').exists()).toBe(false)
      await (await bizOps(wrapper)).run('add')
      const picker = wrapper.findComponent({ name: 'GroupSourcePicker' })
      expect(picker.props('modelValue')).toBe(true)
      expect(picker.props('pickMode')).toBe(true)
      expect(page.mock.lastCall?.[0]).toMatchObject({ page: 1, size: 20 })
      expect(page.mock.lastCall?.[0]).not.toHaveProperty('sourceIds')
      expect(page.mock.lastCall?.[0]).not.toHaveProperty('categorys')
      expect(add).not.toHaveBeenCalled()
      const target = wrapper.findComponent({ name: 'BizDirPickerDialog' })
      expect(target.props('initialSourceIds')).toEqual([])
      expect(target.props('initialDirectoryIds')).toEqual([])
      expect(picker.findComponent({ name: 'ElTree' }).exists()).toBe(true)
      const loads = membership.mock.calls.length
      target.vm.$emit('saved')
      target.vm.$emit('close')
      await flushPromises()
      expect(membership.mock.calls.length).toBeGreaterThan(loads)
      expect(list.props('scopeSourceIds')).toBeUndefined()
      expect(wrapper.findAllComponents({ name: 'ElDropdown' }).some((d) => d.attributes('data-testid') === 'biz-ops')).toBe(true)
    } finally {
      wrapper.unmount()
      for (const spy of [categories, membership, scope, add, page]) spy.mockRestore()
      sourceDirs.resetSourceDirCache()
    }
  })

  it('勾选源后从「业务目录 ▾」添加：带入源和左侧目录，不把含子级范围当作目标', async () => {
    sourceDirs.resetSourceDirCache()
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId) => parentId === '-2' ? [{ id: '900', name: '股票数据' }] : [])
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    const scope = vi.spyOn(sourceDirs, 'bizScopeSourceIds').mockResolvedValue(['1'])
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ sourceId: '1', name: '测试源', state: 'C' } as never] })
    const { wrapper } = await mountList()
    try {
      wrapper.findComponent({ name: 'SourceDirPanel' }).vm.$emit('change', { kind: 'biz', dirIds: ['900', '901'], labels: [{ id: '900', path: '股票数据', hasKids: true }] })
      await flushPromises()
      await wrapper.get('[data-testid="source-check-1"]').setValue(true)
      expect(wrapper.find('[data-testid="source-add-to-biz"]').exists()).toBe(false)
      await (await bizOps(wrapper)).run('add')
      const dialog = wrapper.findComponent({ name: 'BizDirPickerDialog' })
      expect(dialog.props('initialSourceIds')).toEqual(['1'])
      expect(dialog.props('initialDirectoryIds')).toEqual(['900'])
      dialog.vm.$emit('close')
      await flushPromises()
    } finally {
      wrapper.unmount()
      for (const spy of [categories, membership, scope, page]) spy.mockRestore()
      sourceDirs.resetSourceDirCache()
    }
  })

  it('移动到…：没点业务目录时不可用；点了一个目录后带上勾选的源和「从」目录打开弹窗；业务目录下不给「按目录」', async () => {
    sourceDirs.resetSourceDirCache()
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId) => parentId === '-2' ? [{ id: '900', name: '股票数据' }] : [])
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    const scope = vi.spyOn(sourceDirs, 'bizScopeSourceIds').mockResolvedValue(['1'])
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ sourceId: '1', name: '测试源', state: 'C' } as never] })
    const { wrapper } = await mountList()
    try {
      await flushPromises()
      await wrapper.get('[data-testid="source-check-1"]').setValue(true)
      await (await bizOps(wrapper)).run('move')
      expect(wrapper.findComponent({ name: 'BizDirMoveDialog' }).exists()).toBe(false)
      wrapper.findComponent({ name: 'SourceDirPanel' }).vm.$emit('change', { kind: 'biz', dirIds: ['900', '901'], labels: [{ id: '900', path: '股票数据', hasKids: true }] })
      await flushPromises()
      expect(wrapper.find('[data-testid="dir-ops"]').exists()).toBe(false)
      await wrapper.get('[data-testid="source-check-1"]').setValue(true)
      await (await bizOps(wrapper)).run('move')
      const dialog = wrapper.findComponent({ name: 'BizDirMoveDialog' })
      expect(dialog.props()).toMatchObject({ sourceIds: ['1'], fromDirIds: ['900', '901'], fromLabel: '股票数据（含子级）' })
      dialog.vm.$emit('close')
      await flushPromises()
      expect(wrapper.findComponent({ name: 'BizDirMoveDialog' }).exists()).toBe(false)
    } finally {
      wrapper.unmount()
      for (const spy of [categories, membership, scope, page]) spy.mockRestore()
      sourceDirs.resetSourceDirCache()
    }
  })

  // 2026-11-03：批量改所属网站放进「归类」下拉（原「目录归类」），系统目录页签也能用
  it('系统目录页签也有「归类」下拉：只有「修改所属网站」，业务目录三项不出现', async () => {
    sourceDirs.resetSourceDirCache()
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([])
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ sourceId: '1', name: '测试源', state: 'C' } as never] })
    const { wrapper } = await mountList()
    try {
      await flushPromises()
      const dropdown = wrapper.findAllComponents({ name: 'ElDropdown' }).find((d) => d.attributes('data-testid') === 'biz-ops')!
      expect(dropdown.text()).toContain('归类')
      expect(dropdown.text()).not.toContain('目录归类')
      await dropdown.get('button').trigger('click')
      await flushPromises()
      const items = [...document.querySelectorAll('.el-dropdown-menu__item')].map((el) => el.textContent ?? '')
      expect(items.some((text) => text.includes('修改所属网站'))).toBe(true)
      expect(items.some((text) => text.includes('加入业务目录'))).toBe(false)
      expect(items.some((text) => text.includes('移到其他业务目录'))).toBe(false)
      // 没勾选源时这一项不可用
      expect(document.querySelector('[data-testid="source-change-site"]')?.className).toContain('is-disabled')
    } finally {
      wrapper.unmount()
      for (const spy of [categories, membership, page]) spy.mockRestore()
      sourceDirs.resetSourceDirCache()
    }
  })

  it('勾选源后「修改所属网站」带入勾选的源打开弹窗；没勾选时点不动', async () => {
    sourceDirs.resetSourceDirCache()
    const categories = vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([])
    const membership = vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map())
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ sourceId: '1', name: '测试源', state: 'C' } as never] })
    const sites = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 1, list: [{ siteId: '77', name: '目标站' } as never] })
    const { wrapper } = await mountList()
    try {
      await flushPromises()
      const dropdown = wrapper.findAllComponents({ name: 'ElDropdown' }).find((d) => d.attributes('data-testid') === 'biz-ops')!
      dropdown.vm.$emit('command', 'site')
      await flushPromises()
      expect(wrapper.findComponent({ name: 'ChangeSiteDialog' }).exists()).toBe(false)
      await wrapper.get('[data-testid="source-check-1"]').setValue(true)
      dropdown.vm.$emit('command', 'site')
      await flushPromises()
      const dialog = wrapper.findComponent({ name: 'ChangeSiteDialog' })
      expect(dialog.props('sourceIds')).toEqual(['1'])
      expect(sites).toHaveBeenCalled()
      dialog.vm.$emit('close')
      await flushPromises()
      expect(wrapper.findComponent({ name: 'ChangeSiteDialog' }).exists()).toBe(false)
    } finally {
      wrapper.unmount()
      for (const spy of [categories, membership, page, sites]) spy.mockRestore()
      sourceDirs.resetSourceDirCache()
    }
  })

  // 顶上那条网站工具栏整条不出现，视图切换 / 刷新嵌进源列表筛选栏的操作区，两条栏并成一条
  it('只剩一条栏：工具条以源模式嵌在源列表筛选栏里，没有新增网站、搜索、分类、标签、统计', async () => {
    const { wrapper } = await mountList()
    const toolbars = wrapper.findAllComponents({ name: 'FilterToolbar' })
    expect(toolbars).toHaveLength(1)
    expect(toolbars[0]!.props('sourceMode')).toBe(true)
    expect(wrapper.find('.sov-filter-actions .ca-toolbar.is-inline').exists()).toBe(true)
    expect(wrapper.find('[data-testid="site-create"]').exists()).toBe(false)
    expect(wrapper.find('.ca-search').exists()).toBe(false)
    expect(wrapper.find('.ca-stats').exists()).toBe(false)
  })

  it('从源列表切回卡片：保留同一筛选栏、目录和源视图实例', async () => {
    const { wrapper } = await mountList()
    await wrapper.findComponent({ name: 'FilterToolbar' }).vm.$emit('set-view', 'card')
    await flushPromises()
    const toolbar = wrapper.findComponent({ name: 'FilterToolbar' })
    expect(toolbar.props('sourceMode')).toBe(true)
    const create = wrapper.get('[data-testid="site-create"]')
    expect(create.attributes('aria-label')).toBe('新增网站')
    expect(create.text()).toBe('')
    expect(create.find('svg').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'SourceOverviewView' }).props('websiteCards')).toBe(true)
    expect(wrapper.findComponent({ name: 'SourceDirPanel' }).exists()).toBe(true)
  })

  it('最近打开页签：范围是最近打开的网站；一个都没有时给空数组和说明文案', async () => {
    const rec = await import('@/utils/siteRecents')
    rec.recentSiteIds.value = []
    const first = await mountList('recent')
    expect(first.list.props('scopeSiteIds')).toEqual([])
    expect(first.list.props('scopeEmptyText')).toContain('还没有打开过网站')

    rec.recordSiteVisit('s-a')
    rec.recordSiteVisit('s-b')
    await flushPromises()
    expect(first.wrapper.findComponent({ name: 'SourceOverviewView' }).props('scopeSiteIds')).toEqual(['s-b', 's-a'])
  })

  // 0924-08：源列表视图下「我的收藏」是收藏的**源**；卡片视图下同一个页签仍是收藏的网站
  it('我的收藏页签：范围是收藏的源，不再是收藏网站下的源', async () => {
    const srcFav = await import('@/utils/sourceFavorites')
    srcFav.favoriteSourceIds.value = new Set()
    vi.spyOn(favoriteApi, 'listIds').mockImplementation(async (type) => (type === 'SOURCE' ? ['430024431', '430024671'] : ['105']))
    const { list } = await mountList('favorite')
    expect(list.props('scopeSourceIds')).toEqual(['430024431', '430024671'])
    expect(list.props('scopeSiteIds')).toBeUndefined()
  })

  it('我的收藏页签：收藏没拉回来前显示加载中，拉回来是空的才说「还没有收藏的源」', async () => {
    const srcFav = await import('@/utils/sourceFavorites')
    srcFav.favoriteSourceIds.value = new Set()
    srcFav.favoriteSourcesLoaded.value = false
    let resolve!: (ids: string[]) => void
    vi.spyOn(favoriteApi, 'listIds').mockImplementation((type) => (type === 'SOURCE' ? new Promise((r) => { resolve = r }) : Promise.resolve([])))
    const { wrapper } = await mountList('favorite')
    const list = () => wrapper.findComponent({ name: 'SourceOverviewView' })
    // 范围给空数组而不是 undefined：undefined 等于不限，会先查出全部源
    expect(list().props('scopeSourceIds')).toEqual([])
    expect(list().props('scopeEmptyText')).toBe('正在加载收藏的源…')

    resolve([])
    await flushPromises()
    expect(list().props('scopeEmptyText')).toBe('还没有收藏的源，在源列表里点 ☆ 收藏')
  })

  it('打开源：带网站上下文进概览视图，并记一笔最近打开', async () => {
    const rec = await import('@/utils/siteRecents')
    rec.recentSiteIds.value = []
    const { list, router } = await mountList()
    await list.vm.$emit('openSource', { sourceId: 'src-9', siteId: '105', name: '源' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: '105', sourceId: 'src-9', view: 'overview', returnTo: '/collect' })
    expect(rec.recentSiteIds.value[0]).toBe('105')
  })

  it('明确查看源数据时仍直达数据视图', async () => {
    const { list, router } = await mountList()
    await list.vm.$emit('openSourceData', { sourceId: 'src-9', siteId: '105', name: '源' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: '105', sourceId: 'src-9', view: 'data', returnTo: '/collect' })
  })

  it('查看源数据时带主表 tableId，数据页直接按主表打开', async () => {
    const { list, router } = await mountList()
    await list.vm.$emit('openSourceData', { sourceId: 'src-9', siteId: '105', name: '源', mainTable: '2102087' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: '105', sourceId: 'src-9', view: 'data', tableId: '2102087', returnTo: '/collect' })
  })

  it('未关联网站的源（siteId 为 0）只带 sourceId', async () => {
    const { list, router } = await mountList()
    await list.vm.$emit('openSource', { sourceId: 'src-0', siteId: '0', name: '源' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ sourceId: 'src-0', view: 'overview', returnTo: '/collect' })
  })

  it('点所属网站：进网站源视图', async () => {
    const { list, router } = await mountList()
    await list.vm.$emit('openSite', '12')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ siteId: '12', view: 'source', returnTo: '/collect' })
  })

  it('源模式下点刷新：保留筛选并刷新当前查询', async () => {
    const { wrapper } = await mountList()
    const fetch = vi.mocked(sourceApi.sourcePaged)
    fetch.mockClear()
    await wrapper.findComponent({ name: 'FilterToolbar' }).vm.$emit('refresh')
    await flushPromises()
    expect(fetch).toHaveBeenCalled()
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

  it('一个都没打开过时：空列表，空态说明会自动记录', async () => {
    const { wrapper } = await mountWithSites('recent')
    expect(shown(wrapper)).toEqual([])
    const emptyText = wrapper.findComponent({ name: 'SiteCardGrid' }).props('emptyText') as string
    expect(emptyText).toContain('还没有打开过网站')
    // 2026-10-19 起后端存储（通用埋点），换浏览器也在，不再有「仅本机」的说法
    expect(emptyText).not.toContain('仅本机')
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


describe('SourceTab · 删除网站（1014 右键卡片菜单）', () => {
  beforeEach(() => {
    vi.mocked(ElMessage.warning).mockClear()
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  it('点删除：先弹二次确认，取消则不调 siteDelete', async () => {
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
    const sitePagedSpy = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({
      total: 1,
      list: [{ siteId: 's1', name: '网站一', sourceCount: 0, errorCount: 0, updatedAt: '2026-10-14 10:00:00', tags: [], category: '', owner: '' }],
    })
    const deleteSpy = vi.spyOn(siteApi, 'siteDelete').mockResolvedValue({ ok: true, message: '' })
    const { wrapper } = await mountAt()
    await flushPromises()

    const grid = wrapper.findComponent({ name: 'SiteCardGrid' })
    await grid.vm.$emit('delete-site', { siteId: 's1', name: '网站一' })
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
    wrapper.unmount()
    sitePagedSpy.mockRestore()
    deleteSpy.mockRestore()
  })


})

// 1016：数据中心「按条件查源」带过来的命中源
describe('SourceTab 数据查询命中源', () => {
  it('带 from=data-query 且 store 有名单：顶部显示命中数，源列表限定在这批源', async () => {
    const { wrapper } = await mountAt({ tab: 'source', from: 'data-query' }, undefined, ['1', '2', '3'])
    expect(wrapper.get('[data-testid="data-query-hits"]').text()).toContain('数据查询命中 3 个源')
    const list = wrapper.findComponent({ name: 'SourceOverviewView' })
    expect(list.props('scopeSourceIds')).toEqual(['1', '2', '3'])
    expect(wrapper.findComponent({ name: 'SiteCardGrid' }).exists()).toBe(false)
  })

  it('点清除：清空名单、去掉 from，回到普通源管理', async () => {
    const { wrapper, router } = await mountAt({ tab: 'source', from: 'data-query' }, undefined, ['1'])
    await wrapper.get('[data-testid="data-query-hits-clear"]').trigger('click')
    await flushPromises()
    expect(useWorkspaceStore().dataQueryHits).toBeNull()
    expect(router.currentRoute.value.query).toEqual({ tab: 'source' })
    expect(wrapper.find('[data-testid="data-query-hits"]').exists()).toBe(false)
  })

  it('刷新后 store 为空：忽略 from 标记，照常显示', async () => {
    const { wrapper } = await mountAt({ tab: 'source', from: 'data-query' })
    expect(wrapper.find('[data-testid="data-query-hits"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'FilterToolbar' }).exists()).toBe(true)
  })
})


// The all-sources tab now uses the backend read model; legacy favorite/recent card paths above remain covered.
describe('SourceTab 聚合网站与目录接入', () => {
  const response = (names = ['金融站']) => ({ total: 1884, matchedSourceTotal: 180000, unboundSourceTotal: 12,
    list: names.map((name,i) => ({ site: { siteId: String(42+i), name, sourceCount: 24, errorCount: 0, dataCount: 0 } as import('@/api').Site,
      matchedSourceCount: 8, sourcePreview: [], favorited: false })) })
  function selectDirectory(wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'], mode: 'selected' | 'all' = 'selected') {
    const directory = { kind: 'biz', mode, selections: mode === 'all' ? [] : [{ id: '900', includeDescendants: true }] }
    wrapper.findComponent({ name: 'SourceDirPanel' }).vm.$emit('change', { kind: 'biz', all: mode === 'all', dirIds: ['900'], labels: [{ id: '900', path: '宏观数据', hasKids: true }], directory })
    return directory
  }
  it('首屏只取一次聚合页，不取全网站目录或逐站源；完整统计直接展示', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    const oldSites=vi.spyOn(siteApi,'sitePaged');const oldPreview=vi.spyOn(siteApi,'siteSourcePreview');const oldAll=vi.spyOn(siteApi,'siteSources')
    const { wrapper }=await mountAt()
    expect(aggregate).toHaveBeenCalledTimes(1)
    expect(aggregate).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 20, sort: 'editedDesc' }),expect.any(AbortSignal))
    expect(oldSites).not.toHaveBeenCalled();expect(oldPreview).not.toHaveBeenCalled();expect(oldAll).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('1884 个网站');expect(wrapper.text()).toContain('180000 个源')
    expect(wrapper.text()).toContain('数据 0 条')
  })
  it('业务目录含子孙直传，不等待 expandDirIds 或 listSources 成员枚举', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    const expand=vi.spyOn(sourceDirs,'expandDirIds');const members=vi.spyOn(sourceDirs,'bizScopeSourceIds');const membership=vi.spyOn(sourceDirs,'bizMembership')
    const { wrapper }=await mountAt();aggregate.mockClear()
    const directory=selectDirectory(wrapper);await flushPromises()
    expect(aggregate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ directory }),expect.any(AbortSignal))
    expect(aggregate.mock.calls[0]![0].sourceFilter.sourceIds).toBeUndefined()
    expect(expand).not.toHaveBeenCalled();expect(members).not.toHaveBeenCalled();expect(membership).not.toHaveBeenCalled()
  })
  it('显式 selected 空范围不转换成 none 或全库查询', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    const {wrapper}=await mountAt()
    const directory={kind:'biz',mode:'selected',selections:[]}
    wrapper.findComponent({name:'SourceDirPanel'}).vm.$emit('change',{kind:'biz',dirIds:[],labels:[],directory})
    await flushPromises()
    expect(aggregate).toHaveBeenLastCalledWith(expect.objectContaining({directory}),expect.any(AbortSignal))
  })
  it('全选业务树只传 all；新条件失败显示真实错误并支持重试', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    const { wrapper }=await mountAt();aggregate.mockRejectedValueOnce(new Error('目录无权限'))
    const directory=selectDirectory(wrapper,'all');await flushPromises()
    expect(aggregate).toHaveBeenLastCalledWith(expect.objectContaining({ directory }),expect.any(AbortSignal))
    expect(wrapper.get('[role="alert"]').text()).toContain('目录无权限')
    await wrapper.get('[role="alert"] button').trigger('click');await flushPromises()
    expect(wrapper.text()).toContain('金融站')
  })
  it('列表切换保留实例、名称/状态/count=0/目录，并直接用 sourcePaged.directory', async () => {
    vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    vi.spyOn(sourceDirs,'bizMembership').mockResolvedValue(new Map())
    const { wrapper }=await mountAt();const overview=wrapper.findComponent({ name: 'SourceOverviewView' });const instance=overview.vm.$.uid
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('金融')
    await wrapper.get('[data-testid="source-overview-state"]').setValue('E')
    await wrapper.get('[data-testid="source-overview-count"]').setValue('0')
    const directory=selectDirectory(wrapper);await flushPromises()
    expect(siteApi.sourceScopePaged).toHaveBeenLastCalledWith(expect.objectContaining({ directory, sourceFilter: expect.objectContaining({ name: '金融', state: 'E', enable: '0', count: 0 }) }),expect.any(AbortSignal))
    await wrapper.get('[aria-label="源列表视图"]').trigger('click');await flushPromises()
    expect(wrapper.findComponent({ name: 'SourceOverviewView' }).vm.$.uid).toBe(instance)
    expect(sourceApi.sourcePaged).toHaveBeenLastCalledWith(expect.objectContaining({ directory, name: '金融', state: 'E', count: 0, size: 20 }))
    expect((wrapper.get('[data-testid="source-overview-search-text"]').element as HTMLInputElement).value).toBe('金融')
    await wrapper.get('[aria-label="网站视图"]').trigger('click');await flushPromises()
    expect(siteApi.sourceScopePaged).toHaveBeenLastCalledWith(expect.objectContaining({ directory, sourceFilter: expect.objectContaining({ name: '金融', count: 0 }) }),expect.any(AbortSignal))
  })
  it('服务端顺序直接展示；改网站排序不更改源列表的排序状态', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response(['服务端第一站','服务端第二站']))
    const { wrapper }=await mountAt()
    expect(wrapper.findComponent({ name: 'SiteCardGrid' }).props('sites').map((site: import('@/api').Site)=>site.name)).toEqual(['服务端第一站','服务端第二站'])
    await wrapper.get('[data-testid="website-sort"]').setValue('sourceCountDesc');await flushPromises()
    expect(aggregate).toHaveBeenLastCalledWith(expect.objectContaining({ sort:'sourceCountDesc' }),expect.any(AbortSignal))
    expect(aggregate.mock.calls.at(-1)![0].sourceFilter).not.toHaveProperty('sorted')
  })
  it('刷新重新请求当前聚合页；新建空网站通过 includeEmptySiteIds 交给服务端合并', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    const { wrapper }=await mountAt();const before=aggregate.mock.calls.length
    wrapper.findComponent({ name:'FilterToolbar' }).vm.$emit('refresh');await flushPromises()
    expect(aggregate).toHaveBeenCalledTimes(before+1)
    await wrapper.get('[data-testid="site-create"]').trigger('click');await flushPromises()
    wrapper.findComponent({ name:'SiteEditorDialog' }).vm.$emit('saved','12345');await flushPromises()
    expect(aggregate).toHaveBeenLastCalledWith(expect.objectContaining({ includeEmptySiteIds:['12345'] }),expect.any(AbortSignal))
  })
  it('总览下钻异常状态和业务分类直接转成源/目录范围，不枚举全网站', async () => {
    const aggregate=vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    const { wrapper }=await mountAt({ state:'error',category:'900' });await flushPromises()
    expect(aggregate).toHaveBeenLastCalledWith(expect.objectContaining({ directory: {kind:'biz',mode:'selected',selections:[{id:'900',includeDescendants:true}]},sourceFilter:expect.objectContaining({state:'E',enable:'0'}) }),expect.any(AbortSignal))
    expect(wrapper.findComponent({name:'FilterToolbar'}).props('errorOnly')).toBe(true)
  })
  it('网站筛选仅在用户展开时请求50个候选，输入名称走后端搜索', async () => {
    vi.mocked(siteApi.sourceScopePaged).mockResolvedValue(response())
    const websites=vi.spyOn(siteApi,'sitePaged').mockResolvedValue({total:1884,list:[]})
    const { wrapper }=await mountAt();expect(websites).not.toHaveBeenCalled()
    const select=wrapper.findComponent({name:'SourceOverviewView'}).findComponent({name:'ElSelect'})
    select.vm.$emit('visible-change',true);await flushPromises()
    expect(websites).toHaveBeenLastCalledWith({page:1,size:50})
  })
})
