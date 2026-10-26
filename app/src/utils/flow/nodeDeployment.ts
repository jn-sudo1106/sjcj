import { watch } from 'vue'
import { flowCenterApi } from '@/api'
import { runnerManagementApi } from '@/api/runnerManagement'
import { runnerManagementAvailable } from '@/constants/deployGates'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { canvasFlowIdOf } from '@/stores/flowVersion'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

/** Capture the saved node, so an asynchronous request cannot attach to a newly selected node. */
export async function syncNodeDeployment(node: NodeConfig, nodeId: string, scriptDigest?: string, queueOverride?: string) {
  if (!runnerManagementAvailable()) return null
  const flow = useFlowStore(), source = useSourceStore()
  const flowId = canvasFlowIdOf(flow), configId = node.configId
  if (!flowId || !configId) return null
  const nodeName = node.title || node.configName || configId, queueName = queueOverride ?? node.taskCfg?.queue?.trim() ?? ''
  const origin = () => {
    const currentId = Object.entries(flow.configs).find(([, value]) => value === node)?.[0] || nodeId
    const snapshot = source.stepSnapshots[currentId]
    return snapshot?.stepId || (/^\d+$/.test(currentId) ? currentId : currentId.startsWith('source:') ? '0' : '')
  }
  let stepId = origin()
  if (!stepId) {
    stepId = await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => { stop(); reject(new Error('节点还未保存到流程，补全节点配置后重试生成部署配置')) }, 15_000)
      const stop = watch(origin, value => { if (value) { window.clearTimeout(timeout); stop(); resolve(value) } })
    })
  }
  const record = await flowCenterApi.detail(flowId)
  if (!record) throw new Error('来源流程不存在，无法生成部署配置')
  return runnerManagementApi.ensureNodeDeployment({ sourceNode: { flowId, flowName: record.name || flow.flowName,
    stepId, nodeName, configId }, queueName,
    ...(scriptDigest ? { scriptDigest } : {}) })
}
