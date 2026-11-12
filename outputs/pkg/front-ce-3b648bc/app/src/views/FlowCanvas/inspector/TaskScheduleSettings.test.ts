// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TaskScheduleSettings from './TaskScheduleSettings.vue'
import type { CollectorSchedule } from '@/views/FlowCanvas/canvas/flowModel'

function mountSchedule(modelValue: CollectorSchedule = { scheduleType: '每天', scheduleTime: '08:30', weekdays: [], cron: '' }) {
  return mount(TaskScheduleSettings, { props: { modelValue } })
}

function lastPatch(wrapper: ReturnType<typeof mountSchedule>) {
  const events = wrapper.emitted('update:modelValue') ?? []
  return events[events.length - 1]?.[0]
}

describe('TaskScheduleSettings', () => {
  it('每天凌晨 0 点生成 Quartz cron', async () => {
    const wrapper = mountSchedule({ scheduleType: '每天', scheduleTime: '08:30', weekdays: [], cron: '' })

    await wrapper.get('input[type="time"]').setValue('00:00')

    expect(lastPatch(wrapper)).toMatchObject({ scheduleTime: '00:00', cron: '0 0 0 * * ?' })
  })

  it('每天早上 8 点 30 分生成 Quartz cron', async () => {
    const wrapper = mountSchedule()

    await wrapper.get('input[type="time"]').setValue('08:30')

    expect(lastPatch(wrapper)).toMatchObject({ scheduleTime: '08:30', cron: '0 30 8 * * ?' })
  })

  it('每小时按时间里的分钟生成 Quartz cron', async () => {
    const wrapper = mountSchedule({ scheduleType: '每天', scheduleTime: '08:30', weekdays: [], cron: '' })

    await wrapper.get('select').setValue('每小时')

    expect(lastPatch(wrapper)).toMatchObject({ scheduleType: '每小时', cron: '0 30 * * * ?' })
  })

  it('每 5 分钟一次生成 Quartz cron', async () => {
    const wrapper = mountSchedule({ scheduleType: '每天', scheduleTime: '08:30', weekdays: [], cron: '' })

    await wrapper.get('select').setValue('每5分钟一次')

    expect(lastPatch(wrapper)).toMatchObject({ scheduleType: '每5分钟一次', cron: '0 */5 * * * ?' })
  })

  it('每周切换星期时同步生成 cron', async () => {
    const wrapper = mountSchedule({ scheduleType: '每周', scheduleTime: '10:05', weekdays: [1], cron: '' })

    await wrapper.findAll('.rc-day')[2].trigger('click')

    expect(lastPatch(wrapper)).toMatchObject({ weekdays: [1, 3], cron: '0 5 10 ? * 1,3' })
  })

  it('交易日定时默认生成周一到周五 cron', async () => {
    const wrapper = mountSchedule({ scheduleType: '每天', scheduleTime: '08:30', weekdays: [], cron: '' })

    await wrapper.get('select').setValue('交易日定时')

    expect(lastPatch(wrapper)).toMatchObject({ scheduleType: '交易日定时', weekdays: [1, 2, 3, 4, 5], cron: '0 30 8 ? * 1-5' })
  })

  it('自定义 cron 只写入用户手填表达式，不由时间覆盖', async () => {
    const wrapper = mountSchedule({ scheduleType: '自定义 cron', scheduleTime: '08:30', weekdays: [], cron: '0 0 12 * * *' })

    await wrapper.get('input[type="time"]').setValue('09:15')

    expect(lastPatch(wrapper)).toMatchObject({ scheduleTime: '09:15' })
    expect(lastPatch(wrapper)).not.toHaveProperty('cron')
  })

  it('旧定时只有 cron 字段时，直接编辑仍保持自定义策略和输入值', async () => {
    const wrapper = mountSchedule({ cron: '0 30 5 1 1 ?' })
    expect(wrapper.get('select').element.value).toBe('自定义 cron')
    await wrapper.get('input.cron').setValue('0 29 16 30 10 ?')
    expect(lastPatch(wrapper)).toMatchObject({ scheduleType: '自定义 cron', cron: '0 29 16 30 10 ?' })
  })

  // 2026-09-22 用户报「定时为什么关不上」：首次保存定时时源上还没有 job，
  // NodeInspector 本地造了个 jobId 为空的壳，界面显示「已启用」但那条定时没有 ID，
  // 一点就是 setJobEnabled([''])、必然回「没有可操作的定时任务」。
  // 真 jobId 已在保存后回查（见 NodeInspector），这里再加一道：没 ID 就别让人点。
  const job = (over: Partial<{ jobId: string; disabled: boolean }> = {}) => ({
    jobId: 'j-1', jobName: 'j', sourceId: 's-1', schedule: '0 0 0 * * ?',
    runCount: 0, successCount: 0, disabled: false, ...over,
  })

  it('有 jobId 时开关可点', () => {
    const w = mount(TaskScheduleSettings, {
      props: { modelValue: { scheduleType: '每天', scheduleTime: '00:00', weekdays: [], cron: '' }, job: job() },
    })
    const toggle = w.get('[data-testid="job-toggle"]')
    expect(toggle.attributes('disabled')).toBeUndefined()
    expect(toggle.text()).toContain('已启用')
  })

  it('jobId 为空（刚保存、还没回查到）时开关禁用，并说明刷新后可用', () => {
    const w = mount(TaskScheduleSettings, {
      props: { modelValue: { scheduleType: '每天', scheduleTime: '00:00', weekdays: [], cron: '' }, job: job({ jobId: '' }) },
    })
    const toggle = w.get('[data-testid="job-toggle"]')
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.attributes('title')).toContain('刷新页面后可启停')
  })

  it('正在切换时也禁用（防连点）', () => {
    const w = mount(TaskScheduleSettings, {
      props: { modelValue: { scheduleType: '每天', scheduleTime: '00:00', weekdays: [], cron: '' }, job: job(), toggling: true },
    })
    expect(w.get('[data-testid="job-toggle"]').attributes('disabled')).toBeDefined()
  })
})
