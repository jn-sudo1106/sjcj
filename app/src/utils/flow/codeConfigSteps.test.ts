import { beforeEach, expect, it, vi } from 'vitest'
import { flowCenterApi, sourceApi, type Step } from '@/api'
import { loadCodeStepChoices, orchestrationForNode } from './codeConfigSteps'
vi.mock('@/api', () => ({ flowCenterApi: { steps: vi.fn() }, sourceApi: { sourceDetail: vi.fn() } }))
beforeEach(() => vi.resetAllMocks())
it('只展示当前流程、入参表及来源匹配的启用后续步骤；多源共享同一步骤合并为一个选项', async () => {
  const steps: Step[] = [
    { stepId: '1', sourceId: '-1', name: 'ROOT', isRoot: true, enabled: true },
    { stepId: '2', sourceId: '-1', name: '解析', inputTable: '11', dependsOn: ['1'], enabled: true },
    { stepId: '3', sourceId: '-1', name: '别表', inputTable: '12', dependsOn: ['1'], enabled: true },
    { stepId: '4', sourceId: '-1', name: '停用', inputTable: '11', dependsOn: ['1'], enabled: false },
    { stepId: '5', sourceId: '9', name: '别源', inputTable: '11', dependsOn: ['1'], enabled: true },
    { stepId: '6', sourceId: '-1', name: '不在下游', inputTable: '11', enabled: true },
  ]
  vi.mocked(flowCenterApi.steps).mockResolvedValue(steps)
  const choices = await loadCodeStepChoices([{ sourceId: '7', flowId: '50', fromStepId: '1', entryTypeId: 11, entryIds: ['901'] }, { sourceId: '8', flowId: '50', fromStepId: '1', entryTypeId: 11, entryIds: ['902'] }])
  expect(choices.map(choice => choice.stepId)).toEqual(['2'])
  expect(choices[0]!.targets.map(target => target.sourceId)).toEqual(['7', '8'])
  expect(choices[0]!.targets.every(target => target.stepId === '2')).toBe(true)
  expect(flowCenterApi.steps).toHaveBeenCalledOnce()
  expect(flowCenterApi.steps).toHaveBeenCalledWith('50', { withConfigDetails: false, backendScope: 'default' })
})
it('无流程上下文的数据列表按源默认流程查询，明确携带版本时沿用版本', async () => {
  vi.mocked(sourceApi.sourceDetail).mockResolvedValue({ sourceId: '7', defaultFlowId: '50' } as never)
  vi.mocked(flowCenterApi.steps).mockResolvedValue([{ stepId: '2', sourceId: '-1', name: '解析', inputTable: '11', enabled: true }])
  const choices = await loadCodeStepChoices([{ sourceId: '7', ver: '500', entryTypeId: 11, entryIds: ['901'] }])
  expect(choices[0]!.targets[0]).toMatchObject({ sourceId: '7', flowId: '50', stepId: '2', ver: '500', entryIds: ['901'] })
  expect(flowCenterApi.steps).toHaveBeenCalledWith('50', { withConfigDetails: false, backendScope: 'default', versionId: '500' })
})
it('编排参数快照保留全部扩展字段、false、0 与空值，不夹带整节点', () => {
  const cfg = { title: '节点', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], configId: '20', execCfg: { mode: 'new' as const, describe: '', enabled: false, structuredConfig: '{"count":0}', custom: { value: 0, text: '', enabled: false } } }
  const snapshot = orchestrationForNode(cfg)
  expect(snapshot).toEqual(cfg.execCfg)
  cfg.execCfg.custom.value = 1
  expect(snapshot).toMatchObject({ custom: { value: 0 } })
  expect(snapshot).not.toHaveProperty('configId')
})
