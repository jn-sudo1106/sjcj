// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FileView from './FileView.vue'
import { fileApi, type RawFile } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'

const files: RawFile[] = [{
  attachId: 'attach-1', fileId: 'batch-1', state: 'C', siteId: 'site-zfb', sourceId: '391007768', nodeId: 'step-list',
  realName: 'page.html', contentType: 'html', fileSize: 2048, md5: 'abc123',
  attributes: { collector: '列表抓取' }, createDt: '2026-07-13 10:00:00',
  viewUrl: 'https://files.example.com/page.html', downloadUrl: 'https://files.example.com/page.html?download=1',
}]

describe('FileView', () => {
  afterEach(() => vi.restoreAllMocks())

  // 文件视图只在具体源下挂载（M1-4：网站汇总态的文件页签是"开发中"占位，不会渲染这个
  // 组件），所以不再测"siteWide 聚合全部源"这个走不到的场景（0812 计划 M3-3：那条按源
  // 遍历 sourceSteps 的 N+1 分支已经删掉，不是留着以后用）。
  it('查询字段对齐旧平台 page/inst/FileList.vue（M3-1）：state/attachId/fileId/ext + 流程节点', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const query = vi.spyOn(fileApi, 'filePaged').mockResolvedValue({ list: files, total: 1 })
    vi.spyOn(fileApi, 'fileStats').mockResolvedValue({ total: 1, totalSize: 2048 })

    const wrapper = shallowMount(FileView, {
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ProcessNodeRail: true, ElDrawer: true, ElPagination: true },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-process-rail"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('附件ID')
    expect(wrapper.text()).toContain('批次ID')
    expect(wrapper.text()).toContain('状态（不限）')
    expect(wrapper.text()).toContain('MD5')
    expect(wrapper.text()).toContain('扩展属性')
    // 不加文件名/日期筛选（M3-2：fileName 是否被后端支持未确认，旧平台本身也没有日期筛选）
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: current.siteId, sourceId: current.sourceId }))
  })

  it('已停用源默认仍展示历史文件', async () => {
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

    const wrapper = shallowMount(FileView, {
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ProcessNodeRail: true, ElPagination: true, ElDrawer: { template: '<div><slot /></div>' } },
      },
    })
    await flushPromises()
    await wrapper.get('[data-testid="file-preview-attach-1"]').trigger('click')

    expect(wrapper.find('iframe').attributes('src')).toBe(files[0].viewUrl)
  })

  it('文本和 JSON 文件使用安全 iframe 预览', async () => {
    setActivePinia(createPinia())
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))
    const textFile = { ...files[0], attachId: 'attach-text', realName: 'payload.json', contentType: 'application/json' }
    vi.spyOn(fileApi, 'filePaged').mockResolvedValue({ list: [textFile], total: 1 })
    vi.spyOn(fileApi, 'fileStats').mockResolvedValue({ total: 1, totalSize: 2048 })
    const wrapper = shallowMount(FileView, {
      global: { directives: { loading: {} }, stubs: { CanvasHeader: true, ProcessNodeRail: true, ElDrawer: { template: '<div><slot /></div>' } } },
    })
    await flushPromises()
    await wrapper.get('[data-testid="file-preview-attach-text"]').trigger('click')
    expect(wrapper.find('iframe').exists()).toBe(true)
  })
})
