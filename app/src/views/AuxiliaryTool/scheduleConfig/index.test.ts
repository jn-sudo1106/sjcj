// @vitest-environment jsdom
// 调度整体配置页接线回归：统计口径（范围参数怎么拼）、行内启停（jobStatus 0/1 + confirmAll）、
// 以及三个弹窗开关时都带了什么参数。这一屏的坑全在这些参数上，样式不测。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import ScheduleConfig from './index.vue'
import type { ScheduleJob, ScheduleSummaryRow } from '@/api/schedule'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const api = vi.hoisted(() => ({
  getScheduleSummary: vi.fn(),
  getJobsBySchedule: vi.fn(),
  updateScheduleByCron: vi.fn(),
}))
vi.mock('@/api/schedule', () => api)

// 三个子弹窗只验「开关时传了什么」，内部实现另有测试。
// ⚠️ 桩工厂必须整体放进 vi.hoisted：vi.mock 的工厂会被提升到 import 之前执行，
//    引用普通顶层 const 会撞 TDZ（Cannot access before initialization）。
const dialog = vi.hoisted(() => {
  const make = (name: string, fn: (args: unknown[]) => void) => ({
    default: {
      name,
      setup(_props: unknown, { expose }: { expose: (v: Record<string, unknown>) => void }) {
        expose({ show: fn })
        return () => null
      },
    },
  })
  return { make, cron: vi.fn(), category: vi.fn(), drawer: vi.fn() }
})
vi.mock('./CronEditModal.vue', () => dialog.make('CronEditModal', dialog.cron))
vi.mock('./CategoryScheduleModal.vue', () => dialog.make('CategoryScheduleModal', dialog.category))
vi.mock('./ScheduleJobDrawer.vue', () => dialog.make('ScheduleJobDrawer', dialog.drawer))

const ROWS: ScheduleSummaryRow[] = [
  { schedule: '0 0 3 * * ?', jobCnt: 4, enableCnt: 3, disableCnt: 1, runningCnt: 1, minNextRun: '2026-10-21 03:00:00' },
  { schedule: '0 0/30 * * * ?', jobCnt: 2, enableCnt: 2, disableCnt: 0, runningCnt: 0, minNextRun: '2026-10-20 14:00:00' },
]

const JOBS: ScheduleJob[] = [
  { jobId: '1', jobName: 'a', state: 'C', isDelete: 0 },
  { jobId: '2', jobName: 'b', state: 'L', isDelete: 0 },
]

function mountPage() {
  return mount(ScheduleConfig, { global: { plugins: [ElementPlus] } })
}

beforeEach(() => {
  api.getScheduleSummary.mockReset().mockResolvedValue(ROWS)
  api.getJobsBySchedule.mockReset().mockResolvedValue(JOBS)
  api.updateScheduleByCron.mockReset().mockResolvedValue({ affected: 2, total: 2, skipped: 0 })
  dialog.cron.mockReset()
  dialog.category.mockReset()
  dialog.drawer.mockReset()
})

describe('调度整体配置页', () => {
  it('首屏按空范围统计，渲染汇总行', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(api.getScheduleSummary).toHaveBeenCalledTimes(1)
    expect(api.getScheduleSummary).toHaveBeenCalledWith({})
    expect(wrapper.text()).toContain('0 0 3 * * ?')
    expect(wrapper.text()).toContain('0 0/30 * * * ?')
  })

  it('查询把状态与源ID 一起带上（状态哨兵还原成 0）', async () => {
    const wrapper = mountPage()
    await flushPromises()
    wrapper.findAllComponents({ name: 'ElSelect' })[0]!.vm.$emit('update:modelValue', '0')
    const input = wrapper.findAll('input').find((item) => item.attributes('placeholder') === '只看某信源下的任务')!
    await input.setValue('1001')
    const queryButton = wrapper.findAll('button').find((btn) => btn.text() === '查询')!
    await queryButton.trigger('click')
    await flushPromises()
    expect(api.getScheduleSummary).toHaveBeenLastCalledWith({ enable: '0', sourceId: '1001' })
  })

  it('统一修改：把表达式 / 任务数 / 全部源标记带进弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const link = wrapper.findAll('a.sc-link').find((item) => item.text() === '统一修改')!
    await link.trigger('click')
    expect(dialog.cron).toHaveBeenCalledTimes(1)
    const payload = dialog.cron.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.mode).toBe('batch')
    expect(payload.oldCron).toBe('0 0 3 * * ?')
    expect(payload.jobCnt).toBe(4)
    // 没有任何筛选范围 → 走「全部源」强确认
    expect(payload.scopeEmpty).toBe(true)
  })

  it('行内启用：确认后按 jobStatus=0 提交，并带 confirmAll', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mountPage()
    await flushPromises()
    const enable = wrapper.findAll('a.sc-link').find((item) => item.text() === '启用')!
    await enable.trigger('click')
    await flushPromises()
    expect(api.getJobsBySchedule).toHaveBeenCalledWith('0 0 3 * * ?', {})
    expect(api.updateScheduleByCron).toHaveBeenCalledWith('0 0 3 * * ?', undefined, {}, {
      jobStatus: 0,
      confirmAll: true,
    })
    confirm.mockRestore()
  })

  it('统一定时 / 任务明细：带上当前范围与表达式', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const categoryButton = wrapper.findAll('button').find((btn) => btn.text().includes('统一定时'))!
    await categoryButton.trigger('click')
    expect(dialog.category).toHaveBeenCalledWith({}, { fromSchedule: true })

    const detail = wrapper.findAll('a.sc-link').find((item) => item.text() === '任务明细')!
    await detail.trigger('click')
    expect(dialog.drawer).toHaveBeenCalledTimes(1)
    // show(schedule, stats, extraQuery)
    expect(dialog.drawer).toHaveBeenCalledWith(
      '0 0 3 * * ?',
      expect.objectContaining({ schedule: '0 0 3 * * ?' }),
      {},
    )
  })
})
