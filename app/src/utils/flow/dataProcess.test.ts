import { describe, expect, it } from 'vitest'
import { buildDataProcessGeneratePayload, scriptParamName } from './dataProcess'

const base = {
  description: 'd', configId: 1, providerCode: 'DeepSeek', model: 'm', sourceTable: 's', targetTable: 't',
  systemPrompt: '',
  inputFields: ['INDICATOR-K1', 'PERIOD-K2'],
  outputFields: ['INDICATOR_STD-K1'],
  inputFieldOptions: [{ itemCode: 'INDICATOR-K1', itemName: '指标名称' }, { itemCode: 'PERIOD-K2', itemName: '时间' }],
  outputFieldOptions: [{ itemCode: 'INDICATOR_STD-K1', itemName: '指标' }],
}

describe('scriptParamName', () => {
  it('去掉旧平台「-K列号」后缀，其余原样', () => {
    expect(scriptParamName('INDICATOR-K1')).toBe('INDICATOR')
    expect(scriptParamName('feed_id-K12')).toBe('feed_id')
    expect(scriptParamName('tdate')).toBe('tdate')
    expect(scriptParamName('a-b')).toBe('a-b')
  })
})

describe('buildDataProcessGeneratePayload', () => {
  it('规则节点开 scriptParamNames：入参编码去后缀，出参保持原编码', () => {
    const payload = buildDataProcessGeneratePayload({ ...base, scriptParamNames: true })
    expect(payload.inputFields).toBe('指标名称:INDICATOR,时间:PERIOD')
    expect(payload.outputFields).toBe('指标:INDICATOR_STD-K1')
  })

  it('不开时（监控类）入参保持原编码', () => {
    expect(buildDataProcessGeneratePayload(base).inputFields).toBe('指标名称:INDICATOR-K1,时间:PERIOD-K2')
  })
})
