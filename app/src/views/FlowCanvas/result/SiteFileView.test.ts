// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import SiteFileView from './SiteFileView.vue'
import FileDetailDrawer from './FileDetailDrawer.vue'
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
    expect(wrapper.text()).toContain('全部网站 / 全部源')
    expect(wrapper.text()).toContain('task.html')
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
})
