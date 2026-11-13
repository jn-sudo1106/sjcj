// @vitest-environment jsdom
// 运行抽屉：列表层（一行一次正式运行）→ 单次详情层（返回、冻结快照只读、旧日志降级）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as monitorCenter from '@/api/monitorCenter'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import RunsDrawer from './RunsDrawer.vue'

// el-drawer 正常会 teleport 到 body，测试里换成直出容器，等价于「抽屉已打开」
const stubs = {
  ElDrawer: {
    name: 'ElDrawer',
    props: ['modelValue', 'title', 'direction', 'size', 'destroyOnClose'],
    template: '<div class="stub-drawer" :data-open="String(modelValue)" :data-title="title"><slot /></div>',
  },
}

function legacyRun(over: Partial<MonitorRunView> = {}): MonitorRunView {
  return {
    id: 'l1',
    sourceId: 's1',
    monitorName: '日增量监控',
    at: '2026-09-09 11:00:46',
    trigger: 'legacy',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '1240',
    deliveries: [],
    legacy: true,
    raw: {
      logId: 'l1',
      createDt: '2026-09-09 11:00:46',
      logMsg: '2026-09-09 11:00:46---正常, 数量:1240',
      name: '日增量监控',
      state: 'C',
      logType: '1',
      tableName: 'sense_data.tb_jjjk',
      sourceId: 's1',
    },
    ...over,
  }
}

function structuredRun(over: Partial<MonitorRunView> = {}): MonitorRunView {
  return {
    id: 'r2',
    runId: 'run-20261111-0001',
    monitorId: 'm1',
    sourceId: 's1',
    monitorName: '字段完整性',
    at: '2026-11-11T06:00:00+08:00',
    trigger: 'schedule',
    exec: 'failed',
    data: 'abnormal',
    notify: 'accepted',
    count: '100',
    checkedCount: 100,
    abnormalCount: 3,
    window: { start: '2026-11-11 00:00:00', end: '2026-11-11 23:59:59', timezone: 'Asia/Shanghai' },
    config: {
      version: 'v3',
      name: '字段完整性',
      methods: ['required_null'],
      plan: { text: '每天 06:00' },
      notifyOn: 'error',
      channels: ['wecom'],
    },
    checks: [
      {
        checkKey: 'c1',
        methodCode: 'required_null',
        exec: 'failed',
        data: 'abnormal',
        tableName: 'sense_data.tb_jjjk',
        field: 'title',
        checkedCount: 100,
        abnormalCount: 3,
      },
    ],
    logText: '结构化日志正文：3 条空 title',
    deliveries: [
      { channel: 'wecom', target: '运维群', attempt: 2, status: 'accepted', at: '2026-11-11 06:00:05', message: '已受理' },
    ],
    legacy: false,
    ...over,
  }
}

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(RunsDrawer, {
    props: { open: true, sourceId: 's1', ...props },
    global: { stubs },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('RunsDrawer · 列表层', () => {
  it('最近运行入口直接打开指定运行的冻结详情，返回后仍能查看列表', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 1, list: [legacyRun()] })
    const wrapper = mountDrawer({ initialRun: legacyRun() })
    await flushPromises()
    expect(wrapper.find('[data-testid="run-detail-conclusion"]').exists()).toBe(true)
    await wrapper.get('[data-testid="run-detail-back"]').trigger('click')
    expect(wrapper.find('[data-testid="run-detail"]').exists()).toBe(true)
  })
  it('源维度：一次运行一行，旧日志有标注，未知条数「—」，无回执不写「已送达」，入参用 sourceId', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 2, list: [structuredRun(), legacyRun()] })
    const wrapper = mountDrawer()
    await flushPromises()

    expect(monitorCenter.listRuns).toHaveBeenCalledWith({ sourceId: 's1', page: 1, size: 200 })
    expect(wrapper.findAll('[data-testid="run-detail"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="runs-total"]').text()).toContain('已加载 2 / 共 2')
    expect(wrapper.text()).toContain('当前源 · 含该源下全部检查项')
    expect(wrapper.text()).toContain('一行对应一次正式运行')
    expect(wrapper.text()).toContain('筛选仅作用于已加载记录')

    expect(wrapper.findAll('[data-testid="run-legacy-tag"]')).toHaveLength(1)
    const counts = wrapper.findAll('[data-testid="run-count"]').map((node) => node.text())
    // 旧日志保持现状：显示 run.count，不解析中文日志
    expect(counts).toContain('1240')
    // 结构化运行：检查 / 异常都来自结构化字段
    expect(counts.some((text) => text.includes('检查 100 条') && text.includes('异常 3 条'))).toBe(true)

    const notifyTexts = wrapper.findAll('[data-testid="run-notify"]').map((node) => node.text())
    expect(notifyTexts).toContain('已受理·未送达')
    expect(notifyTexts).toContain('未取得回执')
    expect(notifyTexts.join(' ')).not.toContain('已送达')
  })

  it('条数：有结构化值时显示「检查 N 条 · 异常 M 条」，异常 > 0 错误色、= 0 中性色', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({
      total: 2,
      list: [
        structuredRun({ abnormalCount: 3 }),
        structuredRun({ id: 'r3', runId: 'run-20261111-0002', checkedCount: 0, abnormalCount: 0, count: '0' }),
      ],
    })
    const wrapper = mountDrawer()
    await flushPromises()

    expect(wrapper.findAll('[data-testid="run-count-abnormal"]')).toHaveLength(2)
    const rows = wrapper.findAll('[data-testid="run-count"]')
    expect(rows[0].text()).toContain('检查 100 条')
    expect(rows[0].text()).toContain('异常 3 条')
    expect(rows[1].text()).toContain('异常 0 条')

    const abnormal = wrapper.findAll('[data-testid="run-count-abnormal"]')
    expect(abnormal[0].classes()).toContain('is-err')
    expect(abnormal[1].classes()).toContain('is-muted')
  })

  it('条数：旧日志没有结构化值时不出现「检查 / 异常」分段，未知仍是「—」', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({
      total: 2,
      list: [legacyRun(), legacyRun({ id: 'l2', count: '' })],
    })
    const wrapper = mountDrawer()
    await flushPromises()

    expect(wrapper.find('[data-testid="run-count-abnormal"]').exists()).toBe(false)
    const counts = wrapper.findAll('[data-testid="run-count"]').map((node) => node.text())
    expect(counts).toEqual(['1240', '—'])
    expect(wrapper.findAll('[data-testid="run-legacy-tag"]')).toHaveLength(2)
  })

  it('检查项维度：入参带 monitorId + sourceId，范围文案是「当前检查项」', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 1, list: [structuredRun()] })
    const wrapper = mountDrawer({ monitorId: 'm9', title: '字段完整性' })
    await flushPromises()

    expect(monitorCenter.listRuns).toHaveBeenCalledWith({
      monitorId: 'm9',
      sourceId: 's1',
      page: 1,
      size: 200,
    })
    expect(wrapper.text()).toContain('当前检查项「字段完整性」')
    expect(wrapper.get('.stub-drawer').attributes('data-title')).toContain('运行记录 · 字段完整性')
  })

  it('三维筛选只作用于已加载记录，可重置', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 2, list: [structuredRun(), legacyRun()] })
    const wrapper = mountDrawer()
    await flushPromises()

    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(3)

    await selects[1].setValue('normal')
    expect(wrapper.findAll('[data-testid="run-detail"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="run-count"]').text()).toBe('1240')

    await selects[1].setValue('')
    await selects[2].setValue('unknown')
    expect(wrapper.findAll('[data-testid="run-detail"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="run-notify"]').text()).toBe('未取得回执')

    const reset = wrapper.findAll('button').find((button) => button.text() === '重置筛选')
    expect(reset).toBeTruthy()
    await reset?.trigger('click')
    expect(wrapper.findAll('[data-testid="run-detail"]')).toHaveLength(2)
  })

  it('未指定范围时明确报错，不发请求；抽屉关闭时也不请求', async () => {
    const spy = vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mountDrawer({ open: false })
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()

    await wrapper.setProps({ open: true, sourceId: undefined, monitorId: undefined })
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="runs-error"]').text()).toContain('未指定运行范围')
  })

  it('加载失败展示真实错误并允许重试', async () => {
    const spy = vi.spyOn(monitorCenter, 'listRuns').mockRejectedValue(new Error('接口 502'))
    const wrapper = mountDrawer()
    await flushPromises()
    expect(wrapper.get('[data-testid="runs-error"]').text()).toContain('接口 502')

    spy.mockResolvedValue({ total: 1, list: [structuredRun()] })
    const retry = wrapper.findAll('button').find((button) => button.text() === '重试')
    await retry?.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="run-detail"]')).toHaveLength(1)
  })
})

describe('RunsDrawer · 单次详情层', () => {
  it('结构化运行：结论/数值、窗口时区、逐项、快照、日志、投递都来自本次运行，返回可回列表', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 1, list: [structuredRun()] })
    const wrapper = mountDrawer()
    await flushPromises()

    await wrapper.get('[data-testid="run-detail"]').trigger('click')
    expect(wrapper.find('[data-testid="run-detail-conclusion"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="detail-exec"]').text()).toBe('执行失败')
    expect(wrapper.get('[data-testid="detail-data"]').text()).toBe('数据异常')
    expect(wrapper.get('[data-testid="detail-notify"]').text()).toBe('已受理 · 未确认送达')

    // 结论区「检查 / 异常」只认结构化字段；runId 与窗口（含时区）也来自本次运行
    const conclusionText = wrapper.get('[data-testid="run-detail-conclusion"]').text()
    expect(conclusionText).toContain('检查 / 异常')
    expect(conclusionText).toContain('100 / 3')
    expect(conclusionText).toContain('run-20261111-0001')
    const rangeText = wrapper.get('[data-testid="run-detail-range"]').text()
    expect(rangeText).toContain('2026-11-11 00:00:00 → 2026-11-11 23:59:59（Asia/Shanghai）')
    // 逐方法逐表
    expect(wrapper.get('[data-testid="run-detail-checks"]').text()).toContain('必填字段非空')
    // 冻结快照
    expect(wrapper.get('[data-testid="run-detail-snapshot"]').text()).toContain('v3')
    expect(wrapper.get('[data-testid="run-detail-snapshot"]').text()).toContain('仅异常时')
    expect(wrapper.find('[data-testid="run-snapshot-missing"]').exists()).toBe(false)
    // 日志与投递
    expect(wrapper.get('[data-testid="run-log-text"]').text()).toContain('结构化日志正文')
    expect(wrapper.get('[data-testid="delivery-status"]').text()).toBe('已受理 · 未确认送达')
    // 结构化运行不显示旧日志横幅
    expect(wrapper.find('[data-testid="run-legacy-note"]').exists()).toBe(false)

    await wrapper.get('[data-testid="run-detail-back"]').trigger('click')
    expect(wrapper.findAll('[data-testid="run-detail"]')).toHaveLength(1)
  })

  it('旧日志详情：标注降级、快照/逐项「未记录」、条数取日志文本、通知「未取得回执」', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 1, list: [legacyRun()] })
    const wrapper = mountDrawer()
    await flushPromises()

    await wrapper.get('[data-testid="run-detail"]').trigger('click')
    expect(wrapper.get('[data-testid="run-detail-legacy"]').text()).toBe('旧日志')
    expect(wrapper.get('[data-testid="run-legacy-note"]').text()).toContain('旧日志，未取得结构化结论')
    // 结论区的「检查 / 异常」直接给降级文案，不把日志文本里的 1240 当检查数
    const conclusionText = wrapper.get('[data-testid="run-detail-conclusion"]').text()
    expect(conclusionText).toContain('检查 / 异常')
    expect(conclusionText).toContain('旧日志，未取得结构化结论')
    expect(conclusionText).not.toContain('1240')
    expect(wrapper.get('[data-testid="run-snapshot-missing"]').text()).toContain('未记录')
    expect(wrapper.get('[data-testid="run-checks-empty"]').text()).toContain('未记录逐项结果')
    expect(wrapper.get('[data-testid="run-log-text"]').text()).toContain('数量:1240')
    expect(wrapper.get('[data-testid="run-delivery-empty"]').text()).toBe('未取得回执')
    expect(wrapper.get('[data-testid="detail-notify"]').text()).toBe('未取得回执')
    // 旧日志没有冻结方法列表，也不该出现假的方法名
    expect(wrapper.find('[data-testid="run-detail-checks"]').text()).not.toContain('必填字段非空')
  })

  it('日志正文缺失但有 logRef 时给服务端引用，不伪造正文', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({
      total: 1,
      list: [structuredRun({ logText: undefined, logRef: 'run/2026-11-11/abc.log' })],
    })
    const wrapper = mountDrawer()
    await flushPromises()

    await wrapper.get('[data-testid="run-detail"]').trigger('click')
    expect(wrapper.get('[data-testid="run-log-missing"]').text()).toContain('未取得日志内容')
    expect(wrapper.get('[data-testid="run-log-missing"]').text()).toContain('run/2026-11-11/abc.log')
  })
})
