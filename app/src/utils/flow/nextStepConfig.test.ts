import { describe, expect, it, vi } from 'vitest'
import { resolveNextStepConfigFromSteps, fetchNextStepConfig } from './nextStepConfig'
import { sourceApi, type Step } from '@/api'

describe('nextStepConfig · 根据当前节点与 nextConfigPaged 解析下一个节点配置', () => {
  const sampleSteps: Step[] = [
    {
      stepId: '0',
      sourceId: '430006252',
      name: '起点列表',
      isRoot: true,
      outputTable: '900',
      enabled: true,
    },
    {
      stepId: '40597',
      sourceId: '430006252',
      name: '详情解析1',
      configId: '1400974',
      inputTable: '900',
      outputTable: '901',
      dependsOn: ['0'],
      enabled: true,
    },
    {
      stepId: '40598',
      sourceId: '430006252',
      name: '规则提取2',
      configId: '1400975',
      inputTable: '901',
      outputTable: '902',
      dependsOn: ['40597'],
      enabled: true,
    },
    {
      stepId: '40600',
      sourceId: '430006252',
      name: '停用节点',
      configId: '1400980',
      inputTable: '902',
      dependsOn: ['40598'],
      enabled: false,
    },
  ]

  it('当前节点为起点时：正确解析到下一个节点（40597 详情解析1，输入表 900）', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '0')
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40597')
    expect(res.targetNodeName).toBe('详情解析1')
    expect(res.targetTableId).toBe('900')
    expect(res.targetConfigId).toBe('1400974')
  })

  it('当前节点为中间节点 40597 时：发后续任务必须定位到它的下一个节点 40598（输入表 901，非当前表 900）', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '40597')
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40598')
    expect(res.targetNodeName).toBe('规则提取2')
    expect(res.targetTableId).toBe('901')
    expect(res.targetConfigId).toBe('1400975')
  })

  it('当前节点为 40598 时：后续节点已停用，返回无法发送原因', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '40598')
    expect(res.hasNext).toBe(false)
    expect(res.allDisabled).toBe(true)
    expect(res.disabledTitles).toContain('停用节点')
  })

  it('末端节点无后继时：返回 hasNext=false', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '40600')
    expect(res.hasNext).toBe(false)
    expect(res.reason).toContain('没有后续节点配置')
  })

  it('多分支后继：返回所有后继步骤并拼出分支说明', () => {
    const branchSteps: Step[] = [
      { stepId: '10', sourceId: '1', name: '父步骤', outputTable: '900', enabled: true },
      { stepId: '11', sourceId: '1', name: '分支A', inputTable: '900', dependsOn: ['10'], condition: 'K1==1', enabled: true },
      { stepId: '12', sourceId: '1', name: '分支B', inputTable: '900', dependsOn: ['10'], condition: 'K1==2', enabled: true },
    ]
    const res = resolveNextStepConfigFromSteps(branchSteps, '10')
    expect(res.hasNext).toBe(true)
    expect(res.nextSteps).toHaveLength(2)
    expect(res.targetNodeName).toBe('分支A、分支B')
    expect(res.branchHint).toContain('K1==1')
    expect(res.branchHint).toContain('K1==2')
  })

  it('fetchNextStepConfig 真实请求 sourceSteps (nextConfigPaged)', async () => {
    const spy = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(sampleSteps)
    const res = await fetchNextStepConfig('430006252', '40597')
    expect(spy).toHaveBeenCalledWith('430006252', { withConfigDetails: false })
    expect(res.targetStepId).toBe('40598')
    expect(res.targetTableId).toBe('901')
  })

  it('真实生产场景：选择html网页下载节点（dev_web_snatch_html_download）发后续，定位到html解析（news_cont）', () => {
    const prodSteps: Step[] = [
      {
        stepId: '0',
        sourceId: '430016821',
        name: '上市公司-配置',
        configId: '1400935',
        topic: 'news_snt',
        isRoot: true,
        outputTable: '900',
        enabled: true,
      },
      {
        stepId: '40597',
        sourceId: '430016821',
        name: '1400935-详情',
        configId: '1400974',
        topic: 'dev_web_snatch_html_download',
        inputTable: '900',
        outputTable: '900',
        dependsOn: ['0'],
        enabled: true,
      },
      {
        stepId: '40598',
        sourceId: '430016821',
        name: '1400935-详情',
        configId: '1400975',
        topic: 'news_cont',
        inputTable: '900',
        outputTable: '900',
        dependsOn: ['40597'],
        enabled: true,
      },
    ]

    const res = resolveNextStepConfigFromSteps(prodSteps, '40597')
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40598')
    expect(res.targetConfigId).toBe('1400975')
    expect(res.nextStep?.topic).toBe('news_cont')
    expect(res.nextStep?.topic).not.toBe('dev_web_snatch_html_download')
  })

  it('节点 ID 即使是非数字别名，只要携带 currentConfig 也能精准定位到后继 news_cont', () => {
    const prodSteps: Step[] = [
      { stepId: '0', sourceId: '1', name: '列表', configId: '100', topic: 'news_snt', isRoot: true, outputTable: '900', enabled: true },
      { stepId: '40597', sourceId: '1', name: '下载', configId: '1400974', topic: 'dev_web_snatch_html_download', inputTable: '900', outputTable: '900', dependsOn: ['0'], enabled: true },
      { stepId: '40598', sourceId: '1', name: '解析', configId: '1400975', topic: 'news_cont', inputTable: '900', outputTable: '900', dependsOn: ['40597'], enabled: true },
    ]

    const res = resolveNextStepConfigFromSteps(prodSteps, 'web-download-node', {
      configId: '1400974',
      queue: 'dev_web_snatch_html_download',
    })
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40598')
    expect(res.targetConfigId).toBe('1400975')
    expect(res.nextStep?.topic).toBe('news_cont')
  })
})
