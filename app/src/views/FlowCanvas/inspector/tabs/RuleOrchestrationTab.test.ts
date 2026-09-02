// @vitest-environment jsdom
// 编排配置 Tab：0804 S2-2 后只剩路径 B（描述/生成/全屏/测试/保存脚本）——路径 A（表/字段绑定 +
// 保存业务规则元数据）已整个搬去 TableTab.test.ts，跟非规则节点共用同一个表配置 Tab。
// 通过挂载整个 NodeInspector 测试（而非孤立挂载 RuleOrchestrationTab），因为 useNodeInspectorAssets()
// 的 provide/inject 上下文由 NodeInspector 建立，脱离它调用会抛错（见 useNodeInspectorAssets.ts 设计约束）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import NodeInspector from '../NodeInspector.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, paramApi, ruleApi } from '@/api'
import type { EntryType } from '@/api'

// 0901：测试脚本入口改为切到流程视图右侧「数据视图」tab（view=data），用 mock router 断言跳转目标
const routerPush = vi.fn()
const routerReplace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useRoute: () => ({ query: { sourceId: 's-1', siteId: 'site-9' } }),
}))

const INPUT_TABLE: EntryType = {
  tableId: '2102154', tableName: 'sense_data.TB_JD_SKU_BASE', name: 'JD-商品基础',
  fields: [
    { prop: 'sku_id', desc: '商品ID', type: 'string', required: false, columnName: 'K1' },
    { prop: 'sku_name', desc: '商品名称', type: 'string', required: false, columnName: 'K2' },
  ],
}
const MODEL_PROVIDERS = [
  { providerCode: 'DeepSeek', providerName: 'DeepSeek' },
  { providerCode: 'OpenAI', providerName: 'OpenAI' },
]
const MODEL_OPTIONS: Record<string, Array<{ modelCode: string; modelName: string }>> = {
  DeepSeek: [
    { modelCode: 'deepseek-chat', modelName: 'deepseek-chat' },
    { modelCode: 'deepseek-reasoner', modelName: 'deepseek-reasoner' },
  ],
  OpenAI: [
    { modelCode: 'gpt-4o-mini', modelName: 'gpt-4o-mini' },
  ],
}
const PROMPT_TEMPLATE = {
  promptId: 1,
  nodeType: 'rule_processing',
  nodeTypeName: '规则处理',
  category: 'rule',
  systemPrompt: '源表={{source_table}}; 目标表={{output_table}}; 入参={{input_pair}}; 出参={{output_pair}}; 入参码={{input_fields}}; 出参码={{output_fields}}',
}
const MONITOR_PROMPT_TEMPLATE = {
  promptId: 2,
  nodeType: 'rule_processing',
  nodeTypeName: '数据监控',
  category: 'rule',
  systemPrompt: 'source_id={{source_id}}; source_cron={{source_cron}}; source_table={{source_table}}',
}

function mockAssets(inputTableName = INPUT_TABLE.name, tableId = INPUT_TABLE.tableId, tableName = INPUT_TABLE.tableName) {
  const table = { ...INPUT_TABLE, tableId, tableName, name: inputTableName }
  vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [table] })
  // 真实后端的表列表不带字段定义，选中表后另拉一次详情（entryApi.entryDetail）才有 fields——
  // 这里模拟同一张表，保证选表后的字段池仍是 INPUT_TABLE 的 2 个字段，而非 mock 兜底数据。
  vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(table)
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'ruleGroups').mockResolvedValue([])
  vi.spyOn(ruleApi, 'rulePaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'sharedConfigs').mockResolvedValue([])
  // Path B 回灌默认空操作，避免干扰既有用例；覆盖回灌行为的用例再单独 mock
  vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({ mode: 'ref', describe: '' })
  vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    if (url === 'http://localhost:8080/api/model/providers') {
      return new Response(JSON.stringify({ data: MODEL_PROVIDERS }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('http://localhost:8080/api/model/default-models')) {
      const providerCode = new URL(url).searchParams.get('providerCode') || ''
      return new Response(JSON.stringify({ data: MODEL_OPTIONS[providerCode] ?? [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('http://127.0.0.1:8080/api/prompt/list')) {
      const parsed = new URL(url)
      if (parsed.searchParams.get('category') === 'rule' && parsed.searchParams.get('node_type_name') === '规则处理') {
        return new Response(JSON.stringify([PROMPT_TEMPLATE]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (parsed.searchParams.get('category') === 'rule' && parsed.searchParams.get('node_type_name') === '数据监控') {
        return new Response(JSON.stringify([MONITOR_PROMPT_TEMPLATE]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  routerPush.mockClear()
  routerReplace.mockClear()
})

function mountOnRuleNode() {
  setActivePinia(createPinia())
  const flow = useFlowStore()
  flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
  flow.select('rule-1')
  flow.setActiveTab('orchestration')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  return { flow, wrapper }
}

function mountOnMonitorNode() {
  setActivePinia(createPinia())
  const flow = useFlowStore()
  const cfg = cloneConfig(NODE_CONFIGS['rule'])
  cfg.template = 'monitor'
  flow.configs['monitor-1'] = cfg
  flow.select('monitor-1')
  flow.setActiveTab('orchestration')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  return { flow, wrapper }
}

// 0801 方案 §6.4：有 ruleId 后展开的「查看业务编排」——描述/生成脚本/全屏查看/编辑系统提示词/保存脚本
// （0804 起这就是本 Tab 的全部内容，不再有 showBinder 两态切换）
describe('RuleOrchestrationTab · 路径 B（查看业务编排）', () => {
  function mountWithExistingRule() {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: 'orch-173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      outputTable: 'sense_data.TB_JD_SKU_RESULT',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
      systemPrompt: '生成 Python 脚本，返回 JSON',
    })
    flow.configs['rule-1'].configId = '184'
    return { flow, wrapper }
  }

  it('未生成脚本时，全屏查看/保存脚本按钮禁用', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    expect(wrapper.find('textarea.rc-code-box').exists()).toBe(false)
    const buttons = wrapper.findAll('button').filter((b) => ['全屏查看', '保存脚本'].includes(b.text()))
    expect(buttons).toHaveLength(2)
    buttons.forEach((b) => expect(b.attributes('disabled')).toBeDefined())
  })

  it('未填描述就点生成脚本：不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    // makeDefaultRuleOrchestration 默认带一条演示 describe，这里显式清空以测试校验守卫
    flow.patchRuleConfig('rule-1', { describe: '' })
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate')

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).not.toHaveBeenCalled()
  })

  it('缺入参/出参字段时点生成脚本：不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { inputFields: [], outputFields: [] })
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate')

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).not.toHaveBeenCalled()
  })

  it('数据监控节点无出参字段仍能生成脚本（跳过出参校验）', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnMonitorNode()
    flow.patchRuleConfig('monitor-1', {
      mode: 'ref', ruleId: 'orch-mon-1',
      describe: '我想对JD-商品基础表进行如下监控：\n1.当日数据是否正常入库',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: [],
      modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
    })
    flow.configs['monitor-1'].configId = '184'
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {}',
      scriptPath: '/code01/184.py',
    })

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).toHaveBeenCalled()
  })

  it('数据监控节点显示数据监控描述', async () => {
    mockAssets()
    const { wrapper } = mountOnMonitorNode()
    await flushPromises()

    expect(wrapper.text()).toContain('数据监控描述')
  })

  it('数据监控节点进入编排配置时自动组装监控描述', async () => {
    mockAssets('通用新闻表')
    const { flow, wrapper } = mountOnMonitorNode()
    flow.patchRuleConfig('monitor-1', {
      inputTableId: '2102154',
      inputTable: 'sense_data.TB_JD_SKU_BASE',
    })
    flow.setMonitorMethods('monitor-1', ['当日数据是否正常入库', '数据延迟监控'])
    await flushPromises()

    const textarea = wrapper.find('textarea.rc-input.rc-textarea').element as HTMLTextAreaElement
    expect(textarea.value).toBe('我想对通用新闻表:sense_data.TB_JD_SKU_BASE进行如下监控：\n1.当日数据是否正常入库\n2.数据延迟监控')
  })

  it('未保存表配置时点生成脚本：不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.configs['rule-1'].configId = ''
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate')

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).not.toHaveBeenCalled()
  })

  it('填写描述后生成脚本：写回 script/scriptPath，全屏查看/保存脚本随之启用', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {"sku_name": ""}',
      scriptPath: '/rules/generated/orch-173.py',
    })

    await wrapper.find('textarea[placeholder*="描述规则处理逻辑"]').setValue('按 sku_id 生成 sku_name')
    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).toHaveBeenCalledWith(expect.objectContaining({
      description: '按 sku_id 生成 sku_name',
      configId: 184,
      providerCode: 'DeepSeek',
      model: 'deepseek-chat',
      sourceTable: 'JD-商品基础:sense_data.TB_JD_SKU_BASE',
      targetTable: 'sense_data.TB_JD_SKU_RESULT',
      inputFields: '商品ID:sku_id',
      outputFields: '商品名称:sku_name',
      systemPrompt: '生成 Python 脚本，返回 JSON',
    }), expect.anything())
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
    expect(flow.configs['rule-1'].ruleCfg?.scriptPath).toBe('/rules/generated/orch-173.py')
    const buttons = wrapper.findAll('button').filter((b) => ['全屏查看', '保存脚本'].includes(b.text()))
    buttons.forEach((b) => expect(b.attributes('disabled')).toBeUndefined())
  })

  it('规则节点没有数字 ruleId（含旧步骤占位 -1）时，生成脚本先 saveMeta 再走 data-process', async () => {
    mockAssets()
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(INPUT_TABLE)
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'new', ruleId: '-1',
      describe: 'content 中包含地产二字时，tags 返回房地产',
      inputTableId: '2102154', inputFields: ['sku_id'], outputFields: ['sku_name'],
      modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
    })
    flow.configs['rule-1'].configId = '184'
    await flushPromises()
    const metaSpy = vi.spyOn(ruleApi, 'orchestrationSaveMeta').mockResolvedValue({ ruleId: '184', message: 'ok' })
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {"sku_name": ""}',
      scriptPath: '/code01/184.py',
    })

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(metaSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: flow.configs['rule-1'].title,
      inputFields: ['sku_id'],
      outputFields: ['sku_name'],
    }))
    expect(ruleApi.dataProcessGenerate).toHaveBeenCalled()
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('184')
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
  })

  it('全屏查看打开脚本弹窗，展示脚本正文', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()

    const viewBtn = wrapper.findAll('button').find((b) => b.text() === '全屏查看')!
    await viewBtn.trigger('click')
    await flushPromises()

    expect(wrapper.html()).toContain('def main(sku_id)')
  })

  it('点击脚本路径打开工作区，展示脚本正文', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()

    const pathBtn = wrapper.find('button[title="/x/y.py"]')
    await pathBtn.trigger('click')
    await flushPromises()

    expect(wrapper.html()).toContain('def main(sku_id)')
  })

  it('点击测试脚本时会把 scriptPath 一并带到数据视图', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/code01/202609/1788326374508.py' })
    await flushPromises()

    const testBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    await testBtn.trigger('click')
    await flushPromises()

    expect(routerReplace).toHaveBeenCalledWith(expect.objectContaining({
      path: '/canvas',
      query: expect.objectContaining({
        nodeId: 'rule-1',
        view: 'data',
        scriptPath: '/code01/202609/1788326374508.py',
      }),
    }))
  })

  it('编辑系统提示词：保存后写回 systemPrompt，取消不写回', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()

    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑系统提示词')!
    await editBtn.trigger('click')
    await flushPromises()

    // S6-1：系统提示词编辑区从独立弹窗合并进 RuleWorkbenchDialog 左栏，class 从 .rspd-textarea 换成
    // .wb-textarea（右栏脚本框也用这个 class，加 .wb-code；左栏提示词没有，用 :not 精确定位）
    const textarea = wrapper.find('textarea.wb-textarea:not(.wb-code)')
    await textarea.setValue('新的系统提示词')
    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存' && b.classes().includes('primary'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toBe('新的系统提示词')
    expect(flow.configs['rule-1'].ruleCfg?.promptCategory).toBe('规则处理')
    expect(flow.configs['rule-1'].ruleCfg?.modelProviderCode).toBe('DeepSeek')
    expect(flow.configs['rule-1'].ruleCfg?.modelCode).toBe('deepseek-chat')
  })

  it('打开工作区后按提示词分类拉取模板并替换表配置占位符', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()

    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑系统提示词')!
    await editBtn.trigger('click')
    await flushPromises()

    const promptTextarea = wrapper.find('textarea.wb-textarea:not(.wb-code)')
    expect(promptTextarea.element).toBeTruthy()
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('源表=JD-商品基础:sense_data.TB_JD_SKU_BASE')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('目标表=sense_data.TB_JD_SKU_RESULT')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('入参=商品ID:sku_id')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('出参=商品名称:sku_name')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('入参码=sku_id')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('出参码=sku_name')
    // 拼接后的完整提示词同步写回 orchCfg.systemPrompt：生成脚本（data-process）入参 systemPrompt
    // 取的就是这个完整值，无需用户在工作台点「保存」。
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('源表=JD-商品基础:sense_data.TB_JD_SKU_BASE')
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('入参=商品ID:sku_id')
  })

  it('工作区加载模型供应商与模型，并在工作区里不再显示测试按钮', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑系统提示词')!
    await editBtn.trigger('click')
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/model/providers',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/model/default-models?providerCode=DeepSeek',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(wrapper.findAll('.wb-pane-actions button').some((b) => b.text() === '测试')).toBe(false)
  })

  it('主面板生成区展示模型供应商和模型下拉，并复用模型接口候选', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/model/providers',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/model/default-models?providerCode=DeepSeek',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(wrapper.find('[data-testid="main-model-provider"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="main-model"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('模型供应商')
    expect(wrapper.text()).toContain('模型')
  })

  it('切换模型供应商后刷新模型候选，保存时回写新的供应商/模型', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()

    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑系统提示词')!
    await editBtn.trigger('click')
    await flushPromises()

    const providerSelect = wrapper.find('.wb-provider')
    await providerSelect.trigger('click')
    await flushPromises()
    const openAiOption = wrapper.findAll('.el-select-dropdown__item').find((el) => el.text() === 'OpenAI')
    expect(openAiOption).toBeTruthy()
    await openAiOption!.trigger('click')
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/model/default-models?providerCode=OpenAI',
      expect.objectContaining({ method: 'GET' }),
    )

    const saveBtn = wrapper.findAll('button').find((b) => b.text() === '保存' && b.classes().includes('primary'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.modelProviderCode).toBe('OpenAI')
    expect(flow.configs['rule-1'].ruleCfg?.modelCode).toBe('gpt-4o-mini')
  })

  it('工作区里直接生成时使用当前草稿里的模型供应商和模型', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑系统提示词')!
    await editBtn.trigger('click')
    await flushPromises()

    const providerSelect = wrapper.find('.wb-provider')
    await providerSelect.trigger('click')
    await flushPromises()
    const openAiOption = wrapper.findAll('.el-select-dropdown__item').find((el) => el.text() === 'OpenAI')
    expect(openAiOption).toBeTruthy()
    await openAiOption!.trigger('click')
    await flushPromises()

    const generateSpy = vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {"sku_name": ""}',
      scriptPath: '/rules/generated/orch-173.py',
    })

    const generateBtn = wrapper.findAll('.wb-pane-right .wb-pane-actions button').find((b) => b.text().includes('生成'))!
    await generateBtn.trigger('click')
    await flushPromises()

    expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({
      configId: 184,
      providerCode: 'OpenAI',
      model: 'gpt-4o-mini',
      sourceTable: 'JD-商品基础:sense_data.TB_JD_SKU_BASE',
      targetTable: 'sense_data.TB_JD_SKU_RESULT',
      inputFields: '商品ID:sku_id',
      outputFields: '商品名称:sku_name',
    }), expect.anything())
  })

  it('数据监控节点工作区会把 source_id/source_cron/source_table 按表单值替换', async () => {
    mockAssets('通用新闻表', '900', 'sense_data.TB_CNEWS')
    const { flow, wrapper } = mountOnMonitorNode()
    flow.setInputTable('monitor-1', '900')
    flow.setStepSourceId('monitor-1', '391007796')
    flow.patchSchedule('monitor-1', { cron: '0 0 12 * * *' })
    await flushPromises()

    const editBtn = wrapper.findAll('button').find((b) => b.text() === '编辑系统提示词')!
    await editBtn.trigger('click')
    await flushPromises()

    const promptTextarea = wrapper.find('textarea.wb-textarea:not(.wb-code)')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('source_id=391007796')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('source_cron=0 0 12 * * *')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('source_table=通用新闻表:sense_data.TB_CNEWS')
  })

  it('保存脚本：需二次确认，确认后调用 orchestrationSave 并写回 mode/ruleId/scriptPath', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'orchestrationSave').mockResolvedValue({
      ruleId: 'orch-173', scriptPath: '/x/y.py', message: '规则脚本已保存',
    })

    const saveScriptBtn = wrapper.findAll('button').find((b) => b.text().includes('保存脚本'))!
    await saveScriptBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationSave).toHaveBeenCalledTimes(1)
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBe('orch-173')
  })

  it('保存脚本：取消确认框则不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    vi.spyOn(ruleApi, 'orchestrationSave')

    const saveScriptBtn = wrapper.findAll('button').find((b) => b.text().includes('保存脚本'))!
    await saveScriptBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationSave).not.toHaveBeenCalled()
  })

  it('进入查看态：回灌详情描述，并在仅有 scriptPath 时拉取脚本正文', async () => {
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({
      mode: 'ref',
      ruleId: '173',
      describe: '服务端描述',
      systemPrompt: '服务端提示词',
      scriptPath: '/code01/a.py',
    })
    vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('def main():\n    return {}')
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: '173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      describe: '', script: '', scriptPath: '',
    })
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('173')
    expect(ruleApi.orchestrationLoadScript).toHaveBeenCalledWith('/code01/a.py')
    expect(flow.configs['rule-1'].ruleCfg?.describe).toBe('服务端描述')
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
    expect(wrapper.text()).toContain('查看业务编排')
  })
})

// 0901 需求变更：测试脚本入口从全屏测试台弹窗（RuleTestDialog，拍板 #12）改为切换到流程视图
// 右侧面板的「数据视图」tab（view=data），保留当前源上下文，在画布右侧看节点产出数据。
describe('RuleOrchestrationTab · 测试脚本切换数据视图', () => {
  function mountWithScript() {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: 'orch-173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      script: 'def main(sku_id):\n    return {"sku_name": sku_id}', scriptPath: '/x/y.py',
    })
    return { flow, wrapper }
  }

  it('已有 ruleId 但未生成脚本时测试脚本按钮禁用', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', { mode: 'ref', ruleId: 'orch-173', inputTable: 'sense_data.TB_JD_SKU_BASE' })
    await flushPromises()
    const disabledBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    expect(disabledBtn.attributes('disabled')).toBeDefined()
  })

  it('点击测试脚本切到数据视图 tab，保留当前源上下文并带上当前节点定位', async () => {
    const { wrapper } = mountWithScript()
    await flushPromises()

    const testBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    expect(testBtn.attributes('disabled')).toBeUndefined()
    await testBtn.trigger('click')
    await flushPromises()

    expect(routerReplace).toHaveBeenCalledWith(expect.objectContaining({
      path: '/canvas',
      query: expect.objectContaining({
        sourceId: 's-1',
        siteId: 'site-9',
        view: 'data',
        nodeId: 'rule-1',
        scriptPath: '/x/y.py',
      }),
    }))
    expect(routerPush).not.toHaveBeenCalled()
  })
})

// 0804 S3-3：非规则节点（采集）复用同一个 Tab，内容换成抓取配置 XML，走 execCfg 而不是 ruleCfg。
describe('RuleOrchestrationTab · 非规则节点抓取配置（S3-3）', () => {
  function mountOnCollectorNode() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('orchestration')
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('文案换成抓取配置措辞，不出现「测试脚本」按钮（本期不做，方案 §3.1 修正 D）', async () => {
    const { wrapper } = mountOnCollectorNode()
    await flushPromises()

    expect(wrapper.find('textarea[placeholder*="描述抓取需求"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text().includes('生成配置'))).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '测试脚本')).toBe(false)
    expect(wrapper.text()).toContain('配置路径')
  })

  it('未填描述点生成配置：不调用接口；填写后先落 compose 再生成，写回 execCfg 而不是 ruleCfg', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    await flushPromises()
    const genSpy = vi.spyOn(ruleApi, 'orchestrationGenerate')
    const metaSpy = vi.spyOn(ruleApi, 'orchestrationSaveMeta')

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成配置'))!
    await genBtn.trigger('click')
    await flushPromises()
    expect(genSpy).not.toHaveBeenCalled()
    expect(metaSpy).not.toHaveBeenCalled()

    metaSpy.mockResolvedValue({ ruleId: '184', message: '业务规则已保存' })
    genSpy.mockResolvedValue({ script: '<Config>\n  <Action id="1"/>\n</Config>', scriptPath: '/rules/generated/x.xml' })
    await wrapper.find('textarea[placeholder*="描述抓取需求"]').setValue('打开列表页提取表格')
    await genBtn.trigger('click')
    await flushPromises()

    expect(metaSpy).toHaveBeenCalledWith(expect.objectContaining({ name: flow.configs['web-1'].title, inputTable: '' }))
    expect(genSpy).toHaveBeenCalledWith(expect.objectContaining({ ruleId: '184' }), expect.anything())
    expect(flow.configs['web-1'].execCfg?.ruleId).toBe('184')
    expect(flow.configs['web-1'].execCfg?.script).toContain('<Config>')
    expect(flow.configs['web-1'].execCfg?.scriptPath).toBe('/rules/generated/x.xml')
    expect(flow.configs['web-1'].ruleCfg).toBeUndefined()
  })

  it('保存配置：确认文案是"配置"而不是"脚本"，成功后写回 execCfg.ruleId', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: '<Config/>', scriptPath: '/x/1.xml' })
    await flushPromises()
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'orchestrationSave').mockResolvedValue({ ruleId: '184', scriptPath: '/x/1.xml', message: '抓取配置已保存' })

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('配置'), expect.stringContaining('抓取配置'), expect.anything())
    expect(flow.configs['web-1'].execCfg?.mode).toBe('ref')
    expect(flow.configs['web-1'].execCfg?.ruleId).toBe('184')
  })

  // S6-2 联调后端实测（vanv-rule-center DashScopeServiceImpl）：/script/edit 按 scriptPath 原地覆盖写
  // 文件、生成脚本按 ruleId saveOrUpdate 数据库记录，都是"改已有"不是"建新的"——切换只能拷内容当草稿，
  // ruleId/scriptPath 不能跟着换成源记录的，否则后面一保存/一重新生成就把源记录的文件或数据库行覆盖了。
  it('切换已有配置：下拉只列出 .xml 结尾的既有记录，应用后回灌 describe/script，但 ruleId 保留本节点自己的、scriptPath 清空', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('orchestration')
    // 本节点必须已经有自己的编排记录才允许切换套用
    flow.patchExecConfig('web-1', { mode: 'ref', ruleId: '184', scriptPath: '/x/184.xml' })
    mockAssets()
    vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({
      total: 2,
      list: [
        { ruleId: '11', name: '规则脚本', describe: '', script: '', scriptPath: '/a/11.py', enabled: true, createdAt: '' },
        { ruleId: '22', name: '公告列表抓取配置', describe: '', script: '', scriptPath: '/a/22.xml', enabled: true, createdAt: '' },
      ],
    })
    vi.spyOn(ruleApi, 'orchestrationDetail').mockResolvedValue({
      mode: 'ref', ruleId: '22', describe: '既有抓取需求', scriptPath: '/a/22.xml',
    })
    vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('<Config>\n  <Action id="1"/>\n</Config>')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const select = wrapper.find('select.rc-select')
    const optionTexts = select.findAll('option').map((o) => o.text())
    expect(optionTexts.some((t) => t.includes('公告列表抓取配置'))).toBe(true)
    expect(optionTexts.some((t) => t.includes('规则脚本'))).toBe(false)

    await select.setValue('22')
    const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('应用'))!
    await applyBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('22')
    expect(ruleApi.orchestrationLoadScript).toHaveBeenCalledWith('/a/22.xml')
    // ruleId 还是本节点自己的 184，没有被切换对象的 22 顶替
    expect(flow.configs['web-1'].execCfg?.ruleId).toBe('184')
    // scriptPath 清空——强制先「生成脚本」换一个本节点自己的文件才能保存，不会误覆盖源节点的 /a/22.xml
    expect(flow.configs['web-1'].execCfg?.scriptPath).toBe('')
    expect(flow.configs['web-1'].execCfg?.describe).toBe('既有抓取需求')
    expect(flow.configs['web-1'].execCfg?.script).toContain('<Config>')
  })
})

// 0804 S3-4：抓取配置 XML 轻解析接入 UI——顶部只读动作链摘要 + 保存前字段一致性提示。
// captureConfig.ts 本身的解析/校验逻辑单测覆盖在 utils/flow/captureConfig.test.ts，这里只测 UI 接线。
describe('RuleOrchestrationTab · 抓取配置 XML 轻解析接入（S3-4）', () => {
  // 打开网页 → 提取表格 → 提取单值 ×3（按 NextActionId 链表顺序），BizId=9999 不在任何采集节点表的字段里，
  // 用来触发一致性校验的"未匹配"分支；outputTable='2101001'（web-list 种子的固定值）。
  const CAPTURE_XML = `<Actions>
    <OpenUrlAction DisplayTitle="打开网页" ActionId="a" NextActionId="e" LastActionId="">
      <Config><ColumnCfg /></Config>
    </OpenUrlAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="b" NextActionId="" LastActionId="c">
      <Config><ColumnCfg><Column BizId="9999" BizName="未知字段">0</Column></ColumnCfg></Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="c" NextActionId="b" LastActionId="d">
      <Config><ColumnCfg /></Config>
    </ExtractSingleValueAction>
    <ExtractSingleValueAction DisplayTitle="提取单值" ActionId="d" NextActionId="c" LastActionId="e">
      <Config><ColumnCfg /></Config>
    </ExtractSingleValueAction>
    <ExtractDataTableAction DisplayTitle="提取表格" ActionId="e" NextActionId="d" LastActionId="a">
      <Config><ColumnCfg /></Config>
    </ExtractDataTableAction>
  </Actions>`

  function mountOnCollectorNode(orchestrationPagedMode: 'empty' | 'error' = 'empty') {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')
    flow.setActiveTab('orchestration')
    mockAssets()
    if (orchestrationPagedMode === 'error') {
      vi.spyOn(ruleApi, 'orchestrationPaged').mockRejectedValue(new Error('请求失败 502'))
    } else {
      vi.spyOn(ruleApi, 'orchestrationPaged').mockResolvedValue({ total: 0, list: [] })
    }
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  it('既有配置列表异常时不阻断编排配置，展示非阻断提示并支持重试', async () => {
    const { wrapper } = mountOnCollectorNode('error')
    await flushPromises()

    expect(wrapper.text()).toContain('既有配置列表暂时不可用：请求失败 502')
    expect(wrapper.text()).toContain('重试')
    expect(wrapper.find('textarea[placeholder*="描述抓取需求"]').exists()).toBe(true)
  })

  it('顶部展示只读动作链摘要：按 NextActionId 链表顺序，连续同名动作折叠成 ×N', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: CAPTURE_XML })
    await flushPromises()

    expect(wrapper.text()).toContain('打开网页 → 提取表格 → 提取单值 ×3')
  })

  it('保存前一致性校验：BizId 不在输出表字段里时弹提示，取消则不调用保存接口', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: CAPTURE_XML, scriptPath: '/x/1.xml' })
    await flushPromises()
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const saveSpy = vi.spyOn(ruleApi, 'orchestrationSave')

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('未知字段'), '字段一致性提示', expect.anything())
    expect(saveSpy).not.toHaveBeenCalled()
  })

  it('保存前一致性校验：确认「仍要保存」后继续走正常保存流程', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: CAPTURE_XML, scriptPath: '/x/1.xml' })
    await flushPromises()
    // 第一次 confirm 是一致性提示，第二次是既有的"保存后将绑定到该节点"确认，两次都要放行
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'orchestrationSave').mockResolvedValue({ ruleId: '184', scriptPath: '/x/1.xml', message: '' })

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.orchestrationSave).toHaveBeenCalledTimes(1)
    expect(flow.configs['web-1'].execCfg?.ruleId).toBe('184')
  })
})
