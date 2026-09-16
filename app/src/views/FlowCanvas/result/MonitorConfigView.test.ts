// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MonitorConfigView from './MonitorConfigView.vue'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'
import { useFlowStore } from '@/stores/flow'

describe('MonitorConfigView', () => {
  it('复用告警配置面板，并把变更回写当前数据监控节点', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [],
      null,
    )
    const nodeId = 'monitor-test'
    const monitor = cloneConfig(NODE_CONFIGS.rule)
    monitor.template = 'monitor'
    monitor.title = '数据监控'
    flow.configs[nodeId] = monitor
    flow.main.splice(1, 0, nodeId)
    flow.select(nodeId)

    const wrapper = mount(MonitorConfigView, {
      global: {
        stubs: {
          CanvasHeader: { template: '<div data-testid="canvas-header" />' },
          AlertConfigPanel: {
            props: ['nodeId', 'nodeTitle', 'sourceLabel', 'scriptPath'],
            emits: ['update:alert-config'],
            template: '<button data-testid="alert-panel" @click="$emit(\'update:alert-config\', { enabled: false, policies: [], channels: [] })" />',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="canvas-header"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="alert-panel"]').exists()).toBe(true)
    await wrapper.get('[data-testid="alert-panel"]').trigger('click')

    expect(flow.selectedNode?.alertConfig).toEqual({ enabled: false, policies: [], channels: [] })
  })

  it('非数据监控节点显示选择提示，不挂载告警配置面板', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [],
      null,
    )
    const nodeId = 'rule-test'
    flow.configs[nodeId] = cloneConfig(NODE_CONFIGS.rule)
    flow.main.splice(1, 0, nodeId)
    flow.select(nodeId)

    const wrapper = mount(MonitorConfigView, {
      global: {
        stubs: {
          CanvasHeader: true,
          AlertConfigPanel: { template: '<div data-testid="alert-panel" />' },
        },
      },
    })

    expect(wrapper.find('[data-testid="alert-panel"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('请选择数据监控节点')
  })
})
