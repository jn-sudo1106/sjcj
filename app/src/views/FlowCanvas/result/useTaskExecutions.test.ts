// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { TaskInst } from '@/api'
import { runnerManagementApi as api } from '@/api/runnerManagement'
import { useTaskExecutions } from './useTaskExecutions'

afterEach(() => vi.restoreAllMocks())
it('按当前页批量查询，忽略已切换页面的旧响应，错误不冒充无执行记录', async () => {
  let finishFirst!: (value: Awaited<ReturnType<typeof api.businessTaskExecutionBatch>>) => void
  const batch = vi.spyOn(api, 'businessTaskExecutionBatch').mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
    .mockResolvedValueOnce({ items: { second: [] } })
  const rows = ref([{ taskId: 'first', topic: 'news' }, { taskId: 'first2', topic: 'other' }] as TaskInst[])
  let state!: ReturnType<typeof useTaskExecutions>
  const wrapper = mount(defineComponent({ setup() { state = useTaskExecutions(rows); return () => null } }))
  expect(batch).toHaveBeenCalledTimes(1)
  expect(batch).toHaveBeenCalledWith([{ taskId: 'first', topic: 'news' }, { taskId: 'first2', topic: 'other' }])
  rows.value = [{ taskId: 'second' }] as TaskInst[]; await flushPromises()
  finishFirst({ items: { first: [] } }); await flushPromises()
  expect(state.executions.value).toEqual({ second: [] })
  batch.mockRejectedValueOnce(new Error('接口不可达'))
  rows.value = [{ taskId: 'third' }] as TaskInst[]; await flushPromises()
  expect(state.error.value).toBe('接口不可达')
  expect(state.executions.value).toEqual({})
  rows.value = []; await flushPromises()
  expect(state.loading.value).toBe(false)
  expect(batch).toHaveBeenCalledTimes(3)
  wrapper.unmount()
})
