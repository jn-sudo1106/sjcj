// @vitest-environment jsdom
// 任务配置 Tab · 输入字段与上下文统一由表配置维护；任务 URL（来源字段 / 表达式）在任务配置维护。
// 旧实现：旧 SourceStep.vue 的 `<d-entry-item-multi-select :type="form.entryTypeId">`
//        + page/base/EntryItemMultiSelect.vue —— 一个多选下拉，候选是 queryEntryType(表).items
//        全量字段，选项文案 `[columnName] - itemName - [itemCode]`，值按 columnName 逗号连接。
// 通过挂载整个 NodeInspector 测（useNodeInspectorAssets 的 provide 由主壳建立）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import NodeInspector from '../NodeInspector.vue'
import { useFlowStore } from '@/stores/flow'
import { useDictStore } from '@/stores/dict'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, paramApi, ruleApi } from '@/api'
import type { EntryType } from '@/api'

const INPUT_TABLE: EntryType = {
  tableId: '900', tableName: 'sense_data.TB_CNEWS', name: '通用新闻表',
  fields: [
    { prop: 'title-K1', desc: '标题', type: 'string', required: false, columnName: 'K1' },
    { prop: 'url-K2', desc: 'URL', type: 'string', required: false, columnName: 'K2' },
    { prop: 'publish_date-K3', desc: '发布时间', type: 'string', required: false, columnName: 'K3' },
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

/** 保留不一致的旧草稿，用于验证以持久化 context 为准。 */
async function mountTaskTab(contextMap: string[] = [], outColumns?: string[]) {
  mockAssets()
  setActivePinia(createPinia())
  const flow = useFlowStore()
  const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
  cfg.collectCfg!.inputTable = '900'
  cfg.inputFields = ['title-K1']
  if (outColumns) cfg.collectCfg!.outputTable = '900'
  cfg.taskCfg = { queue: '', urlRule: '', contextMap, ...(outColumns ? { outColumns } : {}) }
  flow.configs['web-1'] = cfg
  flow.select('web-1')
  flow.setActiveTab('task')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return { flow, wrapper }
}
describe('TaskTab · 输入字段统一由表配置维护', () => {
  it('任务页移除独立上下文选择，原值保持不变', async () => {
    const { flow, wrapper } = await mountTaskTab(['K2'])
    expect(wrapper.find('[data-testid="context-map-select"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('上下文来源')
    expect(flow.configs['web-1'].taskCfg?.contextMap).toEqual(['K2'])
    wrapper.unmount()
  })

  it('参数候选跟随持久化 context，不读取旧 inputFields', async () => {
    const { flow, wrapper } = await mountTaskTab(['K2'])
    flow.configs['web-1'].execCfg = { mode: 'new', describe: '', inputFields: [] }
    flow.patchCollect('web-1', { urlParamRefs: ['p1'] })
    await flushPromises()
    const options = wrapper.findAll('.ni-task-param-row select option').map((option) => option.attributes('value'))
    expect(options).toEqual(['', 'url-K2'])
    flow.setActiveTab('table')
    await flushPromises()
    await wrapper.get('[data-testid="select-all-input-fields"]').trigger('click')
    flow.setActiveTab('task')
    await flushPromises()
    expect(wrapper.findAll('.ni-task-param-row select option').map((option) => option.attributes('value')))
      .toEqual(['', 'title-K1', 'url-K2', 'publish_date-K3'])
    expect(flow.configs['web-1'].taskCfg?.contextMap).toEqual(['K1', 'K2', 'K3'])
    wrapper.unmount()
  })
})

describe('TaskTab · 默认队列名称（2026-10-14 起取节点类型 topic）', () => {
  it.each([
    ['rule', 'dev_web_rulehandle'],
    ['ocr', 'dev_web_snatch_ocr'],
    ['translate', 'dev_web_translate'],
    ['article-summary', 'dev_web_llm_generate'],
    ['article-tag', 'dev_web_llm_generate'],
    ['audio-text', 'dev_web_audiototext'],
    ['video-audio', 'dev_web_videotoaudio'],
  ])('新增节点 %s 任务配置回显默认队列 %s', async (template, expectedQueue) => {
    mockAssets()
    setActivePinia(createPinia())
    useDictStore().nodeTypeTopics = {
      '600': 'dev_web_rulehandle', '150': 'dev_web_snatch_ocr', '800': 'dev_web_translate', '720': 'dev_web_llm_generate',
      '730': 'dev_web_llm_generate', '710': 'dev_web_audiototext', '700': 'dev_web_videotoaudio',
    }
    const flow = useFlowStore()
    flow.insertAfter('start', template)
    flow.setActiveTab('task')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    const queueInput = wrapper.findAll('.rc-field').find((f) => f.text().includes('队列名称'))?.find('input')
    expect(queueInput?.element.value).toBe(expectedQueue)
  })
})

describe('TaskTab · 输出字段统一在表配置维护', () => {
  it.each([
    ['物理列', ['K1', 'K2']],
    ['历史字段及未知列', ['title-K1', 'K9']],
    ['显式空集合', []],
  ])('任务配置不再重复编辑出参列，保留%s', async (_name, outColumns) => {
    const saved = outColumns as string[]
    const { flow, wrapper } = await mountTaskTab(['K2'], saved)
    expect(wrapper.find('.pt-outcols').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('出参列')
    expect(wrapper.findComponent({ name: 'UrlParamEditor' }).exists()).toBe(true)
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual(saved)

    flow.setActiveTab('table')
    await flushPromises()
    await wrapper.get('[data-testid="clear-all-input-fields"]').trigger('click')
    await wrapper.get('[data-testid="input-fields-list"] .rc-tag').trigger('click')
    expect(flow.configs['web-1'].taskCfg?.contextMap).toEqual(['K1'])
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual(saved)
    wrapper.unmount()
  })

  it('表配置修改输出字段后切换任务配置，再返回时选择不丢失', async () => {
    const { flow, wrapper } = await mountTaskTab([], ['K2'])
    flow.setActiveTab('table')
    await flushPromises()
    await wrapper.get('[data-testid="select-all-fields"]').trigger('click')
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual(['K1', 'K2', 'K3'])

    flow.setActiveTab('task')
    await flushPromises()
    expect(wrapper.find('.pt-outcols').exists()).toBe(false)
    expect(flow.configs['web-1'].taskCfg?.outColumns).toEqual(['K1', 'K2', 'K3'])

    flow.setActiveTab('table')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="output-fields-list"] .rc-tag.on')).toHaveLength(3)
    wrapper.unmount()
  })
})

// 2026-11-05：用户要求撤回「表配置字段用途」，任务 URL 回任务配置 Tab 维护
// （2026-10-19 按旧平台 SourceStepCard 恢复、10-21 对齐旧平台：步骤 itemId / url，只给采集后续步）
describe('TaskTab · 任务 URL 来源字段与表达式', () => {
  const URL_TABLE: EntryType = {
    tableId: '900', tableName: 'sense_data.TB_CNEWS', name: '通用新闻表',
    fields: [
      { prop: 'title-K1', desc: '标题', type: 'string', required: false, columnName: 'K1', itemId: '9001' },
      { prop: 'url-K2', desc: 'URL', type: 'url', required: false, columnName: 'K2', itemId: '9002' },
    ],
  }
  function mountChain(selected: 'web-1' | 'web-2') {
    mockAssets()
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(URL_TABLE)
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.configs['web-1'].collectCfg!.outputTable = '900'
    flow.configs['web-2'] = cloneConfig(NODE_CONFIGS['web-detail'])
    flow.configs['web-2'].collectCfg!.inputTable = '900'
    flow.configs['web-2'].itemId = '9002'
    flow.configs['web-2'].stepUrl = "K2+'#need_upload_xq/xq/'"
    flow.main = ['start', 'web-1', 'web-2', 'end']
    flow.select(selected)
    flow.setActiveTab('task')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('默认收起（同「运行设置」），点开后回显来源字段（输入表字段）和表达式', async () => {
    const { wrapper } = mountChain('web-2')
    await flushPromises()
    expect(wrapper.get('[data-testid="task-url-toggle"]').text()).toContain('任务 URL（来源字段 / 表达式）')
    expect(wrapper.find('[data-testid="task-url-source"]').exists()).toBe(false)
    await wrapper.get('[data-testid="task-url-toggle"]').trigger('click')
    const select = wrapper.get<HTMLSelectElement>('[data-testid="task-url-source"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual(['未选择', '标题（K1）', 'URL（K2）'])
    expect(select.element.value).toBe('9002')
    expect(wrapper.get<HTMLInputElement>('[data-testid="task-url-expr"]').element.value).toBe("K2+'#need_upload_xq/xq/'")
  })

  it('改来源字段和表达式写到节点上并置脏（随步骤自动保存）；表达式清空回到 $VAL$', async () => {
    const { flow, wrapper } = mountChain('web-2')
    await flushPromises()
    await wrapper.get('[data-testid="task-url-toggle"]').trigger('click')
    await wrapper.get('[data-testid="task-url-source"]').setValue('9001')
    expect(flow.configs['web-2'].itemId).toBe('9001')
    expect(flow.flowDirty).toBe(true)
    const expr = wrapper.get('[data-testid="task-url-expr"]')
    await expr.setValue("K1+'#x'")
    await expr.trigger('change')
    expect(flow.configs['web-2'].stepUrl).toBe("K1+'#x'")
    await expr.setValue('  ')
    await expr.trigger('change')
    expect(flow.configs['web-2'].stepUrl).toBe('$VAL$')
  })

  // 10-21 定先不强制：没选来源字段只提示，不自动展开
  it('没选来源字段：仍默认收起，标题和展开后都有提示（不拦截），选上后提示消失', async () => {
    const { flow, wrapper } = mountChain('web-2')
    flow.configs['web-2'].itemId = undefined
    await flushPromises()
    expect(wrapper.get('[data-testid="task-url-toggle"]').text()).toContain('来源字段未选')
    expect(wrapper.find('[data-testid="task-url-source"]').exists()).toBe(false)
    await wrapper.get('[data-testid="task-url-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="task-url-source-unset"]').exists()).toBe(true)
    await wrapper.get('[data-testid="task-url-source"]').setValue('9002')
    expect(wrapper.find('[data-testid="task-url-source-unset"]').exists()).toBe(false)
  })

  it('PDF 抓取后续步也显示（旧平台它是普通 entry 步骤）', async () => {
    mockAssets()
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(URL_TABLE)
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.insertAfter('web-list', 'pdf')
    const pdfId = flow.selectedId
    flow.configs['web-list'].collectCfg!.outputTable = '900'
    flow.select(pdfId)
    flow.setActiveTab('task')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.get('[data-testid="task-url-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="task-url-source"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="task-url-expr"]').exists()).toBe(true)
  })

  it('首个采集节点不显示（它的 URL 由源 / 配置 URL 管）', async () => {
    const { wrapper } = mountChain('web-1')
    await flushPromises()
    expect(wrapper.find('[data-testid="task-url-source"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="task-url-expr"]').exists()).toBe(false)
  })

  // 2026-11-05 晚用户要求：任务 URL 不再夹在输入表和进入条件之间，放到最下面
  it('任务 URL 排在队列、参数配置、任务参数取值之后，是最后一节', async () => {
    const { wrapper } = mountChain('web-2')
    await flushPromises()
    const text = wrapper.text()
    const toggleIndex = text.indexOf('任务 URL（来源字段 / 表达式）')
    expect(toggleIndex).toBeGreaterThan(-1)
    expect(toggleIndex).toBeGreaterThan(text.indexOf('有效输入表'))
    expect(toggleIndex).toBeGreaterThan(text.indexOf('队列名称'))
    expect(toggleIndex).toBeGreaterThan(text.indexOf('参数配置'))
    expect(toggleIndex).toBeGreaterThan(text.indexOf('任务参数取值'))
  })
})
