// 流程绑定读缓存（1107 源详情页加载提速）：进入源画布时主加载、头部流程切换器、流程页签各读一次
// 绑定和流程名，这里验证重复读被合并，以及写操作之后一定重新读。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flowCenterApi, invalidateFlowBindingCache, sourceGroupApi, workflowBindingApi, type FlowRecord, type SourceFlowsView } from './index'

const view: SourceFlowsView = {
  sourceId: '7', flowIds: ['50', '60'], defaultFlowId: '50',
  bindings: [
    { id: '1', sourceId: '7', flowId: '50', isDefault: true, state: 'ACTIVE', revision: 1 },
    { id: '2', sourceId: '7', flowId: '60', isDefault: false, state: 'ACTIVE', revision: 1 },
  ],
  ownFlowIds: ['50', '60'], ownDefaultFlowId: '50', ownBindings: [], ownDataAvailable: true,
}
view.ownBindings = view.bindings

beforeEach(() => invalidateFlowBindingCache())
afterEach(() => vi.restoreAllMocks())

describe('流程绑定读缓存', () => {
  it('短时间内重复读同一个源的绑定和流程名只发一次请求', async () => {
    const readView = vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(view)
    const detail = vi.spyOn(flowCenterApi, 'detail').mockImplementation(async (id) => ({ id, name: `流程${id}` }) as FlowRecord)

    const [a, b] = await Promise.all([workflowBindingApi.list('7'), workflowBindingApi.list('7')])
    await workflowBindingApi.list('7', { withNames: false })

    expect(readView).toHaveBeenCalledTimes(1)
    expect(detail).toHaveBeenCalledTimes(2)
    expect(a.map((row) => row.workflowName)).toEqual(['流程50', '流程60'])
    expect(b).toEqual(a)
  })

  it('改绑定 / 来源组 / 流程的写操作之后重新读', async () => {
    const readView = vi.spyOn(workflowBindingApi, 'view').mockResolvedValue(view)
    vi.spyOn(flowCenterApi, 'detail').mockResolvedValue(null)
    await workflowBindingApi.list('7', { withNames: false })

    // bindFlows 已被 invalidateAround 包过：写之前、写完都会清缓存
    await sourceGroupApi.bindFlows({ sourceGroupId: 'g1', revision: 1, flowIds: [], defaultFlowId: null }).catch(() => {})
    await workflowBindingApi.list('7', { withNames: false })
    expect(readView).toHaveBeenCalledTimes(2)
  })

  it('读失败不缓存，下一次重新请求', async () => {
    const readView = vi.spyOn(workflowBindingApi, 'view').mockRejectedValueOnce(new Error('500')).mockResolvedValue(view)
    await expect(workflowBindingApi.list('7', { withNames: false })).rejects.toThrow('500')
    await workflowBindingApi.list('7', { withNames: false })
    expect(readView).toHaveBeenCalledTimes(2)
  })
})
