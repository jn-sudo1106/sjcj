// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { buildHorizontalLayout, NODE_CONFIGS } from './flowModel'

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
    expect(wrapper.find('[data-node-id="web-list"] .pnr-node-sub').text()).toBe(NODE_CONFIGS['web-list'].sub)
    expect(wrapper.find('[data-node-id="web-detail"] .pnr-node-final').text()).toBe('最终结果')
  })
})
