// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import DataQueryTab from './DataQueryTab.vue'
import DataTableSidebar from './DataTableSidebar.vue'
import DataImportDialog from './DataImportDialog.vue'
import { useAuthStore } from '../../stores/auth'
import { useWorkspaceStore } from '../../stores/workspace'
import { useSourceGroupsStore } from '@/stores/sourceGroups'
import type { UserInfo } from '@/api/auth'
import { dataApi, sourceApi, entryApi, favoriteApi, logReportApi, type DataTableMeta, type DataRow, type EntryTypeGroup } from '../../api'
import { downloadCsv } from '@/utils/format/csvExport'

// 当前页 CSV 导出会触发浏览器下载，jsdom 里换成桩，只断言传给它的文件名和内容
vi.mock('@/utils/format/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/format/csvExport')>()),
  downloadCsv: vi.fn(),
}))

// 数据表页_UI重写设计_2026-07-30：检索区/工具条/批量条/动态列表格/数据详情（抽屉 + ENTRY_ID 弹窗）
describe('数据中心 · 数据查询 tab', () => {
  let wrapper: VueWrapper

  const GROUP: EntryTypeGroup = {
    list1: [
      { tableId: 't1', tableName: 'sense_data.TB_STOCK_NOTICE', name: '公告表', fields: [] },
      { tableId: 't2', tableName: 'sense_data.TB_ZFB_COMMENT', name: '评论表', fields: [] },
    ],
    list2: [],
    list3: [],
  }
  const META: DataTableMeta = {
    tableId: 't1',
    tableName: 'sense_data.TB_STOCK_NOTICE',
    rowCount: 100,
    state: 'C',
    fields: [
      { prop: 'title', desc: '标题', columnName: 'K1', required: true, type: 'string' },
      { prop: 'pub_date', desc: '发布日期', columnName: 'K2', required: true, type: 'string' },
    ],
  }
  const ROW: DataRow = {
    dataId: '88231', sourceId: '600519', state: 'C', k0: 'json-771', detailId: 'd-99',
    values: { K1: '关于利润分配的公告', K2: '2026-07-18' },
    title: '关于利润分配的公告', summary: '', acceptState: 'accepted',
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(favoriteApi, 'listIds').mockResolvedValue([])
    vi.spyOn(logReportApi, 'recentRaw').mockResolvedValue({ success: true, code: '0', msg: '', data: [] })
    vi.spyOn(logReportApi, 'report').mockResolvedValue({ success: true, code: '0', msg: '', data: {} })
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(GROUP)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(META)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['600519', 'src-9'])
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2,
      list: [
        { sourceId: '600519', name: '贵州茅台', url: '', configId: 'c1', mainTable: 't1', owner: 'ops', state: 'C' },
        { sourceId: 'src-9', name: '更多源示例', url: '', configId: 'c1', mainTable: 't1', owner: 'dev', state: 'C' },
      ],
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = '' // 清理 el-dropdown/el-message/el-drawer 传送到 body 的残留节点
  })

  async function mountPage(query: Record<string, string> = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/data', component: { template: '<div />' } },
        { path: '/collect', component: { template: '<div />' } },
      ],
    })
    await router.push({ path: '/data', query })
    await router.isReady()
    wrapper = mount(DataQueryTab, { global: { plugins: [ElementPlus, router] } })
    return wrapper
  }

  async function waitForLoad() {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 500))
    await flushPromises()
  }

  async function openResultMenu(testId: 'data-delete' | 'data-add' | 'data-export-menu') {
    await wrapper.get(`[data-testid="${testId}"]`).trigger('click')
    await flushPromises()
    return new DOMWrapper(document.body)
  }
  function sidebar() { return wrapper.findComponent(DataTableSidebar) }
  async function chooseTable(id: string) {
    const table = sidebar().props('tables').find(table => table.tableId === id)!
    sidebar().vm.$emit('select', table)
    await flushPromises()
  }
  async function searchTables(keyword: string) {
    await wrapper.get('input[data-testid="data-table-search"]').setValue(keyword)
    await flushPromises()
  }
  async function clickMenuItem(body: DOMWrapper<HTMLElement>, label: string) {
    await body.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === label)!.trigger('click')
    await flushPromises()
  }

  it('初次加载：entryTypesGroup/tableMeta/rowQueryPaged 依次调用，默认选中 list1 第一个表', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(dataApi.entryTypesGroup).toHaveBeenCalled()
    expect(dataApi.tableMeta).toHaveBeenCalledWith('t1')
    expect(dataApi.rowQueryPaged).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1', page: 1, size: 20 }))
  })
  it('个人分组和默认目录不限制数据中心的全局表与行查询', async () => {
    const auth = useAuthStore()
    auth.info = { id: 20261003 } as UserInfo
    const groups = useSourceGroupsStore()
    const id = groups.saveGroup('全局数据隔离验证')
    groups.assign(['600519'], [id])
    groups.setPreference('personal')
    await mountPage()
    await waitForLoad()
    expect(dataApi.entryTypesGroup).toHaveBeenCalledWith(undefined)
    expect(dataApi.rowQueryPaged).toHaveBeenCalledWith(expect.objectContaining({ sourceId: undefined }))
    groups.deleteGroup(id)
  })

  it('切表后源候选按新表重载，原表不关联的已选源自动清除', async () => {
    vi.spyOn(dataApi, 'tableMeta').mockImplementation(async (id: string) => ({ ...META, tableId: id }))
    const distinctSpy = vi.spyOn(dataApi, 'distinctSource').mockImplementation(async (query) => (
      query.tableId === 't1' ? ['600519'] : ['src-9']
    ))
    const sourceSpy = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1,
      list: [{ sourceId: 'src-9', name: '仅属新表', url: '', configId: 'c1', mainTable: 't2', owner: 'dev', state: 'C' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    await chooseTable('t2')
    await waitForLoad()

    expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t2')
    expect(distinctSpy).toHaveBeenLastCalledWith({ tableId: 't2', size: 20000 })
    expect(sourceSpy).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: ['src-9'] }))
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 't2', sourceId: undefined, page: 1 }))
  })

  it('查询：输入数据 ID 点查询，rowQueryPaged 带上 dataId 且页码归 1', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.find('input[placeholder="请输入数据 ID"]').setValue('88231')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ dataId: '88231', page: 1 }))
  })

  it('高级筛选默认收起，展开后显示高级条件', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.find('[data-testid="data-query-filters"]').exists()).toBe(false)
    await wrapper.find('button[aria-controls="data-query-advanced"]').trigger('click')
    expect(wrapper.find('[data-testid="data-query-filters"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="后续标识（如 -1）"]').exists()).toBe(true)
  })

  async function chooseQuickQuery(label: string) {
    await wrapper.get('[data-testid="data-quick"]').trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === label)
    if (!item) throw new Error(`未找到快捷查询：${label}`)
    await item.trigger('click')
    await flushPromises()
  }

  it('快捷查询收敛为项目统一的按钮下拉，选择今日新增只提交对应条件且不清空当前源', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    await chooseQuickQuery('日新增')

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({
      sourceId: '600519',
      sql: 'CREATE_DT > CURDATE()',
    }))
  })

  it('快捷查询：选择所有源会清空当前源过滤并重新查询', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    await chooseQuickQuery('所有源')
    await waitForLoad()

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 't1', sourceId: undefined }))
  })

  it.each([
    ['日新增（所有源）', 'CREATE_DT > CURDATE()'],
    ['日更新（所有源）', 'UPDATE_DT > CURDATE()'],
  ])('快捷查询：%s 清空源范围并只提交一次对应 SQL', async (label, sql) => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    const queryCallsBefore = (dataApi.rowQueryPaged as ReturnType<typeof vi.fn>).mock.calls.length
    await chooseQuickQuery(label)
    await waitForLoad()

    expect(dataApi.rowQueryPaged).toHaveBeenCalledTimes(queryCallsBefore + 1)
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({
      tableId: 't1',
      sourceId: undefined,
      sql,
    }))
  })

  it('展示SQL：切换后本地拼接展示，不发请求', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const before = (dataApi.rowQueryPaged as ReturnType<typeof vi.fn>).mock.calls.length
    await wrapper.get('[data-testid="data-sql"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('select * from sense_data.TB_STOCK_NOTICE')
    expect((dataApi.rowQueryPaged as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })

  it('1021-05：数据查询页去掉「开始时间 / 结束时间」，查询和展示 SQL 都不再带 CREATE_DT 区间', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.find('.dqp-time-range').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="开始时间"]').exists()).toBe(false)
    expect(wrapper.find('input[placeholder="结束时间"]').exists()).toBe(false)
    const query = (dataApi.rowQueryPaged as ReturnType<typeof vi.fn>).mock.lastCall![0]
    expect(query.startTime).toBeUndefined()
    expect(query.endTime).toBeUndefined()

    await wrapper.get('[data-testid="data-sql"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('CREATE_DT >=')
  })

  it('导出：调用 dataApi.exportUrl 拼好的 URL 新窗口打开，不经过 rowQueryPaged', async () => {
    const exportSpy = vi.spyOn(dataApi, 'exportUrl').mockReturnValue('/api/v1/entry/entryExportAll?entryType=t1')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    // 0930-14D：导出 Excel 是一级按钮，点了直接下载，不再经过下拉
    await wrapper.get('[data-testid="data-export"]').trigger('click')

    expect(exportSpy).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1' }))
    expect(openSpy).toHaveBeenCalledWith('/api/v1/entry/entryExportAll?entryType=t1', '_blank')
  })

  it('统计、SQL、步骤平铺，清除父表标识只在选中数据后显示', async () => {
    useAuthStore().roles = ['admin']
    await mountPage()
    await waitForLoad()
    for (const id of ['data-summary', 'data-sql', 'data-steps', 'data-back-trace']) {
      expect(wrapper.find(`[data-testid="${id}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-testid="data-more"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-clear-parent"]').exists()).toBe(false)
  })
  it('批量清除父表标识保留确认与源范围；未选源时禁用', async () => {
    useAuthStore().roles = ['admin']
    const clear = vi.spyOn(dataApi, 'clearParent').mockResolvedValue({ message: '设置成功' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
    await mountPage({ sourceId: '600519' })
    await waitForLoad()
    await wrapper.get('tbody input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-testid="data-clear-parent"]').trigger('click')
    await flushPromises()
    expect(clear).not.toHaveBeenCalled()
    confirm.mockResolvedValueOnce('confirm' as never)
    await wrapper.get('[data-testid="data-clear-parent"]').trigger('click')
    await flushPromises()
    expect(clear).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1', sourceId: '600519' }), ['88231'])
    wrapper.unmount()
    await mountPage()
    await waitForLoad()
    await wrapper.get('tbody input[type="checkbox"]').setValue(true)
    expect(wrapper.get('[data-testid="data-clear-parent"]').attributes('disabled')).toBeDefined()
  })
  // 0904 I01/I02（Z1）：反查源从「弹窗中转」改成「一键直达源视图」。
  // 会上原话「那你还不如把这个东西直接放到那个源列表」「你直接反向你不是直接跑两步？」
  it('反查源入口在工具栏上，不在「更多」下拉里', async () => {
    const w = await mountPage()
    await waitForLoad()
    const btn = w.find('[data-testid="data-back-trace"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain('查源')
  })


  // 1016：原来跳 `/canvas?sourceIds=` 会被画布路由守卫弹回 /collect，命中源整个丢了；改成走 store 落到源管理
  it('按条件查源：命中源写进 store，跳源管理并带 from=data-query', async () => {
    await mountPage()
    await waitForLoad()
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ CNT: 3, SOURCE_ID: '600519' }, { CNT: 1, SOURCE_ID: 'src-9' }] as never)
    wrapper.findComponent({ name: 'DataQueryPanel' }).vm.$emit('query-change', { page: 1, size: 20, state: 'C' })
    await flushPromises()
    await wrapper.get('[data-testid="data-back-trace"]').trigger('click')
    await waitForLoad()
    expect(useWorkspaceStore().dataQueryHits).toEqual(['600519', 'src-9'])
    const route = (wrapper.vm as unknown as { $route: { path: string; query: Record<string, string> } }).$route
    expect(route.path).toBe('/collect')
    expect(route.query).toEqual({ tab: 'source', from: 'data-query' })
  })

  it('按条件查源：只选了源、没填条件时带上这个源，不发反查请求', async () => {
    await mountPage({ sourceId: '600519' })
    await waitForLoad()
    vi.mocked(dataApi.distinctSource).mockClear()
    await wrapper.get('[data-testid="data-back-trace"]').trigger('click')
    await waitForLoad()
    expect(dataApi.distinctSource).not.toHaveBeenCalled()
    expect(useWorkspaceStore().dataQueryHits).toEqual(['600519'])
    const route = (wrapper.vm as unknown as { $route: { query: Record<string, string> } }).$route
    expect(route.query.from).toBe('data-query')
  })

  // 2026-10-19：没选源也没条件 = 这张表的所有源，不是全平台全部源（原来落到全部源，表信息丢了）
  it('按条件查源：没选源也没条件时按当前表反查，带这张表的源跳源管理', async () => {
    await mountPage()
    await waitForLoad()
    useWorkspaceStore().setDataQueryHits(['old'])
    vi.mocked(dataApi.distinctSource).mockClear()
    vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ CNT: 5, SOURCE_ID: '600519' }, { CNT: 2, SOURCE_ID: 'src-9' }] as never)
    await wrapper.get('[data-testid="data-back-trace"]').trigger('click')
    await waitForLoad()
    expect(dataApi.distinctSource).toHaveBeenCalled()
    expect(useWorkspaceStore().dataQueryHits).toEqual(['600519', 'src-9'])
    const route = (wrapper.vm as unknown as { $route: { path: string; query: Record<string, string> } }).$route
    expect(route.path).toBe('/collect')
    expect(route.query).toEqual({ tab: 'source', from: 'data-query' })
  })

  it('工具条按新增、导入、导出、更多与删除收敛，不显示夸张的危险操作按钮', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.find('[data-testid="data-delete"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-add"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-danger"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-tools"]').exists()).toBe(false)

    expect(wrapper.get('[data-testid="data-export"]').text()).toBe('导出 Excel')
    // 1008-07：取数 API 从「更多」挪进「导出 ▾」，和当前页 CSV 一起
    const exportMenu = await openResultMenu('data-export-menu')
    expect(exportMenu.text()).toContain('导出当前页 CSV')
    expect(exportMenu.text()).toContain('取数 API')
    expect(exportMenu.text()).not.toContain('导出当前源 Excel')
    document.body.innerHTML = ''

    wrapper.unmount()
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({ ...META, state: 'AC' })
    await mountPage()
    await waitForLoad()
    expect(wrapper.find('[data-testid="data-delete"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-add"]').exists()).toBe(true)
  })

  it('工作区分层：表导航独立，结果操作换行，保留按表 / 按步骤切换', async () => {
    useAuthStore().roles = ['admin']
    await mountPage()
    await waitForLoad()
    const row = wrapper.get('[data-testid="data-query-primary"]')
    expect(row.classes()).not.toContain('is-one-row')
    const toolbar = wrapper.get('[data-testid="data-result-toolbar"]')
    for (const id of ['data-refresh', 'data-add', 'data-export', 'data-export-menu', 'data-summary', 'data-sql', 'data-steps', 'data-fullscreen-toggle', 'column-picker-btn']) {
      expect(toolbar.find(`[data-testid="${id}"]`).exists(), id).toBe(true)
      expect(row.find(`[data-testid="${id}"]`).exists(), id).toBe(false)
    }
    expect(sidebar().exists()).toBe(true)
    expect(wrapper.findAll('.browse-mode-toggle button')).toHaveLength(2)
  })

  it('新增 ▾：手工录入打开新增抽屉，Excel 导入打开导入弹窗；非管理员没有新增入口', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const body = await openResultMenu('data-add')
    expect(body.text()).toContain('手工录入')
    expect(body.text()).toContain('Excel 导入')
    await clickMenuItem(body, 'Excel 导入')
    expect(wrapper.findComponent(DataImportDialog).props('modelValue')).toBe(true)
    document.body.innerHTML = ''

    wrapper.unmount()
    auth.roles = ['read']
    await mountPage()
    await waitForLoad()
    expect(wrapper.find('[data-testid="data-add"]').exists()).toBe(false)
  })

  it('导出 ▾ → 导出当前页 CSV：按已查出的当前页生成文件，没有结果时置灰', async () => {
    const csvSpy = vi.mocked(downloadCsv)
    csvSpy.mockClear()
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const body = await openResultMenu('data-export-menu')
    await clickMenuItem(body, '导出当前页 CSV')
    expect(csvSpy).toHaveBeenCalledTimes(1)
    const [filename, csv] = csvSpy.mock.calls[0]!
    expect(filename).toBe('sense_data.TB_STOCK_NOTICE_第1页.csv')
    expect(csv).toContain('88231')
    expect(csv).toContain('关于利润分配的公告')
    document.body.innerHTML = ''

    // 没有查出数据时这一项置灰
    wrapper.unmount()
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 0, list: [] })
    await mountPage()
    await waitForLoad()
    const emptyBody = await openResultMenu('data-export-menu')
    const pageItem = emptyBody.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '导出当前页 CSV')!
    expect(pageItem.classes()).toContain('is-disabled')
    document.body.innerHTML = ''
  })

  it('全屏：点按钮铺满视口，再点或按 Esc 退出', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const page = wrapper.get('.dv-page')
    expect(page.classes()).not.toContain('is-fullscreen')
    await wrapper.get('[data-testid="data-fullscreen-toggle"]').trigger('click')
    expect(page.classes()).toContain('is-fullscreen')
    expect(wrapper.get('[data-testid="data-fullscreen-toggle"]').text()).toBe('退出全屏')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(page.classes()).not.toContain('is-fullscreen')
    await wrapper.get('[data-testid="data-fullscreen-toggle"]').trigger('click')
    await wrapper.get('[data-testid="data-fullscreen-toggle"]').trigger('click')
    expect(page.classes()).not.toContain('is-fullscreen')
  })

  describe('按步骤查看（对齐源数据视图的「按步骤查看」）', () => {
    const SOURCE = { sourceId: '600519', name: '贵州茅台', url: 'https://example.com', configId: 'c1', mainTable: 't1', owner: 'ops', state: 'C' }
    /** 列表抓取 → t1（没有输入）；评论解析 t1 → t2（输入 ≠ 输出，可切换） */
    function mockFlow() {
      vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
      vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
        { stepId: 's1', sourceId: '600519', name: '列表抓取', outputTable: 't1', enabled: true },
        { stepId: 's2', sourceId: '600519', name: '评论解析', inputTable: 't1', outputTable: 't2', enabled: true },
      ])
    }
    const toStep = async () => {
      await wrapper.findAll('.browse-mode-toggle button')[1]!.trigger('click')
      await waitForLoad()
    }
    const picker = () => wrapper.get('[data-testid="rail-node-select"]')
    const pick = async (value: string) => {
      await picker().setValue(value)
      await waitForLoad()
    }
    const scopeText = () => wrapper.get('[data-testid="data-step-scope"]').text().replace(/\s+/g, '')

    it('没选源：不出节点下拉，数据表下拉也换掉，提示先选源，不请求步骤', async () => {
      mockFlow()
      const auth = useAuthStore()
      auth.roles = ['admin']
      await mountPage()
      await waitForLoad()
      await toStep()

      expect(wrapper.find('[data-testid="data-step-need-source"]').text()).toBe('先选择源')
      expect(wrapper.find('[data-testid="rail-node-select"]').exists()).toBe(false)
      expect(sidebar().exists()).toBe(true)
      expect(sourceApi.sourceSteps).not.toHaveBeenCalled()
    })

    it('选了源：RailNodePicker 列出节点，当前表对应的节点已选中；只有输出表时只显示「输出」', async () => {
      mockFlow()
      const auth = useAuthStore()
      auth.roles = ['admin']
      await mountPage({ sourceId: '600519' })
      await waitForLoad()
      await toStep()

      expect(sourceApi.sourceSteps).toHaveBeenCalledWith('600519')
      expect(picker().findAll('option').map((o) => o.text())).toEqual(['列表抓取', '评论解析'])
      expect((picker().element as HTMLSelectElement).value).toBe('s1')
      expect(scopeText()).toBe('输出t1')
      expect(wrapper.find('[data-testid="data-scope-input"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="data-rail-toggle"]').exists()).toBe(true)
    })

    it('选节点切到它的输出表；输入 / 输出不同时可切换，再切回；源不被清掉', async () => {
      mockFlow()
      // 新表的源清单里没有当前源（大表清单取数有上限）：按表看会清源，按步骤看必须保留
      vi.spyOn(dataApi, 'distinctSource').mockImplementation(async (query) => (query.tableId === 't2' ? ['other-src'] : ['600519']))
      const auth = useAuthStore()
      auth.roles = ['admin']
      await mountPage({ sourceId: '600519' })
      await waitForLoad()
      await toStep()

      await pick('s2')
      expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t2')
      expect(scopeText()).toBe('输入t1·输出t2')
      expect(wrapper.get('[data-testid="data-scope-output"]').classes()).toContain('active')
      expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 't2', sourceId: '600519' }))

      await wrapper.get('[data-testid="data-scope-input"]').trigger('click')
      await waitForLoad()
      expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t1')
      expect(wrapper.get('[data-testid="data-scope-input"]').classes()).toContain('active')
      expect((picker().element as HTMLSelectElement).value).toBe('s2')

      await wrapper.get('[data-testid="data-scope-output"]').trigger('click')
      await waitForLoad()
      expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t2')
      expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 't2', sourceId: '600519' }))
    })

    it('1021-05 上层数据：看节点输出表且输入表不同时显示「来自 表名 #ID」，点了切到输入表并按 ID 查', async () => {
      mockFlow()
      vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [{ ...ROW, parentId: '5501' }] })
      const auth = useAuthStore()
      auth.roles = ['admin']
      await mountPage({ sourceId: '600519' })
      await waitForLoad()
      await toStep()
      await pick('s2')

      const link = wrapper.get('[data-testid="upper-data-link"]')
      expect(link.text()).toBe('来自 公告表 #5501')
      await link.trigger('click')
      await waitForLoad()
      expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t1')
      expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 't1', dataId: '5501', sourceId: '600519' }))
      expect(wrapper.get('[data-testid="data-scope-input"]').classes()).toContain('active')
    })

    it('输入表等于输出表合并成「输入·输出」；流程图按钮打开「展示处理步骤」抽屉；切回按表后数据表下拉回来', async () => {
      vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
      vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
        { stepId: 's1', sourceId: '600519', name: '同表处理', inputTable: 't1', outputTable: 't1', enabled: true },
      ])
      const auth = useAuthStore()
      auth.roles = ['admin']
      await mountPage({ sourceId: '600519' })
      await waitForLoad()
      await toStep()

      expect(wrapper.find('[data-testid="data-scope-merged"]').text().replace(/\s+/g, '')).toBe('输入·输出t1')
      expect(wrapper.find('[data-testid="data-scope-input"]').exists()).toBe(false)

      await wrapper.get('[data-testid="data-rail-toggle"]').trigger('click')
      await flushPromises()
      expect(wrapper.findComponent({ name: 'StepDrawer' }).props('modelValue')).toBe(true)

      await wrapper.findAll('.browse-mode-toggle button')[0]!.trigger('click')
      await flushPromises()
      expect(sidebar().exists()).toBe(true)
      expect(wrapper.find('[data-testid="rail-node-select"]').exists()).toBe(false)
    })
  })

  it('删除数据：分为按行删除和表操作，按源清理移出数据中心', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const body = await openResultMenu('data-delete')
    expect(body.text()).not.toContain('删除该源-当日数据')
    expect(body.text()).toContain('按行删除')
    expect(body.text()).not.toContain('删除该源-所有数据')
    expect(body.text()).toContain('填入 IDs-删除')
    expect(body.text()).toContain('设为正式表')
    expect(body.text()).toContain('清空表数据【当日】')
    expect(body.text()).toContain('清空表数据【全量】')
    expect(body.text()).not.toContain('重新处理后续步骤')
  })

  // 2026-10-09：数据同步服务在 133，只有连 133 的环境（2807）才显示「同步到其他环境」；
  // 连 217（2806）时带过去的表在同步服务的库里可能不存在，同名表搬的也是 133 的数据
  it('「同步到其他环境」只在连同步服务所在环境（133）时显示', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    await mountPage()
    await waitForLoad()
    expect(wrapper.find('[data-testid="data-sync"]').exists()).toBe(false)
    wrapper.unmount()

    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://115.227.21.133:9999')
    await mountPage()
    await waitForLoad()
    expect(wrapper.find('[data-testid="data-sync"]').exists()).toBe(true)
    vi.unstubAllEnvs()
  })

  it('取数 API 在「导出 ▾」、清除父表标识在批量条（0930-14D；1008-07 取数 API 挪到导出）', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    const apiMenu = await openResultMenu('data-export-menu')
    const apiItem = apiMenu.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '取数 API')!
    await apiItem.trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 500))
    await flushPromises()
    await wrapper.vm.$nextTick()
    // 取数 API 弹窗改为公共组件 DataFetchApiDialog（append-to-body），内容挂在 document.body 上
    expect(document.body.querySelector('[data-testid="data-api-dialog"]')).not.toBeNull()
    const apiText = document.body.textContent ?? ''
    expect(apiText).toContain('取数 API')
    expect(apiText).toContain('ID 分批取数')
    expect(apiText).toContain('startId')
    expect(apiText).toContain('endId')
    expect(apiText).toContain('appId')
    expect(apiText).toContain('sourceId')
    expect(apiText).toContain('data.list[].title')
    expect(apiText).toContain('data.list[].id')
    expect(apiText).toContain('返回字段')
    expect(apiText).toContain('appId=dev&appKey=dev1&type=t1&sourceId=600519&startId=0&size=10')
    // 1021-05：开始 / 结束时间去掉后，取数 API 说明里也不再有 dataRange
    expect(apiText).not.toContain('dataRange')
    const closeApiButton = [...document.body.querySelectorAll('button')].find((el) => el.textContent?.trim() === '关闭')
    expect(closeApiButton).toBeDefined()
    closeApiButton!.click()
    await flushPromises()

    await wrapper.get('tbody input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(wrapper.get('[data-testid="data-clear-parent"]').attributes('disabled')).toBeUndefined()
  })

  it('导入数据：管理员可打开旧接口字段口径的导入弹窗', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    const body = await openResultMenu('data-add')
    await clickMenuItem(body, 'Excel 导入')

    expect(wrapper.findComponent(DataImportDialog).props('modelValue')).toBe(true)
    document.body.innerHTML = ''
  })

  it('结果表展示 STATE 状态列', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.text()).toContain('状态')
    // 1021-05：状态码走中文字典，C 在数据表里是「初始」，悬浮说明保留原码
    const tag = wrapper.get('[data-testid="data-state"]')
    expect(tag.text()).toBe('初始')
    expect(tag.attributes('title')).toContain('（C）')
  })

  it('1021-05 父ID：列名保持「父ID」，-1 / -2 显示「—」，按表看只显示上层 ID；原始值在详情抽屉技术字段里', async () => {
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 3,
      list: [
        { ...ROW, dataId: 'r1', parentId: '-1' },
        { ...ROW, dataId: 'r2', parentId: '-2' },
        { ...ROW, dataId: 'r3', parentId: '5501' },
      ],
    })
    await mountPage()
    await waitForLoad()

    expect(wrapper.text()).toContain('父ID')
    expect(wrapper.findAll('[data-testid="upper-data"]').map((c) => c.text())).toEqual(['—', '—', '5501'])
    expect(wrapper.find('[data-testid="upper-data-link"]').exists()).toBe(false)

    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({ row: { ...ROW, parentId: '-2' }, showItems: [] })
    await wrapper.findAll('.el-table__body tr')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="detail-upper"]').text()).toBe('—')
    expect(wrapper.get('[data-testid="detail-tech-parent-id"]').text()).toBe('-2')
  })

  it('动态列：表头按 {desc}-{columnName} 渲染数据表字段', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.text()).toContain('标题-K1')
    expect(wrapper.text()).toContain('发布日期-K2')
  })

  it('批量条：勾选行后出现"已选择 N 项"，发后续任务调用 dataApi.nextStep；取消选择后批量条消失', async () => {
    const nextStepSpy = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已发送' })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    expect(wrapper.text()).not.toContain('已选择')

    const rowCheckbox = wrapper.findAllComponents({ name: 'ElCheckbox' }).find((c) => c.props('ariaLabel') === '选择 88231')
    await rowCheckbox!.vm.$emit('change', true)
    await flushPromises()

    expect(wrapper.text()).toContain('已选择')
    await wrapper.findAll('button').find((b) => b.text() === '发后续任务')!.trigger('click')
    await flushPromises()
    expect(nextStepSpy).toHaveBeenCalledWith('600519', 't1', ['88231'])
    expect(dataApi.rowQueryPaged).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已选择')

    await wrapper.findAll('.dv-batch .dv-link').find((el) => el.text() === '取消选择')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('已选择')
  })

  it('数据详情抽屉：点一行调 dataApi.rowDetail 并展示 showItems', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: ROW,
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '标题', value: '关于利润分配的公告' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.find('.el-table__body tr').trigger('click')
    await flushPromises()

    expect(dataApi.rowDetail).toHaveBeenCalledWith('t1', '88231')
    expect(wrapper.text()).toContain('标题')
    // 点整行仍走右侧抽屉（不是弹窗）——弹窗只留给 ENTRY_ID 链接
    expect(wrapper.findAll('.el-drawer').some((d) => d.text().includes('复制全部 JSON'))).toBe(true)
  })

  it('点一行开详情：点的是行里自带动作的链接 / 选中了文字时不叠开详情；整张表显示手型', async () => {
    const detailSpy = vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({ row: ROW, showItems: [] })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.get('.dqp-table').classes()).toContain('is-row-clickable')
    // ENTRY_ID 也成了链接（点它开详情弹窗），与源 / 任务这类各有动作的链接并列
    expect(wrapper.findAll('a.dv-a').some((a) => a.text() === '88231')).toBe(true)

    // 点源链接：只开源详情，不开行详情
    await wrapper.findAll('a.dv-a').find((a) => a.text() === '600519')!.trigger('click')
    await flushPromises()
    expect(detailSpy).not.toHaveBeenCalled()

    // 选中了文字（准备复制）：点行不开详情
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '选中的文字' } as Selection)
    await wrapper.find('.el-table__body tr').trigger('click')
    await flushPromises()
    expect(detailSpy).not.toHaveBeenCalled()
    selection.mockRestore()

    await wrapper.find('.el-table__body tr').trigger('click')
    await flushPromises()
    expect(detailSpy).toHaveBeenCalledTimes(1)
  })

  it('ENTRY_ID 列可点开详情弹窗（复刻旧平台 entry-list-view 的 ENTRY_ID 链接）', async () => {
    const detailSpy = vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: ROW,
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '标题', value: '关于利润分配的公告' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const entryLink = wrapper.get('[data-testid="row-open-detail"]')
    expect(entryLink.text()).toBe('88231')

    await entryLink.trigger('click')
    await flushPromises()

    // 只调一次：行点击把 <a> 排除掉了，不会与单元格点击叠成两次请求
    expect(detailSpy).toHaveBeenCalledTimes(1)
    expect(detailSpy).toHaveBeenCalledWith('t1', '88231')

    // 弹窗内容体是 EntryRecordTable：复刻旧平台 RecordDetailComm 的「列 / 值」平铺表——
    // 列名用物理列名（ENTRY_ID / K1…），不是抽屉那份的中文标签分组。
    const dialog = wrapper.findAll('.el-dialog').find((d) => d.find('[data-testid="record-columns-table"]').exists())
    expect(dialog).toBeTruthy()
    const popupText = dialog!.text()
    expect(popupText).toContain('ENTRY_ID')
    expect(popupText).toContain('88231')
    expect(popupText).toContain('K1')
    expect(popupText).toContain('关于利润分配的公告')
    // 两套口径分明：弹窗不带抽屉的工具栏
    expect(popupText).not.toContain('复制全部 JSON')

    // 走居中弹窗而不是抽屉（dialog 模式下抽屉容器 v-if 为假、不挂载）。
    // 不能直接断言「页面上没有 .el-drawer」——SummaryDrawer / StepDrawer / SourceDetailDrawer
    // 也常驻在本页（未打开时靠 v-show 隐藏），按内容判定才不会被它们误伤。
    expect(wrapper.findAll('.el-drawer').some((d) => d.find('[data-testid="record-columns-table"]').exists())).toBe(false)
  })

  it('操作列「详情」按钮开的是右侧抽屉，不是弹窗', async () => {
    const detailSpy = vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({ row: ROW, showItems: [] })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const btn = wrapper.findAllComponents({ name: 'ElButton' }).find((b) => b.text() === '详情')
    await btn!.trigger('click')
    await flushPromises()

    expect(detailSpy).toHaveBeenCalledWith('t1', '88231')
    expect(wrapper.findAll('.el-drawer').some((d) => d.text().includes('复制全部 JSON'))).toBe(true)
    expect(wrapper.findAll('.el-dialog').some((d) => d.text().includes('复制全部 JSON'))).toBe(false)
  })

  // 2026-09-28：数据中心也能预览 OSS 文件路径（TB_KAIPANLA 详情json 这类 .json），与源数据视图同一个预览器
  it('文件路径：表格格子与详情抽屉点开都打开文件预览', async () => {
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({
      ...META,
      fields: [...META.fields, { prop: 'result', desc: '详情json', columnName: 'K3', required: false, type: 'string' }],
    })
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({
      total: 1,
      list: [{ ...ROW, values: { ...ROW.values, K3: '/xtdb/kaipan/2026-09-28/386.json' } }],
    })
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: ROW,
      showItems: [{ itemId: '3', columnName: 'K3', itemName: '详情json', value: '/xtdb/kaipan/2026-09-28/386.json' }],
    })
    await mountPage()
    await waitForLoad()

    await wrapper.get('[data-testid="data-cell-file"]').trigger('click')
    await flushPromises()
    const preview = () => wrapper.findComponent({ name: 'FilePreview' })
    expect(preview().exists()).toBe(true)
    expect(preview().props('path')).toBe('/xtdb/kaipan/2026-09-28/386.json')
    expect(preview().props('ext')).toBe('json')

    await wrapper.find('.el-table__body tr').trigger('click')
    await flushPromises()
    const detailFile = wrapper.find('[data-testid="detail-file"]')
    expect(detailFile.exists()).toBe(true)
    expect(detailFile.text()).toContain('386.json')
  })

  function formInput(label: string) {
    const item = wrapper.findAllComponents({ name: 'ElFormItem' }).find((i) => i.props('label') === label)
    return item!.find('input')
  }

  it('手动添加：填表单提交调 dataApi.rowAdd，null/空字段提交前删除', async () => {
    const addSpy = vi.spyOn(dataApi, 'rowAdd').mockResolvedValue({ message: '新增成功' })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const addMenu = await openResultMenu('data-add')
    await clickMenuItem(addMenu, '手工录入')
    document.body.innerHTML = ''

    await formInput('SOURCE_ID').setValue('600519')
    await formInput('标题(K1)').setValue('测试标题')
    // 发布日期(K2) 留空
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(addSpy).toHaveBeenCalledWith('t1', expect.objectContaining({ SOURCE_ID: '600519', K1: '测试标题' }))
    const [, values] = addSpy.mock.calls[0]
    expect(values).not.toHaveProperty('K2')
  })

  it('手动修改：仅测试表显示"更多"里的手动修改项，先取 rowDetail 反填再提交 rowUpdate', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: ROW,
      showItems: [{ columnName: 'K1', itemName: '标题', value: '关于利润分配的公告' }],
    })
    const updateSpy = vi.spyOn(dataApi, 'rowUpdate').mockResolvedValue({ message: '修改成功' })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const moreBtn = wrapper.findAllComponents({ name: 'ElButton' }).find((b) => b.text().startsWith('更多'))
    await moreBtn!.trigger('click')
    await flushPromises()
    // el-dropdown-menu 传送到 document.body，不在 wrapper 的渲染树内
    const editItem = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '手动修改')
    await editItem!.trigger('click')
    await flushPromises()

    expect(dataApi.rowDetail).toHaveBeenCalledWith('t1', '88231')
    expect((formInput('标题(K1)').element as HTMLInputElement).value).toBe('关于利润分配的公告')

    await formInput('标题(K1)').setValue('改过的标题')
    await wrapper.findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(updateSpy).toHaveBeenCalledWith('t1', '88231', expect.objectContaining({ K1: '改过的标题' }))
  })

  it('read 角色：隐藏批量勾选列和新增入口，保留结果工具条', async () => {
    const auth = useAuthStore()
    auth.roles = ['read']
    await mountPage()
    await waitForLoad()

    expect(wrapper.find('[data-testid="data-add"]').exists()).toBe(false)
    expect(wrapper.find('th .el-checkbox, th input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-refresh"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-export"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-summary"]').exists()).toBe(true)
  })

  it('任务实例：read 角色可查看但重发（危险操作）按钮/勾选列/批量重发对 read 隐藏', async () => {
    vi.spyOn(dataApi, 'taskInstPaged').mockResolvedValue({
      total: 1,
      list: [{ taskId: 'd-99', state: 'C', typeName: '浏览器抓取', taskName: 't', sourceId: '600519', updatedAt: '2026-07-01' }],
    })
    const auth = useAuthStore()
    auth.roles = ['read']
    await mountPage()
    await waitForLoad()

    // read 角色下没有操作列，任务列不受 canWrite 限制，可查看
    const taskLink = wrapper.findAll('a.dv-a').find((a) => a.text() === 'd-99')
    await taskLink!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('任务实例')
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('重发'))).toBe(false)
    expect(wrapper.find('.el-table__header .el-checkbox').exists()).toBe(false)
  })

  it('深链接：?entryType=/?sourceId= 自动带入检索', async () => {
    await mountPage({ entryType: 't9', sourceId: 'src-9' })
    await waitForLoad()

    expect(dataApi.rowQueryPaged).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't9', sourceId: 'src-9' }))
  })

  it('统计：选统计列后调用 summaryData（沿用当前查询条件），展示结果表', async () => {
    const summarySpy = vi.spyOn(dataApi, 'summaryData').mockResolvedValue([{ K2: '2026-07-18', CNT: 3 }])
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.get('[data-testid="data-summary"]').trigger('click')
    await flushPromises()

    const bodyWithDrawer = new DOMWrapper(document.body)
    await new Promise((r) => setTimeout(r, 50))
    await bodyWithDrawer.findAll('.el-select-dropdown__item').find((el) => el.text() === '发布日期(K2)')!.trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    await wrapper.findComponent({ name: 'SummaryDrawer' }).findAll('button').find((b) => b.text() === '统计')!.trigger('click')
    await flushPromises()

    expect(summarySpy).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1' }), ['K2'])
    expect(wrapper.text()).toContain('结果行数:1')
    expect(wrapper.text()).toContain('覆盖数据量:3')
  })

  it('展示步骤：无源ID报错；选源后加载 sourceApi.sourceSteps 并打开步骤抽屉', async () => {
    const stepsSpyNoSource = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.get('[data-testid="data-steps"]').trigger('click')
    await flushPromises()
    expect(stepsSpyNoSource).not.toHaveBeenCalled()

    wrapper.unmount()
    const stepsSpy = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { stepId: 's1', sourceId: '600519', name: '抓取列表', outputTable: 'sense_data.TB_LIST', enabled: true },
    ])
    await mountPage({ sourceId: '600519' })
    await waitForLoad()
    await wrapper.get('[data-testid="data-steps"]').trigger('click')
    await flushPromises()

    expect(stepsSpy).toHaveBeenCalledWith('600519')
    expect(wrapper.text()).toContain('处理步骤')
  })

  it('任务实例：点「任务」列（DETAIL_ID）打开弹窗，按 taskId 查询', async () => {
    const taskSpy = vi.spyOn(dataApi, 'taskInstPaged').mockResolvedValue({
      total: 1,
      list: [{ taskId: 'd-99', state: 'C', typeName: '浏览器抓取', taskName: 't', sourceId: '600519', updatedAt: '2026-07-01' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.findAll('a.dv-a').find((a) => a.text() === 'd-99')!.trigger('click')
    await flushPromises()

    expect(taskSpy).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'd-99', sourceId: '600519', parentId: undefined }))
    expect(wrapper.text()).toContain('任务实例')
  })

  it('任务实例：行内「查后续任务实例」按 parentId=ENTRY_ID 查询', async () => {
    const taskSpy = vi.spyOn(dataApi, 'taskInstPaged').mockResolvedValue({ total: 0, list: [] })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const moreBtn = wrapper.findAllComponents({ name: 'ElButton' }).find((b) => b.text().startsWith('更多'))
    await moreBtn!.trigger('click')
    await flushPromises()
    const item = new DOMWrapper(document.body).findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '查后续任务实例')
    await item!.trigger('click')
    await flushPromises()

    expect(taskSpy).toHaveBeenCalledWith(expect.objectContaining({ parentId: '88231', sourceId: '600519' }))
  })

  it('表结构详情：? 按钮打开右侧详情抽屉，展示已加载的 tableMeta 字段列表，不发新请求', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const before = (dataApi.tableMeta as ReturnType<typeof vi.fn>).mock.calls.length
    await wrapper.findAll('button').find((b) => b.attributes('title') === '表结构详情')!.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('表结构详情')
    expect(document.body.querySelector('.el-drawer')).not.toBeNull()
    expect(wrapper.text()).toContain('标题-K1'.split('-')[1]) // K1 出现在字段表里（列名列）
    expect((dataApi.tableMeta as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })

  it('源详情：无源报错不打开；选源后 ? 按钮调 sourceApi.sourceDetail 展示信息', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.findAll('button').find((b) => b.attributes('title') === '源详情')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('URL')

    wrapper.unmount()
    const detailSpy = vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({
      sourceId: '600519', name: '贵州茅台', url: 'http://x', configId: 'c1', mainTable: 't1', owner: 'dev', state: 'C',
    })
    await mountPage({ sourceId: '600519' })
    await waitForLoad()
    await wrapper.findAll('button').find((b) => b.attributes('title') === '源详情')!.trigger('click')
    await flushPromises()

    expect(detailSpy).toHaveBeenCalledWith('600519')
    expect(wrapper.text()).toContain('贵州茅台')
  })

  it('左侧导航直接搜索并切表，不弹出额外查询窗口', async () => {
    const paged = vi.spyOn(entryApi, 'entryPaged')
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ ...GROUP, main: 't1',
      list3: [{ tableId: 't9', tableName: 'sense_data.TB_MORE', name: '更多表', fields: [] }],
    })
    useAuthStore().roles = ['admin']
    await mountPage()
    await waitForLoad()
    await searchTables('更多表')
    await flushPromises()
    expect(paged).not.toHaveBeenCalled()
    expect(document.querySelector('.dv-picker-dialog')).toBeNull()
    await chooseTable('t9')
    await flushPromises()
    expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t9')
  })

  // 搜索选中的表不在下拉首批 20 条里时，也要保留名称和后续分组回读。
  const OTHER_TABLES = Array.from({ length: 30 }, (_, i) => ({
    tableId: `t${i + 20}`, tableName: `sense_data.TB_O${i}`, name: `其它表${i}`, fields: [],
  }))

  it('左侧完整目录可搜索原下拉首屏外的表，切换后表头显示中文名', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ ...GROUP, list3: OTHER_TABLES })
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({
      total: 1,
      // t45 正好是 list3 的第 26 条，落在首批 20 条之外
      list: [{ tableId: 't45', tableName: 'sense_data.TB_O25', name: '其它表25', fields: [] }],
    })
    useAuthStore().roles = ['admin']
    await mountPage()
    await waitForLoad()
    await sidebar().get('[data-tab="db"]').trigger('click')
    expect(sidebar().text()).toContain('其它表25')

    await searchTables('其它表25')
    await flushPromises()
    await chooseTable('t45')
    await flushPromises()

    expect(sidebar().props('selectedId')).toBe('t45')
    expect(wrapper.get('.dv-table-context').text()).toContain('其它表25')
    expect(sidebar().find('[data-table-id="t45"]').attributes('aria-current')).toBe('true')
  })

  it('左侧切表后当前源被清掉、分组重拉，选中的表仍留在导航里', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ ...GROUP, list3: OTHER_TABLES })
    // 初始表（list3 第一条 t20）带 600519，新表 t45 没有：loadSources 会清掉 sourceId
    // 并重新 loadGroup，把 group 整块覆盖掉
    vi.spyOn(dataApi, 'distinctSource').mockImplementation(async (query) => (query.tableId === 't20' ? ['600519'] : ['src-9']))
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({
      total: 1,
      list: [{ tableId: 't45', tableName: 'sense_data.TB_O25', name: '其它表25', fields: [] }],
    })
    useAuthStore().roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()
    const groupCallsBefore = (dataApi.entryTypesGroup as ReturnType<typeof vi.fn>).mock.calls.length

    await searchTables('其它表25')
    await flushPromises()
    await chooseTable('t45')
    await flushPromises()
    await waitForLoad()

    // 源被清掉 → 分组确实重拉了一次
    expect((dataApi.entryTypesGroup as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(groupCallsBefore)
    expect(wrapper.get('.dv-table-context').text()).toContain('其它表25')
    expect(sidebar().find('[data-table-id="t45"]').attributes('aria-current')).toBe('true')
  })

  it('按源搜索：选中跨表源后切换到该源的默认表', async () => {
    const sourceSpy = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1,
      list: [{ sourceId: 'src-9', name: '更多源示例', url: '', configId: 'c1', mainTable: 't1', owner: 'dev', state: 'C' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const link = new DOMWrapper(document.body).findAll('.dv-link').find((el) => el.text().includes('按源搜索'))
    await link!.trigger('click')
    await flushPromises()

    expect(sourceSpy).toHaveBeenCalled()
    expect(wrapper.text()).toContain('更多源示例')
    // 1021-05：列对齐源管理，启停与运行状态分两列
    expect(wrapper.text()).toContain('启停')
    expect(wrapper.text()).toContain('运行状态')

    const row = wrapper.findAll('tr').find((el) => el.text().includes('更多源示例'))
    await row!.trigger('click')
    await flushPromises()

    expect(dataApi.entryTypesGroup).toHaveBeenLastCalledWith('src-9')
    expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t1')
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'src-9' }))
  })
})
