// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MonitorConfigView from './MonitorConfigView.vue'
import { useFlowStore } from '@/stores/flow'

describe('MonitorConfigView', () => {
  it('整体换成两 Tab 监控视图，并把当前源作为过滤条件传入', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.sourceCtx = { sourceId: 'source-a', siteId: 'site-7', name: '源 A' } as never

    const wrapper = mount(MonitorConfigView, {
      global: {
        stubs: {
          CanvasHeader: { template: '<div data-testid="canvas-header" />' },
          SiteMonitorView: {
            props: ['siteId', 'sourceId'],
            template: '<div data-testid="monitor-view" :data-site="siteId" :data-source="sourceId" />',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="canvas-header"]').exists()).toBe(true)
    const monitor = wrapper.get('[data-testid="monitor-view"]')
    expect(monitor.attributes('data-site')).toBe('site-7')
    expect(monitor.attributes('data-source')).toBe('source-a')
  })

  it('没有当前源时不挂监控视图，显示选择提示', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.sourceCtx = null

    const wrapper = mount(MonitorConfigView, {
      global: {
        stubs: {
          CanvasHeader: true,
          SiteMonitorView: { template: '<div data-testid="monitor-view" />' },
        },
      },
    })

    expect(wrapper.find('[data-testid="monitor-view"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('请先在流程视图选择一个数据采集源')
  })
})
