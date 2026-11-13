// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import SiteFileView from './SiteFileView.vue'
// 版式契约（单排 no-wrap / 1200 档位 min-width）只能从样式表本身守，测试里取源码原文断言
import siteFileViewSource from './SiteFileView.vue?raw'
import { readSqlConditions } from '@/utils/sqlConditionHistory'
import FileDetailDrawer from './FileDetailDrawer.vue'
import GlobalSourceSelect from './components/GlobalSourceSelect.vue'
import { dataApi, fileApi, siteApi, sourceApi, type FileResourceRecord, type Source } from '@/api'

// 动态列现在由表字段定义生成（对齐旧 FileList2 的 columns()），所以这里得给全字段——
// 旧实现把「文件名-K1 … 文本大小-K10」十列写死在模板里，fields 空着也能渲染。
const tableFields = [
  { prop: 'file_name-K1', type: 'string', desc: '文件名', columnName: 'K1', required: false },
  { prop: 'file_url-K2', type: 'url', desc: '文件链接', columnName: 'K2', required: false },
  { prop: 'file_path-K3', type: 'string', desc: '文件路径', columnName: 'K3', required: false },
  { prop: 'file_size-K4', type: 'number', desc: '文件大小', columnName: 'K4', required: false },
  { prop: 'file_md5-K5', type: 'string', desc: '文件 MD5', columnName: 'K5', required: false },
  { prop: 'display_name-K6', type: 'string', desc: '展示名', columnName: 'K6', required: false },
  { prop: 'file_ext-K7', type: 'string', desc: '扩展名', columnName: 'K7', required: false },
  { prop: 'text_name-K8', type: 'string', desc: '文本文件名', columnName: 'K8', required: false },
  { prop: 'text_path-K9', type: 'string', desc: '文本文件路径', columnName: 'K9', required: false },
  { prop: 'text_size-K10', type: 'number', desc: '文本文件大小', columnName: 'K10', required: false },
] as never[]
const table = { tableId: 'file-resource', tableName: 'sense_data.tb_news_file_resource', name: 'news-文件资源表', rowCount: 40, fields: tableFields }
function source(sourceId: string, name: string): Source {
  return { sourceId, name, url: '', configId: '', mainTable: '', owner: '', state: 'C' }
}
function file(sourceId: string, dataId: string, fileName: string): FileResourceRecord {
  return {
    dataId, sourceId, state: 'C', createDt: '2026-08-17 12:00:00',
    updateDt: '2026-08-17 12:10:00',
    values: { K1: fileName, K2: `https://files.example.com/${fileName}`, K3: `/data/${fileName}`, K4: 1024, K5: `md5-${dataId}`, K6: fileName, K7: 'html', K8: '', K9: '', K10: 512 },
  }
}

// 查询条件不绑回车（2026-08-20）：中文输入法上屏也会发 Enter 的 keyup，Vue 的
// @keyup.enter 不过滤 isComposing，绑了等于打字打到一半就把半截条件查出去。
async function clickQuery(wrapper: { findAll: (s: string) => { text: () => string; trigger: (e: string) => Promise<void> }[] }) {
  await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
}

/** 方案 A：自定义 SQL / 历史 / 全屏都在「高级」浮层里，默认收起，先展开再操作 SQL 输入 */
async function openAdvanced(wrapper: { get: (s: string) => { trigger: (e: string) => Promise<void> } }) {
  await wrapper.get('[data-testid="site-file-advanced"]').trigger('click')
}

afterEach(() => localStorage.clear())

describe('SiteFileView', () => {
  // 0929 起网站文件视图会并入流程节点输出的文件表；老用例不关心这块，统一给空
  beforeEach(() => vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: [], noFlowSourceCnt: 0, failedFlowIds: [] }))

  // 2026-10-16：列名与顺序对齐旧平台 `page/inst/FileList2.vue`——
  // 固定列是「ID / 源 / … / 状态 / 更新 / 生成 / 操作」（不是「所属源 / 更新时间 / 生成时间」），
  // 中间那批是**按表字段定义动态生成**的列（旧版 `columns()`，标题 `字段名-物理列名`）。
  it('表格列名与顺序对齐旧平台（ID / 源 / 动态字段列 / 状态 / 更新 / 生成 / 操作）', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('s1', '30', 'two.html')] })
    const wrapper = shallowMount(SiteFileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, GlobalSourceSelect: true } },
    })
    await flushPromises()

    const heads = wrapper.findAll('.sfv-table thead th').map((th) => th.text())
    expect(heads).toEqual([
      'ID', '源',
      '文件名-K1', '文件链接-K2', '文件路径-K3', '文件大小-K4', '文件 MD5-K5',
      '展示名-K6', '扩展名-K7', '文本文件名-K8', '文本文件路径-K9', '文本文件大小-K10',
      '状态', '更新', '生成', '操作',
    ])
  })

  it('网站多源查询仅在全部成功时记录条件，部分源失败不记录', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([]) // 收窄失败→退回网站全部源
    const query = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()
    await openAdvanced(wrapper)
    await wrapper.get('input[aria-label="自定义SQL"]').setValue('K1 IS NULL')
    query.mockImplementation(async ({ sourceId }) => {
      if (sourceId === 's2') throw new Error('SQL syntax')
      return { total: 0, list: [] }
    })
    await clickQuery(wrapper)
    await flushPromises()
    expect(readSqlConditions(table.tableId)).toEqual([])
    query.mockResolvedValue({ total: 0, list: [] })
    await clickQuery(wrapper)
    await flushPromises()
    expect(readSqlConditions(table.tableId)).toEqual(['K1 IS NULL'])
    wrapper.unmount()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('未选择网站时直接查询全部 file_resource，不按网站源关联过滤', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const siteSources = vi.spyOn(siteApi, 'siteSources')
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('orphan-source', '40', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(siteSources).not.toHaveBeenCalled()
    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'file-resource', sourceId: undefined }))
    // 未选网站时不再是一段死文案，是可搜索的全局源筛选（对齐旧平台 FileList2.vue 的"源ID"选择器）。
    expect(wrapper.findComponent(GlobalSourceSelect).exists()).toBe(true)
    expect(wrapper.text()).toContain('task.html')
  })

  it('全部网站查询使用接口 total 展示准确分页', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const rows = vi.spyOn(fileApi, 'resourceRows').mockImplementation(async (query) => ({
      total: 21,
      list: [file('orphan-source', String(query.page), `task-${query.page}.html`)],
    }))

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    // 分页 0902 统一成 el-pagination（页码文字与上一页/下一页按钮不再由本组件渲染），
    // 测试环境没全局装 Element Plus，它点不动——与 ResultView.test.ts 同口径，
    // 改成断言 total 绑对了；翻页真正的逻辑（onPageChange → resetAndLoad(false)）
    // 由下面「按当前页码请求」那条覆盖。
    expect(wrapper.text()).toContain('共 21 个文件')
    expect(wrapper.get('[data-testid="site-file-pagination"]').attributes('total')).toBe('21')
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: undefined, page: 1, size: 20 }))
  })

  // 原来是「每页下拉 + 上一页/下一页 + 跳转输入框 + 跳转按钮」四件套，0902 统一成一个
  // el-pagination；每页条数走 sizes、跳页走 jumper，能力不丢，但控件不再是本组件渲染的
  // 原生 select/input，所以这里只验绑进去的 props。
  it('直分页用与数据中心同款 el-pagination，页大小选项与总数绑对', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 61, list: [file('orphan-source', '1', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    const pagination = wrapper.get('[data-testid="site-file-pagination"]')
    expect(pagination.attributes('total')).toBe('61')
    expect(pagination.attributes('page-size')).toBe('20')
    expect(pagination.attributes('layout')).toBe('total, sizes, prev, pager, next, jumper')
  })

  it('网站内已选择具体源时也走单源准确分页，不按全部源归并', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([]) // 收窄失败→退回网站全部源
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 21, list: [file('s1', '1', 'one.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a', initialSourceId: 's1' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(rows).toHaveBeenCalledTimes(1)
    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's1', page: 1, size: 20 }))
    expect(wrapper.text()).toContain('共 21 个文件')
    expect(wrapper.get('[data-testid="site-file-pagination"]').attributes('total')).toBe('21')
  })

  it('网站全部源按 sourceId 查询 file_resource 后合并展示，并保留所属源', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([]) // 收窄失败→退回网站全部源
    const rows = vi.spyOn(fileApi, 'resourceRows').mockImplementation(async (query) => ({
      total: 1,
      list: query.sourceId === 's1' ? [file('s1', '20', 'one.html')] : [file('s2', '30', 'two.html')],
    }))

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(rows).toHaveBeenCalledTimes(2)
    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'file-resource', sourceId: 's1' }))
    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'file-resource', sourceId: 's2' }))
    expect(wrapper.text()).toContain('源一')
    expect(wrapper.text()).toContain('源二')
    expect(wrapper.text()).toContain('two.html')
    expect(wrapper.find('a[target="_blank"]').attributes('href')).toBe('https://files.example.com/two.html')
    // 动态列现在按表字段定义出：`desc` 来自字段定义，不是模板里写死的「文本大小」
    expect(wrapper.text()).toContain('文本文件大小')
    expect(wrapper.text()).toContain('更新')
    await wrapper.get('[data-testid="site-file-detail"]').trigger('click')
    const drawer = wrapper.findComponent(FileDetailDrawer)
    expect(drawer.props('sourceName')).toBe('源二')
    expect(drawer.props('tableId')).toBe('file-resource')
    expect(drawer.props('tableName')).toBe('news-文件资源表')
    expect(wrapper.text()).toContain('已加载全部文件')
  })

  it('全部源用 distinctSource 收窄候选源，只查真正有文件的源（源多的网站不逐个打）', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二'), source('s3', '源三')])
    const distinct = vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['s2', 'not-in-site'])
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('s2', '30', 'two.html')] })

    shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(distinct).toHaveBeenCalledWith(expect.objectContaining({ tableId: 'file-resource', size: 1000 }))
    // s2 属于本站且有文件 → 只查它；s1/s3 不在 distinct 结果里，not-in-site 不属于本站
    expect(rows).toHaveBeenCalledTimes(1)
    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's2' }))
  })

  it('网站全部源滚动到表格底部时自动加载下一批，不再显示手动按钮', async () => {
    let observerCallback: IntersectionObserverCallback | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', vi.fn(function (callback: IntersectionObserverCallback) {
      observerCallback = callback
      return { observe, disconnect }
    }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([]) // 收窄失败→退回网站全部源
    const rows = vi.spyOn(fileApi, 'resourceRows').mockImplementation(async (query) => ({
      total: 21,
      list: query.page === 1
        ? Array.from({ length: 20 }, (_, index) => file('s1', `p1-${index}`, `one-${index}.html`))
        : [file('s1', 'p2-1', 'next.html')],
    }))

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(observe).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="site-file-load-more"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="site-file-auto-load-status"]').text()).toContain('自动加载')

    observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await flushPromises()

    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's1', page: 2 }))
    expect(wrapper.text()).toContain('next.html')
  })

  it('明确展示失败源和接口错误，避免只有计数无法定位', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue([]) // 收窄失败→退回网站全部源
    vi.spyOn(fileApi, 'resourceRows').mockImplementation(async (query) => {
      if (query.sourceId === 's1') throw new Error('请求失败 500')
      return { total: 1, list: [file('s2', '30', 'two.html')] }
    })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="site-file-partial-fail"]').text()).toContain('源一（s1）：请求失败 500')
    expect(wrapper.text()).toContain('two.html')
  })

  it('全部网站查询失败显示表 ID 和真实原因，重查成功后清除提示', async () => {
    const imported = { ...table, tableId: '6100048' }
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([imported])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(imported)
    const rows = vi.spyOn(fileApi, 'resourceRows').mockRejectedValue(new Error('数据表或相关字段不存在 sense_data.TB_sw_file_resource'))
    const wrapper = shallowMount(SiteFileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false } },
    })
    try {
      await flushPromises()
      const error = wrapper.get('[data-testid="site-file-error"]')
      expect(error.text()).toContain('6100048')
      expect(error.text()).toContain('数据表或相关字段不存在 sense_data.TB_sw_file_resource')
      expect(error.attributes('role')).toBe('alert')
      rows.mockResolvedValue({ total: 1, list: [file('s1', '1', 'imported.html')] })
      await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="site-file-error"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('imported.html')
    } finally { wrapper.unmount() }
  })

  it('文件表目录加载失败显示接口原因', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockRejectedValue(new Error('服务暂时不可用'))
    const wrapper = shallowMount(SiteFileView, {
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false } },
    })
    try {
      await flushPromises()
      expect(wrapper.get('[data-testid="site-file-error"]').text()).toContain('服务暂时不可用')
    } finally { wrapper.unmount() }
  })

  it('自定义 SQL 筛选：对齐旧平台 FileList2.vue 的同名筛选项，此前迁移遗漏（补漏）', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('orphan-source', '40', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()
    const callsAfterMount = rows.mock.calls.length

    expect(wrapper.find('[data-testid="site-file-advanced-panel"]').exists()).toBe(false)
    await openAdvanced(wrapper)
    const sqlInput = wrapper.get('[data-testid="site-file-advanced-panel"] input[aria-label="自定义SQL"]')
    expect(sqlInput.attributes('placeholder')).toBe('自定义SQL, 如 K1 IS NULL')

    // 逐字符打字不触发查询——与 fileName/ext 一样要求 Enter 或点「查询」才发出去，
    // 避免一段没打完的 SQL 逐字符触发后端语法错误。
    await sqlInput.setValue('K1 IS N')
    await flushPromises()
    expect(rows).toHaveBeenCalledTimes(callsAfterMount)

    await clickQuery(wrapper)
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sql: 'K1 IS N' }))
    expect(readSqlConditions(table.tableId)).toEqual(['K1 IS N'])
    rows.mockRejectedValueOnce(new Error('SQL syntax'))
    await sqlInput.setValue('bad sql')
    await clickQuery(wrapper)
    await flushPromises()
    expect(readSqlConditions(table.tableId)).toEqual(['K1 IS N'])
  })

  it('清空筛选会一并清掉自定义 SQL 与选中的源，并只重新查询一次', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('orphan-source', '40', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()
    await openAdvanced(wrapper)
    const sqlInput = wrapper.get('input[aria-label="自定义SQL"]')
    await clickQuery(wrapper)
    await sqlInput.setValue('K1 IS NULL')
    await clickQuery(wrapper)
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sql: 'K1 IS NULL' }))

    // 收窄到某个源：GlobalSourceSelect 是 v-model 双向绑定，让桩 emit 等同于用户在面板里点选
    const select = wrapper.findComponent(GlobalSourceSelect)
    select.vm.$emit('update:modelValue', '429016824')
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: '429016824', sql: 'K1 IS NULL' }))
    const callsBeforeClear = rows.mock.calls.length

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')!
    await clearBtn.trigger('click')
    await flushPromises()

    expect((sqlInput.element as HTMLInputElement).value).toBe('')
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sql: undefined, sourceId: undefined }))
    // 2026-10-16 用户反馈：以前清空只清了文本条件，源选择器上还留着选中的源
    expect(wrapper.findComponent(GlobalSourceSelect).props('modelValue')).toBe('')
    // 源变更自带一次重查，clearFilters 不能再补一次，否则同一次清空发两遍相同请求
    expect(rows).toHaveBeenCalledTimes(callsBeforeClear + 1)
  })

  it('检测到多张 file_resource 表时给出手动选择的下拉，而不是报错停住', async () => {
    const tableB = { tableId: 'file-resource-2', tableName: 'sense_data.tb_ext_file_resource', name: 'ext-文件资源表', rowCount: 5, fields: [] }
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table, tableB])
    vi.spyOn(fileApi, 'resourceMeta').mockImplementation(async (id) => (id === tableB.tableId ? tableB : table))
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('orphan-source', '40', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('暂不自动选择')
    const select = wrapper.get('select[aria-label="表ID"]')
    expect(select.findAll('option')).toHaveLength(2)
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource' }))

    await select.setValue(tableB.tableId)
    await flushPromises()

    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource-2' }))
  })
})

// 0929：流程下载节点写进表名不带 file_resource 的文件表（站 124「下载PDF」→ 6200037 pdf文件表），
// 任务完成了文件视图却是空的。现在并入网站流程用到的文件表，并默认选中当前范围真有文件的那张。
describe('SiteFileView 流程产出的文件表', () => {
  const pdfTable = {
    tableId: '6200037', tableName: 'sense_data.TB_PDFWJB', name: 'pdf文件表', rowCount: 2,
    fields: [{ columnName: 'K3', desc: '文件路径' }, { columnName: 'K5', desc: '文件md5' }] as never[],
  }
  const noticeTable = { tableId: '6200036', tableName: 'sense_data.TB_SHZQJYS', name: '上海证券交易所', rowCount: 43, fields: [{ columnName: 'K4', desc: '正文路径' }] as never[] }
  function usedTable(tableId: string) {
    return { tableId, name: tableId, tableName: '', sourceIds: ['s1'], sourceCnt: 1, role: 'STEP' as const }
  }
  function mockMetas() {
    return vi.spyOn(fileApi, 'resourceMeta').mockImplementation(async (id) => (id === '6200037' ? pdfTable : id === '6200036' ? noticeTable : table))
  }
  afterEach(() => vi.restoreAllMocks())

  it('流程输出的文件表进候选并排在前面，结构不是文件表的（公告表）不进', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: [usedTable('6200036'), usedTable('6200037')], noFlowSourceCnt: 0, failedFlowIds: [] })
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    mockMetas()
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '江苏金租定期报告')])
    vi.spyOn(dataApi, 'distinctSource').mockImplementation(async ({ tableId }) => (tableId === '6200037' ? ['s1'] : []))
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('s1', '2800000', 'ea212d87.pdf')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: '124' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    const options = wrapper.get('select[aria-label="表ID"]').findAll('option')
    expect(options.map((o) => o.attributes('value'))).toEqual(['6200037', 'file-resource'])
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: '6200037', sourceId: 's1' }))
    expect(wrapper.text()).toContain('ea212d87.pdf')
  })

  it('默认选有文件的表：流程文件表还没产出、file_resource 里有本站文件时选后者', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: [usedTable('6200037')], noFlowSourceCnt: 0, failedFlowIds: [] })
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    mockMetas()
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一')])
    vi.spyOn(dataApi, 'distinctSource').mockImplementation(async ({ tableId }) => (tableId === 'file-resource' ? ['s1', 'other-site'] : ['other-site']))
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('s1', '1', 'one.html')] })

    shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource' }))
  })

  it('取网站流程用表失败时不阻断，照常展示 file_resource 表', async () => {
    vi.spyOn(siteApi, 'siteUsedTables').mockRejectedValue(new Error('500'))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    mockMetas()
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一')])
    vi.spyOn(dataApi, 'distinctSource').mockResolvedValue(['s1'])
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('s1', '1', 'one.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('加载文件资源表失败')
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource' }))
  })

  it('目录范围透传给全局源选择器：目录内只能选到该目录的源', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 0, list: [] })
    // 挂载时 sourceScopeDirId 的越界校验会跑一次（immediate），目录内的源要能查到
    const scopeSpy = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('s1', '源一')] })
    const gssStub = { name: 'GlobalSourceSelect', props: ['modelValue', 'directoryDirId'], template: '<div />' }

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined, initialSourceId: 's1', sourceScopeDirId: 'dir-1' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true, GlobalSourceSelect: gssStub } },
    })
    await flushPromises()

    const gss = wrapper.findComponent(gssStub)
    expect(gss.props('modelValue')).toBe('s1')
    expect(gss.props('directoryDirId')).toBe('dir-1')
    // 未选网站 + 指定源 = 单源直查（不按网站全部源归并），total 由接口给
    const rows = vi.mocked(fileApi.resourceRows)
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 's1', page: 1, size: 20 }))
    expect(scopeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ keyword: expect.anything() }))
  })

  it('切换目录后当前源不在该目录范围时清空源选择', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (query) => {
      const directory = (query as { directory?: { selections?: { id?: string }[] } } | undefined)?.directory
      return directory?.selections?.[0]?.id === 'dir-1' ? { total: 1, list: [source('s1', '源一')] } : { total: 0, list: [] }
    })
    const gssStub = { name: 'GlobalSourceSelect', props: ['modelValue', 'directoryDirId'], template: '<div />' }

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined, initialSourceId: 's1', sourceScopeDirId: 'dir-1' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true, GlobalSourceSelect: gssStub } },
    })
    await flushPromises()

    await wrapper.setProps({ sourceScopeDirId: 'dir-2' })
    await flushPromises()

    expect(sourceApi.sourcePaged).toHaveBeenCalledWith({
      page: 1,
      size: 1,
      sourceIds: ['s1'],
      directory: { kind: 'biz', mode: 'selected', selections: [{ id: 'dir-2', includeDescendants: true }] },
    })
    expect(wrapper.findComponent(gssStub).props('modelValue')).toBe('')
  })

  it('切换目录后源仍在范围内则保留；校验接口失败也不吞掉用户选择', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 0, list: [] })
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('s1', '源一')] })
    const gssStub = { name: 'GlobalSourceSelect', props: ['modelValue', 'directoryDirId'], template: '<div />' }

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined, initialSourceId: 's1', sourceScopeDirId: 'dir-1' },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true, GlobalSourceSelect: gssStub } },
    })
    await flushPromises()

    await wrapper.setProps({ sourceScopeDirId: 'dir-9' })
    await flushPromises()
    expect(wrapper.findComponent(gssStub).props('modelValue')).toBe('s1')

    paged.mockRejectedValueOnce(new Error('网络错误'))
    await wrapper.setProps({ sourceScopeDirId: 'dir-8' })
    await flushPromises()
    expect(wrapper.findComponent(gssStub).props('modelValue')).toBe('s1')
  })
})

// 方案 A（2026-11-08 用户拍板）：筛选区从 3 行压成 1 行 no-wrap，SQL/历史/全屏收进「高级」浮层。
// 这一组用例专门守版式契约，避免后续加控件又悄悄换行成 2 行。
describe('SiteFileView 方案 A 单排筛选区', () => {
  beforeEach(() => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 0, list: [] })
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
  })

  function mountView(props: Record<string, unknown> = {}) {
    return shallowMount(SiteFileView, {
      props,
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
  }

  it('源/表/文件名/类型/状态/高级/查询/清空都在同一个 nowrap 容器里，SQL 默认不在筛选行内', async () => {
    const wrapper = mountView()
    await flushPromises()

    const toolbar = wrapper.get('[data-testid="site-file-filters"]')
    expect(toolbar.classes()).toContain('sfv-toolbar')
    // 同一个父容器：每个控件都是筛选行的直接子元素（单排结构，没有包一层行）
    const inline = [
      wrapper.get('input[aria-label="文件名"]'),
      wrapper.get('input[aria-label="文件类型"]'),
      wrapper.get('select[aria-label="状态"]'),
      wrapper.get('.sfv-adv-wrap'),
      wrapper.findAll('button').find((button) => button.text() === '查询')!,
      wrapper.findAll('button').find((button) => button.text() === '清空')!,
    ]
    // 「高级」按钮本身在 .sfv-adv-wrap 里（浮层锚点），锚点必须是筛选行的直接子元素
    expect(wrapper.get('[data-testid="site-file-advanced"]').element.parentElement)
      .toBe(wrapper.get('.sfv-adv-wrap').element)
    for (const control of inline) expect(control.element.parentElement).toBe(toolbar.element)
    // 源选择器也在同一行（包在 .sfv-adv-wrap 之外的第一个子元素）
    expect(wrapper.get('.sfv-ctl-src').element.parentElement).toBe(toolbar.element)
    expect(toolbar.find('.sfv-toolbar-gap').exists()).toBe(true)
    // 弹性收窄的宽度档位挂在控件上，对应样式表里的 flex/min-width
    expect(wrapper.get('input[aria-label="文件名"]').classes()).toContain('sfv-ctl-name')
    expect(wrapper.get('input[aria-label="文件类型"]').classes()).toContain('sfv-ctl-ext')
    expect(wrapper.get('select[aria-label="状态"]').classes()).toContain('sfv-ctl-state')
    // 自定义 SQL 收进「高级」，默认不占筛选行
    expect(wrapper.find('input[aria-label="自定义SQL"]').exists()).toBe(false)
  })

  it('筛选行样式是 flex-nowrap 且 1200px 档位的最小宽度齐全（源150/表140/文件名100/类型88/状态84）', async () => {
    const css = siteFileViewSource
    const toolbar = css.match(/\.sfv-toolbar\s*\{[^}]*\}/)?.[0] ?? ''
    expect(toolbar).toContain('display: flex')
    expect(toolbar).toContain('flex-wrap: nowrap')
    expect(toolbar).toContain('min-width: 0')
    for (const rule of ['.sfv-ctl-src', '.sfv-ctl-tbl', '.sfv-ctl-name', '.sfv-ctl-ext', '.sfv-ctl-state']) {
      expect(css).toContain(rule)
    }
    for (const width of ['min-width: 150px', 'min-width: 140px', 'min-width: 100px', 'min-width: 88px', 'min-width: 84px']) {
      expect(css).toContain(width)
    }
    // 折行只由「容器宽度」决定：文件中心满宽右栏 ≈930px 保持单排；
    // 流程画布抽屉等 ≤860px 的容器才允许折两行（否则按钮会被裁掉）
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('@container (max-width: 860px)')
  })

  it('「高级」浮层默认收起，展开后 SQL 参与查询，再点收起', async () => {
    const rows = vi.mocked(fileApi.resourceRows)
    rows.mockResolvedValue({ total: 1, list: [file('s1', '1', 'one.html')] })
    const wrapper = mountView()
    await flushPromises()

    const button = wrapper.get('[data-testid="site-file-advanced"]')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="site-file-advanced-panel"]').exists()).toBe(false)

    await openAdvanced(wrapper)
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(button.classes()).toContain('on')
    const panel = wrapper.get('[data-testid="site-file-advanced-panel"]')
    expect(panel.text()).toContain('自定义 SQL')
    expect(panel.text()).toContain('历史条件与全屏编辑在输入框右侧')

    await panel.get('input[aria-label="自定义SQL"]').setValue('K1 IS NULL')
    await clickQuery(wrapper)
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sql: 'K1 IS NULL' }))

    await button.trigger('click')
    expect(wrapper.find('[data-testid="site-file-advanced-panel"]').exists()).toBe(false)
  })

  it('表头显示「目录：X ·」并在未选源时提示「未选源 → 整表全量」，选了源就隐藏提示', async () => {
    const wrapper = mountView({ sourceScopeDirId: 'dir-1', scopeLabel: '股票数据 / 财务数据' })
    await flushPromises()

    const head = wrapper.get('.sfv-tablehead')
    expect(head.get('[data-testid="site-file-scope-label"]').text()).toContain('目录：')
    expect(head.get('[data-testid="site-file-scope-label"]').text()).toContain('股票数据 / 财务数据')
    expect(head.get('[data-testid="site-file-scope-note"]').text()).toBe('未选源 → 整表全量')
    // 目录范围同时传给源选择器（只能搜到目录内的源）
    expect(wrapper.findComponent(GlobalSourceSelect).props('directoryDirId')).toBe('dir-1')

    wrapper.findComponent(GlobalSourceSelect).vm.$emit('update:modelValue', 's1')
    await flushPromises()

    expect(wrapper.find('[data-testid="site-file-scope-note"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="site-file-scope-label"]').exists()).toBe(true)
  })

  it('没有目录范围时不渲染目录前缀与整表提示', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-testid="site-file-scope-label"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="site-file-scope-note"]').exists()).toBe(false)
  })
})
