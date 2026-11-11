// @vitest-environment jsdom
// 1106 §7.5 / §8.6：日志抽屉的「条数」只读运行记录的结构化数值字段，不解析 logMsg 里的中文日志。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import CheckLogsDrawer from './CheckLogsDrawer.vue'
import * as monitorApi from '../../../api/monitor'
import type { SourceCheckLog } from '../../../api'

// Element Plus 表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

function log(over: Partial<SourceCheckLog> = {}): SourceCheckLog {
  return {
    logId: 'l1',
    createDt: '2026-09-09 11:00:46',
    logMsg: '2026-09-09 11:00:46---正常, 数量:1240',
    name: '日增量监控',
    state: 'C',
    logType: '1',
    tableName: 'sense_data.tb_jjjk',
    sourceId: 's1',
    ...over,
  }
}

// el-drawer 会把内容 teleport 到 body，测试里换成直出容器，等价于「抽屉已打开」
const stubs = { ElDrawer: { name: 'ElDrawer', props: ['modelValue', 'title'], template: '<div class="stub-drawer"><slot /></div>' } }

function mountDrawer() {
  return mount(CheckLogsDrawer, { props: { sourceId: 's1' }, global: { plugins: [ElementPlus], stubs } })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('CheckLogsDrawer · 条数口径', () => {
  it('logMsg 含「数量:5」但无结构化字段：显示「—」，且 state=E 不染红', async () => {
    vi.spyOn(monitorApi, 'pagedCheckJobLogs').mockResolvedValue({
      total: 2,
      list: [
        log({ logId: 'l1', state: 'E', logMsg: '2026-09-09 11:00:46---异常, 数量:5' }),
        // 后端未来给结构化数值字段（按 unknown 兼容注入）
        { ...log({ logId: 'l2', state: 'E', logMsg: '' }), cnt: 9 } as unknown as SourceCheckLog,
      ],
    })
    const wrapper = mountDrawer()
    wrapper.vm.show('s1', 'job-9')
    await flushPromises()

    const none = wrapper.findAll('.cl-count-none')
    expect(none).toHaveLength(1)
    expect(none[0]!.text()).toBe('—')
    expect(wrapper.findAll('.cl-count.alarm')).toHaveLength(0)

    const cells = wrapper.findAll('[data-testid="check-log-count"]')
    expect(cells).toHaveLength(1)
    expect(cells[0]!.text()).toBe('9')
  })
})