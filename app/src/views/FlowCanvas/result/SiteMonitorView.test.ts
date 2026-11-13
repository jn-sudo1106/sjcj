// @vitest-environment jsdom
// 源内 / 网站监控视图容器（1111 去双 Tab 后的一页式实现）。
//
// 这里测容器接线，不测子组件内部：
//   - 源内：源只来自 props（无换源）、6 项信息条 + 最差事实走 summarizeSource、检查项/最近运行挂载；
//   - 网站：只按 siteId 列本站源，7 项摘要全部占位，不混入其他网站的源；
//   - 运行抽屉统一开 fe-runs 的 RunsDrawer（sourceId / monitorId 两种范围）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { MonitorRecordView } from '@/api/types/monitorCenter'
import { siteApi, sourceApi, type Source } from '@/api'
import { listMonitors, listMonitorsOfSource, setMonitorsEnabled } from '@/api/monitorCenter'
import SiteMonitorView from './SiteMonitorView.vue'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>()
  return {
    ...actual,
    sourceApi: { ...actual.sourceApi, sourceDetail: vi.fn() },
    siteApi: { ...actual.siteApi, siteSources: vi.fn() },
  }
})
vi.mock('@/api/monitorCenter', () => ({
  listMonitors: vi.fn(),
  listMonitorsOfSource: vi.fn(),
  setMonitorsEnabled: vi.fn(),
  listRuns: vi.fn(),
}))

const sourceDetailMock = vi.mocked(sourceApi.sourceDetail)
const siteSourcesMock = vi.mocked(siteApi.siteSources)
const listMonitorsMock = vi.mocked(listMonitors)
const listOfSourceMock = vi.mocked(listMonitorsOfSource)
const setEnabledMock = vi.mocked(setMonitorsEnabled)

function monitor(over: Partial<MonitorRecordView> = {}): MonitorRecordView {
  return {
    id: 'm-1',
    sourceId: 'src-1',
    sourceName: '源一',
    name: '日增量监控',
    tableName: 'sense_data.tb_jjjk',
    kind: 'ai',
    enabled: true,
    schedule: '0 0 * * * ?',
    nextRun: '2026-11-11 12:00:00',
    lastRun: '2026-11-11 11:00:00',
    publishStatus: 'ready',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    lastCheckAt: '2026-11-11 11:00:46',
    count: '1240',
    conf: { methods: ['rowCount'] },
    raw: {} as never,
    ...over,
  }
}

function source(id: string, over: Partial<Source> = {}): Source {
  return {
    sourceId: id,
    name: `源${id}`,
    url: '',
    configId: '',
    mainTable: `sense_data.${id}`,
    owner: 'admin',
    state: 'C',
    ...over,
  }
}

const ConfigStub = defineComponent({
  name: 'SiteMonitorConfigView',
  props: ['siteId', 'sourceId', 'monitors', 'loading', 'error', 'togglingId'],
  emits: ['saved', 'toggle', 'runs', 'retry'],
  template: '<div data-testid="config-panel" :data-source-id="sourceId" />',
})

const ResultStub = defineComponent({
  name: 'SiteMonitorResultView',
  props: ['sourceId', 'title'],
  emits: ['all', 'detail'],
  data: () => ({ refreshCalls: 0 }),
  methods: {
    async refresh() {
      this.refreshCalls += 1
    },
  },
  template: '<div data-testid="result-panel" :data-source-id="sourceId" />',
})

const RunsDrawerStub = defineComponent({
  name: 'RunsDrawer',
  props: ['open', 'sourceId', 'monitorId', 'title', 'initialRun'],
  emits: ['close'],
  template:
    '<div v-if="open" data-testid="runs-drawer" :data-source-id="sourceId" :data-monitor-id="monitorId" :data-title="title" />',
})

const stubs = {
  SiteMonitorConfigView: ConfigStub,
  SiteMonitorResultView: ResultStub,
  RunsDrawer: RunsDrawerStub,
}

function mountSource(sourceId = 'src-1') {
  return mount(SiteMonitorView, {
    props: { siteId: 'site-4', sourceId },
    global: { stubs },
  })
}

function mountSite() {
  return mount(SiteMonitorView, {
    props: { siteId: 'site-4' },
    global: { stubs },
  })
}

beforeEach(() => {
  sourceDetailMock.mockReset()
  siteSourcesMock.mockReset()
  listMonitorsMock.mockReset()
  listOfSourceMock.mockReset()
  setEnabledMock.mockReset()

  sourceDetailMock.mockResolvedValue(source('src-1', { name: '源一', siteName: '测试网站' }))
  siteSourcesMock.mockResolvedValue([source('src-a', { name: '源 A', siteName: '网站四' }), source('src-b', { name: '源 B', siteName: '网站四' })])
  listMonitorsMock.mockResolvedValue([])
  listOfSourceMock.mockResolvedValue([monitor()])
  setEnabledMock.mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('SiteMonitorView · 源内视图（锁源）', () => {
  it('按 props 的 sourceId 加载监控，页面不提供换源下拉', async () => {
    const wrapper = mountSource()
    await flushPromises()

    expect(listOfSourceMock).toHaveBeenCalledWith('src-1')
    expect(sourceDetailMock).toHaveBeenCalledWith('src-1')
    expect(wrapper.findComponent({ name: 'SiteSourceSelect' }).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('切换源')
    expect(wrapper.text()).not.toContain('监控结果')
    expect(wrapper.text()).not.toContain('监控配置')
  })

  it('源信息条固定 6 项：源/网站/主表/检查项/最近检查/所选日期覆盖', async () => {
    const wrapper = mountSource()
    await flushPromises()

    const facts = wrapper.get('[data-testid="site-monitor-facts"]')
    const labels = facts.findAll('dt').map((node) => node.text())
    expect(labels).toEqual(['源', '网站', '主表', '检查项', '最近检查', '所选日期覆盖'])
    expect(wrapper.get('[data-testid="site-monitor-fact-source"]').text()).toContain('源一（src-1）')
    expect(wrapper.get('[data-testid="site-monitor-fact-site"]').text()).toContain('测试网站')
    expect(wrapper.get('[data-testid="site-monitor-fact-table"]').text()).toContain('sense_data.src-1')
    expect(wrapper.get('[data-testid="site-monitor-fact-checks"]').text()).toContain('1 启用 ／ 1 项')
    expect(wrapper.get('[data-testid="site-monitor-fact-last"]').text()).toContain('2026-11-11 11:00:46')
    expect(wrapper.get('[data-testid="site-monitor-fact-coverage"]').text()).toContain('—（需服务端聚合）')
  })

  it('顶部最差事实直接用 summarizeSource：无检查项 = 未配置检查', async () => {
    listOfSourceMock.mockResolvedValue([])
    const wrapper = mountSource()
    await flushPromises()

    const worst = wrapper.get('[data-testid="site-monitor-worst"]')
    expect(worst.text()).toContain('未配置检查')
    expect(worst.attributes('data-tone')).toBe('muted')
    expect(wrapper.get('[data-testid="site-monitor-fact-checks"]').text()).toContain('0 启用 ／ 0 项')
    expect(wrapper.get('[data-testid="site-monitor-fact-last"]').text()).toContain('尚未检查')
  })

  it('最差事实优先取数据异常（启用项中任一异常即整源异常）', async () => {
    listOfSourceMock.mockResolvedValue([
      monitor({ id: 'm-1', data: 'normal' }),
      monitor({ id: 'm-2', data: 'abnormal' }),
    ])
    const wrapper = mountSource()
    await flushPromises()

    expect(wrapper.get('[data-testid="site-monitor-worst"]').text()).toContain('数据异常')
    expect(wrapper.find('[data-testid="result-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="config-panel"]').exists()).toBe(true)
  })

  it('检查项表与最近运行都挂在同一页，检查项拿到的是本页加载的数据', async () => {
    const wrapper = mountSource()
    await flushPromises()

    const panel = wrapper.getComponent(ConfigStub)
    expect(panel.props('sourceId')).toBe('src-1')
    expect((panel.props('monitors') as MonitorRecordView[]).map((m) => m.id)).toEqual(['m-1'])
    expect(wrapper.getComponent(ResultStub).props('sourceId')).toBe('src-1')
  })

  it('启停由容器统一调 API 并重拉，子组件只抛目标状态', async () => {
    const wrapper = mountSource()
    await flushPromises()

    await wrapper.getComponent(ConfigStub).vm.$emit('toggle', monitor(), false)
    await flushPromises()

    expect(setEnabledMock).toHaveBeenCalledWith(['m-1'], false)
    expect(listOfSourceMock).toHaveBeenCalledTimes(2)
  })

  it('保存后重拉检查项并刷新最近运行', async () => {
    const wrapper = mountSource()
    await flushPromises()

    await wrapper.getComponent(ConfigStub).vm.$emit('saved')
    await flushPromises()

    expect(listOfSourceMock).toHaveBeenCalledTimes(2)
    expect((wrapper.getComponent(ResultStub).vm as unknown as { refreshCalls: number }).refreshCalls).toBe(1)
  })

  it('加载失败给出错误，不把失败当成「未配置」显示在信息条里', async () => {
    listOfSourceMock.mockRejectedValue(new Error('后端 500'))
    const wrapper = mountSource()
    await flushPromises()

    expect(wrapper.find('[data-testid="site-monitor-facts"]').exists()).toBe(false)
    const panel = wrapper.getComponent(ConfigStub)
    expect(panel.props('error')).toContain('后端 500')
    expect(panel.props('monitors')).toEqual([])
  })
})

describe('SiteMonitorView · 运行抽屉（复用 RunsDrawer）', () => {
  it('行上「记录」按 monitorId + sourceId 打开抽屉', async () => {
    const wrapper = mountSource()
    await flushPromises()

    await wrapper.getComponent(ConfigStub).vm.$emit('runs', monitor({ id: 'm-7', name: '日达标监控' }))
    await flushPromises()

    const drawer = wrapper.get('[data-testid="runs-drawer"]')
    expect(drawer.attributes('data-source-id')).toBe('src-1')
    expect(drawer.attributes('data-monitor-id')).toBe('m-7')
    expect(drawer.attributes('data-title')).toBe('日达标监控')
  })

  it('「全部记录」按 sourceId 打开抽屉', async () => {
    const wrapper = mountSource()
    await flushPromises()

    await wrapper.getComponent(ResultStub).vm.$emit('all')
    await flushPromises()

    const drawer = wrapper.get('[data-testid="runs-drawer"]')
    expect(drawer.attributes('data-source-id')).toBe('src-1')
    expect(drawer.attributes('data-monitor-id')).toBe('')
  })

  it('最近运行「详情」带 monitorId 打开抽屉', async () => {
    const wrapper = mountSource()
    await flushPromises()

    await wrapper.getComponent(ResultStub).vm.$emit('detail', { monitorId: 'm-2', monitorName: '日达标监控' })
    await flushPromises()

    expect(wrapper.get('[data-testid="runs-drawer"]').attributes('data-monitor-id')).toBe('m-2')
    expect(wrapper.getComponent(RunsDrawerStub).props('initialRun')).toMatchObject({ monitorId: 'm-2', monitorName: '日达标监控' })
  })

  it('抽屉关闭事件把 open 置回 false', async () => {
    const wrapper = mountSource()
    await flushPromises()
    await wrapper.getComponent(ResultStub).vm.$emit('all')
    await flushPromises()

    await wrapper.getComponent(RunsDrawerStub).vm.$emit('close')
    await flushPromises()
    expect(wrapper.find('[data-testid="runs-drawer"]').exists()).toBe(false)
  })
})

describe('SiteMonitorView · 网站视图（只按 siteId）', () => {
  it('源行运行记录按源范围打开，不能只取同源第一条检查', async () => {
    listMonitorsMock.mockResolvedValue([
      monitor({ id: 'm-a1', sourceId: 'src-a' }),
      monitor({ id: 'm-a2', sourceId: 'src-a' }),
    ])
    const wrapper = mountSite()
    await flushPromises()
    await wrapper.get('[data-testid="site-monitor-site-row-runs"]').trigger('click')
    const drawer = wrapper.get('[data-testid="runs-drawer"]')
    expect(drawer.attributes('data-source-id')).toBe('src-a')
    expect(drawer.attributes('data-monitor-id')).toBe('')
  })

  it('7 项摘要全部显示「—（需服务端聚合）」并说明原因，不用 0 冒充', async () => {
    const wrapper = mountSite()
    await flushPromises()

    const summary = wrapper.get('[data-testid="site-monitor-site-summary"]')
    expect(summary.findAll('dt').map((node) => node.text())).toEqual([
      '有启用检查源',
      '当日应检查源',
      '至少完成一次',
      '计划覆盖完整',
      '数据异常源',
      '执行失败源',
      '漏跑源',
    ])
    expect(summary.findAll('dd')).toHaveLength(7)
    expect(summary.findAll('dd').every((node) => node.text() === '—（需服务端聚合）')).toBe(true)
    expect(summary.text()).toContain('需服务端按授权聚合')
    expect(summary.text()).not.toMatch(/\b0\b/)
    expect(wrapper.find('[data-testid="site-monitor-facts"]').exists()).toBe(false)
  })

  it('只列本站源，不出现其他网站的源', async () => {
    listMonitorsMock.mockResolvedValue([
      monitor({ id: 'm-a', sourceId: 'src-a', sourceName: '源 A' }),
      monitor({ id: 'm-b', sourceId: 'src-b', sourceName: '源 B', data: 'abnormal' }),
      monitor({ id: 'm-x', sourceId: 'src-other', sourceName: '别站源' }),
    ])
    const wrapper = mountSite()
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="site-monitor-site-row"]')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.attributes('data-source-id'))).toEqual(['src-a', 'src-b'])
    expect(wrapper.html()).not.toContain('src-other')
    expect(wrapper.html()).not.toContain('别站源')
  })

  it('源行展示检查项数量、最差事实、最近检查；未配置源也出现', async () => {
    listMonitorsMock.mockResolvedValue([
      monitor({ id: 'm-a', sourceId: 'src-a', lastCheckAt: '2026-11-11 09:00:00' }),
    ])
    const wrapper = mountSite()
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="site-monitor-site-row"]')
    expect(rows[0]!.text()).toContain('源 A')
    expect(rows[0]!.text()).toContain('1 启用 ／ 共 1 项')
    expect(rows[0]!.text()).toContain('数据正常')
    expect(rows[0]!.text()).toContain('2026-11-11 09:00:00')
    expect(rows[1]!.text()).toContain('源 B')
    expect(rows[1]!.text()).toContain('未配置检查')
  })

  it('展开源行只展示该源的检查项，不跨源', async () => {
    listMonitorsMock.mockResolvedValue([
      monitor({ id: 'm-a', sourceId: 'src-a', name: '源 A 检查' }),
      monitor({ id: 'm-b', sourceId: 'src-b', name: '源 B 检查', data: 'abnormal' }),
    ])
    const wrapper = mountSite()
    await flushPromises()

    await wrapper.get('[data-testid="site-monitor-site-expand-src-a"]').trigger('click')
    const detail = wrapper.get('[data-testid="site-monitor-site-subtable"]')
    expect(detail.text()).toContain('源 A 检查')
    expect(detail.text()).not.toContain('源 B 检查')
  })
})
