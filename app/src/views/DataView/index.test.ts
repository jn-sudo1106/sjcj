// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import DataView from './index.vue'
import DataImportDialog from './DataImportDialog.vue'
import { useAuthStore } from '../../stores/auth'
import { dataApi, sourceApi, entryApi, type DataTableMeta, type DataRow, type EntryTypeGroup } from '../../api'

// 数据表页_UI重写设计_2026-07-30：检索区/工具条/批量条/动态列表格/数据详情抽屉
describe('DataView · 数据表页', () => {
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
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(GROUP)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(META)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    vi.spyOn(sourceApi, 'sourceSame').mockResolvedValue([{ sourceId: '600519', name: '贵州茅台' }])
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = '' // 清理 el-dropdown/el-message/el-drawer 传送到 body 的残留节点
  })

  async function mountPage(query: Record<string, string> = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/data', component: { template: '<div />' } }],
    })
    await router.push({ path: '/data', query })
    await router.isReady()
    wrapper = mount(DataView, { global: { plugins: [ElementPlus, router] } })
    return wrapper
  }

  async function waitForLoad() {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 500))
    await flushPromises()
  }

  async function openResultMenu(testId: 'data-export' | 'data-delete' | 'data-more') {
    await wrapper.get(`[data-testid="${testId}"]`).trigger('click')
    await flushPromises()
    return new DOMWrapper(document.body)
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

  it('切表：选表下拉切到 list1 第二个表，重新拉取 tableMeta 并按新 tableId 重查', async () => {
    vi.spyOn(dataApi, 'tableMeta').mockImplementation(async (id: string) => ({ ...META, tableId: id }))
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const tableSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await tableSelect.vm.$emit('update:modelValue', 't2')
    await tableSelect.vm.$emit('change', 't2')
    await waitForLoad()

    expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t2')
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 't2', page: 1 }))
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
    const body = await openResultMenu('data-more')
    await body.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '查看查询条件/SQL')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('select * from sense_data.TB_STOCK_NOTICE')
    expect((dataApi.rowQueryPaged as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })

  it('导出：调用 dataApi.exportUrl 拼好的 URL 新窗口打开，不经过 rowQueryPaged', async () => {
    const exportSpy = vi.spyOn(dataApi, 'exportUrl').mockReturnValue('/api/v1/entry/entryExportAll?entryType=t1')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const body = await openResultMenu('data-export')
    await body.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '导出 Excel')!.trigger('click')

    expect(exportSpy).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1' }))
    expect(openSpy).toHaveBeenCalledWith('/api/v1/entry/entryExportAll?entryType=t1', '_blank')
  })

  it('更多菜单保留查看能力和已命名的清除父表操作，不再显示数据维护', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const body = await openResultMenu('data-more')
    expect(body.text()).toContain('查看统计')
    expect(body.text()).toContain('查看查询条件/SQL')
    expect(body.text()).toContain('展示处理步骤')
    // 0904 I02（Z1-4）：反查源**从「更多」里放出来了**，工具栏直接有按钮
    // （原话「我到时候把放出来」）——它是数据视图通往源视图的唯一通路，
    // 藏在二级菜单里没人找得到。所以这里断言它**不在**下拉里。
    expect(body.text()).not.toContain('按此条件反查源')
    expect(body.text()).not.toContain('查看去重源 ID')
    expect(body.text()).toContain('清除父表后续标识')
    expect(body.text()).not.toContain('数据维护')
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


  it('工具条按新增、导入、导出、更多与删除收敛，不显示夸张的危险操作按钮', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.find('[data-testid="data-delete"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-import"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-danger"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-tools"]').exists()).toBe(false)

    const exportMenu = await openResultMenu('data-export')
    expect(exportMenu.text()).toContain('导出 Excel')
    expect(exportMenu.text()).toContain('取数 API')

    wrapper.unmount()
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({ ...META, state: 'AC' })
    await mountPage()
    await waitForLoad()
    expect(wrapper.find('[data-testid="data-delete"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-import"]').exists()).toBe(true)
  })

  it('删除数据：按时间删除和表操作按旧系统分组，表操作只保留三项', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const body = await openResultMenu('data-delete')
    expect(body.text()).toContain('删除该源-当日数据')
    expect(body.text()).toContain('删除该源-所有数据')
    expect(body.text()).toContain('填入 IDs-删除')
    expect(body.text()).toContain('设为正式表')
    expect(body.text()).toContain('清空表数据【当日】')
    expect(body.text()).toContain('清空表数据【全量】')
    expect(body.text()).not.toContain('重新处理后续步骤')
  })

  it('取数 API 归入导出；清除父表标识归入更多', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    const exportMenu = await openResultMenu('data-export')
    const apiItem = exportMenu.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '取数 API')!
    await apiItem.trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 500))
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="data-api-dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('API描述')
    expect(wrapper.text()).toContain('ID取数')
    expect(wrapper.text()).toContain('startId')
    expect(wrapper.text()).toContain('endId')
    expect(wrapper.text()).toContain('appId')
    expect(wrapper.text()).toContain('sourceId')
    expect(wrapper.text()).toContain('data.list[].title')
    expect(wrapper.text()).toContain('data.list[].id')
    expect(wrapper.text()).toContain('返回值说明')
    expect(wrapper.text()).toContain('appId=dev&appKey=dev1&type=t1&sourceId=600519&startId=0&size=10')
    const closeApiButton = wrapper.findAll('button').find((el) => el.text() === '关闭')
    expect(closeApiButton).toBeDefined()
    await closeApiButton!.trigger('click')

    const moreMenu = await openResultMenu('data-more')
    expect(moreMenu.text()).toContain('清除父表后续标识')
  })

  it('导入数据：管理员可打开旧接口字段口径的导入弹窗', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    await wrapper.get('[data-testid="data-import"]').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(DataImportDialog).props('modelValue')).toBe(true)
  })

  it('结果表展示 STATE 状态列', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.text()).toContain('状态')
    expect(wrapper.text()).toContain('C')
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

  it('数据详情抽屉：点击 ENTRY_ID 调 dataApi.rowDetail 并展示 showItems', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: ROW,
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '标题', value: '关于利润分配的公告' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.find('a.dv-a').trigger('click') // ENTRY_ID 链接
    await flushPromises()

    expect(dataApi.rowDetail).toHaveBeenCalledWith('t1', '88231')
    expect(wrapper.text()).toContain('标题')
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

    await wrapper.get('[data-testid="data-add"]').trigger('click')
    await flushPromises()

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
    expect(wrapper.find('[data-testid="data-more"]').exists()).toBe(true)
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

    // read 角色下操作列（详情列 ENTRY_ID 仍是唯一 dv-a，任务列不受 canWrite 限制，可查看）
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

    const body = await openResultMenu('data-more')
    await body.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '查看统计')!.trigger('click')
    await flushPromises()

    const bodyWithDrawer = new DOMWrapper(document.body)
    await new Promise((r) => setTimeout(r, 50))
    await bodyWithDrawer.findAll('.el-select-dropdown__item').find((el) => el.text() === '发布日期(K2)')!.trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    await wrapper.findAll('button').find((b) => b.text() === '统计')!.trigger('click')
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

    let body = await openResultMenu('data-more')
    let item = body.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '展示处理步骤')
    await item!.trigger('click')
    await flushPromises()
    expect(stepsSpyNoSource).not.toHaveBeenCalled()

    wrapper.unmount()
    const stepsSpy = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([
      { stepId: 's1', sourceId: '600519', name: '抓取列表', outputTable: 'sense_data.TB_LIST', enabled: true },
    ])
    await mountPage({ sourceId: '600519' })
    await waitForLoad()
    body = await openResultMenu('data-more')
    item = body.findAll('li, .el-dropdown-menu__item').find((el) => el.text() === '展示处理步骤')
    await item!.trigger('click')
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

  it('加载更多数据表：下拉底部入口调 entryApi.entryPaged，选中后切表', async () => {
    const entrySpy = vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({
      total: 1,
      list: [{ tableId: 't9', tableName: 'sense_data.TB_MORE', name: '更多表', fields: [] }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const link = new DOMWrapper(document.body).findAll('.dv-link').find((el) => el.text().includes('加载更多数据表'))
    await link!.trigger('click')
    await flushPromises()

    expect(entrySpy).toHaveBeenCalled()
    expect(wrapper.text()).toContain('更多表')
    expect(wrapper.text()).toContain('去重字段')
    expect(wrapper.text()).toContain('更新时间')
    expect(wrapper.findAll('button[aria-label="刷新"]').length).toBeGreaterThan(1)

    const row = wrapper.findAll('tr').find((el) => el.text().includes('更多表'))
    await row!.trigger('click')
    await flushPromises()

    expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t9')
  })

  it('更多源：下拉底部入口调 sourceApi.sourcePaged，选中后切源', async () => {
    const sourceSpy = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1,
      list: [{ sourceId: 'src-9', name: '更多源示例', url: '', configId: 'c1', mainTable: 't1', owner: 'dev', state: 'C' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const link = new DOMWrapper(document.body).findAll('.dv-link').find((el) => el.text().includes('更多源'))
    await link!.trigger('click')
    await flushPromises()

    expect(sourceSpy).toHaveBeenCalled()
    expect(wrapper.text()).toContain('更多源示例')
    expect(wrapper.text()).toContain('配置ID')
    expect(wrapper.text()).toContain('域')

    const row = wrapper.findAll('tr').find((el) => el.text().includes('更多源示例'))
    await row!.trigger('click')
    await flushPromises()

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'src-9' }))
  })
})
