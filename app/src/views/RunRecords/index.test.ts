// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RunRecords from './index.vue'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { state: 'L' } }),
}))

vi.mock('../../api', () => ({
  runApi: {
    runs: vi.fn().mockResolvedValue([
      { runId: 'RUN-C', flow: '完成链路', state: 'C', startedAt: '2026-06-26 09:00', owner: 'ops' },
      { runId: 'RUN-L', flow: '运行链路', state: 'L', startedAt: '2026-06-26 10:00', owner: 'ops' },
    ]),
    runStats: vi.fn().mockResolvedValue({ completed: 1, failed: 0, running: 1, ruleHits: 0 }),
    runNodes: vi.fn().mockResolvedValue([]),
  },
}))

describe('RunRecords 初始筛选', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('按 URL state query 优先选中对应状态记录', async () => {
    const wrapper = mount(RunRecords, {
      global: {
        plugins: [createPinia()],
        directives: {
          loading: {},
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('.rr-item.active strong').text()).toBe('RUN-L')
  })
})
