// @vitest-environment jsdom
// 监控编辑弹窗（1111 规格 fe-editor 验收）。
//
// 与旧测试的差异（旧断言锁的缺陷，按本轮产品语义改写）：
// 1. 旧编辑器「无源时也能编辑草稿节点、保存按钮只按告警 dirty 判断」→ 新语义必须先有源/名称/方法；
// 2. 旧编辑器按 sourceId 整包写 ck_source（保存只返回影响行数）→ 新语义按记录身份 saveMonitor + 回读；
// 3. 旧编辑器生成脚本后只标「脚本已生成，未保存」且仍走旧保存链路 → 新语义生成只更新页面候选，
//    保存回执必须区分「已生效 vN」/「草稿未生效」/「描述改了但没重新生成」；
// 4. 旧断言不覆盖「打开已有记录能看到生效脚本正文」（T01），这里补上。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { EntryType } from '@/api/types/collect'
import type { EntryTypeGroup } from '@/api/types/data'
import type { SourceCheck } from '@/api/types/monitor'
import type { MonitorCheckConf, MonitorRecordView } from '@/api/types/monitorCenter'
import type { Source, Step } from '@/api/types/source'

const mocks = vi.hoisted(() => ({
  saveMonitor: vi.fn(),
  listMonitorsOfSource: vi.fn(),
  checkOneManual: vi.fn(),
  fetchModelProviders: vi.fn(),
  fetchDefaultModels: vi.fn(),
  resolveGenerationContext: vi.fn(),
}))

vi.mock('@/api/monitorCenter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/monitorCenter')>()
  return {
    ...actual,
    saveMonitor: mocks.saveMonitor,
    listMonitorsOfSource: mocks.listMonitorsOfSource,
  }
})

vi.mock('@/api/monitor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/monitor')>()
  return { ...actual, checkOneManual: mocks.checkOneManual }
})

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    fetchModelProviders: mocks.fetchModelProviders,
    fetchDefaultModels: mocks.fetchDefaultModels,
  }
})

// 生成上下文解析依赖画布种子映射，属于 generation.ts 自己的单元；这里只验编辑器把上下文交给它
vi.mock('./monitor-editor/generation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./monitor-editor/generation')>()
  return { ...actual, resolveMonitorGenerationContext: mocks.resolveGenerationContext }
})

import MonitorConfigEditor from './MonitorConfigEditor.vue'
import { dataApi, entryApi, ruleApi, sourceApi } from '@/api'

const SOURCE = {
  sourceId: '1400995',
  name: '沐言社媒',
  url: 'https://example.com',
  configId: 'cfg-1',
  mainTable: 'sense_data.tb_my',
  owner: 'admin',
  state: 'C',
} as unknown as Source

const TABLE: EntryType = {
  tableId: 't1',
  tableName: 'sense_data.TB_RAW',
  name: '原始数据',
  fields: [
    { prop: 'title', desc: '标题', type: 'string', required: false },
    { prop: 'publish_time', desc: '发布时间', type: 'date', required: false },
  ],
}

const GROUP: EntryTypeGroup = { main: TABLE.tableId, list1: [TABLE], list2: [], list3: [] }

const GENERATION_CONTEXT = {
  configId: 701,
  sourceTable: 'sense_data.TB_RAW',
  targetTable: 'sense_data.TB_RAW',
  inputFields: [],
  outputFields: [],
  inputFieldOptions: [
    { itemCode: 'title', itemName: '标题' },
    { itemCode: 'publish_time', itemName: '发布时间' },
  ],
  outputFieldOptions: [],
}

function steps(): Step[] {
  return [
    { stepId: 'st1', sourceId: SOURCE.sourceId, name: '抓取列表页', outputTable: 'sense_data.TB_RAW', enabled: true },
    { stepId: 'st2', sourceId: SOURCE.sourceId, name: '数据监控', nodeType: 'monitor', inputTable: 'sense_data.TB_RAW', enabled: true },
  ]
}

function sourceRaw(id: string, jobId: string): SourceCheck {
  return {
    id,
    isDelete: 0,
    state: 'E',
    lastMsg: '',
    name: id,
    tableName: 'sense_data.TB_RAW',
    schedule: DEFAULT_SCHEDULE_TEXT,
    sourceId: SOURCE.sourceId,
    checkConf: '{}',
    jobId,
  } as unknown as SourceCheck
}

function aiRecord(overrides: Partial<MonitorRecordView> = {}): MonitorRecordView {
  const conf: MonitorCheckConf = {
    kind: 'ai',
    methods: ['today_landed'],
    desc: '检查今日是否有数据落地',
    version: 'v3',
    script: 'print("检查今日落地")',
    scriptPath: '/code/monitor_20261110.py',
    notifyOn: 'error',
    channels: ['mail'],
    nullPolicy: 'abnormal',
    noDataPolicy: 'no_data',
  }
  return {
    id: 'mon-1001',
    sourceId: SOURCE.sourceId,
    sourceName: SOURCE.name,
    name: '沐言社媒-日增量',
    tableName: 'sense_data.TB_RAW',
    kind: 'ai',
    enabled: true,
    schedule: '0 0 6-22 * * ?',
    publishStatus: 'ready',
    effectiveVersion: 'v3',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '',
    conf,
    raw: sourceRaw('mon-1001', 'job-9'),
    ...overrides,
  }
}

function ruleRecord(overrides: Partial<MonitorRecordView> = {}): MonitorRecordView {
  const conf: MonitorCheckConf = {
    kind: 'rule',
    timeType: 'C',
    minSize: 1,
    maxSize: 100,
    notifyOn: 'error',
    notifyType: 'mail',
    version: 'v2',
  }
  return {
    id: 'mon-2001',
    sourceId: SOURCE.sourceId,
    sourceName: SOURCE.name,
    name: '沐言社媒-规则检查',
    tableName: 'sense_data.TB_RAW',
    kind: 'rule',
    enabled: true,
    schedule: DEFAULT_SCHEDULE_TEXT,
    publishStatus: 'ready',
    effectiveVersion: 'v2',
    exec: 'none',
    data: 'unknown',
    notify: 'none',
    count: '',
    conf,
    raw: sourceRaw('mon-2001', 'job-3'),
    ...overrides,
  }
}

const DEFAULT_SCHEDULE_TEXT = '0 0 6-22 * * ?'

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(MonitorConfigEditor, {
    props: { siteId: '', sourceId: '', record: null, sourceLocked: false, ...props },
    global: {
      stubs: {
        SiteSourceSelect: { template: '<div data-testid="mc-site-source-select" />' },
      },
    },
  })
}

async function settle(): Promise<void> {
  await flushPromises()
  await flushPromises()
  await flushPromises()
}

beforeEach(() => {
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
  vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(GROUP)
  vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(TABLE)
  vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({ script: 'print("新脚本")', scriptPath: '/code/new.py' })
  vi.spyOn(ruleApi, 'executeCode').mockResolvedValue({ success: true, message: '检查通过' })
  vi.spyOn(ElMessage, 'success')
  vi.spyOn(ElMessage, 'warning')
  vi.spyOn(ElMessage, 'error')
  vi.spyOn(ElMessage, 'info')

  mocks.saveMonitor.mockResolvedValue({ created: false, raw: {} })
  mocks.listMonitorsOfSource.mockResolvedValue([])
  mocks.checkOneManual.mockResolvedValue({ success: true, message: '规则校验通过' })
  mocks.fetchModelProviders.mockResolvedValue([{ providerCode: 'deepseek', providerName: 'DeepSeek' }])
  mocks.fetchDefaultModels.mockResolvedValue([{ modelCode: 'deepseek-chat', modelName: 'deepseek-chat' }])
  mocks.resolveGenerationContext.mockResolvedValue(GENERATION_CONTEXT)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('MonitorConfigEditor 四区结构与默认值', () => {
  it('四区 Tab + 底部只有一个取消/保存，内容区是主滚动容器', async () => {
    const wrapper = mountEditor()
    await settle()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual(['基本信息', '检查方式', '执行计划', '通知'])
    expect(wrapper.find('[data-testid="mc-content"]').exists()).toBe(true)
    const footerButtons = wrapper.findAll('footer button')
    expect(footerButtons).toHaveLength(2)
    expect(footerButtons[0].text()).toBe('取消')
    expect(footerButtons[1].text()).toBe('保存为草稿')
    expect(wrapper.find('[data-testid="mc-save"]').attributes('data-testid')).toBe('mc-save')
  })

  it('新建默认 AI 检查，监控方法按 8 类分组多选', async () => {
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()

    expect(wrapper.find('[data-testid="mc-kind-ai"]').classes()).toContain('active')
    expect(wrapper.findAll('[data-testid^="mc-method-group-"]')).toHaveLength(8)
    await wrapper.find('[data-testid="mc-method-today_landed"]').setValue(true)
    expect(wrapper.find('[data-testid="mc-method-count"]').text()).toContain('已选 1 项')
    expect(wrapper.find('[data-testid="mc-method-chips"]').text()).toContain('当日正常入库')
  })

  it('默认描述只在空白表单时填入；用户改过后切换方法不覆盖', async () => {
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()

    await wrapper.find('[data-testid="mc-method-today_landed"]').setValue(true)
    await settle()
    const firstDesc = (wrapper.find('[data-testid="mc-desc-input"]').element as HTMLTextAreaElement).value
    expect(firstDesc).toContain('检查')

    await wrapper.find('[data-testid="mc-desc-input"]').setValue('用户写的业务描述')
    await wrapper.find('[data-testid="mc-method-daily_count"]').setValue(true)
    await settle()
    const desc = (wrapper.find('[data-testid="mc-desc-input"]').element as HTMLTextAreaElement).value
    expect(desc).toBe('用户写的业务描述')
  })

  it('关联表为空表单自动带出唯一表，不误报未保存', async () => {
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    const select = wrapper.find('[data-testid="mc-table-select"]').element as HTMLSelectElement
    expect(select.value).toBe('sense_data.TB_RAW')
    expect(wrapper.find('[data-testid="mc-dirty"]').exists()).toBe(false)
  })
})

describe('MonitorConfigEditor 校验反馈', () => {
  it('未选源 / 未填名称 / 未选方法分别给出明确提示', async () => {
    const noSource = mountEditor()
    await settle()
    await noSource.find('[data-testid="mc-save"]').trigger('click')
    expect(ElMessage.warning).toHaveBeenCalledWith('请先选择被监控源')
    noSource.unmount()

    const withSource = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await withSource.find('[data-testid="mc-save"]').trigger('click')
    expect(ElMessage.warning).toHaveBeenCalledWith('请填写监控名称')

    await withSource.find('[data-testid="mc-name-input"]').setValue('新监控')
    await withSource.find('[data-testid="mc-save"]').trigger('click')
    expect(ElMessage.warning).toHaveBeenCalledWith('AI 检查至少选择一个监控方法')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
  })
})

describe('MonitorConfigEditor 已有记录与脚本正文', () => {
  it('已有 AI 记录打开时显示生效脚本正文，不出现「还没有脚本」，测试可用', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    expect(wrapper.find('[data-testid="mc-script-body"]').text()).toContain('检查今日落地')
    expect(wrapper.find('[data-testid="mc-script-version"]').text()).toContain('生效中的脚本 v3')
    expect(wrapper.text()).not.toContain('还没有脚本')
    expect(wrapper.find('[data-testid="mc-test"]').attributes('disabled')).toBeUndefined()
  })

  it('没有脚本的 AI 记录：不显示脚本正文，测试按钮禁用', async () => {
    const record = aiRecord({
      conf: { kind: 'ai', methods: ['today_landed'], desc: '检查今日落地', notifyOn: 'error', version: 'v1' },
      effectiveVersion: 'v1',
      publishStatus: 'draft',
    })
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    expect(wrapper.find('[data-testid="mc-script-body"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mc-script-empty"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('还没有脚本')
    expect(wrapper.find('[data-testid="mc-test"]').attributes('disabled')).toBeDefined()
  })

  it('只有脚本路径（旧记录不回读正文）时展示路径，不显示「还没有脚本」', async () => {
    const record = aiRecord({ conf: { kind: 'ai', methods: ['today_landed'], desc: '检查', scriptPath: '/code/monitor_v3.py', version: 'v3' } })
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    expect(wrapper.find('[data-testid="mc-script-path"]').text()).toContain('/code/monitor_v3.py')
    expect(wrapper.text()).not.toContain('还没有脚本')
  })
})

describe('MonitorConfigEditor 生成脚本', () => {
  it('换源或清空源后清掉原源候选脚本与测试回显', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-method-dir-toggle"]').trigger('click')
    await wrapper.get('[data-testid="mc-method-today_landed"]').setValue(true)
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="mc-script-pending"]').exists()).toBe(true)
    wrapper.findComponent({ name: 'SourcePickerRemote' }).vm.$emit('update:modelValue', '', '')
    await settle()
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mc-script-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mc-script-body"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('生成只更新页面候选，不自动保存，并标「新生成，尚未保存」', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    expect(mocks.resolveGenerationContext).toHaveBeenCalledWith(SOURCE.sourceId, {
      tableName: expect.any(String),
      tableId: expect.any(String),
    })
    expect(ruleApi.dataProcessGenerate).toHaveBeenCalledTimes(1)
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mc-script-pending"]').text()).toContain('新生成，尚未保存')
    expect(wrapper.find('[data-testid="mc-script-body"]').text()).toContain('新脚本')
    expect(ElMessage.success).toHaveBeenCalledWith('脚本已生成（尚未保存）：保存后才会生效，生成不改变当前版本')
  })

  it('源没有流程时按主表生成独立监控（configId=0）并提示未关联画布节点', async () => {
    mocks.resolveGenerationContext.mockResolvedValueOnce({
      ...GENERATION_CONTEXT,
      contextMode: 'table',
      configId: 0,
      sourceTable: 'sense_data.TB_RAW',
    })
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    // 表单把「主表物理名 + 表 ID」交给上下文解析，源无流程时由它退回 table 模式
    expect(mocks.resolveGenerationContext).toHaveBeenCalledWith(SOURCE.sourceId, {
      tableName: 'sense_data.TB_RAW',
      tableId: 't1',
    })
    // 生成请求带 configId=0（不借别源/别节点的 configId）
    const payload = vi.mocked(ruleApi.dataProcessGenerate).mock.calls[0][0] as { configId: number }
    expect(payload.configId).toBe(0)
    const note = wrapper.get('[data-testid="mc-generate-note"]')
    expect(note.text()).toContain('还没有绑定流程')
    expect(note.text()).toContain('不关联画布节点')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('系统提示词被清空时用默认提示词兜底，不发空串（后端会报 text cannot be null or empty）', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-system-prompt"]').setValue('')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    const payload = vi.mocked(ruleApi.dataProcessGenerate).mock.calls[0][0] as { systemPrompt: string }
    expect(payload.systemPrompt.trim().length).toBeGreaterThan(0)
    expect(payload.systemPrompt).toContain('只读')
  })

  it('生成失败保留原正文（生效脚本不被清空）', async () => {
    vi.mocked(mocks.resolveGenerationContext).mockRejectedValueOnce(new Error('当前节点缺少可执行上下文'))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="mc-generate-error"]').text()).toContain('缺少可执行上下文')
    expect(wrapper.find('[data-testid="mc-script-body"]').text()).toContain('检查今日落地')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
  })
})

describe('MonitorConfigEditor 测试脚本', () => {
  it('测试生效脚本：标「测试，未通知」、注明测的是哪个脚本，不写记录', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-test"]').trigger('click')
    await settle()

    expect(ruleApi.executeCode).toHaveBeenCalledWith({ codePath: '/code/monitor_20261110.py', timeout: 60 })
    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    expect(result).toContain('测试，未通知')
    expect(result).toContain('生效 v3 的脚本')
    expect(result).toContain('未发送业务通知')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    expect(mocks.listMonitorsOfSource).not.toHaveBeenCalled()
  })

  it('测试新生成但未保存的脚本时，注明测的是候选', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="mc-test"]').trigger('click')
    await settle()

    expect(ruleApi.executeCode).toHaveBeenCalledWith({ codePath: '/code/new.py', timeout: 60 })
    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    expect(result).toContain('新生成、尚未保存的脚本')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
  })
})

describe('MonitorConfigEditor 保存', () => {
  it('模型选择随定义保存，重新打开优先使用本次选择而非旧编排模型', async () => {
    const record = aiRecord({ conf: { ...aiRecord().conf, modelProviderCode: 'new-provider', modelCode: 'new-model', orchestration: { modelProviderCode: 'old-provider', modelCode: 'old-model' } } })
    mocks.listMonitorsOfSource.mockResolvedValue([record])
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()
    expect(mocks.saveMonitor.mock.calls[0][0].conf).toMatchObject({ modelProviderCode: 'new-provider', modelCode: 'new-model' })
  })

  it('清空执行计划会显式提交空串，不能回退旧计划', async () => {
    const record = aiRecord()
    mocks.listMonitorsOfSource.mockResolvedValue([record])
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.get('[data-testid="mc-tab-plan"]').trigger('click')
    await wrapper.get('[data-testid="mc-schedule-clear"]').trigger('click')
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()
    expect(mocks.saveMonitor.mock.calls[0][0].schedule).toBe('')
  })

  it('只有新脚本路径时仍保存候选路径，清掉旧正文并推进版本', async () => {
    vi.mocked(ruleApi.dataProcessGenerate).mockResolvedValue({ script: '', scriptPath: '/code/path-only.py' })
    mocks.listMonitorsOfSource.mockResolvedValue([aiRecord()])
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()
    expect(mocks.saveMonitor.mock.calls[0][0].conf).toMatchObject({ script: '', scriptPath: '/code/path-only.py', version: 'v4' })
  })

  it('生成尚未结束时不允许保存旧候选', async () => {
    let complete!: (value: { script: string; scriptPath: string }) => void
    vi.mocked(ruleApi.dataProcessGenerate).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()
    expect(wrapper.get('[data-testid="mc-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    complete({ script: 'print(1)', scriptPath: '/code/new.py' })
    await settle()
    expect(wrapper.get('[data-testid="mc-save"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('源上下文加载期间的手动编辑仍保持 dirty，旧源迟到响应不能覆盖新源', async () => {
    let oldDetail!: (value: Source) => void
    vi.mocked(sourceApi.sourceDetail).mockImplementationOnce(() => new Promise((resolve) => { oldDetail = resolve }))
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await wrapper.get('[data-testid="mc-name-input"]').setValue('用户输入')
    await wrapper.setProps({ sourceId: 'new-source' })
    await settle()
    oldDetail({ ...SOURCE, name: '旧源迟到响应' })
    await settle()
    expect(wrapper.text()).not.toContain('旧源迟到响应')
    expect(wrapper.find('[data-testid="mc-dirty"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('已生成 → 按记录身份 saveMonitor，回执「已保存并生效 v4」，并以回读为新基线', async () => {
    const readback = aiRecord({
      effectiveVersion: 'v4',
      conf: { kind: 'ai', methods: ['today_landed'], desc: '检查今日是否有数据落地', version: 'v4', script: 'print("新脚本")', scriptPath: '/code/new.py' },
    })
    mocks.listMonitorsOfSource.mockResolvedValue([readback])

    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const saved = mocks.saveMonitor.mock.calls[0][0] as { record: MonitorRecordView; conf: MonitorCheckConf; sourceId: string }
    // 记录身份必须整体透传，isDelete/state/jobId 由 saveMonitor 从 record.raw 保留
    expect(saved.record.id).toBe('mon-1001')
    expect(saved.record.raw).toMatchObject({ isDelete: 0, state: 'E', jobId: 'job-9' })
    expect(saved.sourceId).toBe(SOURCE.sourceId)
    expect(saved.conf.script).toBe('print("新脚本")')
    expect(saved.conf.version).toBe('v4')
    expect(String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])).toContain('已保存并生效 v4')
    expect(wrapper.find('[data-testid="mc-script-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mc-script-version"]').text()).toContain('v4')
  })

  it('AI 未生成过脚本 → 回执「已保存草稿，未生效，不执行」', async () => {
    const draft = aiRecord({
      id: 'mon-3001',
      name: '新监控',
      effectiveVersion: undefined,
      publishStatus: 'draft',
      conf: { kind: 'ai', methods: ['today_landed'], desc: '检查今日落地', version: 'v1' },
    })
    mocks.saveMonitor.mockResolvedValue({ created: true, raw: {} })
    mocks.listMonitorsOfSource.mockResolvedValueOnce([]).mockResolvedValueOnce([draft])

    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.find('[data-testid="mc-name-input"]').setValue('新监控')
    await wrapper.find('[data-testid="mc-method-today_landed"]').setValue(true)
    await settle()
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const message = String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])
    expect(message).toContain('已保存草稿')
    expect(message).toContain('未生效')
    expect(message).toContain('不执行')
  })

  it('描述改过但没重新生成 → 回执说明检查逻辑仍是 v3，需重新生成', async () => {
    mocks.listMonitorsOfSource.mockResolvedValue([aiRecord()])
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-desc-input"]').setValue('改过的描述：检查数量与时效')
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    const message = String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])
    expect(message).toContain('检查逻辑仍是 v3')
    expect(message).toContain('需重新生成脚本')
    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
  })

  it('保存后回读不到记录 → 提示「已提交，未回读到记录」，不猜 ID', async () => {
    mocks.listMonitorsOfSource.mockResolvedValue([])
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining('已提交，未回读到记录'))
    expect(wrapper.emitted('saved')?.[0]).toEqual([null])
  })
})

describe('MonitorConfigEditor 源与检查方式', () => {
  it('编辑已有记录锁源：不渲染选源控件，显示只读「当前源：名称（ID）」', async () => {
    const wrapper = mountEditor({ record: aiRecord(), sourceLocked: true })
    await settle()

    expect(wrapper.find('[data-testid="mc-site-source-select"]').exists()).toBe(false)
    const locked = wrapper.find('[data-testid="mc-source-locked"]')
    expect(locked.exists()).toBe(true)
    expect(locked.text()).toContain('沐言社媒')
    expect(locked.text()).toContain(SOURCE.sourceId)
  })

  it('sourceLocked=true 的新建也不渲染选源控件，但仍校验源必填', async () => {
    const wrapper = mountEditor({ sourceLocked: true })
    await settle()

    expect(wrapper.find('[data-testid="mc-site-source-select"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mc-source-locked"]').text()).toContain('未指定')
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    expect(ElMessage.warning).toHaveBeenCalledWith('请先选择被监控源')
  })

  it('全局上下文（无 siteId、未锁源）使用可搜索的远程源下拉', async () => {
    const wrapper = mountEditor()
    await settle()
    expect(wrapper.find('[data-testid="mc-source-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mc-site-source-select"]').exists()).toBe(false)
  })

  it('规则检查保留旧面板字段，并回显旧值', async () => {
    const wrapper = mountEditor({ record: ruleRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    expect(wrapper.find('[data-testid="mc-kind-rule"]').classes()).toContain('active')
    expect((wrapper.find('[data-testid="mc-rule-minSize"]').element as HTMLInputElement).value).toBe('1')
    expect((wrapper.find('[data-testid="mc-rule-maxSize"]').element as HTMLInputElement).value).toBe('100')
    expect(wrapper.find('[data-testid="mc-rule-timeType"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mc-method-today_landed"]').exists()).toBe(false)
  })

  it('规则检查「验证」走 check-one 并标「测试，未通知」', async () => {
    const wrapper = mountEditor({ record: ruleRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-rule-verify"]').trigger('click')
    await settle()

    expect(mocks.checkOneManual).toHaveBeenCalledTimes(1)
    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    expect(result).toContain('测试，未通知')
    expect(result).toContain('未发送业务通知')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
  })
})
describe('MonitorConfigEditor 取消', () => {
  it('无未保存改动时直接 emit cancel（弹窗由宿主关闭）', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-cancel"]').trigger('click')
    await settle()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('有未保存改动时必须确认：继续编辑不发 cancel，放弃修改才发', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm')
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-name-input"]').setValue('改过的名称')

    confirm.mockRejectedValueOnce(new Error('cancel'))
    await wrapper.find('[data-testid="mc-cancel"]').trigger('click')
    await settle()
    expect(wrapper.emitted('cancel')).toBeUndefined()

    confirm.mockResolvedValueOnce('confirm' as never)
    await wrapper.find('[data-testid="mc-cancel"]').trigger('click')
    await settle()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
