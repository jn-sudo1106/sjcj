// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { buildHorizontalLayout, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'

describe('ProcessNodeRail', () => {
  it('点击可选节点时只发出该 nodeId', async () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout, modelValue: '', selectable: () => true } })
    await wrapper.find('[data-node-id="web-list"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['web-list']])
  })

  it('主链节点以卡片展示，并用居中箭头连线和最终结果标记关联', () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'web-detail', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout, modelValue: 'web-detail', selectable: () => true } })

    expect(wrapper.find('.pnr').attributes('style')).toContain(`width: ${layout.totalWidth}px`)
    expect(wrapper.find('.pnr-edge').attributes('marker-end')).toBe('url(#pnr-arrow)')
    // 0917-03：优先展示节点配置里的队列名
    expect(wrapper.find('[data-node-id="web-list"] .pnr-node-sub').text()).toBe('announcement.list')
    expect(wrapper.find('[data-node-id="web-detail"] .pnr-node-final').text()).toBe('最终结果')
  })

  it('需要展示运行事实的只读视图可传入节点状态', () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout, nodeStates: { 'web-list': 'E' } } })
    expect(wrapper.find('[data-node-id="web-list"] .pnr-node-state').classes()).toContain('state-E')
    expect(wrapper.find('[data-node-id="web-list"] .pnr-node-state').attributes('aria-label')).toBe('异常')
  })

  it('0917-03 · 节点卡片优先展示外部传入的队列名，悬停提示完整信息', () => {
    const layout = buildHorizontalLayout(['start', 'web-list', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, {
      props: {
        layout,
        nodeQueues: { 'web-list': 'news_snatch_html_download' },
      },
    })
    const nodeEl = wrapper.find('[data-node-id="web-list"]')
    expect(nodeEl.find('.pnr-node-sub').text()).toBe('news_snatch_html_download')
    expect(nodeEl.attributes('title')).toBe('公告列表抓取 ([90] 网页抓取 · 源配置 · news_snatch_html_download)')
  })

  it('0917-03 · 无队列时副标题退回展示节点标识', () => {
    const customConfigs = {
      ...NODE_CONFIGS,
      'no-queue-node': {
        ...NODE_CONFIGS['web-list'],
        id: 'no-queue-node',
        sub: 'custom-sub',
        taskCfg: undefined,
      },
    }
    const layout = buildHorizontalLayout(['start', 'no-queue-node', 'end'], [], customConfigs, [], { includeTerminals: false })
    const wrapper = mount(ProcessNodeRail, { props: { layout } })
    const nodeEl = wrapper.find('[data-node-id="no-queue-node"]')
    expect(nodeEl.find('.pnr-node-sub').text()).toBe('custom-sub')
    expect(nodeEl.attributes('title')).toBe('公告列表抓取 (custom-sub)')
  })
})
