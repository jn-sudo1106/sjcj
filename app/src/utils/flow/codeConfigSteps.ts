import { flowCenterApi, sourceApi, type Step } from '@/api'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { resolveNextStepConfigFromSteps } from './nextStepConfig'
import type { CodeConfigTarget } from './codeConfigTargets'

export interface CodeStepChoice { key: string; name: string; flowId: string; stepId: string; targets: CodeConfigTarget[] }

/** 只复制编排页内容，不夹带整节点、流程和源配置。保留空值、false、0 及扩展字段。 */
export function orchestrationForNode(config: NodeConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    ...(config.ruleCfg ?? config.execCfg ?? {}),
    ...((config.ruleCfg ?? config.execCfg)?.structuredConfig === undefined && (config.coreParam ?? config.collectCfg?.structuredConfig ?? config.structuredConfig) !== undefined ? { structuredConfig: config.coreParam ?? config.collectCfg?.structuredConfig ?? config.structuredConfig } : {}),
    ...((config.ruleCfg ?? config.execCfg)?.contentRules === undefined && (config.collectCfg?.contentRules ?? config.contentRules) !== undefined ? { contentRules: config.collectCfg?.contentRules ?? config.contentRules } : {}),
    ...(config.monitorMethods !== undefined ? { monitorMethods: config.monitorMethods } : {}),
    ...(config.alertConfig !== undefined ? { alertConfig: config.alertConfig } : {}),
  }))
}

export function withNodeOrchestration(target: CodeConfigTarget, configs?: Record<string, NodeConfig>): CodeConfigTarget {
  if (target.orchestration !== undefined || !target.stepId || !configs) return target
  const config = configs[target.stepId] ?? Object.values(configs).find(value => String((value as NodeConfig & { stepId?: string }).stepId ?? '') === target.stepId)
  return config ? { ...target, orchestration: orchestrationForNode(config) } : target
}

/** 一个选项表示一个流程中的单一步骤，可覆盖选中数据里适用于它的多个源。 */
export async function loadCodeStepChoices(targets: CodeConfigTarget[]): Promise<CodeStepChoice[]> {
  const choices = new Map<string, CodeStepChoice>()
  const flows = new Map<string, Step[]>()
  for (const target of targets) {
    const source = target.flowId ? undefined : await sourceApi.sourceDetail(target.sourceId)
    const flowId = target.flowId || source?.defaultFlowId || source?.flowId
    if (!flowId || flowId === '0') throw new Error(`源 ${target.sourceId} 没有生效的默认流程`)
    const flowKey = `${flowId}:${target.ver || ''}`
    let steps = flows.get(flowKey)
    if (!steps) {
      steps = await flowCenterApi.steps(flowId, { withConfigDetails: false, backendScope: 'default', ...(target.ver ? { versionId: target.ver } : {}) })
      flows.set(flowKey, steps)
    }
    const candidates = target.fromStepId ? resolveNextStepConfigFromSteps(steps, target.fromStepId).downstreamSteps : steps
    for (const step of candidates) {
      if (step.isRoot || step.enabled === false || !/^[1-9]\d*$/.test(step.stepId)) continue
      if (step.sourceId && step.sourceId !== '-1' && step.sourceId !== target.sourceId) continue
      if (String(step.inputTable || '') !== String(target.entryTypeId)) continue
      if (target.stepId && step.stepId !== target.stepId) continue
      const key = `${flowKey}:${step.stepId}`
      const choice = choices.get(key) ?? { key, name: step.name || step.stepId, flowId, stepId: step.stepId, targets: [] }
      choice.targets.push({ ...target, flowId, stepId: step.stepId, entryIds: [...(target.entryIds ?? [])] })
      choices.set(key, choice)
    }
  }
  return [...choices.values()]
}
