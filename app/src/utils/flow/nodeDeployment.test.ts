// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { flowCenterApi } from '@/api'
import { runnerManagementApi } from '@/api/runnerManagement'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'
import { syncNodeDeployment } from './nodeDeployment'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ id: '123', name: '新闻流程' } as never)
  vi.spyOn(runnerManagementApi, 'ensureNodeDeployment').mockResolvedValue({ deploymentId: 'deployment' } as never)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs() })
function fixture(id = '456') {
  const flow = useFlowStore()
  flow.flowId = '123'; flow.setFlowIdMode(true)
  flow.configs[id] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '1401081', taskCfg: { queue: 'news_list', urlRule: '' } }
  flow.select(id)
  return { flow, node: flow.configs[id]! }
}
it('使用真实流程名称和已保存节点，不随当前选择变化', async () => {
  const { flow, node } = fixture()
  const pending = syncNodeDeployment(node, '456', 'sha256:code')
  flow.configs['999'] = { ...node, configId: 'other' }; flow.select('999')
  await pending
  expect(runnerManagementApi.ensureNodeDeployment).toHaveBeenCalledWith({ sourceNode: {
    flowId: '123', flowName: '新闻流程', stepId: '456', nodeName: node.title, configId: '1401081',
  }, queueName: 'news_list', scriptDigest: 'sha256:code' })
})
it('新节点等待自动保存得到真实步骤 ID 后再创建，避免临时 ID 产生重复部署', async () => {
  const { flow, node } = fixture('draft-node')
  const pending = syncNodeDeployment(node, 'draft-node')
  expect(runnerManagementApi.ensureNodeDeployment).not.toHaveBeenCalled()
  flow.configs['456'] = node; delete flow.configs['draft-node']
  useSourceStore().stepSnapshots['456'] = { stepId: '456', configId: '1401081' } as never
  await flushPromises(); await pending
  expect(runnerManagementApi.ensureNodeDeployment).toHaveBeenCalledWith(expect.objectContaining({ sourceNode: expect.objectContaining({ stepId: '456' }) }))
})
it('未落库节点超时保留可重试错误，不创建临时部署', async () => {
  vi.useFakeTimers()
  const { node } = fixture('draft-node')
  const rejected = expect(syncNodeDeployment(node, 'draft-node')).rejects.toThrow('节点还未保存到流程')
  await vi.advanceTimersByTimeAsync(15_000); await rejected
  expect(runnerManagementApi.ensureNodeDeployment).not.toHaveBeenCalled()
})
it('部署构建中虚拟源首节点按步骤 0 关联，无流程时不调用接口', async () => {
  vi.stubEnv('DEV', false)
  const { flow, node } = fixture('source:1401081')
  await syncNodeDeployment(node, 'source:1401081')
  expect(runnerManagementApi.ensureNodeDeployment).toHaveBeenCalledWith(expect.objectContaining({ sourceNode: expect.objectContaining({ stepId: '0' }) }))
  vi.mocked(runnerManagementApi.ensureNodeDeployment).mockClear()
  flow.flowId = 'flow-default'
  expect(await syncNodeDeployment(node, 'source:1401081')).toBeNull()
  expect(runnerManagementApi.ensureNodeDeployment).not.toHaveBeenCalled()
})
