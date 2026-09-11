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
import RuleWorkbenchDialog from '../RuleWorkbenchDialog.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { configApi, entryApi, paramApi, ruleApi, ckSourceApi } from '@/api'
import type { EntryType } from '@/api'
import { useSourceStore } from '@/stores/source'

async function selectFile(input: ReturnType<ReturnType<typeof mount>['find']>, file: File) {
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
}

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
  systemPrompt: 'source_id={{source_id}}; source_cron={{source_cron}}; source_table={{source_table}}; 入参={{input_pair}}; 出参={{output_pair}}',
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
    if (url === '/api/model/providers') {
      return new Response(JSON.stringify({ data: MODEL_PROVIDERS }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('/api/model/default-models')) {
      const providerCode = new URL(url, 'http://localhost').searchParams.get('providerCode') || ''
      return new Response(JSON.stringify({ data: MODEL_OPTIONS[providerCode] ?? [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('/api/prompt/list')) {
      const parsed = new URL(url, 'http://localhost')
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

async function openWorkbench(wrapper: ReturnType<typeof mountOnRuleNode>['wrapper']) {
  const scriptBtn = wrapper.findAll('button').find((b) => b.text() === '脚本编辑')
  if (!scriptBtn) throw new Error('脚本编辑按钮不存在')
  await scriptBtn.trigger('click')
  await flushPromises()
}

// 0801 方案 §6.4：规则节点的「设置业务规则」——描述/生成脚本/全屏查看/编辑系统提示词/保存脚本
// （0804 起这就是本 Tab 的全部内容，不再有 showBinder 两态切换）
describe('RuleOrchestrationTab · 路径 B（设置业务规则）', () => {
  function mountWithExistingRule() {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      outputTable: 'sense_data.TB_JD_SKU_RESULT',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
      systemPrompt: '生成 Python 脚本，返回 JSON',
    })
    flow.configs['rule-1'].configId = '184'
    return { flow, wrapper }
  }

  it('未生成脚本时，工作区保存脚本按钮禁用', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    await openWorkbench(wrapper)
    const workbench = wrapper.findComponent(RuleWorkbenchDialog)
    expect(workbench.find('textarea.wb-code').exists()).toBe(true)
    const saveButton = workbench.findAll('.wb-pane-actions button').find((b) => b.text().includes('保存脚本'))!
    expect(saveButton.attributes('disabled')).toBeDefined()
  })

  it('规则处理节点编排配置页不显示数据预览表格', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    expect(wrapper.text()).not.toContain('数据预览')
    expect(wrapper.find('.dqp').exists()).toBe(false)
    expect(wrapper.text()).toContain('设置业务规则')
  })

  it('脚本编辑按钮显示在设置业务规则标题行右侧', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    const titleRow = wrapper.find('.ni-section-title-row')
    expect(titleRow.exists()).toBe(true)
    expect(titleRow.text()).toContain('设置业务规则')
    expect(titleRow.find('button').text()).toBe('脚本编辑')
    expect(wrapper.find('.rc-actions-row button').exists()).toBe(false)
  })

  it('模型供应商和模型位于同一行', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    const modelRow = wrapper.find('.rc-model-row')
    expect(modelRow.exists()).toBe(true)
    expect(modelRow.find('[data-testid="main-model-provider"]').exists()).toBe(true)
    expect(modelRow.find('[data-testid="main-model"]').exists()).toBe(true)
    expect(modelRow.find('[data-testid="main-generate-script"]').exists()).toBe(false)
  })

  it('规则处理动作区：上传 Excel、生成脚本、测试脚本位于模型行下方并保持同一行', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    const modelRow = wrapper.find('.rc-model-row')
    const actionRow = wrapper.find('[data-testid="rule-generation-actions"]')
    expect(modelRow.find('[data-testid="main-model-provider"]').exists()).toBe(true)
    expect(modelRow.find('[data-testid="main-model"]').exists()).toBe(true)
    expect(modelRow.find('[data-testid="main-generate-script"]').exists()).toBe(false)
    expect(actionRow.exists()).toBe(true)
    expect(actionRow.find('[data-testid="main-upload-excel"]').exists()).toBe(true)
    expect(actionRow.find('[data-testid="main-generate-script"]').exists()).toBe(true)
    expect(actionRow.find('[data-testid="main-test-script"]').exists()).toBe(true)
    expect(actionRow.findAll('button')).toHaveLength(3)
  })

  it('进入编排配置时已有脚本仅显示生成结果和脚本路径', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', {
      script: 'def main(sku_id):\n    return {"sku_name": sku_id}\n',
      scriptPath: '/rules/saved/orch-173.py',
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="main-stream-result"]').exists()).toBe(true)
    expect(wrapper.find('.rc-main-result-head').text()).toContain('/rules/saved/orch-173.py')
    expect(wrapper.find('.rc-main-result-code').exists()).toBe(false)
  })

  it('主面板生成脚本完成后保留生成结果和脚本路径，但隐藏思考与脚本预览', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name', script: '', scriptPath: '' })
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
      options?.onThinking?.('先分析规则描述\n')
      options?.onContent?.('def main(sku_id):\n')
      options?.onContent?.('    return {"sku_name": sku_id}\n')
      options?.onDone?.({ scriptPath: '/rules/generated/orch-173.py', message: '保存完成' })
      return { script: 'def main(sku_id):\n    return {"sku_name": sku_id}\n', scriptPath: '/rules/generated/orch-173.py' }
    })

    const genBtn = wrapper.find('[data-testid="main-generate-script"]')
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="main-stream-thinking"]').exists()).toBe(false)
    expect(wrapper.find('.rc-main-result-head').text()).toContain('/rules/generated/orch-173.py')
    expect(wrapper.find('[data-testid="main-stream-result"]').exists()).toBe(true)
    expect(wrapper.find('.rc-main-result-code').exists()).toBe(false)
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main(sku_id)')
  })

  it('主面板生成中点击取消：中断请求并保留已输出的脚本', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name', script: '', scriptPath: '' })
    await flushPromises()
    let requestSignal: AbortSignal | undefined
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
      requestSignal = options?.signal
      options?.onContent?.('def main(sku_id):\n')
      await new Promise<never>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new Error('请求已取消')), { once: true })
      })
      throw new Error('请求未被取消')
    })

    await wrapper.find('[data-testid="main-generate-script"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="main-stream-result"]').text()).toContain('def main(sku_id):')

    const generateButton = wrapper.find('[data-testid="main-generate-script"]')
    expect(generateButton.attributes('aria-label')).toBe('取消生成脚本')
    await generateButton.trigger('click')
    await flushPromises()

    expect(requestSignal?.aborted).toBe(true)
    expect(wrapper.find('[data-testid="main-stream-result"]').text()).toContain('def main(sku_id):')
  })

  it('主面板生成中按钮切换为停止图标并可点击取消', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name', script: '', scriptPath: '' })
    await flushPromises()
    let requestSignal: AbortSignal | undefined
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
      requestSignal = options?.signal
      await new Promise<never>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new Error('请求已取消')), { once: true })
      })
      throw new Error('请求未被取消')
    })

    const generateButton = wrapper.find('[data-testid="main-generate-script"]')
    await generateButton.trigger('click')
    await flushPromises()

    expect(generateButton.attributes('aria-label')).toBe('取消生成脚本')
    expect(generateButton.find('[data-testid="stop-generation-icon"]').exists()).toBe(true)
    expect(generateButton.find('[data-testid="stop-generation-icon"]').element.childElementCount).toBe(0)
    await generateButton.trigger('click')
    await flushPromises()

    expect(requestSignal?.aborted).toBe(true)
  })

  it('data-process 生成中按钮立即切换为停止图标', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'new',
      describe: '按 sku_id 生成 sku_name',
      inputTableId: '2102154',
      inputFields: ['sku_id'],
      outputFields: ['sku_name'],
      modelProviderCode: 'DeepSeek',
      modelCode: 'deepseek-chat',
    })
    flow.configs['rule-1'].configId = '184'
    await flushPromises()

    let releaseGenerate!: (value: { script: string; scriptPath: string }) => void
    vi.spyOn(ruleApi, 'orchestrationSaveMeta')
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(
      () => new Promise((resolve) => { releaseGenerate = resolve }),
    )

    const generateButton = wrapper.find('[data-testid="main-generate-script"]')
    await generateButton.trigger('click')
    await wrapper.vm.$nextTick()

    expect(generateButton.attributes('aria-label')).toBe('取消生成脚本')
    expect(generateButton.find('[data-testid="stop-generation-icon"]').exists()).toBe(true)
    expect(ruleApi.orchestrationSaveMeta).not.toHaveBeenCalled()

    releaseGenerate({ script: 'def main():\n    return {}', scriptPath: '/code01/184.py' })
    await flushPromises()
  })

  it('生成接口未触发 onDone 时，成功返回后仍隐藏脚本预览', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    const script = ' \ndef process():\n    return {"ok": True}\n'
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name', script: '', scriptPath: '' })
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
      options?.onContent?.(script)
      return { script, scriptPath: '/rules/generated/orch-173.py' }
    })

    await wrapper.find('[data-testid="main-generate-script"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.rc-main-result-head').text()).toContain('/rules/generated/orch-173.py')
    expect(wrapper.find('.rc-main-result-code').exists()).toBe(false)
    expect(flow.configs['rule-1'].ruleCfg?.script).toBe(script)
  })

  it('主面板思考过程流式追加时会自动滚动到底部', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name', script: '', scriptPath: '' })
    await flushPromises()

    const scrollSpy = vi.fn()
    const scrollHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const scrollTopDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 520 })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: scrollSpy,
    })

    try {
      vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
        options?.onThinking?.('第一段思考\n')
        await flushPromises()
        options?.onThinking?.('第二段思考\n')
        return { script: 'def main(sku_id):\n    return {"sku_name": sku_id}\n', scriptPath: '/rules/generated/orch-173.py' }
      })

      await wrapper.find('[data-testid="main-generate-script"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="main-stream-thinking"]').text()).toContain('第二段思考')
      expect(scrollSpy).toHaveBeenCalledWith(520)
    } finally {
      if (scrollHeightDesc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDesc)
      if (scrollTopDesc) Object.defineProperty(HTMLElement.prototype, 'scrollTop', scrollTopDesc)
    }
  })

  it('主面板生成结果流式追加时会自动滚动到底部', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name', script: '', scriptPath: '' })
    await flushPromises()

    const scrollSpy = vi.fn()
    const scrollHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const scrollTopDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 680 })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set(value) {
        if (this.classList.contains('rc-main-result-code')) scrollSpy(value)
      },
    })

    try {
      vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
        options?.onContent?.('def main(sku_id):\n')
        await flushPromises()
        options?.onContent?.('    return {"sku_name": sku_id}\n')
        return { script: 'def main(sku_id):\n    return {"sku_name": sku_id}\n', scriptPath: '/rules/generated/orch-173.py' }
      })

      await wrapper.find('[data-testid="main-generate-script"]').trigger('click')
      await flushPromises()

      expect(flow.configs['rule-1'].ruleCfg?.script).toContain('return {"sku_name": sku_id}')
      expect(wrapper.find('.rc-main-result-code').exists()).toBe(false)
      expect(scrollSpy).toHaveBeenCalledWith(680)
    } finally {
      if (scrollHeightDesc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDesc)
      if (scrollTopDesc) Object.defineProperty(HTMLElement.prototype, 'scrollTop', scrollTopDesc)
    }
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
    flow.setMonitorMethods('monitor-1', ['当日数据是否正常入库', '数据延迟监控'])
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {}',
      scriptPath: '/code01/184.py',
    })

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).toHaveBeenCalled()
    const call = (ruleApi.dataProcessGenerate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call[0]).toHaveProperty('checkRule', '当日数据是否正常入库,数据延迟监控')
  })

  // 2026-09-05：数据监控节点保存脚本时同步落 ck_source（vanv-data-engine SourceController）。
  // 按 sourceId 查存在性：无记录 insert，有记录 update；checkConf 是 monitorMethods + 编排配置的 JSON。
  function setupMonitorSave() {
    const { flow, wrapper } = mountOnMonitorNode()
    flow.patchRuleConfig('monitor-1', {
      mode: 'ref', ruleId: 'orch-mon-1',
      describe: '当日数据是否正常入库',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: [],
      script: 'def main(sku_id):\n    return {}', scriptPath: '/code01/184.py',
    })
    flow.configs['monitor-1'].title = '库存监控'
    flow.configs['monitor-1'].schedule = { scheduleType: 'daily', scheduleTime: '08:00', weekdays: [], cron: '0 0 8 * * ?' }
    flow.setMonitorMethods('monitor-1', ['当日数据是否正常入库', '数据延迟监控'])
    useSourceStore().sourceCfg = {
      sourceId: '430016501', name: '源', url: '', configId: '', mainTable: '', owner: '', state: 'C',
    }
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'fileUploadScript').mockResolvedValue({ ok: true, message: '文件已保存' })
    return { flow, wrapper }
  }

  // 「保存脚本」按钮在 RuleWorkbenchDialog（el-dialog teleport）内，wrapper.findAll 拿不到
  //（既有用例同样受此影响，属 pre-existing 失败）；这里直接对弹层组件 emit save 触发 onSaveScript。
  async function triggerWorkbenchSave(wrapper: ReturnType<typeof mountOnRuleNode>['wrapper']) {
    const dialog = wrapper.findComponent(RuleWorkbenchDialog)
    expect(dialog.exists()).toBe(true)
    await dialog.vm.$emit('save')
    await flushPromises()
  }

  it('数据监控节点保存脚本：ck_source 无记录时 insert（含 checkConf JSON）', async () => {
    mockAssets()
    const { wrapper } = setupMonitorSave()
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)
    const updateSpy = vi.spyOn(ckSourceApi, 'update')
    await flushPromises()

    await triggerWorkbenchSave(wrapper)

    expect(ckSourceApi.list).toHaveBeenCalledWith('430016501')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(ckSourceApi.insert).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 430016501,
      name: '库存监控',
      schedule: '0 0 8 * * ?',
      tableName: 'sense_data.TB_JD_SKU_BASE',
      state: 'E', // insert 默认启用（2026-09-07）
    }))
    const payload = (ckSourceApi.insert as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { checkConf: string }
    const conf = JSON.parse(payload.checkConf)
    expect(conf.monitorMethods).toEqual(['当日数据是否正常入库', '数据延迟监控'])
    // describe 会被「进入编排配置时自动组装监控描述」覆盖成完整模板，断言包含监控方法与脚本路径即可
    expect(conf.orchestration).toMatchObject({ scriptPath: '/code01/184.py' })
    expect(String(conf.orchestration.describe)).toContain('数据延迟监控')
    // checkConf 不落 systemPrompt / script（2026-09-07 约定）：生成脚本的中间产物，不进 ck_source
    expect(conf.orchestration).not.toHaveProperty('systemPrompt')
    expect(conf.orchestration).not.toHaveProperty('script')
  })

  it('数据监控节点保存脚本：ck_source 已有记录时 update，不 insert', async () => {
    mockAssets()
    const { wrapper } = setupMonitorSave()
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 7, sourceId: 430016501, name: '旧名' }])
    const insertSpy = vi.spyOn(ckSourceApi, 'insert')
    vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)
    await flushPromises()

    await triggerWorkbenchSave(wrapper)

    expect(insertSpy).not.toHaveBeenCalled()
    // update 不带 state：运行状态由后台任务维护，前端不覆盖
    const updatePayload = (ckSourceApi.update as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload.state).toBeUndefined()
    expect(ckSourceApi.update).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 430016501, name: '库存监控' }))
  })

  it('流程未绑源（无 sourceId）时保存脚本不同步 ck_source', async () => {
    mockAssets()
    const { wrapper } = setupMonitorSave()
    useSourceStore().sourceCfg = null
    const listSpy = vi.spyOn(ckSourceApi, 'list')
    await flushPromises()

    await triggerWorkbenchSave(wrapper)

    expect(listSpy).not.toHaveBeenCalled()
  })

  // 2026-09-07：数据监控节点在编排配置 Tab 点 NodeInspector 底部「保存」（保存节点配置），
  // 配置保存成功后也要同步 ck_source——之前只有「保存脚本」一条路会同步，用户点底部
  // 「保存」时 /api/source/* 完全不发出。负向用例锁住「仅编排配置 Tab 触发」的口径。
  it('编排配置 Tab 点底部「保存」：配置保存成功后同步 ck_source（无记录 insert）', async () => {
    mockAssets()
    const { flow, wrapper } = setupMonitorSave()
    flow.configs['monitor-1'].configId = '1400998'
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({})
    const updateConfig = vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)
    await flushPromises()

    const saveBtn = wrapper.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
    await saveBtn.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(ckSourceApi.list).toHaveBeenCalledWith('430016501')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 430016501,
      name: '库存监控',
      schedule: '0 0 8 * * ?',
      tableName: 'sense_data.TB_JD_SKU_BASE',
    }))
    const payload = (insert as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { checkConf: string }
    const conf = JSON.parse(payload.checkConf)
    expect(conf.monitorMethods).toEqual(['当日数据是否正常入库', '数据延迟监控'])
    expect(conf.orchestration).toMatchObject({ scriptPath: '/code01/184.py' })
    expect(conf.orchestration).not.toHaveProperty('systemPrompt')
    expect(conf.orchestration).not.toHaveProperty('script')
  })

  it('编排配置 Tab 点底部「保存」：已有记录 update，不 insert', async () => {
    mockAssets()
    const { flow, wrapper } = setupMonitorSave()
    flow.configs['monitor-1'].configId = '1400998'
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({})
    vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 7, sourceId: 430016501, name: '旧名' }])
    const insertSpy = vi.spyOn(ckSourceApi, 'insert')
    vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)
    await flushPromises()

    const saveBtn = wrapper.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
    await saveBtn.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(insertSpy).not.toHaveBeenCalled()
    expect(ckSourceApi.update).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 430016501, name: '库存监控' }))
  })

  it('表配置 Tab 点底部「保存」：不触发 ck_source 同步（需求口径：仅编排配置 Tab）', async () => {
    mockAssets()
    const { flow, wrapper } = setupMonitorSave()
    flow.configs['monitor-1'].configId = '1400998'
    flow.setActiveTab('table')
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({})
    vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: 'ok' })
    const listSpy = vi.spyOn(ckSourceApi, 'list')
    await flushPromises()

    const saveBtn = wrapper.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
    await saveBtn.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(listSpy).not.toHaveBeenCalled()
  })

  it('数据监控节点显示描述输入框', async () => {
    mockAssets()
    const { wrapper } = mountOnMonitorNode()
    await flushPromises()

    expect(wrapper.find('textarea.rc-input.rc-textarea').exists()).toBe(true)
    expect(wrapper.find('[data-testid="monitor-methods-field"]').exists()).toBe(true)
  })

  it('数据监控节点在设置业务规则上方展示监控方法并写入节点配置', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnMonitorNode()
    await flushPromises()

    const monitorField = wrapper.find('[data-testid="monitor-methods-field"]')
    expect(monitorField.exists()).toBe(true)
    expect(monitorField.element.compareDocumentPosition(wrapper.find('.ni-section-title').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const select = monitorField.findComponent({ name: 'ElSelect' })
    await select.vm.$emit('update:modelValue', ['数据延迟监控', '每日数据量监控'])
    await flushPromises()

    expect(flow.configs['monitor-1'].monitorMethods).toEqual(['数据延迟监控', '每日数据量监控'])
  })

  it('数据监控节点进入编排配置时按 checkRule 回填监控方法', async () => {
    mockAssets()
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({
      configId: '184', checkRule: '当日数据是否正常入库, 数据延迟监控,不存在的监控',
    })
    const { flow } = mountOnMonitorNode()
    flow.configs['monitor-1'].configId = '184'
    await flushPromises()

    expect(configApi.configDetailRaw).toHaveBeenCalledWith('184')
    expect(flow.configs['monitor-1'].monitorMethods).toEqual(['当日数据是否正常入库', '数据延迟监控'])
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

  it('填写描述后生成脚本：写回 script/scriptPath，工作区保存脚本随之启用', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {"sku_name": ""}',
      scriptPath: '/rules/generated/orch-173.py',
    })

    await wrapper.find('textarea[placeholder*="自然语言描述"]').setValue('按 sku_id 生成 sku_name')
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
      systemPrompt: expect.stringContaining('源表=JD-商品基础:sense_data.TB_JD_SKU_BASE'),
    }), expect.anything())
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
    expect(flow.configs['rule-1'].ruleCfg?.scriptPath).toBe('/rules/generated/orch-173.py')
    const buttons = wrapper.findAll('button').filter((b) => ['全屏查看', '保存脚本'].includes(b.text()))
    buttons.forEach((b) => expect(b.attributes('disabled')).toBeUndefined())
  })

  it('规则节点没有 ruleId 时，生成脚本直接走 data-process，不先调用 saveMeta', async () => {
    mockAssets()
    vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(INPUT_TABLE)
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'new',
      describe: 'content 中包含地产二字时，tags 返回房地产',
      inputTableId: '2102154', inputFields: ['sku_id'], outputFields: ['sku_name'],
      modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
    })
    flow.configs['rule-1'].configId = '184'
    await flushPromises()
    const metaSpy = vi.spyOn(ruleApi, 'orchestrationSaveMeta')
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def main(sku_id):\n    return {"sku_name": ""}',
      scriptPath: '/code01/184.py',
    })

    const genBtn = wrapper.findAll('button').find((b) => b.text().includes('生成脚本'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(metaSpy).not.toHaveBeenCalled()
    expect(ruleApi.dataProcessGenerate).toHaveBeenCalledWith(expect.objectContaining({
      configId: 184,
      inputFields: '商品ID:sku_id',
      outputFields: '商品名称:sku_name',
    }), expect.anything())
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

  it('已有脚本重新打开工作区时，状态显示已生成而不是待生成', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', {
      script: 'def main(sku_id):\n    return {}',
      scriptPath: '/code01/202609/1789022685732.py',
    })
    await flushPromises()

    await openWorkbench(wrapper)
    await flushPromises()

    expect(wrapper.find('.wb-state').text()).toBe('已生成')
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

  it('打开工作区后默认展示描述（只读），系统提示词需点按钮展开', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    await openWorkbench(wrapper)

    // 默认展示描述（只读），系统提示词编辑区隐藏
    const describeTextarea = wrapper.find('textarea.wb-describe')
    expect(describeTextarea.exists()).toBe(true)
    expect((describeTextarea.element as HTMLTextAreaElement).value).toContain('content')
    // 系统提示词编辑区未渲染
    expect(wrapper.find('textarea.wb-textarea:not(.wb-code):not(.wb-describe)').exists()).toBe(false)
    // 模型供应商和模型下拉框在描述视图下也可用，可直接切换
    expect(wrapper.find('.wb-provider').exists()).toBe(true)
    expect(wrapper.find('.wb-model').exists()).toBe(true)
    // 切换按钮文案为「系统提示词」
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    expect(toggleBtn).toBeTruthy()

    // 点按钮展开系统提示词编辑区，描述收起
    await toggleBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('textarea.wb-describe').exists()).toBe(false)
    expect(wrapper.find('textarea.wb-textarea:not(.wb-code):not(.wb-describe)').exists()).toBe(true)
    // 切换按钮文案变为描述标签
    expect(wrapper.findAll('button').some((b) => b.text() === '规则处理描述')).toBe(true)
  })

  it('编辑系统提示词：保存后写回 systemPrompt，取消不写回', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()

    await openWorkbench(wrapper)

    // 规则节点工作区默认展示描述（只读），需点「系统提示词」按钮切换到提示词编辑区
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    await toggleBtn.trigger('click')
    await flushPromises()

    // S6-1：系统提示词编辑区从独立弹窗合并进 RuleWorkbenchDialog 左栏，class 从 .rspd-textarea 换成
    // .wb-textarea（右栏脚本框也用这个 class，加 .wb-code；左栏提示词没有，用 :not 精确定位）
    const textarea = wrapper.find('textarea.wb-textarea:not(.wb-code):not(.wb-describe)')
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

    await openWorkbench(wrapper)

    // 规则节点工作区默认展示描述（只读），需点「系统提示词」按钮切换到提示词编辑区
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    await toggleBtn.trigger('click')
    await flushPromises()

    const promptTextarea = wrapper.find('textarea.wb-textarea:not(.wb-code):not(.wb-describe)')
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

  it('进入编排配置页时自动拼接系统提示词并写回配置', async () => {
    const { flow } = mountWithExistingRule()
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('源表=JD-商品基础:sense_data.TB_JD_SKU_BASE')
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('目标表=sense_data.TB_JD_SKU_RESULT')
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('入参=商品ID:sku_id')
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('出参=商品名称:sku_name')
  })

  it('表配置字段变化后，规则处理系统提示词按最新入参和出参重新拼接', async () => {
    const { flow } = mountWithExistingRule()
    await flushPromises()

    flow.patchRuleConfig('rule-1', { inputFields: ['sku_name'], outputFields: ['sku_id'] })
    await flushPromises()

    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('入参=商品名称:sku_name')
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toContain('出参=商品ID:sku_id')
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).not.toContain('入参=商品ID:sku_id')
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).not.toContain('出参=商品名称:sku_name')
  })

  it('表配置字段变化后，数据监控系统提示词按最新入参重新拼接', async () => {
    mockAssets('通用新闻表')
    const { flow } = mountOnMonitorNode()
    flow.patchRuleConfig('monitor-1', {
      inputTableId: INPUT_TABLE.tableId,
      inputTable: INPUT_TABLE.tableName,
      inputFields: ['sku_id'],
      outputFields: [],
    })
    await flushPromises()

    flow.patchRuleConfig('monitor-1', { inputFields: ['sku_name'] })
    await flushPromises()

    expect(flow.configs['monitor-1'].ruleCfg?.systemPrompt).toContain('入参=商品名称:sku_name')
    expect(flow.configs['monitor-1'].ruleCfg?.systemPrompt).not.toContain('入参=商品ID:sku_id')
  })

  it('工作区加载模型供应商与模型，并在工作区里不再显示测试按钮', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    await openWorkbench(wrapper)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model/providers',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model/default-models?providerCode=DeepSeek',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(wrapper.findAll('.wb-pane-actions button').some((b) => b.text() === '测试')).toBe(false)
  })

  it('主面板生成区展示模型供应商和模型下拉，并复用模型接口候选', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model/providers',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model/default-models?providerCode=DeepSeek',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(wrapper.find('[data-testid="main-model-provider"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="main-model"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('模型供应商')
    expect(wrapper.text()).toContain('模型')
  })

  it('主面板模型下拉挂载到 body，避免被模型行的 overflow 裁剪', async () => {
    const { wrapper } = mountWithExistingRule()
    await flushPromises()

    const providerSelect = wrapper.find('[data-testid="main-model-provider"]').findComponent({ name: 'ElSelect' })
    const modelSelect = wrapper.find('[data-testid="main-model"]').findComponent({ name: 'ElSelect' })

    expect(providerSelect.props('teleported')).not.toBe(false)
    expect(modelSelect.props('teleported')).not.toBe(false)
  })

  it('切换模型供应商后刷新模型候选，保存时回写新的供应商/模型', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    await flushPromises()

    await openWorkbench(wrapper)

    // 规则节点工作区默认展示描述（只读），需点「系统提示词」按钮切换到提示词编辑区
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    await toggleBtn.trigger('click')
    await flushPromises()

    const providerSelect = wrapper.find('.wb-provider')
    await providerSelect.trigger('click')
    await flushPromises()
    const openAiOption = wrapper.findAll('.el-select-dropdown__item').find((el) => el.text() === 'OpenAI')
    expect(openAiOption).toBeTruthy()
    await openAiOption!.trigger('click')
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model/default-models?providerCode=OpenAI',
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

    await openWorkbench(wrapper)

    // 规则节点工作区默认展示描述（只读），需点「系统提示词」按钮切换到提示词编辑区
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    await toggleBtn.trigger('click')
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

  it('SSE 生成时会把 thinking 累积到思考面板，content 逐步写入代码区，done 显示完成提示', async () => {
    mockAssets()
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', {
      modelProviderCode: 'DeepSeek',
      modelCode: 'deepseek-chat',
      script: '',
      scriptPath: '',
    })
    await flushPromises()

    vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
      options?.onThinking?.('先确认输入表')
      options?.onThinking?.('再确认字段')
      options?.onContent?.('def main(date, zb_value):\n')
      options?.onContent?.('    return {"end_date": "2025-01-01"}\n')
      options?.onDone?.({ script: 'def main(date, zb_value):\n    return {"end_date": "2025-01-01"}', scriptPath: '/rules/generated/orch-173.py' })
      return { script: 'def main(date, zb_value):\n    return {"end_date": "2025-01-01"}', scriptPath: '/rules/generated/orch-173.py' }
    })

    await wrapper.find('textarea[placeholder*="描述规则处理逻辑"]').setValue('按 sku_id 生成 sku_name')
    await openWorkbench(wrapper)

    const genBtn = wrapper.findAll('.wb-pane-right .wb-pane-actions button').find((b) => b.text().includes('生成'))!
    await genBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('思考过程')
    expect(wrapper.text()).toContain('先确认输入表')
    expect(wrapper.text()).toContain('再确认字段')
    const codeTextarea = wrapper.find('textarea.wb-code')
    expect((codeTextarea.element as HTMLTextAreaElement).value).toContain('def main(date, zb_value)')
    expect(wrapper.text()).toContain('保存完成')
  })

  it('脚本工作区：只接受单个 Excel 且超过 10MB 时拒绝选择', async () => {
    mockAssets()
    const { wrapper } = mountWithExistingRule()
    await flushPromises()
    const fileInput = wrapper.find('input[data-testid="main-excel-file-input"]')
    expect(fileInput.exists()).toBe(true)
    const invalid = new File(['text'], 'rules.csv', { type: 'text/csv' })
    await selectFile(fileInput, invalid)
    expect(wrapper.text()).toContain('仅支持 .xls 或 .xlsx 文件')
    expect(wrapper.text()).not.toContain('rules.csv')

    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'rules.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    await selectFile(fileInput, oversized)
    expect(wrapper.text()).toContain('Excel 文件不能超过 10MB')
    expect(wrapper.text()).not.toContain('rules.xlsx')
  })

  it('脚本工作区：选择 Excel 后生成请求携带文件并可移除', async () => {
    mockAssets()
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '根据 Excel 字段生成处理脚本' })
    const generateSpy = vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({
      script: 'def process():\n    return {}',
      scriptPath: '/code01/202609/generated.py',
    })
    await flushPromises()
    const file = new File(['date,name'], 'orders.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const fileInput = wrapper.find('input[data-testid="main-excel-file-input"]')
    await selectFile(fileInput, file)
    expect(wrapper.text()).toContain('orders.xlsx')

    const generateButton = wrapper.find('[data-testid="main-generate-script"]')
    await generateButton.trigger('click')
    await flushPromises()
    expect(generateSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ file }))

    await wrapper.find('.rc-file-remove').trigger('click')
    expect(wrapper.text()).not.toContain('orders.xlsx')
  })

  it('SSE 生成时思考面板会自动滚动到底部', async () => {
    mockAssets()
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', {
      modelProviderCode: 'DeepSeek',
      modelCode: 'deepseek-chat',
      script: '',
      scriptPath: '',
    })
    await flushPromises()

    const scrollSpy = vi.fn()
    const scrollHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const scrollTopDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 480 })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: scrollSpy,
    })

    try {
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
      options?.onThinking?.('第一段思考')
      await flushPromises()
      options?.onThinking?.('第二段思考')
      return { script: 'def main(date, zb_value):\n    return {"end_date": "2025-01-01"}', scriptPath: '/rules/generated/orch-173.py' }
    })

    await wrapper.find('textarea[placeholder*="描述规则处理逻辑"]').setValue('按 sku_id 生成 sku_name')
    await openWorkbench(wrapper)

      const genBtn = wrapper.findAll('.wb-pane-right .wb-pane-actions button').find((b) => b.text().includes('生成'))!
      await genBtn.trigger('click')
      await flushPromises()

      expect(scrollSpy).toHaveBeenCalledWith(480)
    } finally {
      if (scrollHeightDesc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDesc)
      if (scrollTopDesc) Object.defineProperty(HTMLElement.prototype, 'scrollTop', scrollTopDesc)
    }
  })

  it('数据监控节点工作区会把 source_id/source_cron/source_table 按表单值替换', async () => {
    mockAssets('通用新闻表', '900', 'sense_data.TB_CNEWS')
    const { flow, wrapper } = mountOnMonitorNode()
    flow.setInputTable('monitor-1', '900')
    flow.setStepSourceId('monitor-1', '391007796')
    flow.patchSchedule('monitor-1', { cron: '0 0 12 * * *' })
    await flushPromises()

    await openWorkbench(wrapper)

    // 数据监控节点工作区默认展示描述（只读），需点「系统提示词」按钮切换到提示词编辑区
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    await toggleBtn.trigger('click')
    await flushPromises()

    const promptTextarea = wrapper.find('textarea.wb-textarea:not(.wb-code):not(.wb-describe)')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('source_id=391007796')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('source_cron=0 0 12 * * *')
    expect((promptTextarea.element as HTMLTextAreaElement).value).toContain('source_table=通用新闻表:sense_data.TB_CNEWS')
  })

  it('保存脚本：需二次确认，确认后调用 fileUploadScript', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    delete flow.configs['rule-1'].ruleCfg!.ruleId
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'fileUploadScript').mockResolvedValue({ ok: true, message: '文件已保存' })

    await openWorkbench(wrapper)
    const workbench = wrapper.findComponent(RuleWorkbenchDialog)
    const saveScriptBtn = workbench.findAll('.wb-pane-actions button').find((b) => b.text().includes('保存脚本'))!
    await saveScriptBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.fileUploadScript).toHaveBeenCalledWith('/x/y.py', 'def main(sku_id):\n    return {}')
    expect(flow.configs['rule-1'].ruleCfg?.mode).toBe('ref')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBeUndefined()
    expect(flow.configs['rule-1'].ruleCfg?.scriptPath).toBe('/x/y.py')
  })

  it('保存脚本：取消确认框则不调用接口', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/x/y.py' })
    await flushPromises()
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    vi.spyOn(ruleApi, 'fileUploadScript')

    await openWorkbench(wrapper)
    const workbench = wrapper.findComponent(RuleWorkbenchDialog)
    const saveScriptBtn = workbench.findAll('.wb-pane-actions button').find((b) => b.text().includes('保存脚本'))!
    await saveScriptBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.fileUploadScript).not.toHaveBeenCalled()
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
    vi.spyOn(ruleApi, 'fileDownloadScript').mockResolvedValue('def main():\n    return {}')
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', ruleId: '173', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      describe: '', script: '', scriptPath: '',
    })
    await flushPromises()

    expect(ruleApi.orchestrationDetail).toHaveBeenCalledWith('173')
    expect(ruleApi.fileDownloadScript).toHaveBeenCalledWith('/code01/a.py')
    expect(ruleApi.orchestrationLoadScript).not.toHaveBeenCalled()
    expect(flow.configs['rule-1'].ruleCfg?.describe).toBe('服务端描述')
    expect(flow.configs['rule-1'].ruleCfg?.script).toContain('def main')
    expect(wrapper.text()).toContain('设置业务规则')
  })

  it('进入编排配置时会从 configDetailRaw 回填描述、路径和脚本正文', async () => {
    mockAssets()
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({
      snatchConf: { description: '我想对通用新闻表进行如下监控：\n1.当日数据是否正常入库\n2.数据延迟监控' },
      codeRule: {
        scriptPath: '/code01/202609/1788333914232.py',
        content: 'def main():\n    return {"ok": True}\n',
      },
    } as never)
    vi.spyOn(ruleApi, 'orchestrationLoadScript').mockResolvedValue('')

    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref',
      ruleId: '173',
      name: '已有规则',
      dataSource: 'dp-wwdata',
      inputTable: 'sense_data.TB_CNEWS',
      inputTableId: '2102154',
      describe: '',
      script: '',
      scriptPath: '',
    })
    flow.configs['rule-1'].configId = '1400998'
    await flushPromises()
    await openWorkbench(wrapper)
    await flushPromises()

    expect(configApi.configDetailRaw).toHaveBeenCalledWith('1400998')
    expect(wrapper.find('textarea.wb-describe').element).toHaveProperty(
      'value',
      '我想对通用新闻表进行如下监控：\n1.当日数据是否正常入库\n2.数据延迟监控',
    )
    expect(wrapper.find('.wb-path').text()).toBe('/code01/202609/1788333914232.py')
    expect((wrapper.find('textarea.wb-code').element as HTMLTextAreaElement).value).toContain('def main():')
    expect((wrapper.find('textarea.wb-code').element as HTMLTextAreaElement).value).toContain('"ok": True')
    expect(wrapper.find('.rc-main-result-head').text()).toContain('/code01/202609/1788333914232.py')
  })

  it('进入编排配置时若 codeRule 只有路径，会自动下载脚本正文并写回结果框', async () => {
    mockAssets()
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({
      snatchConf: { description: '我想对通用新闻表进行如下监控：\n1.当日数据是否正常入库\n2.数据延迟监控' },
      codeRule: '/code01/202609/1788761803128.py',
    } as never)
    vi.spyOn(ruleApi, 'fileDownloadScript').mockResolvedValue('def main():\n    return {"hello": "world"}\n')

    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref',
      ruleId: '173',
      name: '已有规则',
      dataSource: 'dp-wwdata',
      inputTable: 'sense_data.TB_CNEWS',
      inputTableId: '2102154',
      describe: '',
      script: '',
      scriptPath: '',
    })
    flow.configs['rule-1'].configId = '1400998'
    await flushPromises()
    await openWorkbench(wrapper)
    await flushPromises()

    expect(ruleApi.fileDownloadScript).toHaveBeenCalledWith('/code01/202609/1788761803128.py')
    expect((wrapper.find('textarea.wb-code').element as HTMLTextAreaElement).value).toContain('def main():')
    expect((wrapper.find('textarea.wb-code').element as HTMLTextAreaElement).value).toContain('"hello": "world"')
    expect(wrapper.find('.rc-main-result-code').text()).toContain('def main():')
  })

  it('点击生成结果文件名时会把脚本下载到本地，文件名取路径最后一段', async () => {
    mockAssets()
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({
      snatchConf: { description: '我想对通用新闻表进行如下监控：\n1.当日数据是否正常入库\n2.数据延迟监控' },
      codeRule: {
        scriptPath: '/code01/202609/1788761803128.py',
        content: 'def main():\n    pass\n',
      },
    } as never)
    vi.spyOn(ruleApi, 'fileDownloadScript').mockResolvedValue('def main():\n    return {"hello": "world"}\n')

    // 拦截 createObjectURL：把 Blob 内容读出来后用同步桩 URL 代替，避免 jsdom 真的去 fetch blob:
    const captured: { name: string | null; text: string }[] = []
    const stubUrl = 'blob:stub'
    vi.spyOn(URL, 'createObjectURL').mockImplementation(((blob: Blob) => {
      void blob.text().then((text) => {
        captured.push({ name: stubDownloadName, text })
      })
      return stubUrl
    }) as typeof URL.createObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let stubDownloadName = ''
    const origCreate = document.createElement.bind(document)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement
      if (tag === 'a') {
        Object.defineProperty(el, 'download', {
          configurable: true,
          get() { return stubDownloadName },
          set(v: string) { stubDownloadName = v },
        })
      }
      return el
    })

    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref',
      ruleId: '173',
      name: '已有规则',
      dataSource: 'dp-wwdata',
      inputTable: 'sense_data.TB_CNEWS',
      inputTableId: '2102154',
      describe: '',
      script: '',
      scriptPath: '',
    })
    flow.configs['rule-1'].configId = '1400998'
    await flushPromises()
    await openWorkbench(wrapper)
    await flushPromises()

    await wrapper.find('.rc-main-result-link').trigger('click')
    await flushPromises()
    // 等 blob.text() 这个微任务 resolve
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()

    expect(ruleApi.fileDownloadScript).toHaveBeenCalledWith('/code01/202609/1788761803128.py')
    expect(captured.length).toBe(1)
    expect(captured[0].name).toBe('1788761803128.py')
    expect(captured[0].text).toContain('def main():')
    expect(captured[0].text).toContain('"hello": "world"')
    // 不要再回填到工作台脚本编辑器
    expect((wrapper.find('textarea.wb-code').element as HTMLTextAreaElement).value).not.toContain('"hello": "world"')

    createSpy.mockRestore()
  })
})

// 0901 需求变更：测试脚本入口从全屏测试台弹窗（RuleTestDialog，拍板 #12）改为切换到流程视图
// 右侧面板的「数据视图」tab（view=data），保留当前源上下文，在画布右侧看节点产出数据。
describe('RuleOrchestrationTab · 测试脚本切换数据视图', () => {
  function mountWithScript() {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', name: '已有规则',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      script: 'def main(sku_id):\n    return {"sku_name": sku_id}', scriptPath: '/x/y.py',
    })
    return { flow, wrapper }
  }

  it('已有输入表但未生成脚本时测试脚本按钮禁用', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.configs['rule-1'].configId = '184'
    flow.patchRuleConfig('rule-1', { mode: 'ref', inputTable: 'sense_data.TB_JD_SKU_BASE' })
    await flushPromises()
    const disabledBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    expect(disabledBtn.attributes('disabled')).toBeDefined()
  })

  it('已有脚本路径且仅绑定输入表 ID 时测试脚本按钮可用', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref',
      inputTableId: '2102154',
      script: '',
      scriptPath: '/code01/202609/1788326374508.py',
    })
    await flushPromises()

    const testBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    expect(testBtn.attributes('disabled')).toBeUndefined()
  })

  it('脚本工作区中的测试脚本按钮与主面板使用相同启用条件', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref',
      ruleId: 'orch-173',
      inputTableId: '2102154',
      script: '',
      scriptPath: '/code01/202609/1788326374508.py',
    })
    await openWorkbench(wrapper)

    const workbench = wrapper.findComponent(RuleWorkbenchDialog)
    const workbenchTest = workbench.findAll('.wb-pane-actions button').find((b) => b.text() === '测试脚本')!
    expect(workbenchTest.attributes('disabled')).toBeUndefined()
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

  it('数据监控节点点击测试脚本直接执行 codePath，并在弹窗展示返回结果', async () => {
    mockAssets()
    const executeSpy = vi.spyOn(ruleApi, 'executeCode').mockResolvedValue({
      success: true,
      result: [{ status: 'ok' }],
    })
    const { flow, wrapper } = mountOnMonitorNode()
    flow.patchRuleConfig('monitor-1', {
      mode: 'ref',
      ruleId: '1400997',
      inputTableId: '2102154',
      inputFields: ['sku_id'],
      script: '',
      scriptPath: '/code01/202609/1788774054213.py',
    })
    await flushPromises()

    const testBtn = wrapper.findAll('button').find((b) => b.text() === '测试脚本')!
    expect(testBtn.attributes('disabled')).toBeUndefined()
    await testBtn.trigger('click')
    await flushPromises()

    expect(executeSpy).toHaveBeenCalledWith({
      codePath: '/code01/202609/1788774054213.py',
      timeout: 300,
    })
    expect(routerReplace).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="monitor-test-result"]').exists()).toBe(false)
    expect(document.body.querySelector('[data-testid="monitor-script-test-dialog"]')?.textContent).toContain('"status": "ok"')
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
    vi.spyOn(ruleApi, 'fileUploadScript').mockResolvedValue({ ok: true, message: '文件已保存' })

    await openWorkbench(wrapper)
    const workbench = wrapper.findComponent(RuleWorkbenchDialog)
    const saveBtn = workbench.findAll('.wb-pane-actions button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('配置'), expect.stringContaining('抓取配置'), expect.anything())
    expect(ruleApi.fileUploadScript).toHaveBeenCalledWith('/x/1.xml', '<Config/>')
    expect(flow.configs['web-1'].execCfg?.mode).toBe('ref')
    expect(flow.configs['web-1'].execCfg?.ruleId).toBeUndefined()
  })

  // 切换已有配置后必须清空 scriptPath，避免保存时覆盖源节点的文件。
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
    vi.spyOn(ruleApi, 'fileUploadScript')

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('未知字段'), '字段一致性提示', expect.anything())
    expect(ruleApi.fileUploadScript).not.toHaveBeenCalled()
  })

  it('保存前一致性校验：确认「仍要保存」后继续走正常保存流程', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    flow.patchExecConfig('web-1', { script: CAPTURE_XML, scriptPath: '/x/1.xml' })
    await flushPromises()
    // 第一次 confirm 是一致性提示，第二次是既有的"保存后将绑定到该节点"确认，两次都要放行
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    vi.spyOn(ruleApi, 'fileUploadScript').mockResolvedValue({ ok: true, message: '文件已保存' })

    const saveBtn = wrapper.findAll('button').find((b) => b.text().includes('保存配置'))!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(ruleApi.fileUploadScript).toHaveBeenCalledWith('/x/1.xml', CAPTURE_XML)
    expect(flow.configs['web-1'].execCfg?.ruleId).toBeUndefined()
  })
})
