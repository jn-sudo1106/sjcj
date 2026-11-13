// @vitest-environment jsdom
// 「复用已有实例 · 整站源批量绑定」弹窗（1109 原型 #frame7 / 方案 R02·R04·R05）。测接线不测样式：
//   ① 打开就出范围与预览卡，补默认标注「不计入合计」
//   ② 点「提交冻结集合」调 startBatchBind（带 scopeToken）并切到执行视图
//   ③ 轮询推进显示新增 / 跳过 / 失败 / 待开始；done 后停表（fake timers）
//   ④ 关闭或 visible=false 之后 interval 被清，不再调 fetchBatchJob
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import SourceBatchBindDialog from './SourceBatchBindDialog.vue'
import { fetchBatchJob, previewScope, startBatchBind } from '@/api/flowCenterCenter'
import type { BatchJob, ScopePreview } from '@/api/types/flowCenterCenter'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('@/api/flowCenterCenter', () => ({
  previewScope: vi.fn(),
  startBatchBind: vi.fn(),
  fetchBatchJob: vi.fn(),
}))

const previewMock = vi.mocked(previewScope)
const startMock = vi.mocked(startBatchBind)
const jobMock = vi.mocked(fetchBatchJob)
const errorMsg = vi.mocked(ElMessage.error)

/** 与 mock（及原型 #frame7）同一组数字：6,564 个源 / 33 批 / 每批 200 */
const PREVIEW: ScopePreview = {
  templateId: '4821',
  total: 6564,
  toAdd: 6553,
  toSkip: 0,
  groupSources: 5,
  expectedUnavailable: 6,
  defaultFilled: 12,
}

function snapshot(over: Partial<BatchJob> = {}): BatchJob {
  return {
    jobId: 'job-8821',
    instanceId: '4821',
    scopeToken: '20261110-0931',
    batchIndex: 11,
    batchTotal: 33,
    batchSize: 200,
    total: 6564,
    processed: 2200,
    added: 2148,
    skipped: 46,
    failed: 6,
    defaultFilled: 0,
    status: 'running',
    pending: 4164,
    running: 200,
    failures: [{ sourceId: '2283', sourceName: '深交所问询函', reason: '并发锁冲突（源绑定快照已变化），可重试' }],
    ...over,
  }
}

const DONE = snapshot({
  status: 'done',
  batchIndex: 33,
  processed: 6564,
  added: 6512,
  skipped: 46,
  failed: 6,
  pending: 0,
  running: 0,
})

function mountDialog() {
  return mount(SourceBatchBindDialog, {
    props: { visible: true, instanceId: '4821', instanceName: '公告列表→详情' },
    global: {
      config: {
        // 弹窗内部的 el-dialog / el-input / el-table 等是项目全局注册的 Element Plus 组件，
        // 而本文件把 element-plus 整体 mock 掉了 → 这些标签在测试里解析不到，按原生标签渲染
        // （DOM 结构、disabled、click 行为不变，断言照旧）。这里只关掉「解析不到组件」的告警噪声。
        warnHandler: (msg: string) => {
          if (!msg.includes('Failed to resolve component')) return
        },
      },
    },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  previewMock.mockResolvedValue(PREVIEW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SourceBatchBindDialog · 范围与预览', () => {
  it('打开就出范围、预览表与回执，补默认标注不计入合计', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    // 冻结态 + 筛选条 + 5 列预览表
    expect(wrapper.get('[data-testid="sb-scope-token"]').text()).toContain('已冻结 · scopeToken')
    const headers = wrapper.get('[data-testid="sb-table"]').findAll('thead th').map((th) => th.text())
    expect(headers).toEqual(['', '源', '网站', '当前绑定', '本次操作'])
    expect(wrapper.findAll('[data-testid="sb-row"]')).toHaveLength(8)
    expect(wrapper.get('[data-testid="sb-table"]').text()).toContain('新增关联（追加）')
    expect(wrapper.get('[data-testid="sb-table"]').text()).toContain('已绑定、跳过（不重复写）')

    // 预览回执：总数 6,564，补默认单独一项且写清不计入合计
    const card = wrapper.get('[data-testid="sb-preview-card"]')
    expect(card.text()).toContain('6,564')
    const defaultFilled = wrapper.get('[data-testid="sb-default-filled"]')
    expect(defaultFilled.text()).toContain('补默认 12')
    expect(defaultFilled.text()).toContain('不计入合计')
    // 合计只算终态：6,553 + 0 + 6
    expect(card.text()).toContain('合计 6,559')

    // 第一次预览用默认范围：整站源、默认流程不勾
    expect(previewMock).toHaveBeenCalledWith('4821', {
      sites: [],
      mode: 'site-all',
      manualSourceIds: [],
      setDefault: false,
    })
    wrapper.unmount()
  })

  it('预览失败时 ElMessage.error 报错并在弹窗内给重试入口', async () => {
    previewMock.mockRejectedValueOnce(new Error('服务不可用'))
    const wrapper = mountDialog()
    await flushPromises()

    expect(errorMsg).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="sb-preview-error"]').text()).toContain('服务不可用')
    expect(wrapper.get('[data-testid="sb-submit"]').attributes('disabled')).toBeDefined()

    // 重试成功后恢复预览与冻结令牌
    await wrapper.get('[data-testid="sb-preview-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="sb-preview-card"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('SourceBatchBindDialog · 提交与分批执行', () => {
  it('点「提交冻结集合」调 startBatchBind 并进入执行视图', async () => {
    startMock.mockResolvedValue(snapshot())
    jobMock.mockResolvedValue(snapshot())
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.get('[data-testid="sb-submit"]').trigger('click')
    await flushPromises()

    expect(startMock).toHaveBeenCalledTimes(1)
    const payload = startMock.mock.calls[0][0]
    expect(payload.instanceId).toBe('4821')
    expect(payload.scopeToken).toMatch(/^\d{8}-\d{4}$/)
    expect(payload.scope).toEqual({ sites: [], mode: 'site-all', manualSourceIds: [], setDefault: false })

    expect(wrapper.find('[data-testid="sb-job"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="sb-job-id"]').text()).toBe('job-8821')
    expect(wrapper.get('[data-testid="sb-progress"]').text()).toContain('已完成 11 / 33 批，第 12 批执行中')
    expect(wrapper.find('[data-testid="sb-failures"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('轮询推进显示新增 / 跳过 / 失败 / 待开始，done 后停表', async () => {
    vi.useFakeTimers()
    startMock.mockResolvedValue(snapshot())
    jobMock.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(DONE)

    const wrapper = mountDialog()
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.get('[data-testid="sb-submit"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    // 第 1 次轮询：11 批已完成、第 12 批 200 个源执行中
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get('[data-testid="sb-added"]').text()).toBe('2,148')
    expect(wrapper.get('[data-testid="sb-skipped"]').text()).toBe('46')
    expect(wrapper.get('[data-testid="sb-failed"]').text()).toBe('6')
    expect(wrapper.get('[data-testid="sb-running"]').text()).toBe('200')
    // 待开始 = 6,564 − 2,200 − 200
    expect(wrapper.get('[data-testid="sb-pending"]').text()).toBe('4,164')
    expect(wrapper.get('[data-testid="sb-progress"]').text()).toContain('已处理 2,200 / 6,564')

    // 第 2 次轮询推进到 done：停表 + 通知父级刷新
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get('[data-testid="sb-job-status"]').text()).toBe('已完成')
    expect(wrapper.get('[data-testid="sb-progress"]').text()).toContain('已完成 33 / 33 批')
    expect(wrapper.get('[data-testid="sb-pending"]').text()).toBe('0')
    expect(wrapper.emitted('done')).toBeTruthy()

    const calls = jobMock.mock.calls.length
    expect(calls).toBe(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(jobMock.mock.calls.length).toBe(calls)
    wrapper.unmount()
  })

  it('暂停只停本地轮询并提示「已暂停，继续可恢复」', async () => {
    vi.useFakeTimers()
    startMock.mockResolvedValue(snapshot())
    jobMock.mockResolvedValue(snapshot())
    const wrapper = mountDialog()
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.get('[data-testid="sb-submit"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    const calls = jobMock.mock.calls.length

    await wrapper.get('[data-testid="sb-pause"]').trigger('click')
    expect(wrapper.get('[data-testid="sb-note"]').text()).toContain('已暂停，继续可恢复')
    await vi.advanceTimersByTimeAsync(3000)
    expect(jobMock.mock.calls.length).toBe(calls)

    // 继续后恢复轮询
    await wrapper.get('[data-testid="sb-pause"]').trigger('click')
    await vi.advanceTimersByTimeAsync(1000)
    expect(jobMock.mock.calls.length).toBe(calls + 1)
    wrapper.unmount()
  })

  it('重试失败项 / 取消待处理项没有接口：明确提示未提交请求，不假装成功', async () => {
    startMock.mockResolvedValue(snapshot())
    jobMock.mockResolvedValue(snapshot())
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('[data-testid="sb-submit"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="sb-retry-failed"]').trigger('click')
    expect(wrapper.get('[data-testid="sb-note"]').text()).toContain('未提交任何请求')
    await wrapper.get('[data-testid="sb-cancel-pending"]').trigger('click')
    expect(wrapper.get('[data-testid="sb-note"]').text()).toContain('未提交任何请求')
    expect(startMock).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

describe('SourceBatchBindDialog · 定时器清理', () => {
  it('关闭后 interval 被清，不再请求进度', async () => {
    vi.useFakeTimers()
    startMock.mockResolvedValue(snapshot())
    jobMock.mockResolvedValue(snapshot())
    const wrapper = mountDialog()
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.get('[data-testid="sb-submit"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    const calls = jobMock.mock.calls.length
    expect(calls).toBeGreaterThan(0)

    await wrapper.get('[data-testid="sb-close"]').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    await wrapper.setProps({ visible: false })
    await vi.advanceTimersByTimeAsync(3000)
    expect(jobMock.mock.calls.length).toBe(calls)
    wrapper.unmount()
  })

  it('卸载后 interval 被清，不再请求进度', async () => {
    vi.useFakeTimers()
    startMock.mockResolvedValue(snapshot())
    jobMock.mockResolvedValue(snapshot())
    const wrapper = mountDialog()
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.get('[data-testid="sb-submit"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    const calls = jobMock.mock.calls.length

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(3000)
    expect(jobMock.mock.calls.length).toBe(calls)
  })
})