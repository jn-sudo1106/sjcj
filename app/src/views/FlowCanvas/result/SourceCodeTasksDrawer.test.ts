// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import SourceCodeTasksDrawer from './SourceCodeTasksDrawer.vue'
it('直接显示源流程节点选择，去掉不直观的任务方式切换', () => {
  const sources = [{ sourceId: '123', name: '网站新闻' }] as never
  const w = shallowMount(SourceCodeTasksDrawer, { props: { modelValue: true, sources }, global: { stubs: { ElDrawer: { template: '<div><slot /></div>' } } } })
  expect(w.find('select[aria-label="任务方式"]').exists()).toBe(false)
  expect(w.findComponent({ name: 'SourceGenerationTaskPanel' }).props('sources')).toEqual(sources)
  w.unmount()
})
