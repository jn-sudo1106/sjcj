// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FileView from './FileView.vue'
import FileDetailDrawer from './FileDetailDrawer.vue'
import { fileApi, type FileResourceRecord } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'

const table = {
  tableId: 'file-resource',
  tableName: 'sense_data.tb_news_file_resource',
  name: 'news-文件资源表',
  rowCount: 40,
  fields: [],
}
const files: FileResourceRecord[] = [{
  dataId: 'entry-1', sourceId: '391007768', state: 'C', createDt: '2026-07-13 10:00:00',
  values: {
    K1: 'page.html', K2: 'https://files.example.com/page.html', K3: '/data/page.html', K4: 2048,
    K5: 'abc123', K6: 'page.html', K7: 'html', K8: 'page.txt', K9: '/data/page.txt', K10: 512,
  },
}]

describe('FileView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('按 file_resource 表目录 + 元数据 + entryDataPaged 查询文件资源', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const tables = vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    const meta = vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    const query = vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('文件名')
    expect(wrapper.text()).toContain('展示名')
    expect(wrapper.text()).toContain('文件路径')
    expect(wrapper.text()).toContain('状态（不限）')
    expect(wrapper.text()).toContain('MD5')
    expect(wrapper.find('[data-testid="file-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-resource-table"]').text()).toContain('数据源：news-文件资源表')
    expect(wrapper.text()).not.toContain('文件记录关联字段待接口确认后再启用节点筛选')
    expect(tables).toHaveBeenCalled()
    expect(meta).toHaveBeenCalledWith('file-resource')
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 'file-resource', sourceId: current.sourceId }))
  })

  it('已停用源默认仍展示历史文件', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: 'NEWS5522' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    await flushPromises()

    expect(wrapper.text()).toContain('列表抓取_1')
  })

  it('K2 仅渲染为安全 HTTP(S) 外链，K3/K9 只展示原值', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: files, total: 1 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await flushPromises()

    const link = wrapper.find('a[target="_blank"]')
    expect(link.attributes('href')).toBe(files[0].values.K2)
    expect(link.attributes('rel')).toContain('noreferrer')
    expect(wrapper.text()).toContain('/data/page.html')
    expect(wrapper.text()).toContain('/data/page.txt')
  })

  it('补齐文本大小、状态、更新时间，并可打开文件详情', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const row = { ...files[0], updateDt: '2026-08-17 10:00:00' }
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockResolvedValue({ list: [row], total: 101 })

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('文本大小')
    expect(wrapper.text()).toContain('更新时间')
    expect(wrapper.text()).toContain('512 B')
    await wrapper.get('[data-testid="file-detail"]').trigger('click')
    expect(wrapper.findComponent(FileDetailDrawer).props('file')).toEqual(row)

    await wrapper.get('select[aria-label="每页条数"]').setValue('50')
    await flushPromises()
    expect(fileApi.resourceRows).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, size: 50 }))
  })

  it('具体源文件查询失败时显示失败提示，不伪装成空结果', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(fileApi, 'resourceTables').mockResolvedValue([table])
    vi.spyOn(fileApi, 'resourceMeta').mockResolvedValue(table)
    vi.spyOn(fileApi, 'resourceRows').mockRejectedValue(new Error('500'))

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('文件列表查询失败，请重试')
    expect(wrapper.text()).not.toContain('没有匹配的文件')
  })
})
