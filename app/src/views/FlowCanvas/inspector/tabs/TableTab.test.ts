// @vitest-environment jsdom
// 表配置 Tab：规则节点分支（0804 S2-2，从 RuleOrchestrationTab.test.ts 的「路径 A」迁移而来——
// 表/字段绑定在这里。「保存并配置编排」按钮已移除，生成脚本使用节点保存后的 configId。
// 通过挂载整个 NodeInspector 测试（而非孤立挂载 TableTab），因为 useNodeInspectorAssets() 的
// provide/inject 上下文由 NodeInspector 建立，脱离它调用会抛错（见 useNodeInspectorAssets.ts 设计约束）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import NodeInspector from '../NodeInspector.vue'
import RuleTableFieldBinder from '../RuleTableFieldBinder.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, paramApi, ruleApi } from '@/api'
import { __resetPresetTableCache } from '@/composables/usePresetTables'
import type { EntryType, RuleOrchestration } from '@/api'

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

describe('TableTab · 规则节点表/字段绑定（0804 S2-2 从编排配置搬回）', () => {
  it('展示表/字段绑定表单，不再有「保存并配置编排」按钮', async () => {
    mockAssets()
    const { wrapper } = mountOnRuleNode()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(true)
    expect(wrapper.text()).toContain('入参字段')
    expect(wrapper.text()).not.toContain('保存并配置编排')
  })

  it('已保存过的规则节点回到表配置：仍是可编辑表单，不是只读摘要', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.configs['rule-1'].configId = '1400998'
    flow.patchRuleConfig('rule-1', {
      mode: 'ref',
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

  it('结构化配置和正文规则可清空，空值不会被默认文案重新填回', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnCollectorNode()
    flow.configs['web-1'].collectCfg!.structuredConfig = '{"globals":["列ID"]}'
    flow.configs['web-1'].collectCfg!.contentRules = 'content=trim'
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    const structuredInput = textareas.find((t) => t.attributes('placeholder')?.includes('globals'))!
    const contentRuleInput = textareas.find((t) => t.attributes('placeholder')?.includes('content=trim'))!
    await structuredInput.setValue('')
    await contentRuleInput.setValue('')

    expect(structuredInput.element.value).toBe('')
    expect(contentRuleInput.element.value).toBe('')
    expect(flow.configs['web-1'].collectCfg?.structuredConfig).toBe('')
    expect(flow.configs['web-1'].collectCfg?.contentRules).toBe('')
    expect(flow.configDirty).toBe(true)
  })

  // 2026-09-23：字段多时默认只铺已选的，可切换显示全部；全选 / 一个没选时不出切换按钮
  it('非规则节点：输入字段默认只看已选，可切换显示全部', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchCollect('web-1', { inputTable: INPUT_TABLE.tableId })
    await flushPromises()
    const shown = () => wrapper.get('[data-testid="input-fields-list"]').findAll('.rc-tag').map((t) => t.text())

    // 默认全选：两个都在，没有切换按钮
    expect(shown()).toHaveLength(2)
    expect(wrapper.find('[data-testid="toggle-only-selected-input-fields"]').exists()).toBe(false)

    flow.setInputFields('web-1', ['sku_id'])
    await flushPromises()
    expect(shown()).toHaveLength(1)
    expect(shown()[0]).toContain('sku_id')
    const toggle = wrapper.get('[data-testid="toggle-only-selected-input-fields"]')
    expect(toggle.text()).toBe('显示全部 2 个')
    await toggle.trigger('click')
    expect(shown()).toHaveLength(2)
    expect(wrapper.get('[data-testid="toggle-only-selected-input-fields"]').text()).toBe('只看已选')

    // 一个没选：自动显示全部，不出切换按钮
    await wrapper.find('[data-testid="clear-all-input-fields"]').trigger('click')
    expect(shown()).toHaveLength(2)
    expect(wrapper.find('[data-testid="toggle-only-selected-input-fields"]').exists()).toBe(false)
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
    // 输入表下拉 0902 改成 el-select（原生 <select> 换成可搜索的），清空走 update:model-value
    const inputTableSelect = wrapper.find('[data-testid="input-table-field"]').findComponent({ name: 'ElSelect' })
    await inputTableSelect.vm.$emit('update:modelValue', '')
    await flushPromises()
    expect(flow.configs['web-1'].inputFields).toBeUndefined()
  })

  // 0902：表会很多，下拉不一定翻得到——输入表/输出表都换成 el-select filterable remote，
  // 按关键字查 entryApi.entryPaged，不再只认预加载的 100 张。
  it('输入表下拉支持关键字搜索，选中结果写入 collectCfg.inputTable', async () => {
    mockAssets()
    const search = vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [INPUT_TABLE] })
    const { flow, wrapper } = mountOnCollectorNode()
    await flushPromises()

    const inputTableSelect = wrapper.find('[data-testid="input-table-field"]').findComponent({ name: 'ElSelect' })
    search.mockClear() // 清掉挂载时 useNodeInspectorAssets 预加载 100 张表那一次调用
    // 打开下拉即以空关键字查一次，展示一个默认列表（size:30 与预加载的 size:100 区分开）
    await inputTableSelect.vm.$emit('visible-change', true)
    await flushPromises()
    expect(search).toHaveBeenCalledWith({ name: undefined, size: 30 })

    search.mockClear()
    // remote-method 是传给 el-select 的 prop 函数，不是它 $emit 出来的事件——
    // 拿 props 里那个函数直接调，跟 RuleTableFieldBinder.test.ts 的 onInputTableFilter 同一个思路。
    const remoteMethod = inputTableSelect.props('remoteMethod') as (keyword: string) => void
    remoteMethod('JD')
    await new Promise((resolve) => setTimeout(resolve, 320)) // 防抖 300ms
    await flushPromises()
    expect(search).toHaveBeenCalledWith({ name: 'JD', size: 30 })

    await inputTableSelect.vm.$emit('update:modelValue', INPUT_TABLE.tableId)
    await flushPromises()
    expect(flow.configs['web-1'].collectCfg?.inputTable).toBe(INPUT_TABLE.tableId)
  })

  it('输出表下拉同样支持搜索，选中结果写入 collectCfg.outputTable', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnCollectorNode()
    await flushPromises()

    const outputTableSelect = wrapper.find('[data-testid="output-table-field"]').findComponent({ name: 'ElSelect' })
    await outputTableSelect.vm.$emit('update:modelValue', INPUT_TABLE.tableId)
    await flushPromises()
    expect(flow.configs['web-1'].collectCfg?.outputTable).toBe(INPUT_TABLE.tableId)
  })
})

// 规则/采集节点表配置都不再放「保存并配置编排」（跟底部节点「保存」抢主按钮）；
// 规则节点也去掉了该按钮（2026-09-02），表配置只负责绑表/字段，保存走节点底部主按钮。
// 旧采集配置的 compose 记录仍由编排配置 Tab 处理。
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

// 数据监控节点（2026-09-01）：monitor 复用 rule 种子，表配置只负责输入表/入参字段绑定。
describe('TableTab · 输出字段选择 = 旧平台出参列 OutContext（1010 恢复）', () => {
  const OUT_TABLE: EntryType = {
    tableId: '2103330', tableName: 'sense_data.TB_NEWS', name: '资讯列表',
    fields: [
      { prop: 'title', desc: '标题', type: 'string', required: false, columnName: 'K1' },
      { prop: 'url', desc: '链接', type: 'string', required: false, columnName: 'K2' },
      { prop: 'body', desc: '正文', type: 'text', required: false, columnName: 'K3' },
    ],
  }

  async function mountCollector(outColumns?: string[]) {
    vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [OUT_TABLE] })
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(OUT_TABLE)
    vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.outputTable = '2103330'
    if (outColumns) cfg.taskCfg = { ...(cfg.taskCfg ?? { queue: '', urlRule: '' }), outColumns }
    flow.configs['web-1'] = cfg
    flow.select('web-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    return { flow, wrapper }
  }
  const checked = (wrapper: Awaited<ReturnType<typeof mountCollector>>['wrapper']) =>
    wrapper.findAll('[data-testid="output-fields-list"] .rc-tag.on').map((t) => t.text().split(' ')[0])

  it('出参列为空时不勾选，提示默认使用全部字段', async () => {
    const { wrapper } = await mountCollector()
    expect(checked(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('不选默认全部字段')
  })

  it('后端存的列名 K1/K3 回显成对应字段', async () => {
    const { wrapper } = await mountCollector(['K1', 'K3'])
    expect(checked(wrapper)).toEqual(['title', 'body'])
  })

  it('取消勾选后按列名写回 taskCfg.outColumns（落步骤 outContext）', async () => {
    const { flow, wrapper } = await mountCollector(['K1', 'K2', 'K3'])
    await wrapper.findAll('[data-testid="output-fields-list"] .rc-tag')[1].trigger('click')
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual(['K1', 'K3'])
    await wrapper.get('[data-testid="select-all-fields"]').trigger('click')
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual(['K1', 'K2', 'K3'])
  })

  it('清空后可重新选择字段，并按列名保存', async () => {
    const { flow, wrapper } = await mountCollector(['K1', 'K2', 'K3'])
    await wrapper.get('[data-testid="clear-all-fields"]').trigger('click')
    expect(checked(wrapper)).toEqual([])
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual([])
    await wrapper.findAll('[data-testid="output-fields-list"] .rc-tag')[1].trigger('click')
    expect(checked(wrapper)).toEqual(['url'])
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual(['K2'])
  })
})

describe('TableTab · 数据监控节点（不落表/不出参）', () => {
  function mountOnMonitorNode() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.template = 'monitor'
    flow.configs['monitor-1'] = cfg
    flow.select('monitor-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('不展示「输出表」「出参字段」和「监控方法」', async () => {
    mockAssets()
    const { wrapper } = mountOnMonitorNode()
    await flushPromises()

    expect(wrapper.text()).toContain('入参字段')
    expect(wrapper.text()).not.toContain('出参字段')
    expect(wrapper.text()).not.toContain('输出表')
    expect(wrapper.text()).not.toContain('监控方法')
    expect(wrapper.find('[data-testid="monitor-methods-field"]').exists()).toBe(false)
  })
})

// 2026-09-04：规则节点「保存不了」的真因。
// 写的时候 mergeStepForWrite 把 inputFields/outputFields（itemCode）换成物理列名存进步骤的
// context/outContext；读回来 applyStepTaskFields 只把它们放进 taskCfg.contextMap/outColumns，
// 没有人换回 itemCode 填到 ruleCfg —— 刷新后勾选全空，validateTableBinding 卡在
// 「请至少选择 1 个入参字段」，nodeInspectorTabs 据此把「编排配置」整个 Tab 置灰。
// 实测步骤 41672：后端 context='K1,K2,K3'、outContext='K1,K2,K3' 都在，前端却是 []。
describe('TableTab · 回读时按 context/outContext 还原入出参勾选', () => {
  it('步骤存的是列名 K1/K2，字段表到位后还原成 itemCode，并解除「编排配置」置灰', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    const cfg = flow.configs['rule-1']
    cfg.ruleCfg!.inputTableId = INPUT_TABLE.tableId
    cfg.ruleCfg!.outputTableId = INPUT_TABLE.tableId
    cfg.ruleCfg!.inputFields = []
    cfg.ruleCfg!.outputFields = []
    // 回读时 applyStepTaskFields 放进来的物理列名
    cfg.taskCfg = { ...(cfg.taskCfg ?? { queue: '', urlRule: '' }), contextMap: ['K1', 'K2'], outColumns: ['K2'] }
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg!.inputFields).toEqual(['sku_id', 'sku_name'])
    expect(flow.configs['rule-1'].ruleCfg!.outputFields).toEqual(['sku_name'])

    const orchestration = wrapper.findAll('.rc-top-tab').find((b) => b.text() === '编排配置')!
    expect((orchestration.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('用户已经勾过就不覆盖（只补空，不改选择）', async () => {
    mockAssets()
    const { flow } = mountOnRuleNode()
    const cfg = flow.configs['rule-1']
    cfg.ruleCfg!.inputTableId = INPUT_TABLE.tableId
    cfg.ruleCfg!.inputFields = ['sku_name']
    cfg.taskCfg = { ...(cfg.taskCfg ?? { queue: '', urlRule: '' }), contextMap: ['K1', 'K2'] }
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg!.inputFields).toEqual(['sku_name'])
  })
})

// 0903 欠账 A2：「常用默认表」那四个 ID 在真实后端全都不存在（2026-09-05 实测），
// 点一下会把输出表设成无效 ID、出参变「共 0 个可选」，而界面不报错。
describe('TableTab · 常用默认表按可用性过滤（A2）', () => {
  it('表都查不到时整行不渲染，不留死按钮', async () => {
    __resetPresetTableCache()
    mockAssets()
    // 输入表照常能查到，只有预设表查不到——用 tableId 区分
    vi.spyOn(entryApi, 'entryDetail').mockImplementation(async (id) => {
      if (id === INPUT_TABLE.tableId) return INPUT_TABLE
      throw new Error(`未找到相关ID${id}`)
    })
    const { wrapper } = mountOnRuleNode()
    await flushPromises()
    expect(wrapper.find('[data-testid="rule-table-presets"]').exists()).toBe(false)
  })

  it('表存在时照常显示', async () => {
    __resetPresetTableCache()
    mockAssets()
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(INPUT_TABLE)
    const { wrapper } = mountOnRuleNode()
    await flushPromises()
    expect(wrapper.find('[data-testid="rule-table-presets"]').exists()).toBe(true)
  })
})

// 2026-09-18：翻译助手并入规则式表/字段绑定；绑定内容写 execCfg——不能写 ruleCfg，
// 否则翻译助手会被误判成规则节点、编排配置的模型/脚本工作区整个串位。
describe('TableTab · 翻译助手（与规则处理同一套绑定）', () => {
  function mountOnTranslateNode() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['translate-1'] = cloneConfig(NODE_CONFIGS['translate'])
    flow.select('translate-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('展示规则式表/字段绑定，不出现非规则分支的内容', async () => {
    mockAssets()
    const { wrapper } = mountOnTranslateNode()
    await flushPromises()

    expect(wrapper.text()).toContain('入参字段')
    expect(wrapper.text()).toContain('出参字段')
    expect(wrapper.text()).not.toContain('结构化配置')
    expect(wrapper.text()).not.toContain('正文规则')
    expect(wrapper.text()).not.toContain('去重方式')
  })

  it('绑定结果写进 execCfg（含节点级输入/输出表），ruleCfg 保持不出现', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnTranslateNode()
    await flushPromises()

    wrapper.findComponent(RuleTableFieldBinder).vm.$emit('update:modelValue', {
      inputTableId: INPUT_TABLE.tableId,
      inputTable: INPUT_TABLE.tableName,
      inputFields: ['sku_id'],
      outputTableId: INPUT_TABLE.tableId,
      outputTable: INPUT_TABLE.tableName,
      outputFields: ['sku_name'],
    } as Partial<RuleOrchestration>)
    await flushPromises()

    const cfg = flow.configs['translate-1']
    expect(cfg.ruleCfg).toBeUndefined()
    expect(cfg.execCfg?.inputTableId).toBe(INPUT_TABLE.tableId)
    expect(cfg.execCfg?.inputFields).toEqual(['sku_id'])
    expect(cfg.execCfg?.outputFields).toEqual(['sku_name'])
    expect(cfg.inputTable).toBe(INPUT_TABLE.tableId)
    expect(cfg.outputTable).toBe(INPUT_TABLE.tableId)
  })

  it('回读时按 context/outContext 还原入出参到 execCfg', async () => {
    mockAssets()
    const { flow } = mountOnTranslateNode()
    const cfg = flow.configs['translate-1']
    cfg.execCfg = {
      ...(cfg.execCfg ?? { mode: 'new' as const, format: 'xml' as const, describe: '', script: '', scriptPath: '', enabled: true }),
      inputTableId: INPUT_TABLE.tableId,
      outputTableId: INPUT_TABLE.tableId,
      inputFields: [],
      outputFields: [],
    }
    // 回读时 applyStepTaskFields 放进来的物理列名
    cfg.taskCfg = { ...(cfg.taskCfg ?? { queue: '', urlRule: '' }), contextMap: ['K1', 'K2'], outColumns: ['K2'] }
    await flushPromises()

    expect(flow.configs['translate-1'].execCfg!.inputFields).toEqual(['sku_id', 'sku_name'])
    expect(flow.configs['translate-1'].execCfg!.outputFields).toEqual(['sku_name'])
  })
})

// 2026-09-18：文章打标签与翻译助手同待遇——并入规则式表/字段绑定，绑定内容写 execCfg。
describe('TableTab · 文章打标签（与规则处理同一套绑定）', () => {
  function mountOnTagNode() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['tag-1'] = cloneConfig(NODE_CONFIGS['article-tag'])
    flow.select('tag-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('展示规则式表/字段绑定，不出现非规则分支的内容', async () => {
    mockAssets()
    const { wrapper } = mountOnTagNode()
    await flushPromises()

    expect(wrapper.text()).toContain('入参字段')
    expect(wrapper.text()).toContain('出参字段')
    expect(wrapper.text()).not.toContain('结构化配置')
    expect(wrapper.text()).not.toContain('正文规则')
    expect(wrapper.text()).not.toContain('去重方式')
  })

  it('绑定结果写进 execCfg（含节点级输入/输出表），ruleCfg 保持不出现', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnTagNode()
    await flushPromises()

    wrapper.findComponent(RuleTableFieldBinder).vm.$emit('update:modelValue', {
      inputTableId: INPUT_TABLE.tableId,
      inputTable: INPUT_TABLE.tableName,
      inputFields: ['sku_id'],
      outputTableId: INPUT_TABLE.tableId,
      outputTable: INPUT_TABLE.tableName,
      outputFields: ['sku_name'],
    } as Partial<RuleOrchestration>)
    await flushPromises()

    const cfg = flow.configs['tag-1']
    expect(cfg.ruleCfg).toBeUndefined()
    expect(cfg.execCfg?.inputTableId).toBe(INPUT_TABLE.tableId)
    expect(cfg.execCfg?.inputFields).toEqual(['sku_id'])
    expect(cfg.execCfg?.outputFields).toEqual(['sku_name'])
    expect(cfg.inputTable).toBe(INPUT_TABLE.tableId)
    expect(cfg.outputTable).toBe(INPUT_TABLE.tableId)
  })

  it('回读时按 context/outContext 还原入出参到 execCfg', async () => {
    mockAssets()
    const { flow } = mountOnTagNode()
    const cfg = flow.configs['tag-1']
    cfg.execCfg = {
      ...(cfg.execCfg ?? { mode: 'new' as const, format: 'xml' as const, describe: '', script: '', scriptPath: '', enabled: true }),
      inputTableId: INPUT_TABLE.tableId,
      outputTableId: INPUT_TABLE.tableId,
      inputFields: [],
      outputFields: [],
    }
    cfg.taskCfg = { ...(cfg.taskCfg ?? { queue: '', urlRule: '' }), contextMap: ['K1', 'K2'], outColumns: ['K2'] }
    await flushPromises()

    expect(flow.configs['tag-1'].execCfg!.inputFields).toEqual(['sku_id', 'sku_name'])
    expect(flow.configs['tag-1'].execCfg!.outputFields).toEqual(['sku_name'])
  })
})

// 2026-09-18：文章生成摘要 / 音频提取文字 / 视频提取音频与翻译助手同待遇——
// 并入规则式表/字段绑定，绑定内容写 execCfg 而非 ruleCfg。
// 2026-09-22：OCR 抓取同待遇（用户口径：OCR 的表配置跟翻译助手做成一样）。
describe('TableTab · 摘要/音视频/OCR 处理节点（与规则处理同一套绑定）', () => {
  it.each([
    ['article-summary', '文章生成摘要'],
    ['audio-text', '音频提取文字'],
    ['video-audio', '视频提取音频'],
    ['ocr', 'OCR抓取'],
  ])('%s：展示规则式绑定，绑定结果写进 execCfg，ruleCfg 保持不出现', async (seedKey, title) => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['proc-1'] = { ...cloneConfig(NODE_CONFIGS[seedKey]), title }
    flow.select('proc-1')
    flow.setActiveTab('table')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.text()).toContain('入参字段')
    expect(wrapper.text()).toContain('出参字段')
    expect(wrapper.text()).not.toContain('结构化配置')
    expect(wrapper.text()).not.toContain('去重方式')

    wrapper.findComponent(RuleTableFieldBinder).vm.$emit('update:modelValue', {
      inputTableId: INPUT_TABLE.tableId,
      inputTable: INPUT_TABLE.tableName,
      inputFields: ['sku_id'],
      outputTableId: INPUT_TABLE.tableId,
      outputTable: INPUT_TABLE.tableName,
      outputFields: ['sku_name'],
    } as Partial<RuleOrchestration>)
    await flushPromises()

    const cfg = flow.configs['proc-1']
    expect(cfg.ruleCfg).toBeUndefined()
    expect(cfg.execCfg?.inputTableId).toBe(INPUT_TABLE.tableId)
    expect(cfg.execCfg?.inputFields).toEqual(['sku_id'])
    expect(cfg.execCfg?.outputFields).toEqual(['sku_name'])
    expect(cfg.inputTable).toBe(INPUT_TABLE.tableId)
    expect(cfg.outputTable).toBe(INPUT_TABLE.tableId)
    wrapper.unmount()
  })
})
