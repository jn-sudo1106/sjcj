// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flowCenterApi, sourceApi, type Step } from '@/api'
import { useSourceStore } from '@/stores/source'
import { fetchNextStepConfig } from './nextStepConfig'

afterEach(() => vi.restoreAllMocks())

describe('发后续任务的流程范围', () => {
  const auxiliary: Step[] = [
    { stepId: '41895', sourceId: '-1', name: '智能采集', configId: '1401218', isRoot: true, enabled: true, outputTable: '900' },
    { stepId: '41896', sourceId: '-1', name: '辅助后续', configId: '1401219', dependsOn: ['41895'], enabled: true, inputTable: '900' },
  ]
  const primary: Step[] = [
    { ...auxiliary[0], stepId: '40596', configId: '1400935' },
    { ...auxiliary[1], stepId: '40597', name: '主流程后续', configId: '1400974', dependsOn: ['40596'] },
  ]

  it.each(['正常', '失败', '空结果'])('当前流程接口%s时，不读取默认流程或混用其他流程快照', async (state) => {
    setActivePinia(createPinia())
    useSourceStore().rememberSteps(primary, 'replace')
    const bySource = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(primary)
    const byFlow = vi.spyOn(flowCenterApi, 'steps')
    if (state === '失败') byFlow.mockRejectedValue(new Error('network'))
    else byFlow.mockResolvedValue(state === '正常' ? auxiliary : [])
    const result = await fetchNextStepConfig('430024910', '41895', auxiliary, {
      flowId: '21000040', configId: '1401218', title: '智能采集',
    })
    expect(byFlow).toHaveBeenCalledWith('21000040', { withConfigDetails: false, backendScope: 'default' })
    expect(bySource).not.toHaveBeenCalled()
    expect(result.targetStepId).toBe('41896')
    expect(result.targetConfigId).toBe('1401219')
  })

  it('当前流程加载失败且没有同流程兜底时，不使用其他流程的缓存', async () => {
    setActivePinia(createPinia())
    useSourceStore().rememberSteps(primary, 'replace')
    vi.spyOn(flowCenterApi, 'steps').mockRejectedValue(new Error('network'))
    vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(primary)
    const result = await fetchNextStepConfig('430024910', '0', [], { flowId: '21000040' })
    expect(result.hasNext).toBe(false)
    expect(result.downstreamSteps).toEqual([])
  })
})
