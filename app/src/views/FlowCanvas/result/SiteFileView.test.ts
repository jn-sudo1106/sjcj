// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import SiteFileView from './SiteFileView.vue'
import { readSqlConditions } from '@/utils/sqlConditionHistory'
import FileDetailDrawer from './FileDetailDrawer.vue'
import GlobalSourceSelect from './components/GlobalSourceSelect.vue'
import { dataApi, fileApi, siteApi, type FileResourceRecord, type Source } from '@/api'

const table = { tableId: 'file-resource', tableName: 'sense_data.tb_news_file_resource', name: 'news-文件资源表', rowCount: 40, fields: [] }
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

afterEach(() => localStorage.clear())

describe('SiteFileView', () => {
  // 0929 起网站文件视图会并入流程节点输出的文件表；老用例不关心这块，统一给空
  beforeEach(() => vi.spyOn(siteApi, 'siteUsedTables').mockResolvedValue({ tables: [], noFlowSourceCnt: 0, failedFlowIds: [] }))

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
    expect(wrapper.text()).toContain('文本大小')
    expect(wrapper.text()).toContain('更新时间')
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

    const sqlInput = wrapper.get('input[aria-label="自定义SQL"]')
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

  it('清空筛选会一并清掉自定义 SQL 并重新查询', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('orphan-source', '40', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SqlConditionEditor: false, SiteSourceSelect: true } },
    })
    await flushPromises()
    const sqlInput = wrapper.get('input[aria-label="自定义SQL"]')
    await clickQuery(wrapper)
    await sqlInput.setValue('K1 IS NULL')
    await clickQuery(wrapper)
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sql: 'K1 IS NULL' }))

    const clearBtn = wrapper.findAll('button').find((b) => b.text() === '清空')!
    await clearBtn.trigger('click')
    await flushPromises()

    expect((sqlInput.element as HTMLInputElement).value).toBe('')
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sql: undefined }))
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
})
