// @vitest-environment jsdom
// 源维度列表（1110 §3.2）页面行为回归：一行一源、未配置源出行、目录降级、
// 筛选/刷新保留上下文、单源展开、批量只作用勾选、日志抽屉按记录 id 打开、新增直接进编辑器选源。
// 断言只依赖对外可见的文案、接口参数与暴露方法，不触碰内部实现。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import type { MonitorRecordView } from '@/api/types/monitorCenter'
import { deleteSourceCheck } from '@/api/monitor'
import type { MonitorSourceOption } from '@/api/monitorCenter'
import {
  listMonitors,
  listMonitorsOfSource,
  listSourceNames,
  listSourceOptions,
  listSourceSummary,
  runMonitorsNow,
  setMonitorsEnabled,
} from '@/api/monitorCenter'
import SourceCheckPage from './index.vue'

// Element Plus 的表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

// confirmDanger 真实实现要弹 ElMessageBox（jsdom 里点不到「确认」），测试直接放行动作本身
vi.mock('@/utils/confirmDanger', () => ({
  confirmDanger: (_title: string, _body: string, run: () => Promise<unknown>) => run(),
  confirmOrRun: (_need: boolean, _t: string, _b: string, run: () => Promise<unknown>) => run(),
}))

vi.mock('@/api/monitor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/monitor')>()),
  deleteSourceCheck: vi.fn(),
}))

vi.mock('@/api/monitorCenter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/monitorCenter')>()
  return {
    ...actual,
    listMonitors: vi.fn(),
    listMonitorsOfSource: vi.fn(),
    listSourceOptions: vi.fn(),
    listSourceNames: vi.fn(),
    // C07 首期聚合：默认「服务端未部署」，测试按需覆盖
    listSourceSummary: vi.fn(),
    setMonitorsEnabled: vi.fn(),
    runMonitorsNow: vi.fn(),
  }
})

const mockedListMonitors = vi.mocked(listMonitors)
const mockedListOfSource = vi.mocked(listMonitorsOfSource)
const mockedListSources = vi.mocked(listSourceOptions)
const mockedListNames = vi.mocked(listSourceNames)
const mockedSummary = vi.mocked(listSourceSummary)
const mockedSetEnabled = vi.mocked(setMonitorsEnabled)
const mockedRunNow = vi.mocked(runMonitorsNow)
const mockedDelete = vi.mocked(deleteSourceCheck)

const editorDirty = vi.fn(() => false)

const ElDialogStub = defineComponent({
  name: 'ElDialog',
  props: { modelValue: { type: Boolean, default: false }, title: { type: String, default: '' }, beforeClose: Function },
  emits: ['update:modelValue'],
  template: `<div v-if="modelValue" class="stub-dialog">
    <div class="stub-dialog-title">{{ title }}</div>
    <slot />
    <div class="stub-dialog-footer"><slot name="footer" /></div>
  </div>`,
})

const stubs = {
  ElDialog: ElDialogStub,
  SourceSelect: defineComponent({
    name: 'SourceSelect',
    props: { modelValue: { type: String, default: '' } },
    emits: ['update:modelValue', 'change'],
    template: '<div class="stub-source-select" />',
  }),
  // 统一编辑器：断言「打开时锁了哪个源、是否带记录身份」，不依赖其内部四区实现
  MonitorConfigEditor: defineComponent({
    name: 'MonitorConfigEditor',
    props: {
      siteId: { type: String, default: '' },
      sourceId: { type: String, default: '' },
      record: { type: Object, default: null },
      sourceLocked: { type: Boolean, default: false },
    },
    emits: ['saved', 'cancel'],
    setup(_props, { expose }) {
      expose({ isDirty: editorDirty, isBusy: () => false })
      return () => h('div', { class: 'stub-editor' })
    },
  }),
  // 远程搜索选源器：只断言 emit 的 (sourceId, name)，不依赖其内部接口调用
  SourcePickerRemote: defineComponent({
    name: 'SourcePickerRemote',
    props: {
      modelValue: { type: String, default: '' },
      selectedName: { type: String, default: '' },
      placeholder: { type: String, default: '' },
    },
    emits: ['update:modelValue'],
    setup() {
      return () => h('div', { class: 'stub-source-picker' })
    },
  }),
  // 统一运行抽屉：只断言「打开时带了哪个范围」，不依赖其内部实现
  RunsDrawer: defineComponent({
    name: 'RunsDrawer',
    props: {
      open: { type: Boolean, default: false },
      sourceId: { type: String, default: '' },
      monitorId: { type: String, default: '' },
      title: { type: String, default: '' },
    },
    emits: ['close'],
    setup(props) {
      return () => (props.open ? h('div', { class: 'stub-runs' }, `${props.sourceId}|${props.monitorId}|${props.title}`) : null)
    },
  }),
}

function rec(patch: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: 'm1',
    sourceId: 's1',
    sourceName: '源一',
    name: '检查项A',
    kind: 'ai',
    enabled: true,
    schedule: '0 8 * * *',
    publishStatus: 'ready',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '3',
    conf: { notifyOn: 'error', methods: ['a'] },
    raw: {} as never,
    ...patch,
  }
}

const directory: MonitorSourceOption[] = [
  { sourceId: 's1', name: '源一', siteName: '站A' },
  { sourceId: 's2', name: '未配置源', siteName: '站A' },
]

function buttonByText(wrapper: VueWrapper, text: string): ReturnType<VueWrapper['find']> {
  const found = wrapper.findAll('button').find((item) => item.text().trim() === text)
  if (!found) throw new Error(`找不到按钮：${text}`)
  return found
}

async function mountPage(props: Record<string, string> = {}): Promise<VueWrapper> {
  const wrapper = mount(SourceCheckPage, {
    props,
    global: { plugins: [ElementPlus], stubs },
  })
  await flushPromises()
  return wrapper
}

function selectByPlaceholder(wrapper: VueWrapper, placeholder: string) {
  const found = wrapper
    .findAllComponents({ name: 'ElSelect' })
    .find((item) => item.props('placeholder') === placeholder)
  if (!found) throw new Error(`找不到下拉：${placeholder}`)
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
  editorDirty.mockReturnValue(false)
  mockedListMonitors.mockResolvedValue([rec()])
  mockedListOfSource.mockResolvedValue([rec()])
  mockedListSources.mockResolvedValue(directory)
  mockedListNames.mockResolvedValue([])
  mockedSummary.mockResolvedValue({ total: 0, rows: [], unavailable: true })
  mockedSetEnabled.mockResolvedValue(undefined)
  mockedRunNow.mockResolvedValue({ viaRunner: 0, viaLegacy: 1, runnerSkipped: 0, runnerRunIds: [] })
  mockedDelete.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('一行一源与源目录', () => {
  it('网站上下文传入源目录时，未配置检查的源也出行且不显示绿色正常', async () => {
    const wrapper = await mountPage({ siteId: 'site-1', siteName: '站A' })
    expect(wrapper.text()).toContain('未配置源')
    expect(wrapper.text()).toContain('未配置检查')
    expect(wrapper.text()).toMatch(/共\s*2\s*个源/)
    await buttonByText(wrapper, '展开检查').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(rec().name)
    expect(wrapper.text()).toMatch(/已配置\s*1/)
  })

  it('全局视图不拉全量源目录（避免 20 次串行请求），按已配置源展示并说明', async () => {
    const wrapper = await mountPage()
    expect(mockedListSources).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('按已配置监控的源展示')
    expect(wrapper.text()).toContain('C07')
  })

  it('按源 ID 批量取名，主标题不退化成 ID', async () => {
    mockedListMonitors.mockResolvedValue([rec({ sourceName: undefined })])
    mockedListNames.mockResolvedValue([
      { sourceId: 's1', name: '上市公司新闻', siteName: '财经资讯站', tableName: 'sense_data.news_main' },
    ])
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('上市公司新闻')
    expect(wrapper.text()).toContain('财经资讯站 · sense_data.news_main')
    expect(wrapper.text()).not.toContain('源 s1')
  })

  it('服务端聚合可用时，未配置检查的源也出行并标注未配置', async () => {
    mockedSummary.mockResolvedValue({
      total: 2,
      unavailable: false,
      rows: [
        {
          sourceId: 's1',
          sourceName: '上市公司新闻',
          tableName: 'sense_data.news_main',
          siteName: '财经资讯站',
          monitorTotal: 1,
          monitorEnabled: 1,
          coverage: null,
          coverageUnavailable: true,
          data: 'normal' as const,
          exec: 'unknown' as const,
          notifyFailures: 0,
          lastCheckAt: '2026-11-12 09:00:00',
          label: '数据正常',
          tone: 'good' as const,
          monitors: [],
          unconfigured: false,
        },
        {
          sourceId: 's2',
          sourceName: '港口吞吐量',
          monitorTotal: 0,
          monitorEnabled: 0,
          coverage: null,
          coverageUnavailable: true,
          data: 'unknown' as const,
          exec: 'unknown' as const,
          notifyFailures: 0,
          label: '未配置检查',
          tone: 'muted' as const,
          monitors: [],
          unconfigured: true,
        },
      ],
    })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="sc-summary-hint"]').exists()).toBe(true)
    await buttonByText(wrapper, '展开检查').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain(rec().name)
    expect(wrapper.text()).toContain('物流吞吐量'.slice(0, 0) + '港口吞吐量')
    expect(wrapper.text()).toContain('未配置检查')
    expect(wrapper.text()).toMatch(/共\s*2\s*个源/)
  })

  it('监控记录加载失败时给出错误与重试', async () => {
    mockedListMonitors.mockRejectedValue(new Error('boom'))
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('监控记录加载失败：boom')
    expect(wrapper.text()).toContain('重试')
  })

  it('计划覆盖无聚合数据时显示「—（计划不可推算）」且不按时隙推算', async () => {
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('—（计划不可推算）')
    expect(wrapper.text()).toContain('本页不推算漏跑')
  })

  it('停用源显示已停用，不显示数据正常', async () => {
    mockedListMonitors.mockResolvedValue([rec({ enabled: false, data: 'unknown' })])
    mockedListSources.mockResolvedValue([{ sourceId: 's1', name: '源一' }])
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).not.toContain('数据正常')
  })

  it('源上下文锁定当前源，不加载整份源目录', async () => {
    const wrapper = await mountPage({ sourceId: 's1' })
    expect(mockedListOfSource).toHaveBeenCalledWith('s1')
    expect(mockedListSources).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已锁定到当前源')
  })

  it('网站上下文按网站取源目录并锁定筛选项', async () => {
    const wrapper = await mountPage({ siteId: 'site-1', siteName: '站A' })
    expect(mockedListSources).toHaveBeenCalledWith({ siteId: 'site-1' })
    expect(wrapper.text()).toContain('已锁定到当前网站')
  })
})

describe('筛选与刷新', () => {
  it('按数据情况与关键词筛选，刷新后保留筛选与分页大小', async () => {
    mockedListMonitors.mockResolvedValue([
      rec(),
      rec({ id: 'm2', sourceId: 's2', sourceName: '未配置源', exec: 'failed', data: 'unknown' }),
    ])
    mockedListSources.mockResolvedValue(directory)
    const wrapper = await mountPage()

    selectByPlaceholder(wrapper, '数据情况').vm.$emit('update:modelValue', 'failed')
    const keyword = wrapper.find('input[placeholder="源名称 / ID / 主表"]')
    await keyword.setValue('未配置')
    await buttonByText(wrapper, '查询').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('未配置源')
    expect(wrapper.text()).not.toContain('源一')

    // 分页大小改大后再刷新，不能被重置回默认 30
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('update:page-size', 100)
    await nextTick()
    await wrapper.find('button[title="保留当前筛选与分页大小重新查询"]').trigger('click')
    await flushPromises()

    expect(mockedListMonitors).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent({ name: 'ElPagination' }).props('pageSize')).toBe(100)
    expect(wrapper.text()).toContain('未配置源')
    expect(wrapper.text()).not.toContain('源一')
  })
})

describe('行内展开与批量', () => {
  async function mountExpanded(): Promise<VueWrapper> {
    mockedListMonitors.mockResolvedValue([
      rec(),
      rec({ id: 'm2', name: '检查项B' }),
      rec({ id: 'm3', sourceId: 's2', sourceName: '源二', name: '检查项C' }),
    ])
    mockedListSources.mockResolvedValue([
      { sourceId: 's1', name: '源一' },
      { sourceId: 's2', name: '源二' },
    ])
    const wrapper = await mountPage()
    await wrapper.findAll('.el-table__expand-icon')[0].trigger('click')
    await flushPromises()
    return wrapper
  }

  it('同时只展开当前源，切源后前一个源收起', async () => {
    const wrapper = await mountExpanded()
    expect(wrapper.findAll('.sc-inner')).toHaveLength(1)
    expect(wrapper.text()).toContain('检查项A')

    await wrapper.findAll('.el-table__expand-icon')[1].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.sc-inner')).toHaveLength(1)
    expect(wrapper.text()).toContain('检查项C')
    expect(wrapper.text()).not.toContain('检查项A')
  })

  it('编辑打开时带记录身份并锁源（否则会另存成重复记录）', async () => {
    const wrapper = await mountExpanded()
    await buttonByText(wrapper, '编辑').trigger('click')
    await flushPromises()

    const editor = wrapper.findComponent({ name: 'MonitorConfigEditor' })
    expect(editor.exists()).toBe(true)
    expect(editor.props('sourceId')).toBe('s1')
    expect(editor.props('sourceLocked')).toBe(true)
    // 必须是视图记录（按 monitorId 保存），不是旧接口原始行
    expect((editor.props('record') as MonitorRecordView).id).toBe('m1')
  })

  it('批量操作只作用已勾选的检查项', async () => {
    const wrapper = await mountExpanded()
    const innerTable = wrapper.findAllComponents({ name: 'ElTable' })[1]
    innerTable.vm.$emit('selection-change', [rec({ id: 'm2', name: '检查项B' })])
    await nextTick()

    await buttonByText(wrapper, '启用所选').trigger('click')
    await flushPromises()
    expect(mockedSetEnabled).toHaveBeenCalledWith(['m2'], true)

    const innerTableAfter = wrapper.findAllComponents({ name: 'ElTable' })[1]
    innerTableAfter.vm.$emit('selection-change', [rec({ id: 'm2', name: '检查项B' })])
    await nextTick()
    await buttonByText(wrapper, '删除所选').trigger('click')
    await flushPromises()
    expect(mockedDelete).toHaveBeenCalledWith(['m2'])
  })

  it('记录入口按监控记录 id 打开运行抽屉，不传旧 jobId', async () => {
    const wrapper = await mountExpanded()
    await buttonByText(wrapper, '记录').trigger('click')
    await nextTick()
    // sourceId | monitorId | title：monitorId 必须是监控记录 id（旧日志 jobId 就是 ckSource.id）
    expect(wrapper.find('.stub-runs').text()).toBe('s1|m1|检查项A')

    await buttonByText(wrapper, '结果').trigger('click')
    await nextTick()
    // 源级入口只带 sourceId，不带 monitorId，也不沿用上一条检查项名
    expect(wrapper.find('.stub-runs').text()).toBe('s1||')
  })
})

describe('新增监控', () => {
  it('保存回读未知时保留候选，回读成功后关闭且新增不带旧记录', async () => {
    const wrapper = await mountPage()
    await buttonByText(wrapper, '新增监控').trigger('click')
    await flushPromises()
    const editor = wrapper.getComponent({ name: 'MonitorConfigEditor' })
    editor.vm.$emit('saved', null)
    await flushPromises()
    expect(wrapper.find('.stub-editor').exists()).toBe(true)
    editor.vm.$emit('saved', rec({ id: 'new-monitor' }))
    await flushPromises()
    expect(wrapper.find('.stub-editor').exists()).toBe(false)
    await buttonByText(wrapper, '新增监控').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent({ name: 'MonitorConfigEditor' }).props('record')).toBeNull()
    wrapper.unmount()
  })

  it('关窗选择继续编辑后必须保留弹窗及未保存草稿', async () => {
    const wrapper = await mountPage()
    await buttonByText(wrapper, '新增监控').trigger('click')
    await flushPromises()
    editorDirty.mockReturnValue(true)
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const close = wrapper.getComponent(ElDialogStub).props('beforeClose') as (done: () => void) => Promise<void>
    const done = vi.fn()
    await close(done)
    expect(done).not.toHaveBeenCalled()
    expect(wrapper.find('.stub-editor').exists()).toBe(true)
    wrapper.unmount()
  })

  it('全局视图直接进编辑器选源（不再多一层「先选择源」弹窗）', async () => {
    const wrapper = await mountPage()

    await buttonByText(wrapper, '新增监控').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('新增监控 · 先选择源')
    const editor = wrapper.findComponent({ name: 'MonitorConfigEditor' })
    expect(editor.exists()).toBe(true)
    // 全局入口：源为空、不锁源，由编辑器里的远程搜索选
    expect(editor.props('sourceId')).toBe('')
    expect(editor.props('record')).toBeNull()
    expect(editor.props('sourceLocked')).toBe(false)
  })

  it('源上下文直接打开新增，不需要再选源', async () => {
    const wrapper = await mountPage({ sourceId: 's1' })
    await buttonByText(wrapper, '新增监控').trigger('click')
    await flushPromises()
    const editor = wrapper.findComponent({ name: 'MonitorConfigEditor' })
    expect(editor.exists()).toBe(true)
    expect(editor.props('sourceId')).toBe('s1')
    expect(editor.props('record')).toBeNull()
  })
})
