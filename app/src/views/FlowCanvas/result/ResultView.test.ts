// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ResultView from './ResultView.vue'
import { dataApi, siteApi, type DataRow, type DataTableMeta, type Source } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'

const meta: DataTableMeta = {
  tableId: 'TB_ZFB_COMMENT', tableName: '评论', rowCount: 0,
  fields: [{ prop: 'content', type: 'string', desc: '内容' }],
}

describe('ResultView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('以当前子源流程展示无首尾节点的节点条，且只查当前子源数据（不再提供所属子源筛选）', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const peer = { ...current, sourceId: 'peer-source', name: '同站子源' } as Source
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current, peer])

    const wrapper = shallowMount(ResultView, {
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ElDrawer: true, DataGrid: true },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-source-filter"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('开始')
    expect(wrapper.text()).not.toContain('完成')
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: current.siteId, sourceId: current.sourceId }))
  })

  it('网站详情页（site-wide）聚合查看全部子源数据，不展示流程节点条，筛选栏提供源 ID 下拉', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const peer = { ...current, sourceId: 'peer-source', name: '同站子源' } as Source
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current, peer])

    const wrapper = shallowMount(ResultView, {
      props: { siteWide: true },
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ElDrawer: true, DataGrid: true },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="data-process-rail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-source-filter"]').exists()).toBe(true)
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: current.siteId, sourceId: undefined }))
  })

  it('数据视图筛选栏包含流程节点下拉框与源 ID 下拉框', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(meta)
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = shallowMount(ResultView, {
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ElDrawer: true, DataGrid: true },
      },
    })
    await flushPromises()

    const nodeFilter = wrapper.find<HTMLSelectElement>('[data-testid="data-node-filter"]')
    expect(nodeFilter.exists()).toBe(true)
    expect(nodeFilter.element.value).not.toBe('')

    const sourceFilter = wrapper.find<HTMLSelectElement>('[data-testid="data-source-filter"]')
    expect(sourceFilter.exists()).toBe(true)
    expect(sourceFilter.element.value).toBe(current.sourceId)
  })

  it('表结构接口异常时不阻断数据查询，并提示已回退到演示数据', async () => {
    setActivePinia(createPinia())
    const current = mockSourceDetail({ sourceId: '391007768' })!
    const row: DataRow = {
      dataId: 'row-1', sourceId: current.sourceId, title: '测试行', summary: '',
      acceptState: 'accepted', values: { K1: '正文', K2: 42 },
    }
    useFlowStore().loadFromSource(current, mockSourceSteps({ sourceId: current.sourceId }))
    vi.spyOn(dataApi, 'tableMeta').mockRejectedValue(new Error('业务类型不存在'))
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [row], total: 1 })
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([current])

    const wrapper = shallowMount(ResultView, {
      global: {
        directives: { loading: {} },
        stubs: { CanvasHeader: true, ElDrawer: true, DataGrid: true },
      },
    })
    await flushPromises()

    expect(query).toHaveBeenCalled()
    expect(wrapper.text()).toContain('真实数据接口暂不可用，已切换到本地演示数据')
    expect(wrapper.text()).toContain('1 行')
  })
})
