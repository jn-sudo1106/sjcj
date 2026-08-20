// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import SiteFileView from './SiteFileView.vue'
import FileDetailDrawer from './FileDetailDrawer.vue'
import GlobalSourceSelect from './components/GlobalSourceSelect.vue'
import { fileApi, siteApi, type FileResourceRecord, type Source } from '@/api'

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

describe('SiteFileView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('未选择网站时直接查询全部 file_resource，不按网站源关联过滤', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const siteSources = vi.spyOn(siteApi, 'siteSources')
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('orphan-source', '40', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
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
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('共 21 个文件')
    expect(wrapper.text()).toContain('第 1 / 2 页')
    await wrapper.get('[data-testid="site-file-next"]').trigger('click')
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: undefined, page: 2, size: 20 }))
    expect(wrapper.text()).toContain('task-2.html')
  })

  it('直分页提供统一的每页条数和跳转控件', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 61, list: [file('orphan-source', '1', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(wrapper.get('select[aria-label="每页条数"]').findAll('option')).toHaveLength(3)
    await wrapper.get('input[aria-label="跳转页码"]').setValue(3)
    await wrapper.get('[data-testid="site-file-jump"]').trigger('click')
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, size: 20 }))

    await wrapper.get('select[aria-label="每页条数"]').setValue('50')
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, size: 50 }))
    expect(wrapper.text()).toContain('第 1 / 2 页')
  })

  it('网站内已选择具体源时也走单源准确分页，不按全部源归并', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 21, list: [file('s1', '1', 'one.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a', initialSourceId: 's1' },
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
    })
    await flushPromises()

    expect(rows).toHaveBeenCalledTimes(1)
    expect(rows).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's1', page: 1, size: 20 }))
    expect(wrapper.text()).toContain('共 21 个文件')
    expect(wrapper.text()).toContain('第 1 / 2 页')
  })

  it('网站全部源按 sourceId 查询 file_resource 后合并展示，并保留所属源', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    const rows = vi.spyOn(fileApi, 'resourceRows').mockImplementation(async (query) => ({
      total: 1,
      list: query.sourceId === 's1' ? [file('s1', '20', 'one.html')] : [file('s2', '30', 'two.html')],
    }))

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
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
    expect(wrapper.findComponent(FileDetailDrawer).props('sourceName')).toBe('源二')
    expect(wrapper.text()).toContain('已加载全部文件')
  })

  it('明确展示失败源和接口错误，避免只有计数无法定位', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1', '源一'), source('s2', '源二')])
    vi.spyOn(fileApi, 'resourceRows').mockImplementation(async (query) => {
      if (query.sourceId === 's1') throw new Error('请求失败 500')
      return { total: 1, list: [file('s2', '30', 'two.html')] }
    })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: 'site-a' },
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
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
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
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

    await sqlInput.trigger('keyup.enter')
    await flushPromises()
    expect(rows).toHaveBeenLastCalledWith(expect.objectContaining({ sql: 'K1 IS N' }))
  })

  it('清空筛选会一并清掉自定义 SQL 并重新查询', async () => {
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const rows = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ total: 1, list: [file('orphan-source', '40', 'task.html')] })

    const wrapper = shallowMount(SiteFileView, {
      props: { siteId: undefined },
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
    })
    await flushPromises()
    const sqlInput = wrapper.get('input[aria-label="自定义SQL"]')
    await sqlInput.trigger('keyup.enter')
    await sqlInput.setValue('K1 IS NULL')
    await sqlInput.trigger('keyup.enter')
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
      global: { directives: { loading: {} }, stubs: { SiteSourceSelect: true } },
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
