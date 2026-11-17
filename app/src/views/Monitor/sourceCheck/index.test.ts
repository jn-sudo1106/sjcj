// @vitest-environment jsdom
// 源维度列表（1110 §3.2）页面行为回归：一行一源、未配置源出行、目录降级、
// 筛选/刷新保留上下文、单源展开、批量只作用勾选、日志抽屉按记录 id 打开、新增直接进编辑器选源。
// 断言只依赖对外可见的文案、接口参数与暴露方法，不触碰内部实现。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ElementPlus, { ElMessageBox } from 'element-plus'
import type { MonitorRecordView, MonitorSourceRow } from '@/api/types/monitorCenter'
import { deleteSourceCheck } from '@/api/monitor'
import type { MonitorSourceOption } from '@/api/monitorCenter'
import {
  listMonitors,
  listMonitorsOfSource,
  listSourceNames,
  listSourceOptions,
  listSourceSummary,
  loadSourceSummaryStats,
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
    // 统计不 mock 时走真实请求，在 jsdom 里一直挂起，加载态永远收不起来
    loadSourceSummaryStats: vi.fn(),
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
// 通知回执抽屉走 ref.show(sourceId, monitorId, monitorName)，只记录调用参数
const notifyCalls: string[] = []

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
  // 通知回执抽屉：只断言「打开时带了哪个范围」，不依赖其内部实现
  CheckNotificationsDrawer: defineComponent({
    name: 'CheckNotificationsDrawer',
    setup(_props, { expose }) {
      expose({
        show: (sourceId: string, jobId?: string, monitorName?: string) => {
          notifyCalls.push(`${sourceId}|${jobId ?? ''}|${monitorName ?? ''}`)
        },
      })
      return () => h('div', { class: 'stub-notify' })
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
  notifyCalls.length = 0
  editorDirty.mockReturnValue(false)
  mockedListMonitors.mockResolvedValue([rec()])
  mockedListOfSource.mockResolvedValue([rec()])
  mockedListSources.mockResolvedValue(directory)
  mockedListNames.mockResolvedValue([])
  mockedSummary.mockResolvedValue({ total: 0, rows: [], unavailable: true })
  vi.mocked(loadSourceSummaryStats).mockResolvedValue({
    available: false, totalSources: 0, configuredSources: 0, enabledSources: 0,
    abnormalSources: 0, uncheckedSources: 0, notConfiguredSources: 0,
  })
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

  it('检查对象列按 scopeType 显示：源结果 / 节点环节 / 未分类（缺键不推断）', async () => {
    mockedListMonitors.mockResolvedValue([
      rec({ id: 'm1', name: '源结果检查', conf: { scopeType: 'source_result' } }),
      rec({ id: 'm2', name: '节点检查', conf: { scopeType: 'node_input' } }),
      rec({ id: 'm3', name: '旧记录检查', conf: {} }),
    ])
    mockedListSources.mockResolvedValue([{ sourceId: 's1', name: '源一' }])
    const wrapper = await mountPage()
    await wrapper.findAll('.el-table__expand-icon')[0].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('检查对象')
    const tags = wrapper.findAll('.sc-object-tag')
    expect(tags.map((item) => item.text())).toEqual(['源结果', '节点环节', '未分类'])
    // 未分类必须是中性灰（is-none），不能用源结果/节点环节的样式
    expect(tags[2].classes()).toContain('is-none')
    expect(tags[0].classes()).toContain('is-source')
    expect(tags[1].classes()).toContain('is-node')
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

  it('通知入口与「记录」同样按监控记录 id 打开回执抽屉', async () => {
    const wrapper = await mountExpanded()
    await buttonByText(wrapper, '通知').trigger('click')
    await nextTick()
    expect(notifyCalls.at(-1)).toBe('s1|m1|检查项A')
  })
})

describe('检查对象筛选', () => {
  /** 一个源 5 项检查：2 源结果 + 2 节点环节 + 1 旧记录（未分类）；另一个源只有 1 项节点环节 */
  function scopeRecords(): MonitorRecordView[] {
    return [
      rec({ id: 'm1', sourceId: 's1', sourceName: '源一', name: '源结果甲', conf: { scopeType: 'source_result' } }),
      rec({ id: 'm2', sourceId: 's1', sourceName: '源一', name: '源结果乙', conf: { scopeType: 'source_result' } }),
      rec({ id: 'm3', sourceId: 's1', sourceName: '源一', name: '节点甲', conf: { scopeType: 'node_input' } }),
      rec({ id: 'm4', sourceId: 's1', sourceName: '源一', name: '节点乙', conf: { scopeType: 'node_input' } }),
      rec({ id: 'm5', sourceId: 's1', sourceName: '源一', name: '旧记录', conf: {} }),
      rec({ id: 'm6', sourceId: 's2', sourceName: '源二', name: '源二节点', conf: { scopeType: 'node_input' } }),
    ]
  }

  function outerRows(wrapper: VueWrapper): Array<{ sourceId: string }> {
    const table = wrapper.findAllComponents({ name: 'ElTable' })[0]
    return table.props('data') as Array<{ sourceId: string }>
  }

  async function applyScope(wrapper: VueWrapper, value: string): Promise<void> {
    selectByPlaceholder(wrapper, '检查对象').vm.$emit('update:modelValue', value)
    await buttonByText(wrapper, '查询').trigger('click')
    await flushPromises()
  }

  async function expandFirst(wrapper: VueWrapper): Promise<void> {
    await wrapper.findAll('.el-table__expand-icon')[0].trigger('click')
    await flushPromises()
  }

  function innerNames(wrapper: VueWrapper): string[] {
    return wrapper.findAll('.sc-inner-table .sc-name').map((item) => item.text())
  }

  it('四态筛选：只列命中检查项，无匹配源整行隐藏，行内计数写清「已筛选 N / 共 M」', async () => {
    const cases = [
      {
        value: 'all',
        rows: ['s1', 's2'],
        items: ['源结果甲', '源结果乙', '节点甲', '节点乙', '旧记录'],
        count: '5 项检查',
      },
      {
        value: 'source_result',
        // 源二只有节点环节检查：整行隐藏
        rows: ['s1'],
        items: ['源结果甲', '源结果乙'],
        count: '已筛选 2 / 共 5 项检查',
      },
      {
        value: 'node_input',
        rows: ['s1', 's2'],
        items: ['节点甲', '节点乙'],
        count: '已筛选 2 / 共 5 项检查',
      },
      {
        // 旧记录 scopeType 缺省：只在「未分类」里出现，不被推断成源结果
        value: 'unclassified',
        rows: ['s1'],
        items: ['旧记录'],
        count: '已筛选 1 / 共 5 项检查',
      },
    ]

    for (const item of cases) {
      mockedListMonitors.mockResolvedValue(scopeRecords())
      const wrapper = await mountPage()
      if (item.value !== 'all') {
        await applyScope(wrapper, item.value)
      }
      expect(outerRows(wrapper).map((row) => row.sourceId)).toEqual(item.rows)

      await expandFirst(wrapper)
      expect(innerNames(wrapper)).toEqual(item.items)
      expect(wrapper.get('[data-testid="sc-scope-count"]').text()).toBe(item.count)
      // 源级计数按筛选后的源数走，不能还显示全站/未过滤的源数
      expect(wrapper.text()).toMatch(new RegExp(`共\\s*${item.rows.length}\\s*个源`))
      wrapper.unmount()
    }
  })

  it('筛选生效时给出说明，且不再显示「服务端按源聚合」提示', async () => {
    mockedListMonitors.mockResolvedValue(scopeRecords())
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="sc-scope-filter-hint"]').exists()).toBe(false)

    await applyScope(wrapper, 'source_result')
    expect(wrapper.find('[data-testid="sc-scope-filter-hint"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('只显示含该类检查项的源')
    expect(wrapper.text()).toContain('源结果检查')
  })

  it('服务端聚合可用时按检查对象筛选：退回本地过滤，计数与展示行一致（不拿服务端总数冒充）', async () => {
    mockedListMonitors.mockResolvedValue([
      rec({ id: 'm1', sourceId: 's1', sourceName: '源一', conf: { scopeType: 'source_result' } }),
      rec({ id: 'm2', sourceId: 's2', sourceName: '源二', conf: { scopeType: 'node_input' } }),
    ])
    mockedSummary.mockResolvedValue({
      total: 2,
      unavailable: false,
      rows: [
        {
          sourceId: 's1',
          sourceName: '源一',
          monitorTotal: 1,
          monitorEnabled: 1,
          coverage: null,
          coverageUnavailable: true,
          data: 'normal' as const,
          exec: 'unknown' as const,
          notifyFailures: 0,
          label: '数据正常',
          tone: 'good' as const,
          monitors: [],
          unconfigured: false,
        },
        {
          sourceId: 's2',
          sourceName: '源二',
          monitorTotal: 1,
          monitorEnabled: 1,
          coverage: null,
          coverageUnavailable: true,
          data: 'unknown' as const,
          exec: 'unknown' as const,
          notifyFailures: 0,
          label: '尚未检查',
          tone: 'unknown' as const,
          monitors: [],
          unconfigured: false,
        },
      ],
    })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="sc-summary-hint"]').exists()).toBe(true)

    await applyScope(wrapper, 'source_result')
    // 检查对象是检查项属性，服务端按源聚合装不下：筛选期间回到本地分页，计数才能和展示行一致
    expect(wrapper.find('[data-testid="sc-summary-hint"]').exists()).toBe(false)
    expect(outerRows(wrapper).map((row) => row.sourceId)).toEqual(['s1'])
    expect(wrapper.text()).toMatch(/共\s*1\s*个源/)
  })

  it('超期策略：配了预期周期才渲染「每 N 分钟」，宽限只写在 title 里', async () => {
    mockedListMonitors.mockResolvedValue([
      rec({
        id: 'm1',
        name: '配宽限',
        conf: { overduePolicy: { expectEveryMinutes: 60, graceMinutes: 10 } },
      }),
      rec({ id: 'm2', name: '只有周期', conf: { overduePolicy: { expectEveryMinutes: 30 } } }),
      // 没配 overduePolicy / 周期非正数：都不出徽标，不凭空给周期
      rec({ id: 'm3', name: '没配', conf: {} }),
      rec({ id: 'm4', name: '周期非法', conf: { overduePolicy: { expectEveryMinutes: 0 } } }),
    ])
    const wrapper = await mountPage()
    await expandFirst(wrapper)

    const tags = wrapper.findAll('[data-testid="sc-overdue-tag"]')
    expect(tags.map((tag) => tag.text())).toEqual(['每 60 分钟', '每 30 分钟'])
    expect(tags[0].attributes('title')).toBe('超期无新增：预期每 60 分钟更新一次，宽限 10 分钟')
    expect(tags[1].attributes('title')).toBe('超期无新增：预期每 30 分钟更新一次，未配置宽限')
    expect(wrapper.text()).not.toContain('每 0 分钟')
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

describe('源行流程关联与执行结论（1113）', () => {
  /** 服务端聚合行：只覆盖本组断言用到的字段，其余按接口契约给默认值 */
  function sourceRow(patch: Partial<MonitorSourceRow> & { sourceId: string }): MonitorSourceRow {
    return {
      sourceName: '上市公司新闻',
      tableName: 'sense_data.news_main',
      siteName: '财经资讯站',
      monitorTotal: 1,
      monitorEnabled: 1,
      coverage: null,
      coverageUnavailable: true,
      data: 'normal',
      exec: 'unknown',
      notifyFailures: 0,
      label: '数据正常',
      tone: 'good',
      monitors: [],
      unconfigured: false,
      ...patch,
    }
  }

  // 翻页竞态（2026-11-16）：翻页只重取聚合，不能沿用同一序号——快速翻页时慢的旧页回来不能盖掉新页
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
  }
  type SummaryResult = Awaited<ReturnType<typeof listSourceSummary>>
  // el-loading 的遮罩在 jsdom 里等不到过渡结束不会移除，直接读页面的加载态
  const busy = (wrapper: VueWrapper) => {
    const vm = wrapper.vm as unknown as { loading: boolean, pageLoading: boolean }
    return vm.loading || vm.pageLoading
  }
  const pageOf = (name: string): SummaryResult => ({ total: 90, unavailable: false, rows: [sourceRow({ sourceId: name, sourceName: name })] })

  it('快速翻页：第 2 页慢、第 3 页先回，最终表格停在第 3 页', async () => {
    mockedSummary.mockResolvedValue(pageOf('第一页源'))
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('第一页源')

    const page2 = deferred<SummaryResult>()
    const page3 = deferred<SummaryResult>()
    mockedSummary.mockReturnValueOnce(page2.promise).mockReturnValueOnce(page3.promise)
    const pager = wrapper.findComponent({ name: 'ElPagination' })
    pager.vm.$emit('current-change', 2)
    pager.vm.$emit('current-change', 3)
    expect(mockedSummary.mock.calls.at(-2)?.[0]).toMatchObject({ page: 2 })
    expect(mockedSummary.mock.calls.at(-1)?.[0]).toMatchObject({ page: 3 })

    page3.resolve(pageOf('第三页源'))
    await flushPromises()
    page2.resolve(pageOf('第二页源'))
    await flushPromises()

    expect(wrapper.text()).toContain('第三页源')
    expect(wrapper.text()).not.toContain('第二页源')
    wrapper.unmount()
  })

  it('翻页期间表格显示加载态，最新一页回来后收起', async () => {
    mockedSummary.mockResolvedValue(pageOf('第一页源'))
    const wrapper = await mountPage()
    const next = deferred<SummaryResult>()
    mockedSummary.mockReturnValueOnce(next.promise)

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await nextTick()
    expect(busy(wrapper)).toBe(true)
    expect(wrapper.find('.el-loading-mask').exists()).toBe(true)

    next.resolve(pageOf('第二页源'))
    await flushPromises()
    expect(busy(wrapper)).toBe(false)
    expect(wrapper.text()).toContain('第二页源')
    wrapper.unmount()
  })

  it('翻页后整体刷新：旧的翻页响应晚回也不能覆盖刷新结果', async () => {
    mockedSummary.mockResolvedValue(pageOf('第一页源'))
    const wrapper = await mountPage()
    const slowPage = deferred<SummaryResult>()
    mockedSummary.mockReturnValueOnce(slowPage.promise).mockResolvedValueOnce(pageOf('刷新后的源'))

    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
    await wrapper.find('button[title="保留当前筛选与分页大小重新查询"]').trigger('click')
    await flushPromises()
    slowPage.resolve(pageOf('迟到的旧页'))
    await flushPromises()

    expect(wrapper.text()).toContain('刷新后的源')
    expect(wrapper.text()).not.toContain('迟到的旧页')
    expect(busy(wrapper)).toBe(false)
    wrapper.unmount()
  })

  it('flowId 缺省时显示「未关联流程」：title 说明只影响触发方式，不影响生成检查', async () => {
    mockedSummary.mockResolvedValue({ total: 1, unavailable: false, rows: [sourceRow({ sourceId: 's1' })] })
    const wrapper = await mountPage()

    const tag = wrapper.get('[data-testid="sc-flow-unbound-tag"]')
    expect(tag.text()).toBe('未关联流程')
    const title = tag.attributes('title') ?? ''
    expect(title).toContain('不会随采集流程触发')
    expect(title).toContain('不影响生成检查')
    // 轻量分类信息，不能用错误色
    expect(tag.classes()).not.toContain('is-err')
    wrapper.unmount()
  })

  it('有 flowId 时不显示「未关联流程」', async () => {
    mockedSummary.mockResolvedValue({
      total: 1,
      unavailable: false,
      rows: [sourceRow({ sourceId: 's1', flowId: 'flow-9' })],
    })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="sc-flow-unbound-tag"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('本地聚合拿不到 flowId 时不臆造「未关联流程」', async () => {
    // 默认 listSourceSummary 返回 unavailable → 回到 summarizeSources，行上没有 flowId 字段
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="sc-flow-unbound-tag"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('执行结论徽标：failed/succeeded/unknown 出徽标、none 不渲染，title 写清判定口径', async () => {
    mockedSummary.mockResolvedValue({
      total: 4,
      unavailable: false,
      rows: [
        sourceRow({ sourceId: 's1', exec: 'failed' }),
        sourceRow({ sourceId: 's2', exec: 'succeeded' }),
        sourceRow({ sourceId: 's3', exec: 'unknown' }),
        sourceRow({ sourceId: 's4', exec: 'none' }),
      ],
    })
    const wrapper = await mountPage()

    const badges = wrapper.findAll('[data-testid="sc-exec-badge"]')
    // none（没有启用中的检查项）不渲染；其余三种各一条
    expect(badges).toHaveLength(3)
    expect(badges.map((badge) => badge.text())).toEqual(['执行失败', '执行正常', '未执行'])
    expect(badges[0].classes()).toContain('is-err')
    expect(badges[1].classes()).toContain('is-ok')
    expect(badges[2].classes()).toContain('is-muted')
    for (const badge of badges) {
      expect(badge.attributes('title')).toContain('按该源启用中检查项最近一次运行判定')
    }
    // 原有的数据结论（label/tone）照旧展示，不因徽标被替换
    expect(wrapper.text()).toContain('数据正常')
    expect(wrapper.text()).toMatch(/共\s*4\s*个源/)
    wrapper.unmount()
  })
})
