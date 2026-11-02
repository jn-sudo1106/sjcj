import { sourceApi, flowCenterApi, type SendCodeConfigPayload, type SendCodeConfigResult } from './index'
import { runnerManagementApi } from './runnerManagement'

/** Resolve business node identity, then persist generation jobs in management DB. */
export async function submitDatabaseCodeTasks(payload: SendCodeConfigPayload): Promise<SendCodeConfigResult> {
  const source = await sourceApi.sourceDetail(payload.sourceId)
  if (!source) throw new Error('源不存在或已删除')
  const steps = await flowCenterApi.steps(payload.flowId, { withConfigDetails: false, ...(payload.ver ? { versionId: payload.ver } : {}) })
  const node = steps.find(step => (payload.stepId ? step.stepId === payload.stepId : step.isRoot) && step.enabled !== false
    && (!step.sourceId || ['-1', '0', payload.sourceId].includes(step.sourceId)))
  if (!node?.configId) throw new Error('流程没有可用的目标配置节点')
  const generation = payload.orchestration?.aiGeneration
  const result = await runnerManagementApi.createCodeGenerationTask({ sourceId: payload.sourceId, sourceName: source.name,
    flowId: payload.flowId, flowVersionId: payload.ver, stepId: node.stepId, configId: node.configId, nodeName: node.name,
    entryIds: payload.entryIds, generation: { ...(generation && typeof generation === 'object' ? generation : {}), url: payload.url || source.url } })
  return { sourceId: payload.sourceId, configId: node.configId, stepConfigId: node.configId, queue: '',
    requestCnt: 1, sendCnt: 1, failCnt: 0, taskIds: [result.job.taskId], tasks: [{ stepId: node.stepId, taskIds: [result.job.taskId], errors: [] }] }
}
