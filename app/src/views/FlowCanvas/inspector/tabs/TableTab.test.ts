// @vitest-environment jsdom
// 表配置 Tab：规则节点分支（0804 S2-2，从 RuleOrchestrationTab.test.ts 的「路径 A」迁移而来——
// 表/字段绑定搬去了这里，跟非规则节点共用同一个 Tab）。中间「保存并配置编排」已去掉，
// 换数字 ruleId 改到第一次生成脚本；绑完表字段即可解锁编排配置 Tab。
// 通过挂载整个 NodeInspector 测试（而非孤立挂载 TableTab），因为 useNodeInspectorAssets() 的
// provide/inject 上下文由 NodeInspector 建立，脱离它调用会抛错（见 useNodeInspectorAssets.ts 设计约束）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import NodeInspector from '../NodeInspector.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, paramApi, ruleApi } from '@/api'
import type { EntryType } from '@/api'

const INPUT_TABLE: EntryType = {
  tableId: '2102154', tableName: 'sense_data.TB_JD_SKU_BASE', name: 'JD-商品基础',
  fields: [
    { prop: 'sku_id', desc: '商品ID', type: 'string', required: false, columnName: 'K1' },
    { prop: 'sku_name', desc: '商品名称', type: 'string', required: false, columnName: 'K2' },
  ],
}

function mockAssets() {
  vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [INPUT_TABLE] })
  vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(INPUT_TABLE)
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
  flow.setActiveTab('table')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  return { flow, wrapper }
}

function orchestrationTab(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.rc-top-tab').find((b) => b.text() === '编排配置')!
}

describe('TableTab · 规则节点表/字段绑定（0804 S2-2 从编排配置搬回）', () => {
  it('展示表/字段绑定表单，没有中间「保存并配置编排」', async () => {
    mockAssets()
    const { wrapper } = mountOnRuleNode()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(true)
    expect(wrapper.text()).toContain('入参字段')
    expect(wrapper.text()).not.toContain('保存并配置编排')
    expect(wrapper.find('.rc-insp-foot button.rc-btn.primary').text()).toMatch(/保存/)
  })

  it('未选表时编排配置 Tab 仍禁用，且不调用 orchestrationSaveMeta', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationSaveMeta')
    const { wrapper } = mountOnRuleNode()
    await flushPromises()

    expect(ruleApi.orchestrationSaveMeta).not.toHaveBeenCalled()
    expect(orchestrationTab(wrapper).attributes('disabled')).toBeDefined()
  })

  it('选表后字段默认全选（0804 S2-3），同步 NodeConfig 输入表，解锁编排配置，不调用 saveMeta', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationSaveMeta')
    const { flow, wrapper } = mountOnRuleNode()
    flow.setTitle('rule-1', '邮箱附件转换指标数据规则')
    await flushPromises()

    // 只在 Tab 正文里找：配置条上还有一个「本节点使用配置」选择器（0828 §2.1-2b），
    // 按全局第一个 ElSelect 取会取到它。
    const tableSelects = wrapper.find('.rc-inspector-body').findAllComponents({ name: 'ElSelect' })
    expect(tableSelects.length).toBeGreaterThanOrEqual(1)
    await tableSelects[0].vm.$emit('visible-change', true)
    await flushPromises()
    await tableSelects[0].vm.$emit('update:modelValue', '2102154')
    // 表选中 → useRuleTableFields 异步拉字段 → RuleTableFieldBinder 的默认全选 watch 再回填 modelValue，
    // 链路要经过好几轮微任务/响应式调度，单次 flushPromises 未必能追上，多等几轮。
    await flushPromises()
    await flushPromises()
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.inputFields).toEqual(['sku_id', 'sku_name'])
    expect(flow.configs['rule-1'].ruleCfg?.outputFields).toEqual(['sku_id', 'sku_name'])
    expect(flow.configs['rule-1'].inputTable).toBe('2102154')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBeFalsy()
    expect(ruleApi.orchestrationSaveMeta).not.toHaveBeenCalled()
    expect(orchestrationTab(wrapper).attributes('disabled')).toBeUndefined()
    expect(flow.activeTab).toBe('table')
  })

  it('已保存过的规则节点回到表配置：仍是可编辑表单，不是只读摘要，也没有中间保存按钮', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: 'orch-173',
      inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(true)
    expect(wrapper.text()).toContain('入参字段')
    expect(wrapper.text()).not.toContain('修改表字段')
    expect(wrapper.text()).not.toContain('保存并配置编排')
  })
})

// 结构化配置（入库配置）+ 正文规则（0804 S3-1）：只跟采集节点有关（0805 改判：规则节点表配置
// 不再有这两块，见 RuleTableFieldBinder 的入参/出参字段绑定）。
describe('TableTab · 结构化配置 / 正文规则（0804 S3-1，0805 收窄为仅采集节点）', () => {
  function mountOnCollectorNode() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('规则节点：表配置 Tab 不再出现结构化配置/正文规则输入框', async () => {
    mockAssets()
    const { wrapper } = mountOnRuleNode()
    await flushPromises()

    expect(wrapper.text()).not.toContain('结构化配置')
    expect(wrapper.text()).not.toContain('正文规则')
  })

  it('采集节点：填写后写入 collectCfg.structuredConfig / contentRules（走 store 双轨 setter）', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnCollectorNode()
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    const structuredInput = textareas.find((t) => t.attributes('placeholder')?.includes('globals'))!
    const contentRuleInput = textareas.find((t) => t.attributes('placeholder')?.includes('content=trim'))!
    await structuredInput.setValue('{"table":"T2"}')
    await contentRuleInput.setValue('summary=truncate(200)')

    expect(flow.configs['web-1'].collectCfg?.structuredConfig).toBe('{"table":"T2"}')
    expect(flow.configs['web-1'].collectCfg?.contentRules).toBe('summary=truncate(200)')
    expect(flow.configs['web-1'].structuredConfig).toBeUndefined()
  })

  it('非规则节点：表配置展示输入表/输入字段，默认全选且切换表后恢复默认', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchCollect('web-1', { inputTable: INPUT_TABLE.tableId })
    await flushPromises()

    expect(wrapper.text()).toContain('输入字段选择')
    expect(flow.configs['web-1'].inputFields).toBeUndefined()
    await wrapper.find('[data-testid="clear-all-input-fields"]').trigger('click')
    expect(flow.configs['web-1'].inputFields).toEqual([])
    await wrapper.find('[data-testid="select-all-input-fields"]').trigger('click')
    expect(flow.configs['web-1'].inputFields).toEqual(['sku_id', 'sku_name'])
    await wrapper.find('select').setValue('')
    expect(flow.configs['web-1'].inputFields).toBeUndefined()
  })
})

// 规则/采集节点表配置都不再放「保存并配置编排」（跟底部节点「保存」抢主按钮）；
// 换数字 ruleId 改在编排配置第一次「生成脚本/生成配置」时自动 orchestrationSaveMeta。
describe('TableTab · 不再展示「保存并配置编排」', () => {
  function mountOnCollectorNode() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('采集节点表配置没有「保存并配置编排」，节点保存仍在底部条', async () => {
    mockAssets()
    const { wrapper } = mountOnCollectorNode()
    await flushPromises()

    expect(wrapper.text()).not.toContain('保存并配置编排')
    expect(wrapper.find('.rc-insp-foot button.rc-btn.primary').text()).toMatch(/保存/)
  })
})

// 去重列（0828 D11）：会上「去重列丢了，要加回来」。它是派生值——由输出表字段的「去重」勾选聚合，
// 旧平台也是这么拼 uniqueKey 的（配置详情接口本身不返回它，见 api/legacyAdapters.ts:342）。
describe('TableTab · 去重列（0828 D11）', () => {
  const DEDUP_TABLE: EntryType = {
    tableId: '2103330', tableName: 'sense_data.TB_NEWS', name: '资讯列表',
    fields: [
      { prop: 'title', desc: '标题', type: 'string', required: false, columnName: 'K1', dedup: true },
      { prop: 'url', desc: '链接', type: 'string', required: false, columnName: 'K2', dedup: true },
      { prop: 'body', desc: '正文', type: 'text', required: false, columnName: 'K3' },
    ],
  }

  async function mountWithTable(table: EntryType, outputTable: string) {
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [table] })
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(table)
    vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.outputTable = outputTable
    flow.configs['web-1'] = cfg
    flow.select('web-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    return wrapper
  }

  it('展示输出表里勾了「去重」的字段', async () => {
    const wrapper = await mountWithTable(DEDUP_TABLE, '2103330')
    expect(wrapper.get('[data-testid="dedup-columns"]').text()).toBe('title、url')
  })

  it('没有字段勾去重时显示占位，并提示去表字段里勾', async () => {
    const noDedup: EntryType = { ...DEDUP_TABLE, fields: DEDUP_TABLE.fields.map((f) => ({ ...f, dedup: false })) }
    const wrapper = await mountWithTable(noDedup, '2103330')
    expect(wrapper.get('[data-testid="dedup-columns"]').text()).toBe('—')
    expect(wrapper.text()).toContain('勾选「去重」')
  })

  it('还没选输出表时提示先选表', async () => {
    const wrapper = await mountWithTable(DEDUP_TABLE, '')
    expect(wrapper.get('[data-testid="dedup-columns"]').text()).toBe('—')
    expect(wrapper.text()).toContain('先选择输出表')
  })
})
