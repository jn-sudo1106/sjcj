// @vitest-environment jsdom
// 节点配置 Tab：规则节点「选择已有规则」（0805 恢复 D3 砍掉的能力，按会议原话"新建是新建、选是选"
// 分开做——节点名称输入框只管新建/改名，单独一个按钮 + 弹窗管选择，见方案 §1.3）。
// 通过挂载整个 NodeInspector 测试（而非孤立挂载 ConfigTab），因为 useNodeInspectorAssets() 的
// provide/inject 上下文由 NodeInspector 建立，脱离它调用会抛错（见 useNodeInspectorAssets.ts 设计约束）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import NodeInspector from '../NodeInspector.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, paramApi, ruleApi } from '@/api'
import type { EntryType, RuleOrchestrationItem } from '@/api'

const OUTPUT_TABLE: EntryType = {
  tableId: '2102200', tableName: 'sense_data.TB_EXISTING', name: '既有规则输入表',
  fields: [{ prop: 'sku_id', desc: '商品ID', type: 'string', required: false, columnName: 'K1' }],
}

const EXISTING_RULE: RuleOrchestrationItem = {
  ruleId: '173', name: '邮箱附件转换指标数据规则', describe: '转换描述', script: 'def main():\n    return {}',
  scriptPath: '/code01/a.py', enabled: true, createdAt: '2026-07-01', dataSource: 'dp-wwdata',
  inputTable: 'sense_data.TB_EXISTING', inputFields: ['sku_id'], outputFields: ['sku_id'], userCode: 'admin',
}

function mockAssets() {
  vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [OUTPUT_TABLE] })
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'ruleGroups').mockResolvedValue([])
  vi.spyOn(ruleApi, 'rulePaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'sharedConfigs').mockResolvedValue([])
}

afterEach(() => vi.restoreAllMocks())

function mountOnRuleNode() {
  setActivePinia(createPinia())
  const flow = useFlowStore()
  flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
  flow.select('rule-1')
  flow.setActiveTab('config')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  return { flow, wrapper }
}

describe('ConfigTab · 规则节点「选择已有规则」（0805）', () => {
  it('规则节点：节点名称旁有「选择已有」按钮；非规则节点没有', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationOwnRules').mockResolvedValue([])
    const { wrapper } = mountOnRuleNode()
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text() === '选择已有')).toBe(true)

    setActivePinia(createPinia())
    const flow2 = useFlowStore()
    flow2.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow2.select('web-1')
    flow2.setActiveTab('config')
    const wrapper2 = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper2.findAll('button').some((b) => b.text() === '选择已有')).toBe(false)
  })

  it('点「选择已有」打开弹窗，列出 orchestrationOwnRules 返回的规则', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationOwnRules').mockResolvedValue([EXISTING_RULE])
    const { wrapper } = mountOnRuleNode()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '选择已有')!.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationOwnRules).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('邮箱附件转换指标数据规则')
  })

  it('选中一项：拉详情、反查表 ID、写回 title + ruleCfg，弹窗关闭', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationOwnRules').mockResolvedValue([EXISTING_RULE])
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({
      mode: 'ref', ruleId: '173', name: '邮箱附件转换指标数据规则', describe: '转换描述',
      systemPrompt: '提示词', scriptPath: '/code01/a.py', script: 'def main():\n    return {}',
      enabled: true, dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_EXISTING',
      inputFields: ['sku_id'], outputFields: ['sku_id'],
    })
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '选择已有')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('邮箱附件转换指标数据规则'))!.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('173')
    expect(flow.configs['rule-1'].title).toBe('邮箱附件转换指标数据规则')
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('173')
    expect(flow.configs['rule-1'].ruleCfg?.inputTableId).toBe('2102200')
    expect(flow.configs['rule-1'].inputTable).toBe('2102200')
  })

  it('反查输入表搜不到时：不阻塞，仍套用规则其余字段，只是给出提示', async () => {
    mockAssets()
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 0, list: [] }) // 搜不到匹配的表
    vi.spyOn(ruleApi, 'orchestrationOwnRules').mockResolvedValue([EXISTING_RULE])
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({
      mode: 'ref', ruleId: '173', name: '邮箱附件转换指标数据规则', describe: '转换描述',
      inputTable: 'sense_data.TB_EXISTING', scriptPath: '/code01/a.py',
    })
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '选择已有')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('邮箱附件转换指标数据规则'))!.trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('173')
    expect(flow.configs['rule-1'].ruleCfg?.inputTableId).toBe('')
  })
})
