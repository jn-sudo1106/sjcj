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
  loadMonitorRecord: vi.fn(),
  checkOneManual: vi.fn(),
  fetchModelProviders: vi.fn(),
  fetchDefaultModels: vi.fn(),
  resolveSourceResultContext: vi.fn(),
  resolveTableFields: vi.fn(),
}))

vi.mock('@/api/monitorCenter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/monitorCenter')>()
  return {
    ...actual,
    saveMonitor: mocks.saveMonitor,
    listMonitorsOfSource: mocks.listMonitorsOfSource,
    loadMonitorRecord: mocks.loadMonitorRecord,
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
  return { ...actual, resolveSourceResultContext: mocks.resolveSourceResultContext, resolveMonitorTableFields: mocks.resolveTableFields }
})

import MonitorConfigEditor from './MonitorConfigEditor.vue'
import { dataApi, entryApi, ruleApi, sourceApi } from '@/api'
import { nodePromptApi, type NodePromptTemplate } from '@/api/nodePrompts'
import { defaultSystemPrompt } from '@/utils/monitor/methods'

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
        ElDrawer: { props: ['modelValue', 'title'], template: '<section v-if="modelValue" role="dialog" :aria-label="title"><slot /></section>' },
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
  mocks.resolveTableFields.mockImplementation(async () => {
    const group = await dataApi.entryTypesGroup('t1')
    return group.list1[0]?.fields.map((field) => field.prop) ?? []
  })
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE)
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(steps())
  vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(GROUP)
  vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(TABLE)
  vi.spyOn(ruleApi, 'dataProcessGenerate').mockResolvedValue({ script: 'print("新脚本")', scriptPath: '/code/new.py' })
  const files = new Map<string, string>([['/code/path-only.py', 'print("回读脚本")']])
  vi.spyOn(ruleApi, 'fileUploadScript').mockImplementation(async (path, body) => { files.set(path, body); return { ok: true } as never })
  vi.spyOn(ruleApi, 'fileDownloadScript').mockImplementation(async (path) => files.get(path) || '')
  vi.spyOn(ruleApi, 'executeCode').mockResolvedValue({ success: true, message: '检查通过' })
  vi.spyOn(ElMessage, 'success')
  vi.spyOn(ElMessage, 'warning')
  vi.spyOn(ElMessage, 'error')
  vi.spyOn(ElMessage, 'info')

  mocks.saveMonitor.mockResolvedValue({ created: false, raw: {} })
  mocks.loadMonitorRecord.mockResolvedValue(undefined)
  mocks.checkOneManual.mockResolvedValue({ success: true, message: '规则校验通过' })
  mocks.fetchModelProviders.mockResolvedValue([{ providerCode: 'deepseek', providerName: 'DeepSeek' }])
  mocks.fetchDefaultModels.mockResolvedValue([{ modelCode: 'deepseek-chat', modelName: 'deepseek-chat' }])
  mocks.resolveSourceResultContext.mockResolvedValue(GENERATION_CONTEXT)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
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

  it('新建时默认带出源的最终落库主表，而不是清单里的第一张表', async () => {
    const finalTable: EntryType = { ...TABLE, tableId: 't9', tableName: 'sense_data.TB_FINAL', name: '最终落库表' }
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValueOnce({ main: TABLE.tableId, list1: [TABLE, finalTable], list2: [], list3: [] })
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValueOnce({ ...SOURCE, mainTable: 'sense_data.TB_FINAL' })

    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()

    const select = wrapper.find('[data-testid="mc-table-select"]').element as HTMLSelectElement
    expect(select.value).toBe('sense_data.TB_FINAL')
    // 页面按「源结果检查」标注范围（1113 修订 §4.1.5），不再出现流程绑定状态
    expect(wrapper.text()).toContain('源结果检查')
    expect(wrapper.text()).toContain('检查表：sense_data.TB_FINAL')
    expect(wrapper.find('[data-testid="mc-dirty"]').exists()).toBe(false)
    wrapper.unmount()
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

describe('MonitorConfigEditor 脚本文件', () => {
  it('正文存在时仍展示文件名和路径，并可预览当前已保存正文', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    expect(wrapper.get('[data-testid="mc-script-filename"]').text()).toBe('monitor_20261110.py')
    expect(wrapper.get('[data-testid="mc-script-path"]').text()).toBe('/code/monitor_20261110.py')
    await wrapper.get('[data-testid="mc-script-file-preview"]').trigger('click')
    await settle()
    expect(wrapper.get('[data-testid="mc-file-full-code"]').text()).toContain('检查今日落地')
    expect(ruleApi.fileDownloadScript).not.toHaveBeenCalled()
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('生成完成后即可预览候选文件，无需保存生效', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()
    expect(wrapper.get('[data-testid="mc-script-filename"]').text()).toBe('new.monitor.py')
    expect(wrapper.get('[data-testid="mc-script-file"]').text()).toContain('待保存候选')
    await wrapper.get('[data-testid="mc-script-file-preview"]').trigger('click')
    await settle()
    expect(wrapper.get('[data-testid="mc-file-full-code"]').text()).toBe('print("新脚本")')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('下载当前展示的正文，保留 .py 文件名并释放 Blob URL', async () => {
    let downloaded: Blob | undefined
    const create = vi.fn((blob: Blob) => { downloaded = blob; return 'blob:script' })
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-script-download"]').trigger('click')
    await settle()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('monitor_20261110.py')
    expect(anchor.href).toBe('blob:script')
    const text = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(downloaded!)
    })
    expect(text).toBe('print("检查今日落地")')
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:script'))
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('只有路径时按需读取文件；读取失败明确提示，不下载空文件', async () => {
    const wrapper = mountEditor({ record: aiRecord({ conf: { kind: 'ai', scriptPath: '/code/path-only.py' } }) })
    await settle()
    vi.mocked(ruleApi.fileDownloadScript).mockRejectedValueOnce(new Error('文件不存在'))
    await wrapper.get('[data-testid="mc-script-file-preview"]').trigger('click')
    await settle()
    expect(wrapper.get('[role="alert"]').text()).toContain('文件不存在')
    expect(wrapper.get('[data-testid="mc-preview-download"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="mc-script-file-preview"]').trigger('click')
    await settle()
    expect(wrapper.get('[data-testid="mc-file-full-code"]').text()).toBe('print("回读脚本")')
    wrapper.unmount()
  })
})

describe('MonitorConfigEditor 生成脚本', () => {
  // 1117 起新建监控生成前先存草稿（拿监控 ID），存完即锁源：候选脚本不可能被带到别的源上。
  // 原用例「生成后换源清候选」的场景因此不再存在，改为验证锁源。
  it('新建监控生成后源已锁定（先存草稿），候选脚本不会被带到别的源', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    mocks.saveMonitor.mockResolvedValue({ created: true, raw: { id: 3201 } })
    mocks.loadMonitorRecord.mockResolvedValue(aiRecord({
      id: '3201', name: '锁源', effectiveVersion: undefined, publishStatus: 'draft',
      conf: { kind: 'ai', methods: ['today_landed'], desc: '检查今日落地', version: '', modelProviderCode: 'deepseek', modelCode: 'deepseek-chat' },
    }))
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.get('[data-testid="mc-name-input"]').setValue('锁源')
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-method-dir-toggle"]').trigger('click')
    await wrapper.get('[data-testid="mc-method-today_landed"]').setValue(true)
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="mc-script-pending"]').exists()).toBe(true)
    await wrapper.get('[data-testid="mc-tab-basic"]').trigger('click')
    expect(wrapper.find('[data-testid="mc-source-locked"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'SourcePickerRemote' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('生成只更新页面候选，不自动保存，并标「新生成，尚未保存」', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    expect(mocks.resolveSourceResultContext).toHaveBeenCalledWith({
      tableName: expect.any(String),
      tableId: expect.any(String),
    })
    expect(ruleApi.dataProcessGenerate).toHaveBeenCalledTimes(1)
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="mc-script-pending"]').text()).toContain('新生成，尚未保存')
    expect(wrapper.find('[data-testid="mc-script-body"]').text()).toContain('新脚本')
    expect(ElMessage.success).toHaveBeenCalledWith('脚本已生成（尚未保存）：保存后才会生效，生成不改变当前版本')
  })

  it('源有流程、流程里也有监控节点时，生成仍只读表单选定的表，且不提示流程相关警告', async () => {
    mocks.resolveSourceResultContext.mockResolvedValueOnce({
      ...GENERATION_CONTEXT,
      configId: 0,
      sourceTable: 'sense_data.TB_OTHER',
      targetTable: 'sense_data.TB_OTHER',
    })
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    expect(mocks.resolveSourceResultContext).toHaveBeenCalledWith({ tableName: 'sense_data.TB_RAW', tableId: 't1' })
    const payload = vi.mocked(ruleApi.dataProcessGenerate).mock.calls[0][0] as { configId: number; sourceTable: string }
    // 表单选的表就是本次生成的范围；configId=0 只是旧协议兼容值
    expect(payload.configId).toBe(0)
    expect(payload.sourceTable).toBe('sense_data.TB_OTHER')
    expect(wrapper.find('[data-testid="mc-generate-note"]').exists()).toBe(false)
    expect(ElMessage.warning).not.toHaveBeenCalled()
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
    vi.mocked(mocks.resolveSourceResultContext).mockRejectedValueOnce(new Error('当前节点缺少可执行上下文'))
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
  it.each([
    { success: false, status: 'ERROR', messageType: 'error' as const, text: '执行失败' },
    { success: true, status: 'ABNORMAL', messageType: 'warning' as const, text: '数据异常' },
    { success: true, status: 'NORMAL', messageType: 'success' as const, text: '数据正常' },
  ])('测试回执 $status 的弹出提示与结果区一致', async ({ success, status, messageType, text }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success, status, checkedCount: 0, abnormalCount: 0, durationMs: 87,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-test"]').trigger('click')
    await settle()

    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    const message = String(vi.mocked(ElMessage[messageType]).mock.calls.at(-1)?.[0])
    expect(result).toContain(text)
    expect(message).toContain(text)
    expect(message).toContain('检查 0 条；异常 0 条；87ms')
    expect(result).toContain('检查 0 条；异常 0 条；87ms')
    if (!success) {
      expect(result).toContain('测试失败，未通知')
      expect(ElMessage.success).not.toHaveBeenCalled()
    }
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('测试生效脚本：标「测试，未通知」、注明测的是哪个脚本，不写记录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
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
    expect(mocks.loadMonitorRecord).not.toHaveBeenCalled()
  })

  it('测试脚本优先走数据监控执行器（不依赖 vrule 执行端点）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      status: 'ABNORMAL',
      checkedCount: 63,
      abnormalCount: 2,
      reason: '2 行标题不符合约定',
      durationMs: 812,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-test"]').trigger('click')
    await settle()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runner-management/monitor-runner/test-script',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(ruleApi.executeCode).not.toHaveBeenCalled()
    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    expect(result).toContain('测试，未通知')
    expect(result).toContain('检查 63 条')
    expect(result).toContain('异常 2 条')
  })

  it('测试新生成但未保存的脚本时，注明测的是候选', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="mc-test"]').trigger('click')
    await settle()

    expect(ruleApi.executeCode).toHaveBeenCalledWith({ codePath: '/code/new.monitor.py', timeout: 60 })
    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    expect(result).toContain('新生成、尚未保存的脚本')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
  })

  it('试跑回执标出检查范围（表），不只说测的是哪个版本', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-test"]').trigger('click')
    await settle()

    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    expect(result).toContain('表 sense_data.TB_RAW')
  })

  it('换检查表后候选保留但标记为按旧表生成，试跑对象写出旧表', async () => {
    const finalTable: EntryType = { ...TABLE, tableId: 't9', tableName: 'sense_data.TB_FINAL', name: '最终落库表' }
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ main: TABLE.tableId, list1: [TABLE, finalTable], list2: [], list3: [] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    await wrapper.find('[data-testid="mc-table-select"]').setValue('sense_data.TB_FINAL')
    await settle()

    // 不作废（用户可能只是换表看看），但必须标出来，且保存前要再确认
    const stale = wrapper.find('[data-testid="mc-candidate-stale"]')
    expect(stale.exists()).toBe(true)
    expect(stale.text()).toContain('按「sense_data.TB_RAW」生成')
    expect(stale.text()).toContain('sense_data.TB_FINAL')

    await wrapper.find('[data-testid="mc-test"]').trigger('click')
    await settle()
    const result = wrapper.find('[data-testid="mc-test-result"]').text()
    expect(result).toContain('新生成、尚未保存的脚本')
    expect(result).toContain('按「sense_data.TB_RAW」生成')
    expect(result).toContain('表 sense_data.TB_FINAL')
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
  })
})

describe('MonitorConfigEditor 保存', () => {
  it('模型选择随定义保存，重新打开优先使用本次选择而非旧编排模型', async () => {
    const record = aiRecord({ conf: { ...aiRecord().conf, modelProviderCode: 'new-provider', modelCode: 'new-model', orchestration: { modelProviderCode: 'old-provider', modelCode: 'old-model' } } })
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()
    expect(mocks.saveMonitor.mock.calls[0][0].conf).toMatchObject({ modelProviderCode: 'new-provider', modelCode: 'new-model' })
  })

  it('清空执行计划会显式提交空串，不能回退旧计划', async () => {
    const record = aiRecord()
    mocks.loadMonitorRecord.mockResolvedValue(record)
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
    mocks.loadMonitorRecord.mockResolvedValue(aiRecord())
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()
    expect(mocks.saveMonitor.mock.calls[0][0].conf).toMatchObject({ script: 'print("回读脚本")', scriptPath: '/code/path-only.monitor.py', version: 'v4' })
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

  it('脚本正文默认直接可见（不用点开折叠），并可一键复制', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    const body = wrapper.get('[data-testid="mc-script-body"]')
    expect(body.text()).toContain('print("检查今日落地")')
    // 不应再要求先展开 details
    expect(wrapper.find('details.mc-script-details').exists()).toBe(false)
    expect(wrapper.get('[data-testid="mc-script-preview"]').text()).toContain('脚本正文')
    wrapper.unmount()
  })

  it('生成过程中展示流式正文、思考片段与耗时', async () => {
    let complete!: (value: { script: string; scriptPath: string }) => void
    vi.mocked(ruleApi.dataProcessGenerate).mockImplementationOnce(((
      _payload: unknown,
      handlers?: { onContent?: (text: string) => void; onThinking?: (text: string) => void },
    ) => {
      handlers?.onThinking?.('正在确认表结构与入库时间列')
      handlers?.onContent?.('import pymysql\n')
      return new Promise((resolve) => { complete = resolve })
    }) as never)
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()

    const stream = wrapper.get('[data-testid="mc-stream"]')
    expect(stream.text()).toContain('模型正在生成代码')
    expect(wrapper.get('[data-testid="mc-generating"]').text()).toContain('import pymysql')
    // 思考是增量推送，界面要累积成完整文本，而不是只剩最后一个词
    expect(wrapper.get('[data-testid="mc-stream-thinking"]').text()).toContain('入库时间列')
    expect(stream.text()).toContain('已接收 15 字')

    complete({ script: 'print(1)', scriptPath: '/code/new.py' })
    await settle()
    // 生成结束后过程区消失，候选正文回到脚本卡
    expect(wrapper.find('[data-testid="mc-stream"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="mc-script-body"]').text()).toContain('print(1)')
    wrapper.unmount()
  })

  it('思考阶段只显示思考过程并说明代码稍后出现', async () => {
    vi.mocked(ruleApi.dataProcessGenerate).mockImplementationOnce(((
      _payload: unknown,
      handlers?: { onThinking?: (text: string) => void },
    ) => {
      handlers?.onThinking?.('先确认')
      handlers?.onThinking?.('表结构')
      return new Promise(() => {})
    }) as never)
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-generate"]').trigger('click')
    await settle()

    const stream = wrapper.get('[data-testid="mc-stream"]')
    expect(stream.text()).toContain('模型正在思考')
    expect(stream.text()).toContain('代码会在思考结束后逐字出现')
    expect(wrapper.get('[data-testid="mc-stream-thinking"]').text()).toBe('先确认表结构')
    expect(wrapper.find('[data-testid="mc-generating"]').exists()).toBe(false)
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
    mocks.loadMonitorRecord.mockResolvedValue(readback)

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

  it('AI 有脚本但没有执行计划 → 按钮「保存（仅手动）」，回执只说手动运行、不说计划已生效', async () => {
    // timeColumn 与打开记录时自动选中的列一致，避免额外触发「需重新生成脚本」分支
    const record = aiRecord({ schedule: '', conf: { ...aiRecord().conf, timeColumn: 'publish_time' } })
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()

    // 头部 meta 与按钮口径一致：计划为空 = 仅手动
    expect(wrapper.text()).toContain('仅手动')
    expect(wrapper.get('[data-testid="mc-save"]').text()).toBe('保存（仅手动）')

    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    expect((mocks.saveMonitor.mock.calls[0][0] as { schedule: string }).schedule).toBe('')
    const message = String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])
    expect(message).toContain('已保存并生效 v3')
    expect(message).toContain('未设执行计划')
    expect(message).toContain('只能手动运行')
    expect(message).toContain('如需定时，请填写执行计划')
    expect(message).not.toContain('计划/通知/判定策略已生效')
  })

  it('AI 有脚本且有执行计划 → 仍是「保存并生效」，回执含计划已生效', async () => {
    const record = aiRecord({ conf: { ...aiRecord().conf, timeColumn: 'publish_time' } })
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()

    expect(wrapper.get('[data-testid="mc-save"]').text()).toBe('保存并生效')
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()

    const message = String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])
    expect(message).toContain('已保存并生效 v3')
    expect(message).toContain('计划/通知/判定策略已生效')
    expect(message).not.toContain('只能手动运行')
  })

  it('超期无新增策略：回显旧值，改完随保存写进 check_conf.overduePolicy', async () => {
    const record = aiRecord({
      conf: {
        ...aiRecord().conf,
        timeColumn: 'publish_time',
        overduePolicy: { expectEveryMinutes: 30, graceMinutes: 5 },
      },
    })
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')

    // 旧记录打开要能看见已生效的策略，不能显示空白让人以为没配
    expect((wrapper.get('[data-testid="mc-overdue-minutes"]').element as HTMLInputElement).value).toBe('30')
    expect((wrapper.get('[data-testid="mc-overdue-grace"]').element as HTMLInputElement).value).toBe('5')

    await wrapper.get('[data-testid="mc-overdue-minutes"]').setValue('15')
    await wrapper.get('[data-testid="mc-overdue-grace"]').setValue('0')
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const saved = mocks.saveMonitor.mock.calls[0][0] as { conf: MonitorCheckConf }
    expect(saved.conf.overduePolicy).toEqual({ expectEveryMinutes: 15, graceMinutes: 0 })
    wrapper.unmount()
  })

  it('超期周期填非法值时拦截保存，不发请求', async () => {
    const record = aiRecord({ conf: { ...aiRecord().conf, timeColumn: 'publish_time' } })
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.get('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.get('[data-testid="mc-overdue-minutes"]').setValue('0')
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    expect(String(vi.mocked(ElMessage.warning).mock.calls.at(-1)?.[0])).toContain('正整数分钟')
    wrapper.unmount()
  })

  it('规则检查在计划为空时行为不变：按钮仍是「保存并生效」，回执不提仅手动', async () => {
    const record = ruleRecord({ schedule: '' })
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()

    expect(wrapper.get('[data-testid="mc-save"]').text()).toBe('保存并生效')
    await wrapper.get('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const message = String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])
    expect(message).toBe('已保存并生效 v2：保存的内容已发布')
    expect(message).not.toContain('只能手动运行')
  })

  it('AI 未生成过脚本 → 回执「已保存草稿，未生效，不执行」', async () => {
    const draft = aiRecord({
      id: 'mon-3001',
      name: '新监控',
      effectiveVersion: undefined,
      publishStatus: 'draft',
      conf: { kind: 'ai', methods: ['today_landed'], desc: '检查今日落地', version: 'v1' },
    })
    // 新建时后端 /add 回执带 data.id，回读按这个 id 单条读（不再按源拉全量猜）
    mocks.saveMonitor.mockResolvedValue({ created: true, raw: { id: 3001 } })
    mocks.loadMonitorRecord.mockResolvedValue(draft)

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

  it('新建保存后按回执 id 单条回读（C01），不再按源拉全量猜记录', async () => {
    const draft = aiRecord({
      id: '3002',
      name: '单条回读',
      effectiveVersion: undefined,
      publishStatus: 'draft',
      conf: { kind: 'ai', methods: ['today_landed'], desc: '检查今日落地', version: 'v1' },
    })
    mocks.saveMonitor.mockResolvedValue({ created: true, raw: { id: 3002, ver: 1794 } })
    mocks.loadMonitorRecord.mockResolvedValue(draft)

    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.find('[data-testid="mc-name-input"]').setValue('单条回读')
    await wrapper.find('[data-testid="mc-method-today_landed"]').setValue(true)
    await settle()
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    // 只按主键读一条：既不是 0 次（漏回读），也不是按源扫全量
    expect(mocks.loadMonitorRecord).toHaveBeenCalledTimes(1)
    expect(mocks.loadMonitorRecord).toHaveBeenCalledWith('3002')
    expect(mocks.listMonitorsOfSource).not.toHaveBeenCalled()
  })

  it('描述改过但没重新生成 → 回执说明检查逻辑仍是 v3，需重新生成', async () => {
    mocks.loadMonitorRecord.mockResolvedValue(aiRecord())
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

  it('候选按旧表生成时保存要先确认：取消就不写记录', async () => {
    const finalTable: EntryType = { ...TABLE, tableId: 't9', tableName: 'sense_data.TB_FINAL', name: '最终落库表' }
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ main: TABLE.tableId, list1: [TABLE, finalTable], list2: [], list3: [] })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="mc-table-select"]').setValue('sense_data.TB_FINAL')
    await settle()
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('按「sense_data.TB_RAW」生成'),
      '候选脚本与当前检查范围不一致',
      expect.objectContaining({ confirmButtonText: '仍然保存' }),
    )
    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('候选按旧表生成仍选择保存 → 发布候选并升版本，回执不说「需重新生成」', async () => {
    const finalTable: EntryType = { ...TABLE, tableId: 't9', tableName: 'sense_data.TB_FINAL', name: '最终落库表' }
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ main: TABLE.tableId, list1: [TABLE, finalTable], list2: [], list3: [] })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    mocks.loadMonitorRecord.mockResolvedValue(aiRecord({ tableName: 'sense_data.TB_FINAL', effectiveVersion: 'v4' }))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="mc-table-select"]').setValue('sense_data.TB_FINAL')
    await settle()
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const payload = mocks.saveMonitor.mock.calls[0][0]
    expect(payload.tableName).toBe('sense_data.TB_FINAL')
    expect(JSON.stringify(payload.conf)).toContain('新脚本')
    const message = String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])
    expect(message).toContain('已保存')
    wrapper.unmount()
  })

  it('换表后没重新生成就保存 → 回执点名具体字段有改动，不说笼统的「描述或方法」', async () => {
    const finalTable: EntryType = { ...TABLE, tableId: 't9', tableName: 'sense_data.TB_FINAL', name: '最终落库表' }
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({ main: TABLE.tableId, list1: [TABLE, finalTable], list2: [], list3: [] })
    mocks.loadMonitorRecord.mockResolvedValue(aiRecord({ tableName: 'sense_data.TB_FINAL' }))
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-table-select"]').setValue('sense_data.TB_FINAL')
    await settle()
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    const message = String(vi.mocked(ElMessage.success).mock.calls.at(-1)?.[0])
    expect(message).toMatch(/检查表(、|有改动)/)
    expect(message).toContain('检查逻辑仍是 v3')
    expect(message).toContain('需重新生成脚本')
    expect(message).not.toContain('描述或方法有改动')
  })

  it('保存后回读不到记录 → 提示「已提交，未回读到记录」，不猜 ID', async () => {
    mocks.loadMonitorRecord.mockResolvedValue(undefined)
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
// 1117 前端修改清单 1.1–1.4：提示词读节点提示词模板（610）、新建先存草稿拿 ID、目标路径预览
const MONITOR_TEMPLATE = {
  promptId: 61,
  promptName: '数据监控默认',
  nodeType: '610',
  nodeTypeName: '数据监控',
  category: '',
  templateUse: 'script',
  revision: '1',
  isActive: 1,
  isDefault: 1,
  systemPrompt: '模板系统提示词：检查表 {{table_name}}',
  userPromptTemplate: '请检查 {{source_name}} 的 {{table_name}}：{{methods}}',
} as unknown as NodePromptTemplate

describe('MonitorConfigEditor 提示词模板与监控 ID', () => {
  it('新建：系统提示词与业务描述按 610 模板填充，并注明来源', async () => {
    const list = vi.spyOn(nodePromptApi, 'list').mockResolvedValue([MONITOR_TEMPLATE])
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-method-today_landed"]').setValue(true)
    await settle()

    expect(list).toHaveBeenCalledWith({ sourceType: '610', templateUse: 'script' })
    const system = wrapper.find('[data-testid="mc-system-prompt"]').element as HTMLTextAreaElement
    expect(system.value).toBe('模板系统提示词：检查表 sense_data.TB_RAW')
    const desc = wrapper.find('[data-testid="mc-desc-input"]').element as HTMLTextAreaElement
    expect(desc.value).toContain('请检查 沐言社媒 的 sense_data.TB_RAW：')
    expect(wrapper.find('[data-testid="mc-prompt-source"]').text()).toContain('数据监控默认')
  })

  it('模板读取失败：退回内置默认提示词，提示原因，不阻断', async () => {
    vi.spyOn(nodePromptApi, 'list').mockRejectedValue(new Error('请先登录'))
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    expect((wrapper.find('[data-testid="mc-system-prompt"]').element as HTMLTextAreaElement).value).toBe(defaultSystemPrompt())
    expect(wrapper.find('[data-testid="mc-prompt-source"]').text()).toContain('使用内置默认')
  })

  it('已有记录：保留保存过的系统提示词，不被模板覆盖；「恢复模板」才换成模板', async () => {
    vi.spyOn(nodePromptApi, 'list').mockResolvedValue([MONITOR_TEMPLATE])
    const record = aiRecord()
    record.conf = { ...record.conf, systemPrompt: '已保存的提示词' }
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    const system = () => (wrapper.find('[data-testid="mc-system-prompt"]').element as HTMLTextAreaElement).value

    expect(system()).toBe('已保存的提示词')
    await wrapper.find('[data-testid="mc-system-prompt-restore"]').trigger('click')
    expect(system()).toBe('模板系统提示词：检查表 sense_data.TB_RAW')
  })

  it('已有记录显示 Git 目标路径 monitor/<sourceId>/<监控ID>.py', async () => {
    const wrapper = mountEditor({ record: aiRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    expect(wrapper.find('[data-testid="mc-target-path"]').text()).toContain(`monitor/${SOURCE.sourceId}/mon-1001.py`)
  })

  it('新建监控生成前先存草稿拿 ID：确认后保存（无脚本）再生成，不关编辑器', async () => {
    const draft = aiRecord({
      id: '3101',
      name: '先存草稿',
      effectiveVersion: undefined,
      publishStatus: 'draft',
      conf: { kind: 'ai', methods: ['today_landed'], desc: '检查今日落地', version: '', modelProviderCode: 'deepseek', modelCode: 'deepseek-chat' },
    })
    mocks.saveMonitor.mockResolvedValue({ created: true, raw: { id: 3101 } })
    mocks.loadMonitorRecord.mockResolvedValue(draft)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)

    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.find('[data-testid="mc-name-input"]').setValue('先存草稿')
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-method-today_landed"]').setValue(true)
    await settle()
    expect(wrapper.find('[data-testid="mc-target-path"]').text()).toContain('先保存草稿')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const savedConf = mocks.saveMonitor.mock.calls[0][0].conf as MonitorCheckConf
    expect(savedConf.script).toBeUndefined()
    expect(wrapper.emitted('draft-saved')?.[0]?.[0]).toMatchObject({ id: '3101' })
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(ruleApi.dataProcessGenerate).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="mc-target-path"]').text()).toContain(`monitor/${SOURCE.sourceId}/3101.py`)
  })

  it('新建监控生成时取消「先存草稿」：不保存也不生成', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()
    await wrapper.find('[data-testid="mc-name-input"]').setValue('不存')
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-method-today_landed"]').setValue(true)
    await settle()
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).not.toHaveBeenCalled()
    expect(ruleApi.dataProcessGenerate).not.toHaveBeenCalled()
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

function groupWithFields(fields: EntryType['fields']): EntryTypeGroup {
  return { main: TABLE.tableId, list1: [{ ...TABLE, fields }], list2: [], list3: [] }
}

function timeColumnValue(wrapper: ReturnType<typeof mountEditor>): string {
  return (wrapper.find('[data-testid="mc-time-column"]').element as HTMLSelectElement).value
}

function timeColumnRecord(): MonitorRecordView {
  return aiRecord({
    conf: {
      ...aiRecord().conf,
      timeColumn: 'CREATE_DT',
      window: { type: 'hours', hours: 6 },
      customKey: 'keep-me',
    },
  })
}

describe('MonitorConfigEditor 入库时间字段', () => {
  it('旧字段不存在时保留配置并提示，不加入真实字段候选', async () => {
    const wrapper = mountEditor({ record: timeColumnRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    expect(timeColumnValue(wrapper)).toBe('')
    const options = wrapper.findAll('[data-testid="mc-time-column"] option').map((option) => option.text())
    expect(options).toEqual(['请选择', 'publish_time'])
    expect(wrapper.text()).toContain('当前表不存在字段 CREATE_DT')
    expect(wrapper.find('[data-testid="mc-time-column"]').element.parentElement?.textContent).toContain(
      '脚本按这一列统计；不确定时选表的入库时间列',
    )
  })

  it('只有一个时间列候选时自动选中，且不算未保存改动', async () => {
    vi.mocked(dataApi.entryTypesGroup).mockResolvedValue(groupWithFields([
      { prop: 'CREATE_DT', desc: '入库时间', type: 'date', required: false },
      { prop: 'title', desc: '标题', type: 'string', required: false },
    ]))
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()

    expect(timeColumnValue(wrapper)).toBe('CREATE_DT')
    expect(wrapper.find('[data-testid="mc-dirty"]').exists()).toBe(false)
  })

  it('多个时间列候选时不猜，留空显示「请选择」且不算未保存改动', async () => {
    vi.mocked(dataApi.entryTypesGroup).mockResolvedValue(groupWithFields([
      { prop: 'CREATE_DT', desc: '入库时间', type: 'date', required: false },
      { prop: 'UPDATE_DT', desc: '更新时间', type: 'date', required: false },
      { prop: 'title', desc: '标题', type: 'string', required: false },
    ]))
    const wrapper = mountEditor({ sourceId: SOURCE.sourceId })
    await settle()

    expect(timeColumnValue(wrapper)).toBe('')
    expect(wrapper.find('[data-testid="mc-dirty"]').exists()).toBe(false)
  })

  it('字段清单拿不到时不提供猜测的候选；草稿仍可保存', async () => {
    vi.mocked(dataApi.entryTypesGroup).mockResolvedValue(groupWithFields([]))
    vi.mocked(entryApi.entryDetail).mockRejectedValue(new Error('字段清单不可用'))
    vi.spyOn(entryApi, 'searchTables').mockResolvedValue([])
    const record = aiRecord()
    mocks.loadMonitorRecord.mockResolvedValue(record)

    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    const options = wrapper.findAll('[data-testid="mc-time-column"] option').map((option) => option.text())
    expect(options).toEqual(['请选择'])
    expect(timeColumnValue(wrapper)).toBe('')

    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining('入库时间字段'))
    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const saved = mocks.saveMonitor.mock.calls[0]![0] as { conf: MonitorCheckConf }
    expect(saved.conf.timeColumn).toBeUndefined()
  })
})

describe('MonitorConfigEditor 检查窗口', () => {
  it('打开已有记录时回填 window（hours）', async () => {
    const wrapper = mountEditor({ record: timeColumnRecord() })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    expect(wrapper.find('[data-testid="mc-window-hours"]').classes()).toContain('active')
    expect((wrapper.find('[data-testid="mc-window-hours-input"]').element as HTMLInputElement).value).toBe('6')
    expect(wrapper.find('[data-testid="mc-window-hint"]').text()).toContain('最近 6 小时')
  })

  it('保存把 timeColumn 与 window 写进 checkConf，未识别键整包保留', async () => {
    const record = timeColumnRecord()
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()

    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    expect(mocks.saveMonitor).toHaveBeenCalledTimes(1)
    const saved = mocks.saveMonitor.mock.calls[0]![0] as { conf: MonitorCheckConf }
    expect(saved.conf.timeColumn).toBe('CREATE_DT')
    expect(saved.conf.window).toEqual({ type: 'hours', hours: 6 })
    expect(saved.conf.customKey).toBe('keep-me')
    expect(ElMessage.warning).not.toHaveBeenCalledWith(expect.stringContaining('入库时间字段'))
  })

  it('窗口切到 hours 后保存写 {type:"hours", hours:N}（N 夹到 1–720）', async () => {
    const record = aiRecord()
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    await wrapper.find('[data-testid="mc-window-hours"]').trigger('click')
    await wrapper.find('[data-testid="mc-window-hours-input"]').setValue('999')
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    const saved = mocks.saveMonitor.mock.calls[0]![0] as { conf: MonitorCheckConf }
    expect(saved.conf.window).toEqual({ type: 'hours', hours: 720 })
  })

  it('「上一个周期」按当前计划间隔算 periodHours', async () => {
    const record = aiRecord()
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')

    await wrapper.find('[data-testid="mc-window-period"]').trigger('click')
    expect(wrapper.find('[data-testid="mc-window-hint"]').text()).toContain('约 1 小时')
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    const saved = mocks.saveMonitor.mock.calls[0]![0] as { conf: MonitorCheckConf }
    expect(saved.conf.window).toEqual({ type: 'period', periodHours: 1 })
  })

  it('未配置窗口时默认「当日」，保存写 {type:"today"}', async () => {
    const record = aiRecord()
    mocks.loadMonitorRecord.mockResolvedValue(record)
    const wrapper = mountEditor({ record })
    await settle()

    expect(wrapper.find('[data-testid="mc-window-today"]').classes()).toContain('active')
    await wrapper.find('[data-testid="mc-save"]').trigger('click')
    await settle()

    const saved = mocks.saveMonitor.mock.calls[0]![0] as { conf: MonitorCheckConf }
    expect(saved.conf.window).toEqual({ type: 'today' })
  })
})

describe('MonitorConfigEditor 生成提示词注入真实列', () => {
  it('把主表真实字段与入库时间列拼进 systemPrompt，避免模型臆造列名', async () => {
    mocks.resolveTableFields.mockResolvedValue(['title', 'publish_time', 'CREATE_DT'])
    const record = aiRecord({ conf: { ...aiRecord().conf, timeColumn: 'CREATE_DT' } })
    const wrapper = mountEditor({ record })
    await settle()
    await wrapper.find('[data-testid="mc-tab-check"]').trigger('click')
    await wrapper.find('[data-testid="mc-generate"]').trigger('click')
    await settle()

    const payload = vi.mocked(ruleApi.dataProcessGenerate).mock.calls[0]![0] as { systemPrompt: string }
    expect(payload.systemPrompt).toContain('该表真实字段：title, publish_time, CREATE_DT（只能用这些列名，不要臆造）')
    expect(payload.systemPrompt).toContain('按 CREATE_DT 统计入库时间')
  })
})

describe('MonitorConfigEditor 通知渠道：钉钉暂不支持', () => {
  it('新建时钉钉禁用并标「暂不支持」，提示只支持邮件', async () => {
    const wrapper = mountEditor()
    await settle()

    const ding = wrapper.get('[data-testid="mc-channel-dingtalk"]')
    expect(ding.attributes('disabled')).toBeDefined()
    expect((ding.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('[data-testid="mc-panel-notify"]').text()).toContain('暂不支持')
    expect(wrapper.get('[data-testid="mc-panel-notify"]').text()).toContain('目前只支持邮件通知')
    expect(wrapper.find('[data-testid="mc-dingtalk-warn"]').exists()).toBe(false)
  })

  it('恢复通知标「暂不支持」，「仅正常时」说明是每次通过都通知', async () => {
    const wrapper = mountEditor()
    await settle()
    expect(wrapper.get('[data-testid="mc-recovery"]').text()).toContain('暂不支持')
    expect(wrapper.text()).toContain('每次检查通过都通知')
    expect(wrapper.text()).not.toContain('恢复或正常时通知')
  })

  it('历史记录只勾了钉钉：可取消勾选，并提示收不到任何通知；取消后不能再选回', async () => {
    const record = aiRecord()
    record.conf = { ...record.conf, channels: ['dingtalk'] }
    const wrapper = mountEditor({ record })
    await settle()

    const ding = wrapper.get('[data-testid="mc-channel-dingtalk"]')
    expect(ding.attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="mc-dingtalk-warn"]').text()).toContain('不会收到任何通知')

    await ding.setValue(false)
    expect(wrapper.find('[data-testid="mc-dingtalk-warn"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="mc-channel-dingtalk"]').attributes('disabled')).toBeDefined()
  })

  it('历史记录同时勾了邮件和钉钉：提示只会发邮件', async () => {
    const record = aiRecord()
    record.conf = { ...record.conf, channels: ['mail', 'ding'] }
    const wrapper = mountEditor({ record })
    await settle()

    expect(wrapper.get('[data-testid="mc-dingtalk-warn"]').text()).toContain('只会发邮件')
  })
})
