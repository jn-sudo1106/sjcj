// @vitest-environment jsdom
// 任务配置 Tab ·「上下文来源」对齐旧平台（0828 W4-2）。
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

/** inputFields 只勾了一个字段，用来验证上下文来源**不**按勾选过滤 */
async function mountTaskTab(contextMap: string[] = []) {
  mockAssets()
  setActivePinia(createPinia())
  const flow = useFlowStore()
  const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
  cfg.collectCfg!.inputTable = '900'
  cfg.inputFields = ['title-K1']
  cfg.taskCfg = { queue: '', urlRule: '', contextMap }
  flow.configs['web-1'] = cfg
  flow.select('web-1')
  flow.setActiveTab('task')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return { flow, wrapper }
}
const select = (w: Awaited<ReturnType<typeof mountTaskTab>>['wrapper']) =>
  w.findComponent({ name: 'ElSelect' })

describe('TaskTab · 上下文来源（对齐旧平台）', () => {
  it('候选是输入表的**全部**字段，不按表配置的勾选过滤', async () => {
    const { wrapper } = await mountTaskTab()
    const opts = wrapper.findAllComponents({ name: 'ElOption' })
    // inputFields 只勾了 title-K1，但三个字段都要能选
    expect(opts.length).toBe(3)
  })

  it('选项文案照抄旧平台：[columnName] - 展示名 - [编码]', async () => {
    const { wrapper } = await mountTaskTab()
    const labels = wrapper.findAllComponents({ name: 'ElOption' }).map((o) => o.props('label'))
    expect(labels).toEqual([
      '[K1] - 标题 - [title]',
      '[K2] - URL - [url]',
      '[K3] - 发布时间 - [publish_date]',
    ])
  })

  it('选项的值是 columnName，不是 prop（旧平台存的就是 columnName）', async () => {
    const { wrapper } = await mountTaskTab()
    const values = wrapper.findAllComponents({ name: 'ElOption' }).map((o) => o.props('value'))
    expect(values).toEqual(['K1', 'K2', 'K3'])
  })

  it('是一个多选下拉，不再是「每行一个 select + 添加/删除」', async () => {
    const { wrapper } = await mountTaskTab()
    expect(select(wrapper).props('multiple')).toBe(true)
    expect(wrapper.text()).not.toContain('+ 添加字段')
  })

  it('选中后按 columnName 写回 taskCfg.contextMap', async () => {
    const { flow, wrapper } = await mountTaskTab()
    select(wrapper).vm.$emit('update:modelValue', ['K1', 'K3'])
    await flushPromises()
    expect(flow.configs['web-1'].taskCfg?.contextMap).toEqual(['K1', 'K3'])
  })

  it('已配置的值能回显', async () => {
    const { wrapper } = await mountTaskTab(['K2'])
    expect(select(wrapper).props('modelValue')).toEqual(['K2'])
  })

  it('没有有效输入表时禁用', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.inputTable = ''
    flow.configs['web-1'] = cfg
    flow.select('web-1')
    flow.setActiveTab('task')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(select(wrapper).props('disabled')).toBe(true)
  })

  // 2026-09-04 会上：规则节点这一栏去掉——它的入参在「表配置」里选，
  // 任务配置再来一个「入参来源」是同一件事的第二个入口，两处能填出不一致的值。
  // 写入侧也已统一：规则节点的 context 取自 ruleCfg.inputFields（见 stepPersist）。
  it('规则处理节点不显示这一栏（入参在表配置里选，避免两个入口）', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.inputTable = '900'
    cfg.taskCfg = { queue: '', urlRule: '', contextMap: ['K1', 'K2'] }
    flow.configs['rule-1'] = cfg
    flow.select('rule-1')
    flow.setActiveTab('task')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('入参来源')
    expect(wrapper.text()).not.toContain('上下文来源')
    expect(wrapper.find('[data-testid="context-map-select"]').exists()).toBe(false)
  })
})

describe('TaskTab · 默认队列名称（2026-09-23 用户拍板）', () => {
  it.each([
    ['ocr', 'dev_web_snatch_ocr'],
    ['translate', 'dev_web_translate'],
    ['article-summary', 'dev_web_llm_generate'],
    ['article-tag', 'dev_web_llm_generate'],
    ['audio-text', 'dev_web_audiototext'],
    ['video-audio', 'dev_web_videotoaudio'],
  ])('新增节点 %s 任务配置回显默认队列 %s', async (template, expectedQueue) => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.insertAfter('start', template)
    flow.setActiveTab('task')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    const queueInput = wrapper.findAll('.rc-field').find((f) => f.text().includes('队列名称'))?.find('input')
    expect(queueInput?.element.value).toBe(expectedQueue)
  })
})
