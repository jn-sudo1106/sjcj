// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ResultView from './ResultView.vue'
import { dataApi, siteApi, type DataTableMeta, type Source } from '../../api'
import { useFlowStore } from '../../stores/flow'
import { mockSourceDetail, mockSourceSteps } from '../../api/mock/sources'

const meta: DataTableMeta = {
  tableId: 'TB_ZFB_COMMENT', tableName: '评论', rowCount: 0,
  fields: [{ prop: 'content', type: 'string', desc: '内容' }],
}

describe('ResultView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('以当前子源流程展示无首尾节点的节点条，并可按所属子源切换至全部范围', async () => {
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

    await wrapper.get('[data-testid="data-source-filter"]').setValue('')
    await flushPromises()
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ siteId: current.siteId, sourceId: undefined }))
  })
})
