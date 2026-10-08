// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { sourceApi, type TaskInst } from '@/api'
import RunRecords from './index.vue'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/tasks', component: { template: '<div />' } },
    { path: '/canvas', component: { template: '<div />' } },
  ],
})

describe('全局任务中心', () => {
  afterEach(() => vi.restoreAllMocks())

  it('直接查询全部源任务，并沿用源任务页的状态与源筛选', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    await router.push('/tasks?state=L')
    const task: TaskInst = {
      taskId: 't-1', sourceId: '391007768', state: 'L', taskName: '抓取列表', typeName: '采集任务', updatedAt: '2026-10-05 18:00',
    }
    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 1, list: [task] })
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    const wrapper = mount(RunRecords, {
      global: {
        plugins: [router, pinia],
        directives: { loading: {} },
        stubs: {
          GlobalSourceSelect: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template: '<button data-testid="choose-global-source" @click="$emit(\'update:modelValue\', \'391007768\')">选择源</button>',
          },
          TaskDetailDrawer: true,
          'el-date-picker': true,
          'el-icon': true,
          'el-switch': true,
          'el-pagination': true,
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('任务中心')
    expect(wrapper.text()).toContain('抓取列表')
    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(false)
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ siteId: '', sourceId: undefined, state: 'L' }))

    await wrapper.get('[data-testid="task-global-source-filter"]').trigger('click')
    await flushPromises()
    expect(paged).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '391007768', state: 'L' }))
    wrapper.unmount()
  })
})
