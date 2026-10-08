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
import SiteScriptGeneratorDialog from '../SiteScriptGeneratorDialog.vue'
import { useFlowStore } from '@/stores/flow'
import { DEFAULT_CAPTURE_CONFIG_SYSTEM_PROMPT, NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { configApi, entryApi, paramApi, ruleApi, ckSourceApi, sourceApi } from '@/api'
import { translateSampleOf } from '@/api/translate'
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

  // 0917 产品口径：视频转音频 / 语音转文字这几类不给「脚本编辑」入口（它们不需要生成脚本）。
  // 0922/0923 起这两类都改成各自的纯参数配置（音频参数区），「抓取配置」标题行整块收起——
  // 与上面「只保留音频参数」用例同口径（0929 修正：video-audio 分支还停留在 0917 的旧 UI，
  // 标题行只对规则节点出现）。
  // 0921 起「文章生成摘要」整行标题都不出现（它连抓取配置都没有），单独在下面断言。
  // 0922 起「OCR 抓取」编排配置整页空白，单独在下面「OCR 抓取节点编排配置（空白页）」断言。
  it.each([
    ['video-audio', '视频提取音频'],
    ['audio-text', '音频提取文字'],
  ])('%s 节点（%s）的标题行不出现', async (seedKey, label) => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['x-1'] = cloneConfig(NODE_CONFIGS[seedKey])
    flow.select('x-1')
    flow.setActiveTab('orchestration')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.find('.ni-section-title-row').exists(), label).toBe(false)
    expect(wrapper.find('.ni-section-actions').exists(), label).toBe(false)
    wrapper.unmount()
  })

  // 0921 产品口径：文章生成摘要的编排配置只留模型与系统提示词，标题行（抓取配置）整块下线
  it('文章生成摘要节点（文章生成摘要）连「抓取配置」标题行都不出现', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['x-1'] = cloneConfig(NODE_CONFIGS['article-summary'])
    flow.select('x-1')
    flow.setActiveTab('orchestration')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.find('.ni-section-title-row').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('抓取配置')
  })

  it('采集类节点（网页抓取）仍然保留脚本编辑按钮', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['x-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('x-1')
    flow.setActiveTab('orchestration')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    const titleRow = wrapper.find('.ni-section-title-row')
    expect(titleRow.text()).toContain('抓取配置')
    expect(titleRow.find('button').text()).toBe('脚本编辑')
  })

  // 2026-09-22：OCR 编排 Tab 曾整页空白；2026-09-30 恢复「是否保存为文件」勾选框（唯一区块），
  // 其余编排内容（识别试跑、脚本工作区、描述、切换已有配置）仍不出现。
  describe('OCR 抓取节点编排配置（只剩「是否保存为文件」勾选框）', () => {
    it('渲染勾选框，不渲染标题行/识别试跑/描述框/切换已有配置/脚本工作区', async () => {
      mockAssets()
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['ocr-1'] = cloneConfig(NODE_CONFIGS['ocr'])
      flow.select('ocr-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      await flushPromises()

      expect(wrapper.find('.ni-section-title-row').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('抓取配置')
      expect(wrapper.text()).not.toContain('OCR 识别')
      expect(wrapper.text()).not.toContain('切换已有配置')
      expect(wrapper.find('input[type="file"]').exists()).toBe(false)
      expect(wrapper.find('textarea').exists()).toBe(false)
      // 脚本编辑工作区也不该为 OCR 节点挂上（没有可生成/保存的脚本）
      expect(wrapper.findComponent(RuleWorkbenchDialog).exists()).toBe(false)
      // 「是否保存为文件」勾选框：默认未勾选（回读走 structuredConfig，NODE_CONFIGS.ocr 空）
      const checkbox = wrapper.find('[data-testid="ocr-save-as-file"]')
      expect(checkbox.exists()).toBe(true)
      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
      wrapper.unmount()
    })

    it('勾选写入 structuredConfig = {"saveAsFile":true}；取消写 false', async () => {
      mockAssets()
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['ocr-1'] = cloneConfig(NODE_CONFIGS['ocr'])
      flow.select('ocr-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="ocr-save-as-file"]')
      await checkbox.setValue(true)
      expect(flow.configs['ocr-1'].structuredConfig).toBe('{"saveAsFile":true}')
      await checkbox.setValue(false)
      expect(flow.configs['ocr-1'].structuredConfig).toBe('{"saveAsFile":false}')
      wrapper.unmount()
    })

    it('回读：structuredConfig 里 saveAsFile=true 时勾选还原', async () => {
      mockAssets()
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['ocr-1'] = cloneConfig(NODE_CONFIGS['ocr'])
      flow.configs['ocr-1'].structuredConfig = '{"saveAsFile":true}'
      flow.select('ocr-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      await flushPromises()

      const checkbox = wrapper.find('[data-testid="ocr-save-as-file"]')
      expect((checkbox.element as HTMLInputElement).checked).toBe(true)
      wrapper.unmount()
    })
  })

  // 2026-09-23：音频提取文字节点编排配置增强——供应商/远程参数/语言/区间/输出，落成 CODE_RULE。
  describe('音频提取文字节点编排配置', () => {
    function mountOnAudioTextNode() {
      mockAssets()
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['audio-1'] = cloneConfig(NODE_CONFIGS['audio-text'])
      flow.select('audio-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      return { flow, wrapper }
    }

    it('默认本地供应商：显示供应商/语言/区间/输出，不显示远程字段，且不出现其它编排元素', async () => {
      const { wrapper } = mountOnAudioTextNode()
      await flushPromises()

      expect(wrapper.find('[data-testid="audio-config-field"]').exists()).toBe(true)
      expect((wrapper.find('select[data-testid="audio-provider"]').element as HTMLSelectElement).value).toBe('local')
      expect((wrapper.find('select[data-testid="audio-language"]').element as HTMLSelectElement).value).toBe('zh')
      expect(wrapper.find('[data-testid="audio-start"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="audio-end"]').exists()).toBe(true)
      // local 才给 SRT 选项
      expect(wrapper.find('option[data-testid="audio-srt-option"]').attributes('disabled')).toBeUndefined()
      // 远程专属字段不出现
      expect(wrapper.find('[data-testid="audio-provider-code"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="audio-remote-model"]').exists()).toBe(false)
      // 其它编排元素（描述/标题行/切换配置）不出现
      expect(wrapper.find('.ni-section-title-row').exists()).toBe(false)
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('切换已有配置')
      wrapper.unmount()
    })

    it('切到 WAND：不显示旧的远程供应商/模型字段，SRT 被禁用，CODE_RULE 落 provider=wand', async () => {
      const { flow, wrapper } = mountOnAudioTextNode()
      await flushPromises()

      await wrapper.find('select[data-testid="audio-provider"]').setValue('wand')
      await flushPromises()

      // 原「语音转文字接口」专属字段已整体下线，任何供应商下都不出现
      expect(wrapper.find('[data-testid="audio-provider-code"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="audio-remote-model"]').exists()).toBe(false)
      // 只回整段文本，SRT 禁用
      expect(wrapper.find('option[data-testid="audio-srt-option"]').attributes('disabled')).toBeDefined()

      const stored = JSON.parse(String(flow.configs['audio-1'].structuredConfig))
      expect(stored.provider).toBe('wand')
      expect(stored.outputFormat).toBe('txt')
      expect('providerCode' in stored).toBe(false)
      expect('remoteModel' in stored).toBe(false)
      wrapper.unmount()
    })

    it('切到 AssemblyAI：不显示远程供应商/模型字段，SRT 被禁用，CODE_RULE 落 provider=assemblyai', async () => {
      const { flow, wrapper } = mountOnAudioTextNode()
      await flushPromises()

      await wrapper.find('select[data-testid="audio-provider"]').setValue('assemblyai')
      await flushPromises()

      // AssemblyAI 直连官方接口，不需要接口供应商/接口模型
      expect(wrapper.find('[data-testid="audio-provider-code"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="audio-remote-model"]').exists()).toBe(false)
      // 只回整段文本，SRT 禁用
      expect(wrapper.find('option[data-testid="audio-srt-option"]').attributes('disabled')).toBeDefined()

      const stored = JSON.parse(String(flow.configs['audio-1'].structuredConfig))
      expect(stored.provider).toBe('assemblyai')
      expect('providerCode' in stored).toBe(false)
      expect('remoteModel' in stored).toBe(false)
      expect(stored.outputFormat).toBe('txt')
      wrapper.unmount()
    })

    it('语言与区间改动写回 structuredConfig（CODE_RULE），修掉旧的不落库问题', async () => {
      const { flow, wrapper } = mountOnAudioTextNode()
      await flushPromises()

      await wrapper.find('select[data-testid="audio-language"]').setValue('zh')
      await wrapper.find('input[data-testid="audio-start"]').setValue('30')
      await wrapper.find('input[data-testid="audio-end"]').setValue('90')
      await flushPromises()

      const stored = JSON.parse(String(flow.configs['audio-1'].structuredConfig))
      expect(stored.language).toBe('zh')
      expect(stored.start).toBe('30')
      expect(stored.end).toBe('90')
      wrapper.unmount()
    })

    it('从已存 CODE_RULE 回填各控件', async () => {
      mockAssets()
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['audio-1'] = {
        ...cloneConfig(NODE_CONFIGS['audio-text']),
        structuredConfig: JSON.stringify({ provider: 'wand', language: 'en', start: '10', end: '20', outputFormat: 'txt', outputBaseDir: '/code09' }),
      }
      flow.select('audio-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      await flushPromises()

      expect((wrapper.find('select[data-testid="audio-provider"]').element as HTMLSelectElement).value).toBe('wand')
      expect((wrapper.find('select[data-testid="audio-language"]').element as HTMLSelectElement).value).toBe('en')
      expect((wrapper.find('input[data-testid="audio-start"]').element as HTMLInputElement).value).toBe('10')
      expect((wrapper.find('input[data-testid="audio-end"]').element as HTMLInputElement).value).toBe('20')
      expect((wrapper.find('input[data-testid="audio-output-base-dir"]').element as HTMLInputElement).value).toBe('/code09')
      wrapper.unmount()
    })

    it('结束时间不晚于开始时间时给出校验提示', async () => {
      const { wrapper } = mountOnAudioTextNode()
      await flushPromises()

      await wrapper.find('input[data-testid="audio-start"]').setValue('90')
      await wrapper.find('input[data-testid="audio-end"]').setValue('30')
      await flushPromises()

      expect(wrapper.find('[data-testid="audio-range-error"]').exists()).toBe(true)
      wrapper.unmount()
    })
  })

  // 0917 视频提取音频试跑：上传视频 → multipart 调 /api/media/extract-audio → 音频试听/下载
  describe('视频提取音频试跑（视频提取音频节点）', () => {
    function mountOnVideoAudioNode() {
      mockAssets()
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['video-1'] = cloneConfig(NODE_CONFIGS['video-audio'])
      flow.select('video-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      return { flow, wrapper }
    }

    function mockMediaFetch(impl?: () => Response) {
      return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (impl ? impl() : new Response(
        new Uint8Array([1, 2, 3, 4]),
        {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': "attachment; filename=meeting.mp3; filename*=UTF-8''meeting.mp3",
          },
        },
      )))
    }

    it('视频提取音频节点只保留音频参数，不显示通用编排元素', async () => {
      const { wrapper } = mountOnVideoAudioNode()
      await flushPromises()

      expect(wrapper.find('[data-testid="video-extract-field"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="video-pick-file"]').exists()).toBe(false)
      // 输出格式 / 码率 / 采样率 / 声道 都在，且默认是 mp3
      expect((wrapper.get('[data-testid="media-format"]').element as HTMLSelectElement).value).toBe('mp3')
      expect(wrapper.find('[data-testid="media-bitrate"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="media-sampling-rate"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="media-channels"]').exists()).toBe(true)
      expect(wrapper.find('.ni-section-title-row').exists()).toBe(false)
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('切换已有配置')
      // 没选文件不能点提取
      expect(wrapper.get('[data-testid="video-extract"]').attributes('disabled')).toBeDefined()
      wrapper.unmount()
    })

    it('上传视频后按参数调接口，拿到音频流并给出试听与下载', async () => {
      const { wrapper } = mountOnVideoAudioNode()
      await flushPromises()
      const fetchSpy = mockMediaFetch()

      await selectFile(
        wrapper.find('input[data-testid="video-file-input"]'),
        new File(['video-bytes'], 'meeting.mp4', { type: 'video/mp4' }),
      )
      await wrapper.get('select[data-testid="media-format"]').setValue('wav')
      await wrapper.get('select[data-testid="media-sampling-rate"]').setValue('16000')
      await wrapper.get('[data-testid="video-extract"]').trigger('click')
      await flushPromises()
      await flushPromises()

      const calls = fetchSpy.mock.calls.filter(([url]) => url === '/api/media/extract-audio')
      expect(calls).toHaveLength(1)
      const form = calls[0][1]?.body as FormData
      expect((form.get('file') as File).name).toBe('meeting.mp4')
      await expect((form.get('request') as Blob).text()).resolves.toBe('{"format":"wav","samplingRate":16000}')

      const result = wrapper.get('[data-testid="video-result"]')
      expect(result.text()).toContain('meeting.mp3')
      expect(result.find('[data-testid="video-audio-player"]').exists()).toBe(true)
      expect(result.text()).toContain('下载')
    })

    it('勾选上传到文件服务时展示 fileId', async () => {
      const { wrapper } = mountOnVideoAudioNode()
      await flushPromises()
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
        fileId: '/media01/202609/abc.mp3', filename: 'meeting.mp3', format: 'mp3', size: 16629, duration: 12.3,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

      await selectFile(
        wrapper.find('input[data-testid="video-file-input"]'),
        new File(['video-bytes'], 'meeting.mp4', { type: 'video/mp4' }),
      )
      await wrapper.get('input[data-testid="media-upload-switch"]').setValue(true)
      await wrapper.get('[data-testid="video-extract"]').trigger('click')
      await flushPromises()
      await flushPromises()

      expect(wrapper.get('[data-testid="video-upload-result"]').text()).toContain('已上传到文件服务')
      expect(wrapper.get('[data-testid="video-file-id"]').text()).toContain('/media01/202609/abc.mp3')
      expect(wrapper.find('[data-testid="video-audio-player"]').exists()).toBe(false)
    })

    it('非视频后缀被本地拦下，不发请求', async () => {
      const { wrapper } = mountOnVideoAudioNode()
      await flushPromises()
      const fetchSpy = mockMediaFetch()

      await selectFile(
        wrapper.find('input[data-testid="video-file-input"]'),
        new File(['x'], 'audio.mp3', { type: 'audio/mpeg' }),
      )
      await flushPromises()

      expect(wrapper.get('[data-testid="video-file-error"]').text()).toContain('不支持的视频格式')
      expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/media/extract-audio')).toHaveLength(0)
      expect(wrapper.get('[data-testid="video-extract"]').attributes('disabled')).toBeDefined()
    })

    it('视频没有音轨（422）时透出后端文案，不显示结果区', async () => {
      const { wrapper } = mountOnVideoAudioNode()
      await flushPromises()
      mockMediaFetch(() => new Response(JSON.stringify({ error: '视频不包含音频轨道，无法提取音频' }), {
        status: 422, headers: { 'Content-Type': 'application/json' },
      }))

      await selectFile(
        wrapper.find('input[data-testid="video-file-input"]'),
        new File(['video-bytes'], 'silent.mp4', { type: 'video/mp4' }),
      )
      await wrapper.get('[data-testid="video-extract"]').trigger('click')
      await flushPromises()
      await flushPromises()

      expect(wrapper.get('[data-testid="video-error"]').text()).toContain('视频不包含音频轨道')
      expect(wrapper.find('[data-testid="video-result"]').exists()).toBe(false)
    })
  })

  // 0921 改版：文章生成摘要的编排配置只留「模型供应商 / 模型」两个下拉 + 只读的系统提示词；
  // 上传/粘贴正文 → 生成摘要那一套（0917 第一版）整体下线，真正的摘要在流程执行时由后端生成。
  describe('文章生成摘要（文章生成摘要节点）', () => {
    const ARTICLE_TEMPLATE = {
      promptId: 3,
      nodeType: 'article_summary',
      nodeTypeName: '文章生成摘要',
      category: 'rule',
      systemPrompt: '你是一名专业的文章摘要生成助手，请为下面的文章生成 100~300 字摘要。',
      version: 1,
      isActive: 1,
      isDefault: 1,
    }

    /** 按真实后端的两跳响应打桩：/api/model/providers、/api/model/default-models、/api/prompt/list */
    function mockArticleApis(promptRows: unknown[] = [ARTICLE_TEMPLATE]) {
      const calls: string[] = []
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        calls.push(url)
        const json = (data: unknown) => new Response(JSON.stringify(data), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
        if (url === '/api/model/providers') return json({ data: MODEL_PROVIDERS })
        if (url.startsWith('/api/model/default-models')) {
          const code = new URL(url, 'http://localhost').searchParams.get('providerCode') || ''
          return json({ data: MODEL_OPTIONS[code] ?? [] })
        }
        if (url.startsWith('/api/prompt/list')) return json(promptRows)
        return json([])
      })
      return { spy, calls, promptCalls: () => calls.filter((u) => u.startsWith('/api/prompt/list')) }
    }

    /**
     * ⚠️ 顺序要紧：mockAssets() 自己也会 spy fetch（画布上的资产/提示词请求），
     * 必须先让它装完，再用 mockArticleApis 接管，否则挂载期的提示词/模型请求都被它兜住、断言永远为空。
     */
    function mountOnArticleNode(promptRows: unknown[] = [ARTICLE_TEMPLATE]) {
      mockAssets()
      const api = mockArticleApis(promptRows)
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['article-1'] = cloneConfig(NODE_CONFIGS['article-summary'])
      flow.select('article-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      return { flow, wrapper, ...api }
    }

    it('只保留模型选择与系统提示词，试跑区与抓取配置配套件都不出现', async () => {
      const { wrapper } = mountOnArticleNode()
      await flushPromises()
      await flushPromises()

      expect(wrapper.find('[data-testid="article-summary-field"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="article-model-provider"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="article-model"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="article-prompt-toggle"]').exists()).toBe(true)

      // 试跑区（上传正文 / 正文框 / 生成按钮 / 结果区）整体下线
      for (const id of [
        'article-pick-file', 'article-file-input', 'article-text',
        'article-file-error', 'article-generate', 'article-error', 'article-result',
      ]) {
        expect(wrapper.find(`[data-testid="${id}"]`).exists(), id).toBe(false)
      }
      expect(wrapper.find('textarea[placeholder*="粘贴或上传要生成摘要的文章正文"]').exists()).toBe(false)
      // 抓取配置那一套配套件（标题行 / 抓取需求描述 / 切换已有配置）同样不出现
      expect(wrapper.find('.ni-section-title-row').exists()).toBe(false)
      expect(wrapper.find('textarea[placeholder*="描述抓取需求"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('切换已有配置')
    })

    it('进 Tab 就按 category=rule + node_type_name=文章生成摘要 取提示词并写到节点上', async () => {
      const { flow, wrapper, promptCalls } = mountOnArticleNode()
      await flushPromises()
      await flushPromises()

      expect(promptCalls()[0]).toContain('category=rule')
      expect(decodeURIComponent(promptCalls()[0])).toContain('node_type_name=文章生成摘要')
      expect(flow.configs['article-1'].execCfg?.systemPrompt).toBe(ARTICLE_TEMPLATE.systemPrompt)
      // 查看系统提示词改为打开脚本编辑工作台同款的只读弹窗
      await wrapper.get('[data-testid="article-prompt-toggle"]').trigger('click')
      await flushPromises()
      const dialog = wrapper.findComponent(RuleWorkbenchDialog)
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('promptPreviewOnly')).toBe(true)
      expect(dialog.find('[data-testid="prompt-preview-dialog"]').exists()).toBe(true)
      expect((dialog.get('[data-testid="prompt-preview-textarea"]').element as HTMLTextAreaElement).value).toContain('文章摘要生成助手')
      expect(wrapper.find('[data-testid="article-prompt-text"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('提示词表里没有这一行时给出明确提示', async () => {
      const { flow, wrapper } = mountOnArticleNode([])
      await flushPromises()
      await flushPromises()

      // 取不到模板时节点保留种子默认（抓取配置那套），页面必须明确说清模板缺失
      expect(flow.configs['article-1'].execCfg?.systemPrompt).toBe(DEFAULT_CAPTURE_CONFIG_SYSTEM_PROMPT)
      expect(wrapper.get('[data-testid="article-prompt-missing"]').text()).toContain('没有取到')
    })

    it('切换模型供应商后重新拉该供应商的模型候选，并写回节点', async () => {
      const { flow, wrapper } = mountOnArticleNode()
      await flushPromises()
      await flushPromises()

      // 挂载时已按默认供应商（DeepSeek）选中第一个模型
      expect(flow.configs['article-1'].execCfg?.modelProviderCode).toBe('DeepSeek')
      expect(flow.configs['article-1'].execCfg?.modelCode).toBe('deepseek-chat')

      // 走 el-select 的 change（jsdom 里点选项不稳，直接发组件事件＝同一条处理路径）
      const providerSelect = wrapper.findAllComponents({ name: 'ElSelect' })
        .find((c) => c.attributes('data-testid') === 'article-model-provider')
      expect(providerSelect, '找不到 article-model-provider 下拉').toBeTruthy()
      providerSelect!.vm.$emit('change', 'OpenAI')
      await flushPromises()
      await flushPromises()

      expect(flow.configs['article-1'].execCfg?.modelProviderCode).toBe('OpenAI')
      expect(flow.configs['article-1'].execCfg?.modelCode).toBe('gpt-4o-mini')
    })
  })

  // 0921 翻译助手改版：纯配置（引擎 + 源语言 + 目标语言）→「测试翻译」用内置样例调 /api/translate
  describe('翻译助手（翻译助手节点）', () => {
    /** 翻译走 /api/translate（不是 data-process）：请求体 {from,to,query,engine}，语言是百度码 */
    function mockTranslateApi(
      payload: unknown = { from: 'zh', to: 'en', translatedText: 'Hello, world! This is a sample text…' },
      status = 200,
    ) {
      const calls: { url: string; body: Record<string, unknown> }[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        if (url === '/api/translate') {
          calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
        }
        return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
      })
      return { calls }
    }

    /** 按 data-testid 取 el-select：不依赖 DOM 顺序 */
    function langSelect(wrapper: ReturnType<typeof mount>, testid: string) {
      const found = wrapper.findAllComponents({ name: 'ElSelect' })
        .find((c) => c.attributes('data-testid') === testid)
      if (!found) throw new Error(`找不到 el-select[data-testid=${testid}]`)
      return found
    }

    /**
     * ⚠️ 顺序要紧：mockAssets() 自己也会 spy fetch，必须让它先装完，再接管 fetch，最后挂载。
     * 所以 api 桩**不能在参数默认值里建**（默认值在函数体之前求值，会被 mockAssets 顶掉）。
     */
    function mountOnTranslateNode(apiFactory: () => ReturnType<typeof mockTranslateApi> = mockTranslateApi) {
      mockAssets()
      const translateApi = apiFactory()
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['translate-1'] = cloneConfig(NODE_CONFIGS['translate'])
      flow.select('translate-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      return { flow, wrapper, api: translateApi }
    }

    it('显示翻译引擎 / 源语言 / 目标语言与「测试翻译」，无输入框、无上传文件、无描述与切换已有配置', async () => {
      const { wrapper } = mountOnTranslateNode()
      await flushPromises()

      expect(wrapper.find('[data-testid="translate-field"]').exists()).toBe(true)
      expect(wrapper.find('.ni-section-title-row button').exists()).toBe(false)

      // 0921 追加口径：翻译节点的编排 Tab 不显示「抓取配置」标题行
      expect(wrapper.find('.ni-section-title-row').exists()).toBe(false)

      const engineSelect = langSelect(wrapper, 'translate-engine')
      const sourceSelect = langSelect(wrapper, 'translate-source')
      const targetSelect = langSelect(wrapper, 'translate-target')
      expect(engineSelect.findAllComponents({ name: 'ElOption' }).map((o) => o.props('value')))
        .toEqual(['谷歌翻译', '有道翻译', '百度翻译'])
      expect(engineSelect.props('modelValue')).toBe('百度翻译')
      expect(sourceSelect.findAllComponents({ name: 'ElOption' }).map((o) => o.props('value')))
        .toEqual(['自动检测', '中文简体', '中文繁体', '英语', '日语', '韩语', '法语', '德语', '西班牙语', '俄语'])
      expect(targetSelect.findAllComponents({ name: 'ElOption' }).map((o) => o.props('value')))
        .toEqual(['中文简体', '中文繁体', '英语', '日语', '韩语', '法语', '德语', '西班牙语', '俄语'])
      expect(sourceSelect.props('modelValue')).toBe('自动检测')
      expect(targetSelect.props('modelValue')).toBe('英语')

      // 改版后没有原文输入框 / 上传文件入口，测试按钮常驻可点
      expect(wrapper.find('[data-testid="translate-text"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="translate-pick-file"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="translate-test"]').text()).toBe('测试翻译')
      expect(wrapper.get('[data-testid="translate-test"]').attributes('disabled')).toBeUndefined()

      // 当日追加口径：描述输入框与「切换已有配置」对翻译节点隐藏
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('切换已有配置')
    })

    it('测试翻译：默认引擎百度，用中文样例发 {from:auto,to:en,engine:baidu}', async () => {
      const { wrapper, api } = mountOnTranslateNode()
      await flushPromises()

      await wrapper.get('[data-testid="translate-test"]').trigger('click')
      await flushPromises()
      await flushPromises()

      expect(api.calls).toHaveLength(1)
      expect(api.calls[0].body).toEqual({
        from: 'auto',
        to: 'en',
        engine: 'baidu',
        query: translateSampleOf('自动检测'),
      })
      expect(wrapper.get('[data-testid="translate-result-text"]').text()).toContain('Hello, world!')
      expect(wrapper.get('[data-testid="translate-result"]').text()).toContain('英语')
      expect(wrapper.get('[data-testid="translate-result"]').text()).toContain('百度翻译')
    })

    it('中文简体 → 英语 + 谷歌翻译：body 带 engine=google 与对应样例', async () => {
      const { wrapper, api } = mountOnTranslateNode()
      await flushPromises()

      langSelect(wrapper, 'translate-engine').vm.$emit('update:modelValue', '谷歌翻译')
      langSelect(wrapper, 'translate-engine').vm.$emit('change', '谷歌翻译')
      langSelect(wrapper, 'translate-source').vm.$emit('update:modelValue', '中文简体')
      langSelect(wrapper, 'translate-source').vm.$emit('change', '中文简体')
      langSelect(wrapper, 'translate-target').vm.$emit('update:modelValue', '英语')
      langSelect(wrapper, 'translate-target').vm.$emit('change', '英语')
      await flushPromises()

      await wrapper.get('[data-testid="translate-test"]').trigger('click')
      await flushPromises()
      await flushPromises()

      expect(api.calls[0].body).toEqual({
        from: 'zh',
        to: 'en',
        engine: 'google',
        query: translateSampleOf('中文简体'),
      })
    })

    it('源语言为自动检测时发 auto，并把上游识别语言换成界面语言名展示', async () => {
      const { wrapper } = mountOnTranslateNode(() => mockTranslateApi({
        from: 'zh', to: 'jp', translatedText: 'こんにちは、世界！',
      }))
      await flushPromises()

      langSelect(wrapper, 'translate-target').vm.$emit('update:modelValue', '日语')
      langSelect(wrapper, 'translate-target').vm.$emit('change', '日语')
      await flushPromises()
      await wrapper.get('[data-testid="translate-test"]').trigger('click')
      await flushPromises()
      await flushPromises()

      expect(wrapper.get('[data-testid="translate-result"]').text()).toContain('检测到源语言：中文简体')
    })

    it('接口报错时透出后端文案（凭据未配置 / 限流），不显示结果区', async () => {
      const { wrapper } = mountOnTranslateNode(
        () => mockTranslateApi({ error: '未配置 translate.google.api-key（Google Cloud Translation API 密钥）' }, 502),
      )
      await flushPromises()

      await wrapper.get('[data-testid="translate-test"]').trigger('click')
      await flushPromises()
      await flushPromises()

      expect(wrapper.get('[data-testid="translate-error"]').text()).toContain('translate.google.api-key')
      expect(wrapper.find('[data-testid="translate-result"]').exists()).toBe(false)
    })

    // ---- 0921：引擎与语言一起写进 updateConfig 的 code_rule ----
    // 改引擎/语言即写回节点结构化配置（置脏 → 底部「保存」可点），保存时随 buildConfigPayload 落 code_rule。

    /** 挂在一个已有 configId 的翻译助手节点上，准备走 updateConfig 保存路径 */
    function mountOnSavedTranslateNode(structuredConfig?: string) {
      mockAssets()
      vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [] as never })
      vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({})
      vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: '操作成功' })
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['translate-1'] = {
        ...cloneConfig(NODE_CONFIGS['translate']),
        configId: '1401013',
        configName: '翻译助手',
        ...(structuredConfig !== undefined ? { structuredConfig } : {}),
      }
      flow.select('translate-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      return { flow, wrapper }
    }

    it('改引擎与语言后点保存：updateConfig 的 core_param 是 {"from":"zh","to":"en","engine":"google"}（不再写 codeRule）', async () => {
      const { wrapper } = mountOnSavedTranslateNode()
      await flushPromises()

      langSelect(wrapper, 'translate-engine').vm.$emit('update:modelValue', '谷歌翻译')
      langSelect(wrapper, 'translate-engine').vm.$emit('change', '谷歌翻译')
      langSelect(wrapper, 'translate-source').vm.$emit('update:modelValue', '中文简体')
      langSelect(wrapper, 'translate-source').vm.$emit('change', '中文简体')
      langSelect(wrapper, 'translate-target').vm.$emit('update:modelValue', '英语')
      langSelect(wrapper, 'translate-target').vm.$emit('change', '英语')
      await flushPromises()

      // 改配置即置脏，保存按钮可点
      const saveBtn = wrapper.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
      expect(saveBtn.attributes('disabled')).toBeUndefined()
      await saveBtn.trigger('click')
      await flushPromises()
      await flushPromises()

      expect(configApi.updateConfig).toHaveBeenCalledTimes(1)
      const sent = vi.mocked(configApi.updateConfig).mock.calls[0][0]
      expect(sent).toMatchObject({
        configId: '1401013',
        coreParam: '{"from":"zh","to":"en","engine":"google"}',
      })
      // 2026-09-21：翻译助手的语言/引擎整体挪到 core_param，codeRule 不再写
      expect(sent.codeRule).toBeUndefined()
      wrapper.unmount()
    })

    it('已保存的配置回填下拉：{"from":"jp","to":"en","engine":"google"} → 日语 / 英语 / 谷歌翻译', async () => {
      const { wrapper } = mountOnSavedTranslateNode('{"from":"jp","to":"en","engine":"google"}')
      await flushPromises()

      expect(langSelect(wrapper, 'translate-source').props('modelValue')).toBe('日语')
      expect(langSelect(wrapper, 'translate-target').props('modelValue')).toBe('英语')
      expect(langSelect(wrapper, 'translate-engine').props('modelValue')).toBe('谷歌翻译')
      wrapper.unmount()
    })

    it('存量配置没有 engine 字段时回填默认百度翻译', async () => {
      const { wrapper } = mountOnSavedTranslateNode('{"from":"jp","to":"kor"}')
      await flushPromises()

      expect(langSelect(wrapper, 'translate-source').props('modelValue')).toBe('日语')
      expect(langSelect(wrapper, 'translate-target').props('modelValue')).toBe('韩语')
      expect(langSelect(wrapper, 'translate-engine').props('modelValue')).toBe('百度翻译')
      wrapper.unmount()
    })

    it('engine 码不认识时同样回填百度翻译', async () => {
      const { wrapper } = mountOnSavedTranslateNode('{"from":"zh","to":"en","engine":"bing"}')
      await flushPromises()

      expect(langSelect(wrapper, 'translate-engine').props('modelValue')).toBe('百度翻译')
      wrapper.unmount()
    })

    it('仅改引擎也会把节点置脏并写回 engine', async () => {
      const { flow, wrapper } = mountOnSavedTranslateNode()
      await flushPromises()

      expect(flow.dirtyConfigNodes).not.toContain('translate-1')
      langSelect(wrapper, 'translate-engine').vm.$emit('update:modelValue', '有道翻译')
      langSelect(wrapper, 'translate-engine').vm.$emit('change', '有道翻译')
      await flushPromises()

      expect(flow.configs['translate-1'].structuredConfig).toBe('{"from":"auto","to":"en","engine":"youdao"}')
      expect(flow.dirtyConfigNodes).toContain('translate-1')
      expect(wrapper.find('.rc-insp-foot .foot-note').text()).toContain('未保存修改')
      wrapper.unmount()
    })
  })

  // 0921 改版：文章打标签的编排配置只保留模型供应商、模型和系统提示词查看入口。
  describe('文章打标签（文章打标签节点）', () => {
    const TAG_TEMPLATE = {
      promptId: 5,
      nodeType: 'article_maketag',
      nodeTypeName: '文章打标签',
      category: 'rule',
      systemPrompt: '你是一名专业的舆情监控文本标注引擎，请按给定标签体系输出 JSON。',
      version: 1,
      isActive: 1,
      isDefault: 0,
    }

    function mockTagApis(promptRows: unknown[] = [TAG_TEMPLATE]) {
      const calls: string[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
        calls.push(url)
        const json = (data: unknown) => new Response(JSON.stringify(data), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
        if (url === '/api/model/providers') return json({ data: MODEL_PROVIDERS })
        if (url.startsWith('/api/model/default-models')) {
          const code = new URL(url, 'http://localhost').searchParams.get('providerCode') || ''
          return json({ data: MODEL_OPTIONS[code] ?? [] })
        }
        if (url.startsWith('/api/prompt/list')) return json(promptRows)
        return json([])
      })
      return { promptCalls: () => calls.filter((u) => u.startsWith('/api/prompt/list')) }
    }

    /** ⚠️ 先 mockAssets（它自己会 spy fetch），再接管 fetch，最后挂载 */
    function mountOnTagNode(promptRows: unknown[] = [TAG_TEMPLATE]) {
      mockAssets()
      const api = mockTagApis(promptRows)
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['tag-1'] = cloneConfig(NODE_CONFIGS['article-tag'])
      flow.select('tag-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      return { flow, wrapper, ...api }
    }

    it('只保留模型供应商、模型和查看系统提示词，其他元素都不出现', async () => {
      const { wrapper } = mountOnTagNode()
      await flushPromises()

      expect(wrapper.find('[data-testid="article-tag-field"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="tag-model-provider"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="tag-model"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="tag-prompt-toggle"]').exists()).toBe(true)
      expect(wrapper.find('.ni-section-title-row').exists()).toBe(false)
      expect(wrapper.find('[data-testid="tag-file-input"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="tag-pick-file"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="tag-text"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="tag-generate"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="tag-result"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="tag-raw-result"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('来自提示词表')
    })

    it('按 category=rule + node_type_name=文章打标签 取提示词并写到节点上', async () => {
      const { flow, wrapper, promptCalls } = mountOnTagNode()
      await flushPromises()
      await flushPromises()

      expect(promptCalls().length).toBeGreaterThan(0)
      promptCalls().forEach((url) => {
        expect(decodeURIComponent(url)).toContain('node_type_name=文章打标签')
        expect(url).toContain('category=rule')
      })
      expect(flow.configs['tag-1'].execCfg?.systemPrompt).toBe(TAG_TEMPLATE.systemPrompt)
      await wrapper.get('[data-testid="tag-prompt-toggle"]').trigger('click')
      await flushPromises()
      const dialog = wrapper.findComponent(RuleWorkbenchDialog)
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('promptPreviewOnly')).toBe(true)
      expect(dialog.find('[data-testid="prompt-preview-dialog"]').exists()).toBe(true)
      expect((dialog.get('[data-testid="prompt-preview-textarea"]').element as HTMLTextAreaElement).value).toContain('舆情监控文本标注引擎')
      expect(wrapper.find('[data-testid="tag-prompt-text"]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('提示词表里的系统提示词可展开查看', async () => {
      const { wrapper } = mountOnTagNode()
      await flushPromises()
      await flushPromises()

      await wrapper.get('[data-testid="tag-prompt-toggle"]').trigger('click')
      await flushPromises()
      const dialog = wrapper.findComponent(RuleWorkbenchDialog)
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('promptPreviewOnly')).toBe(true)
      expect(dialog.find('[data-testid="prompt-preview-dialog"]').exists()).toBe(true)
      expect((dialog.get('[data-testid="prompt-preview-textarea"]').element as HTMLTextAreaElement).value).toContain('舆情监控文本标注引擎')
      wrapper.unmount()
    })

    it('系统提示词预览支持编辑，并按当前节点 configId 保存到配置 prompt', async () => {
      const { flow, wrapper } = mountOnTagNode()
      flow.configs['tag-1'].configId = '140016929'
      const updateSpy = vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: '提示词已保存' })
      await flushPromises()
      await flushPromises()

      await wrapper.get('[data-testid="tag-prompt-toggle"]').trigger('click')
      await flushPromises()
      const dialog = wrapper.findComponent(RuleWorkbenchDialog)
      const textarea = dialog.get('[data-testid="prompt-preview-textarea"]')
      await textarea.setValue('用户二次编辑后的系统提示词')
      await dialog.get('[data-testid="prompt-preview-save"]').trigger('click')
      await flushPromises()

      expect(updateSpy).toHaveBeenCalledWith({
        configId: '140016929',
        prompt: '用户二次编辑后的系统提示词',
      })
      expect(flow.configs['tag-1'].execCfg?.systemPrompt).toBe('用户二次编辑后的系统提示词')
      wrapper.unmount()
    })

    it('提示词表里没有这一行时不显示其他配置元素', async () => {
      const { flow, wrapper } = mountOnTagNode([])
      await flushPromises()
      await flushPromises()

      expect(flow.configs['tag-1'].execCfg?.systemPrompt).toBe(DEFAULT_CAPTURE_CONFIG_SYSTEM_PROMPT)
      expect(wrapper.find('[data-testid="tag-prompt-missing"]').exists()).toBe(false)
    })

    // ---- 2026-09-20：编排配置保存时把模型供应商与模型写进 updateConfig 的 core_param ----

    /** 挂在一个已有 configId 的打标签节点上，准备走 updateConfig 保存路径 */
    function mountOnSavedTagNode(coreParam?: string) {
      mockAssets()
      const api = mockTagApis([TAG_TEMPLATE])
      vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [] as never })
      vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({})
      vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: '操作成功' })
      setActivePinia(createPinia())
      const flow = useFlowStore()
      flow.configs['tag-1'] = {
        ...cloneConfig(NODE_CONFIGS['article-tag']),
        configId: '1401014',
        configName: '文章打标签',
        ...(coreParam !== undefined ? { coreParam } : {}),
      }
      flow.select('tag-1')
      flow.setActiveTab('orchestration')
      const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
      return { flow, wrapper, ...api }
    }

    /** 按 data-testid 取 el-select（模型行里的下拉） */
    function modelSelect(wrapper: ReturnType<typeof mount>, testid: string) {
      const found = wrapper.findAllComponents({ name: 'ElSelect' })
        .find((c) => c.attributes('data-testid') === testid)
      if (!found) throw new Error(`找不到 el-select[data-testid=${testid}]`)
      return found
    }

    it('改模型后点保存：updateConfig 的 coreParam 是 {"providerCode":"OpenAI","model":"gpt-4o-mini"}', async () => {
      const { wrapper } = mountOnSavedTagNode()
      await flushPromises()
      await flushPromises()

      modelSelect(wrapper, 'tag-model-provider').vm.$emit('change', 'OpenAI')
      await flushPromises() // 换供应商会重拉该家的模型列表
      await flushPromises()
      modelSelect(wrapper, 'tag-model').vm.$emit('change', 'gpt-4o-mini')
      await flushPromises()

      const saveBtn = wrapper.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
      await saveBtn.trigger('click')
      await flushPromises()
      await flushPromises()

      expect(configApi.updateConfig).toHaveBeenCalledTimes(1)
      expect(vi.mocked(configApi.updateConfig).mock.calls[0][0]).toMatchObject({
        configId: '1401014',
        coreParam: '{"providerCode":"OpenAI","model":"gpt-4o-mini"}',
      })
      wrapper.unmount()
    })

    it('已保存的模型回填下拉：coreParam 是 {"providerCode":"OpenAI","model":"gpt-4o-mini"}', async () => {
      const { wrapper } = mountOnSavedTagNode('{"providerCode":"OpenAI","model":"gpt-4o-mini"}')
      await flushPromises()
      await flushPromises()

      // 回填后不自动选第一家（DeepSeek/deepseek-chat），而是还原保存的 OpenAI/gpt-4o-mini
      expect(modelSelect(wrapper, 'tag-model-provider').props('modelValue')).toBe('OpenAI')
      expect(modelSelect(wrapper, 'tag-model').props('modelValue')).toBe('gpt-4o-mini')
      wrapper.unmount()
    })

    it('回填后直接保存：coreParam 写回已保存的模型对，而不是默认第一家（DeepSeek/deepseek-chat）', async () => {
      const { wrapper } = mountOnSavedTagNode('{"providerCode":"DeepSeek","model":"deepseek-reasoner"}')
      await flushPromises()
      await flushPromises()

      expect(modelSelect(wrapper, 'tag-model').props('modelValue')).toBe('deepseek-reasoner')

      const saveBtn = wrapper.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
      await saveBtn.trigger('click')
      await flushPromises()
      await flushPromises()

      expect(vi.mocked(configApi.updateConfig).mock.calls[0][0]).toMatchObject({
        coreParam: '{"providerCode":"DeepSeek","model":"deepseek-reasoner"}',
      })
      wrapper.unmount()
    })
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

  // 0917 产品口径：数据监控节点不要「上传 Excel」样本文件入口（画布 / 监控视图两处一致），
  // 规则处理节点保留——那里的 Excel 是给"按样本生成规则脚本"用的。
  it('数据监控节点动作区只有生成脚本与测试脚本，没有上传 Excel', async () => {
    mockAssets()
    const { wrapper } = mountOnMonitorNode()
    await flushPromises()

    const actionRow = wrapper.find('[data-testid="rule-generation-actions"]')
    expect(actionRow.exists()).toBe(true)
    expect(actionRow.find('[data-testid="main-upload-excel"]').exists()).toBe(false)
    expect(actionRow.find('[data-testid="main-excel-file-input"]').exists()).toBe(false)
    expect(actionRow.find('[data-testid="main-generate-script"]').exists()).toBe(true)
    expect(actionRow.find('[data-testid="main-test-script"]').exists()).toBe(true)
    expect(actionRow.findAll('button')).toHaveLength(2)
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
      // 0929：生成完成后思考面板已按「完成后隐藏思考与脚本预览」口径收起（见同口径用例），
      // 所以把 promise 挂起在流式进行中做断言——测的就是「流式追加 + 自动滚动」本身。
      let finishGenerate!: (value: { script: string; scriptPath: string }) => void
      vi.spyOn(ruleApi, 'dataProcessGenerate').mockImplementation(async (_payload, options) => {
        options?.onThinking?.('第一段思考\n')
        await flushPromises()
        options?.onThinking?.('第二段思考\n')
        await new Promise<{ script: string; scriptPath: string }>((resolve) => {
          finishGenerate = resolve
        })
        return { script: 'def main(sku_id):\n    return {"sku_name": sku_id}\n', scriptPath: '/rules/generated/orch-173.py' }
      })

      await wrapper.find('[data-testid="main-generate-script"]').trigger('click')
      await flushPromises()

      // 流式进行中：思考面板可见、已累积完整并滚动到底
      expect(wrapper.find('[data-testid="main-stream-thinking"]').text()).toContain('第二段思考')
      expect(scrollSpy).toHaveBeenCalledWith(520)

      // 生成完成后思考面板随口径收起
      finishGenerate({ script: 'def main(sku_id):\n    return {"sku_name": sku_id}\n', scriptPath: '/rules/generated/orch-173.py' })
      await flushPromises()
      expect(wrapper.find('[data-testid="main-stream-thinking"]').exists()).toBe(false)
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
    expect(conf.minSize).toBe('30')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
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
    // 2026-09-16 口径：update 与 insert 同一份 payload，state/isDelete/createDt/ver 都带上，
    // schedule 取节点配置 Tab 的 cron、tableName 取表配置 Tab 的输入表。
    const updatePayload = (ckSourceApi.update as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload).toMatchObject({
      sourceId: 430016501,
      name: '库存监控',
      schedule: '0 0 8 * * ?',
      tableName: 'sense_data.TB_JD_SKU_BASE',
      state: 'E',
      isDelete: 0,
      ver: 12,
    })
    // ISO-8601（后端 LocalDateTime 只认这个；带空格的旧写法会被 400 拒掉）
    expect(String(updatePayload.createDt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
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
    expect(conf.minSize).toBe('30')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
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

  // 0929 收编：早先的「全屏查看」按钮和结果区路径入口都并进了工作区/下载（见 1769、2348），
  // 这里锁定当前口径：完成后主面板不铺脚本预览，只留文件名链接；正文经「脚本编辑」工作区查看。
  it('已有脚本：完成后结果区只留文件名链接（预览隐藏），正文在工作区可见', async () => {
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { script: 'def main(sku_id):\n    return {}', scriptPath: '/code01/202609/1789022685732.py' })
    await flushPromises()

    const resultHead = wrapper.find('.rc-main-result-head')
    expect(resultHead.exists()).toBe(true)
    expect(resultHead.text()).toContain('1789022685732.py')
    // 完成后脚本预览隐藏（与「完成后隐藏思考与脚本预览」用例同口径）
    expect(wrapper.find('.rc-main-result-code').exists()).toBe(false)

    await openWorkbench(wrapper)
    await flushPromises()
    const workbench = wrapper.findComponent(RuleWorkbenchDialog)
    expect((workbench.find('textarea.wb-code').element as HTMLTextAreaElement).value).toContain('def main(sku_id)')
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
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name 的描述正文' })
    await flushPromises()

    await openWorkbench(wrapper)

    // 默认展示描述（只读），系统提示词编辑区隐藏
    const describeTextarea = wrapper.find('textarea.wb-describe')
    expect(describeTextarea.exists()).toBe(true)
    expect((describeTextarea.element as HTMLTextAreaElement).value).toContain('按 sku_id 生成 sku_name')
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

  // 0921：这条同时是「手改不被自动拼接覆盖」的回归用例。
  // 自动拼接 watcher 的依赖里有异步加载的字段选项，它们落地时 watcher 会再跑一轮；
  // 早先它会把刚保存的手改值静默换回渲染模板（seq 守卫只防旧请求晚到，不防用户已手改）。
  // 现在由 promptTouched 挡住回写，所以保存后 store 里必须仍是手改值。
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

    // 改字段会让自动拼接 watcher 重算模板（见下面「表配置字段变化后，规则处理系统提示词
    // 按最新入参和出参重新拼接」）。手改过的提示词必须扛住这一轮重拼，不能被换回模板。
    flow.patchRuleConfig('rule-1', { inputFields: ['sku_name'] })
    await flushPromises()
    expect(flow.configs['rule-1'].ruleCfg?.systemPrompt).toBe('新的系统提示词')
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
    const { flow, wrapper } = mountWithExistingRule()
    flow.patchRuleConfig('rule-1', { describe: '按 sku_id 生成 sku_name' })
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

    await wrapper.find('textarea[placeholder*="自然语言描述"]').setValue('按 sku_id 生成 sku_name')
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

    await wrapper.find('textarea[placeholder*="自然语言描述"]').setValue('按 sku_id 生成 sku_name')
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

  // 2026-09-16 修：source_id 取**画布当前源**（左侧源列表里选中的那个），不是节点自己的
  // 「适用源」stepSourceId——后者按设计默认 `-1`（该配置下所有源共用），拼进提示词就是
  // `source_id=-1`，监控脚本拿它去查数据必然落空。
  it('数据监控节点工作区把 source_id 拼成画布当前源，而不是步骤的适用源 -1', async () => {
    mockAssets('通用新闻表', '900', 'sense_data.TB_CNEWS')
    const { flow, wrapper } = mountOnMonitorNode()
    flow.setInputTable('monitor-1', '900')
    flow.setStepSourceId('monitor-1', '-1')   // 规则/数据监控节点的默认「适用源」，不该出现在提示词里
    flow.patchSource({ sourceId: '430016398', name: 'test1' })
    flow.patchSchedule('monitor-1', { cron: '0 0 12 * * *' })
    await flushPromises()

    await openWorkbench(wrapper)

    // 数据监控节点工作区默认展示描述（只读），需点「系统提示词」按钮切换到提示词编辑区
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    await toggleBtn.trigger('click')
    await flushPromises()

    const promptTextarea = wrapper.find('textarea.wb-textarea:not(.wb-code):not(.wb-describe)')
    const prompt = (promptTextarea.element as HTMLTextAreaElement).value
    expect(prompt).toContain('source_id=430016398')
    expect(prompt).not.toContain('source_id=-1')
    expect(prompt).toContain('source_cron=0 0 12 * * *')
    expect(prompt).toContain('source_table=通用新闻表:sense_data.TB_CNEWS')
  })

  it('画布没绑源时 source_id 留空，不会退回写成 -1', async () => {
    mockAssets('通用新闻表', '900', 'sense_data.TB_CNEWS')
    const { flow, wrapper } = mountOnMonitorNode()
    flow.setInputTable('monitor-1', '900')
    flow.setStepSourceId('monitor-1', '-1')
    await flushPromises()

    await openWorkbench(wrapper)
    const toggleBtn = wrapper.findAll('button').find((b) => b.text() === '系统提示词')!
    await toggleBtn.trigger('click')
    await flushPromises()

    const promptTextarea = wrapper.find('textarea.wb-textarea:not(.wb-code):not(.wb-describe)')
    const prompt = (promptTextarea.element as HTMLTextAreaElement).value
    expect(prompt).toContain('source_id=;')
    expect(prompt).not.toContain('source_id=-1')
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

  // 0929：原「进入查看态（orchestrationDetail 回灌）」用例随接口迁移删除——
// 查看态回灌已统一走 configDetailRaw，由下面两条用例覆盖（含仅有 scriptPath 时自动下载正文）。
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
    // 0929：完成后主面板不再铺脚本预览（见「完成后隐藏思考与脚本预览」口径），
    // 只留文件名链接——这里断言链接展示的路径（与上面 configDetailRaw 回填用例同款断言）。
    expect(wrapper.find('.rc-main-result-head').text()).toContain('/code01/202609/1788761803128.py')
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

  it('数据监控节点在生成结果下方展示告警配置，规则处理节点不展示', async () => {
    mockAssets()
    const { wrapper: monitorWrapper } = mountOnMonitorNode()
    await flushPromises()
    expect(monitorWrapper.find('[data-testid="monitor-alert-config"]').exists()).toBe(true)
    expect(monitorWrapper.find('[data-testid="alert-policy-row"]').text()).toContain('数据延迟超过阈值')

    mockAssets()
    const { wrapper: ruleWrapper } = mountOnRuleNode()
    await flushPromises()
    expect(ruleWrapper.find('[data-testid="monitor-alert-config"]').exists()).toBe(false)
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

  it('采集节点的 Python 生成入口使用当前源列表 URL 和任务队列', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    useSourceStore().sourceCfg = { sourceId: 's-1', name: '测试源', url: 'https://www.realcan.cn/newscenter', configId: 'c-1', mainTable: '', owner: '', state: 'C' }
    flow.configs['web-1'].configUrl = 'https://wrong.example.com/config'
    flow.configs['web-1'].taskCfg = { queue: 'news_list', urlRule: '' }
    await flushPromises()
    expect(wrapper.find('[data-testid="main-generate-script"]').text()).toBe('生成配置')
    const button = wrapper.find('[data-testid="open-site-script-generator"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    const dialog = wrapper.findComponent(SiteScriptGeneratorDialog)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('initialUrl')).toBe('https://www.realcan.cn/newscenter')
    expect(dialog.props('queueName')).toBe('news_list')
  })

  it('任务队列未填写时沿用任务配置显示的默认队列', async () => {
    const { flow, wrapper } = mountOnCollectorNode()
    useSourceStore().sourceCfg = { sourceId: 's-1', name: '测试源', url: 'https://www.realcan.cn/list', configId: 'c-1', mainTable: '', owner: '', state: 'C' }
    flow.configs['web-1'].taskCfg = { queue: '', urlRule: '' }
    await flushPromises()
    await wrapper.get('[data-testid="open-site-script-generator"]').trigger('click')
    expect(wrapper.findComponent(SiteScriptGeneratorDialog).props('queueName')).toBe('s-1_main')
  })

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
    // 0929：保存按钮收在脚本工作区（与「保存配置」用例同入口），先打开工作区再点保存
    await openWorkbench(wrapper)
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
    await openWorkbench(wrapper)
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

// 1005 方案 §5.4：PDF 抓取节点的样本槽位收 PDF，「解析内容」只展示、不回写；
// 与「生成脚本」的附件口径是**分开**（§10.1）——PDF 节点的生成脚本请求不许带附件。
describe('RuleOrchestrationTab · PDF 抓取样本与解析内容（1005）', () => {
  function mountOnPdfNode() {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['pdf-1'] = cloneConfig(NODE_CONFIGS['pdf-collect'])
    flow.select('pdf-1')
    flow.setActiveTab('orchestration')
    flow.patchExecConfig('pdf-1', {
      describe: '从 PDF 抽取合同金额与签署日期',
      dataSource: 'dp-wwdata',
      inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      outputTable: 'sense_data.TB_PDF_RESULT',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
      systemPrompt: '按出参抽取 PDF 正文',
      script: '', scriptPath: '',
    })
    flow.configs['pdf-1'].configId = '184'
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    return { flow, wrapper }
  }

  const pdfFile = () => new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' })

  // 真规则节点：与上面 PDF 同一套字段/模型，只是存储位回到 ruleCfg
  function mountOnRuleNodeWithModel() {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.patchRuleConfig('rule-1', {
      mode: 'ref', name: '已有规则',
      describe: '按 sku_id 生成 sku_name',
      dataSource: 'dp-wwdata', inputTable: 'sense_data.TB_JD_SKU_BASE', inputTableId: '2102154',
      outputTable: 'sense_data.TB_JD_SKU_RESULT',
      inputFields: ['sku_id'], outputFields: ['sku_name'],
      modelProviderCode: 'DeepSeek', modelCode: 'deepseek-chat',
    })
    flow.configs['rule-1'].configId = '184'
    return { flow, wrapper }
  }

  it('描述标签是「PDF 抽取描述」，动作区给上传 PDF + 解析内容，不再出现上传 Excel', async () => {
    const { wrapper } = mountOnPdfNode()
    await flushPromises()

    expect(wrapper.findComponent(RuleWorkbenchDialog).props('describeLabel')).toBe('PDF 抽取描述')
    const actionRow = wrapper.find('[data-testid="rule-generation-actions"]')
    expect(actionRow.exists()).toBe(true)
    expect(actionRow.find('[data-testid="main-upload-excel"]').exists()).toBe(false)
    expect(actionRow.find('[data-testid="main-excel-file-input"]').exists()).toBe(false)
    expect(actionRow.find('[data-testid="main-upload-pdf"]').exists()).toBe(true)
    expect(actionRow.find('[data-testid="main-pdf-file-input"]').attributes('accept')).toBe('.pdf')
    expect(actionRow.find('[data-testid="main-extract-document"]').exists()).toBe(true)
    // 解析内容排在生成脚本之前（方案 §3.1 的动作区顺序）
    const labels = actionRow.findAll('button').map((b) => b.text())
    expect(labels).toEqual(['上传 PDF', '解析内容', '生成脚本', '测试脚本'])
    wrapper.unmount()
  })

  it('未选 PDF 时「解析内容」禁用；选好后调用 documentExtract 带上文件、提示词与出参', async () => {
    const { wrapper } = mountOnPdfNode()
    await flushPromises()

    const extractBtn = wrapper.find('[data-testid="main-extract-document"]')
    expect(extractBtn.attributes('disabled')).toBeDefined()
    vi.spyOn(ruleApi, 'documentExtract').mockResolvedValue({ content: '金额：12 万元', charCount: 7, truncated: false, chunkCount: 1, sourceCharCount: 7, mergeRounds: 0 })
    await extractBtn.trigger('click')
    expect(ruleApi.documentExtract).not.toHaveBeenCalled()

    await selectFile(wrapper.find('[data-testid="main-pdf-file-input"]'), pdfFile())
    expect(wrapper.find('.rc-file-name').text()).toBe('report.pdf')
    await wrapper.find('[data-testid="main-extract-document"]').trigger('click')
    await flushPromises()

    expect(ruleApi.documentExtract).toHaveBeenCalledTimes(1)
    const [payload, options] = (ruleApi.documentExtract as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(payload).toEqual(expect.objectContaining({
      description: '从 PDF 抽取合同金额与签署日期',
      systemPrompt: '按出参抽取 PDF 正文',
      configId: 184,
      providerCode: 'DeepSeek',
      model: 'deepseek-chat',
      outputFields: '商品名称:sku_name',
      outputFormat: 'text',
    }))
    expect((options as { file: File }).file.name).toBe('report.pdf')
    expect(wrapper.find('[data-testid="main-extract-result"]').text()).toContain('金额：12 万元')
    wrapper.unmount()
  })

  it('解析结果流式回填并给出复制；全程不回写 execCfg 的脚本与路径', async () => {
    const { flow, wrapper } = mountOnPdfNode()
    await flushPromises()
    vi.spyOn(ruleApi, 'documentExtract').mockImplementation(async (_payload, options) => {
      options?.onThinking?.('先读文档结构\n')
      options?.onContent?.('甲方：甲\n')
      options?.onContent?.('金额：12 万元\n')
      options?.onDone?.({ message: '解析完成', charCount: 12, truncated: true, chunkCount: 1, sourceCharCount: 12, mergeRounds: 0 })
      return { content: '甲方：甲\n金额：12 万元\n', charCount: 12, truncated: true, chunkCount: 1, sourceCharCount: 12, mergeRounds: 0 }
    })

    await selectFile(wrapper.find('[data-testid="main-pdf-file-input"]'), pdfFile())
    await wrapper.find('[data-testid="main-extract-document"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="main-extract-result"]').text()).toContain('已截断')
    expect(wrapper.find('.rc-main-result-code.rc-extract-body').text()).toContain('金额：12 万元')
    expect(flow.configs['pdf-1'].execCfg?.script).toBe('')
    expect(flow.configs['pdf-1'].execCfg?.scriptPath).toBe('')
    wrapper.unmount()
  })

  it('分块抽取：过程中显示块进度，合并开始时重铺正文，结束后说明分了几段', async () => {
    const { wrapper } = mountOnPdfNode()
    await flushPromises()
    let continueRun!: () => void
    const running = new Promise<void>((resolve) => { continueRun = resolve })
    vi.spyOn(ruleApi, 'documentExtract').mockImplementation(async (_payload, options) => {
      options?.onChunk?.({ phase: 'map', index: 1, total: 2, pages: '第 1-2 页', charCount: 12000, last: false })
      options?.onContent?.('第一段结果\n')
      options?.onChunk?.({ phase: 'map', index: 2, total: 2, pages: '第 3 页', charCount: 640, last: false })
      options?.onContent?.('第二段结果')
      await running
      options?.onChunk?.({ phase: 'merge', index: 1, total: 1, charCount: 1300, last: true })
      options?.onContent?.('合并后的完整结果')
      options?.onDone?.({ message: '解析完成', charCount: 9, truncated: false, chunkCount: 2, sourceCharCount: 23456, mergeRounds: 1 })
      return { content: '合并后的完整结果', charCount: 9, truncated: false, chunkCount: 2, sourceCharCount: 23456, mergeRounds: 1 }
    })

    await selectFile(wrapper.find('[data-testid="main-pdf-file-input"]'), pdfFile())
    await wrapper.find('[data-testid="main-extract-document"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="main-extract-result"]').text()).toContain('正在抽取第 2/2 块 · 第 3 页')
    expect(wrapper.find('.rc-main-result-code.rc-extract-body').text()).toContain('第二段结果')

    continueRun()
    await flushPromises()

    const result = wrapper.find('[data-testid="main-extract-result"]')
    expect(result.text()).toContain('合并后的完整结果')
    expect(result.text()).not.toContain('第一段结果')
    expect(result.text()).toContain('分块抽取 2 段 · 原文 23456 字')
    wrapper.unmount()
  })

  it('解析中再点一次是取消：中断请求且不改动节点配置', async () => {
    const { wrapper } = mountOnPdfNode()
    await flushPromises()
    let signal: AbortSignal | undefined
    vi.spyOn(ruleApi, 'documentExtract').mockImplementation(async (_payload, options) => {
      signal = options?.signal
      options?.onContent?.('甲方：甲\n')
      await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('请求已取消')), { once: true })
      })
      throw new Error('请求未被取消')
    })

    await selectFile(wrapper.find('[data-testid="main-pdf-file-input"]'), pdfFile())
    await wrapper.find('[data-testid="main-extract-document"]').trigger('click')
    await flushPromises()

    const running = wrapper.find('[data-testid="main-extract-document"]')
    expect(running.attributes('aria-label')).toBe('取消解析')
    expect(running.find('[data-testid="stop-extract-icon"]').exists()).toBe(true)
    await running.trigger('click')
    await flushPromises()

    expect(signal?.aborted).toBe(true)
    wrapper.unmount()
  })

  it('分开口径：PDF 节点已选样本时点生成脚本不带附件', async () => {
    const { wrapper } = mountOnPdfNode()
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({ script: 'def main():\n    pass\n', scriptPath: '' })

    await selectFile(wrapper.find('[data-testid="main-pdf-file-input"]'), pdfFile())
    await wrapper.find('[data-testid="main-generate-script"]').trigger('click')
    await flushPromises()

    expect(ruleApi.dataProcessGenerate).toHaveBeenCalledTimes(1)
    const options = (ruleApi.dataProcessGenerate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]
    expect((options as { file?: File }).file).toBeUndefined()
    wrapper.unmount()
  })

  it('分开口径：真规则节点选 .xlsx 后点生成脚本仍然带 file（这条不许漂）', async () => {
    const { wrapper } = mountOnRuleNodeWithModel()
    await flushPromises()
    vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({ script: 'def main():\n    pass\n', scriptPath: '' })

    const file = new File(['x'], 'sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await selectFile(wrapper.find('[data-testid="main-excel-file-input"]'), file)
    await wrapper.find('[data-testid="main-generate-script"]').trigger('click')
    await flushPromises()

    const options = (ruleApi.dataProcessGenerate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]
    expect((options as { file?: File }).file?.name).toBe('sample.xlsx')
    wrapper.unmount()
  })

  it('PDF 节点选到 Excel 文件会被本地拦下并清空槽位', async () => {
    const { wrapper } = mountOnPdfNode()
    await flushPromises()

    await selectFile(wrapper.find('[data-testid="main-pdf-file-input"]'), new File(['x'], 'sheet.xlsx'))
    expect(wrapper.find('.rc-file-error').text()).toBe('仅支持 .pdf 文件')
    expect(wrapper.find('.rc-file-selected').exists()).toBe(false)
    expect(wrapper.find('[data-testid="main-extract-document"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('切节点清空样本文件与解析结果，并中断进行中的解析', async () => {
    const { flow, wrapper } = mountOnPdfNode()
    await flushPromises()
    let signal: AbortSignal | undefined
    vi.spyOn(ruleApi, 'documentExtract').mockImplementation(async (_payload, options) => {
      signal = options?.signal
      options?.onContent?.('甲方：甲\n')
      await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('请求已取消')), { once: true })
      })
      throw new Error('请求未被取消')
    })

    await selectFile(wrapper.find('[data-testid="main-pdf-file-input"]'), pdfFile())
    await wrapper.find('[data-testid="main-extract-document"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="main-extract-result"]').exists()).toBe(true)

    flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
    flow.select('rule-1')
    await flushPromises()

    expect(signal?.aborted).toBe(true)
    expect(wrapper.find('[data-testid="main-extract-result"]').exists()).toBe(false)
    expect(wrapper.find('.rc-file-selected').exists()).toBe(false)
    wrapper.unmount()
  })
})
