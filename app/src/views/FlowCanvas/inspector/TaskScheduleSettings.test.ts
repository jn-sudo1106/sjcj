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
})
