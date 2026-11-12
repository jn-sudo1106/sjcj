// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RuntimePolicySummary from './RuntimePolicySummary.vue'

describe('RuntimePolicySummary', () => {
  it('展示九个只读运行策略字段，不提供输入控件', () => {
    const wrapper = mount(RuntimePolicySummary, {
      props: { raw: '{snatch:{retryCnt:3,timeout:60,toHost:1}}' },
    })

    expect(wrapper.text()).toContain('运行策略')
    expect(wrapper.text()).toContain('只读')
    expect(wrapper.find('[data-testid="runtime-policy-retryCnt"]').text()).toBe('3')
    expect(wrapper.find('[data-testid="runtime-policy-timeout"]').text()).toBe('60')
    expect(wrapper.find('[data-testid="runtime-policy-toHost"]').text()).toBe('是')
    expect(wrapper.findAll('.runtime-policy-grid dd')).toHaveLength(9)
    expect(wrapper.find('input, select, textarea, button').exists()).toBe(false)
  })

  it('后端没有返回策略时明确显示缺值', () => {
    const wrapper = mount(RuntimePolicySummary)
    expect(wrapper.text()).toContain('后端未返回运行策略')
  })
})
