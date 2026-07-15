// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FileView from './FileView.vue'
import { fileApi, siteApi, type RawFile, type Source } from '../../api'
import { useFlowStore } from '../../stores/flow'
import { mockSourceDetail, mockSourceSteps } from '../../api/mock/sources'

const files: RawFile[] = [{
  fileId: 'file-1', siteId: 'site-zfb', sourceId: '391007768', nodeId: 'step-list',
  fileName: 'page.html', contentType: 'html', size: 2048, md5: 'abc123',
  attributes: { collector: '列表抓取' }, createdAt: '2026-07-13 10:00:00',
  viewUrl: 'https://files.example.com/page.html', downloadUrl: 'https://files.example.com/page.html?download=1',
}]

describe('FileView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('默认查询当前子源（不再提供所属子源筛选）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const peer = { ...current, sourceId: 'peer-source', name: '同站子源' } as Source
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const query = vi.spyOn(fileApi, 'filePaged').mockResolvedValue({ list: files, total: 1 })
    vi.spyOn(fileApi, 'fileStats').mockResolvedValue({ total: 1, totalSize: 2048 })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current, peer])

    const wrapper = shallowMount(FileView, {
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ProcessNodeRail: true, ElDrawer: true, ElPagination: true },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-source-filter"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('状态')
    expect(wrapper.text()).toContain('MD5')
    expect(wrapper.text()).toContain('扩展属性')
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: current.siteId, sourceId: current.sourceId }))
  })

  it('网站详情页（site-wide）聚合查看全部子源文件，不展示流程节点条', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const peer = { ...current, sourceId: 'peer-source', name: '同站子源' } as Source
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const query = vi.spyOn(fileApi, 'filePaged').mockResolvedValue({ list: files, total: 1 })
    vi.spyOn(fileApi, 'fileStats').mockResolvedValue({ total: 1, totalSize: 2048 })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current, peer])

    const wrapper = shallowMount(FileView, {
      props: { siteWide: true },
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ProcessNodeRail: true, ElDrawer: true, ElPagination: true },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-process-rail"]').exists()).toBe(false)
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: current.siteId, sourceId: undefined }))
    expect(wrapper.text()).toContain('所属子源')
  })

  it('已停用子源默认仍展示历史成功文件', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: 'NEWS5522' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true, ProcessNodeRail: true, ElDrawer: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(wrapper.text()).toContain('列表抓取_1')
  })

  it('在站内抽屉预览支持的文件', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    vi.spyOn(fileApi, 'filePaged').mockResolvedValue({ list: files, total: 1 })
    vi.spyOn(fileApi, 'fileStats').mockResolvedValue({ total: 1, totalSize: 2048 })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source])

    const wrapper = shallowMount(FileView, {
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ProcessNodeRail: true, ElPagination: true, ElDrawer: { template: '<div><slot /></div>' } },
      },
    })
    await flushPromises()
    await wrapper.get('[data-testid="file-preview-file-1"]').trigger('click')

    expect(wrapper.find('iframe').attributes('src')).toBe(files[0].viewUrl)
  })

  it('文本和 JSON 文件使用安全 iframe 预览', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    const textFile = { ...files[0], fileId: 'file-text', fileName: 'payload.json', contentType: 'application/json' }
    vi.spyOn(fileApi, 'filePaged').mockResolvedValue({ list: [textFile], total: 1 })
    vi.spyOn(fileApi, 'fileStats').mockResolvedValue({ total: 1, totalSize: 2048 })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source])
    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true, ProcessNodeRail: true, ElDrawer: { template: '<div><slot /></div>' } } },
    })
    await flushPromises()
    await wrapper.get('[data-testid="file-preview-file-text"]').trigger('click')
    expect(wrapper.find('iframe').exists()).toBe(true)
  })
})
