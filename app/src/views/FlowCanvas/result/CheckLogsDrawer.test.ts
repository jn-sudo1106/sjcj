// @vitest-environment jsdom
// CheckLogsDrawer 是旧调用方式的薄包装：props + show() 不变，内部转发到 RunsDrawer。
// jobId 按 monitorId 解释（旧后端把 ckSource.id 写进日志 jobId），不做任务 jobId 猜测。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as monitorCenter from '@/api/monitorCenter'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import CheckLogsDrawer from './CheckLogsDrawer.vue'

const stubs = {
  ElDrawer: {
    name: 'ElDrawer',
    props: ['modelValue', 'title', 'direction', 'size', 'destroyOnClose'],
    template: '<div class="stub-drawer" :data-open="String(modelValue)" :data-title="title"><slot /></div>',
  },
}

function legacyRun(): MonitorRunView {
  return {
    id: 'l1',
    sourceId: 's2',
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
      sourceId: 's2',
    },
  }
}

type DrawerApi = { show: (sourceId?: string, jobId?: string, monitorName?: string) => void; close: () => void }

function apiOf(wrapper: ReturnType<typeof mount>): DrawerApi {
  return wrapper.vm as unknown as DrawerApi
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('CheckLogsDrawer · 旧调用接口兼容', () => {
  it('show(sourceId, jobId, monitorName) 把 jobId 当 monitorId 转发，并带上 sourceId', async () => {
    const spy = vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 1, list: [legacyRun()] })
    const wrapper = mount(CheckLogsDrawer, { props: { sourceId: 's1' }, global: { stubs } })

    apiOf(wrapper).show('s2', 'm9', '检查项A')
    await flushPromises()

    expect(spy).toHaveBeenCalledWith({ monitorId: 'm9', sourceId: 's2', page: 1, size: 200 })
    const drawer = wrapper.get('.stub-drawer')
    expect(drawer.attributes('data-open')).toBe('true')
    expect(drawer.attributes('data-title')).toBe('运行记录 · 检查项A')
    expect(wrapper.text()).toContain('旧日志')
  })

  it('只给 props 时 show() 无参也用 props 的范围', async () => {
    const spy = vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 1, list: [legacyRun()] })
    const wrapper = mount(CheckLogsDrawer, {
      props: { sourceId: 's3', jobId: 'm3', monitorName: '字段完整性' },
      global: { stubs },
    })

    apiOf(wrapper).show()
    await flushPromises()

    expect(spy).toHaveBeenCalledWith({ monitorId: 'm3', sourceId: 's3', page: 1, size: 200 })
    expect(wrapper.get('.stub-drawer').attributes('data-title')).toBe('运行记录 · 字段完整性')
  })

  it('close() 收起抽屉', async () => {
    vi.spyOn(monitorCenter, 'listRuns').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mount(CheckLogsDrawer, { props: { sourceId: 's1' }, global: { stubs } })

    apiOf(wrapper).show('s1', 'm1', '检查项A')
    await flushPromises()
    expect(wrapper.get('.stub-drawer').attributes('data-open')).toBe('true')

    apiOf(wrapper).close()
    await flushPromises()
    expect(wrapper.get('.stub-drawer').attributes('data-open')).toBe('false')
  })
})