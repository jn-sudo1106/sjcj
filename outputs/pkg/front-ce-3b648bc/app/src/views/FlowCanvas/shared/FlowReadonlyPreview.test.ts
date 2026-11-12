// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { flowCenterApi, flowVersionApi, type FlowRecord } from '@/api'
import FlowReadonlyPreview from './FlowReadonlyPreview.vue'

const flow = { id: '10', name: '测试流程' } as FlowRecord
const step = { stepId: '1', sourceId: '', name: '采集', isRoot: true, configId: '12', outputTable: '34', enabled: true }
afterEach(() => vi.restoreAllMocks())

describe('流程只读预览', () => {
  it.each([
    ['发布版优先', '2', '3', '2', '已发布'],
    ['仅有草稿', null, '3', '3', '草稿'],
  ])('%s时预览实际复制的版本', async (_name, publishId, draftId, expectedId, label) => {
    vi.spyOn(flowVersionApi, 'overview').mockResolvedValue({ enabled: true, publishId, draftId, versions: [] } as never)
    const steps = vi.spyOn(flowCenterApi, 'steps').mockResolvedValue([step] as never)
    const wrapper = mount(FlowReadonlyPreview, { props: { flow }, global: { directives: { loading: {} }, stubs: { FlowReadonlyCanvas: true, FlowNodeReadonlyPanel: true } } })
    await flushPromises()
    expect(steps).toHaveBeenCalledWith('10', { versionId: expectedId })
    expect(wrapper.text()).toContain(label)
  })

  it('版本查询失败时显示错误，不把未知版本当作预览结果', async () => {
    vi.spyOn(flowVersionApi, 'overview').mockRejectedValue(new Error('连接失败'))
    const steps = vi.spyOn(flowCenterApi, 'steps')
    const wrapper = mount(FlowReadonlyPreview, { props: { flow }, global: { directives: { loading: {} } } })
    await flushPromises()
    expect(wrapper.text()).toContain('版本读取失败：连接失败')
    expect(steps).not.toHaveBeenCalled()
  })
})
