// StatusTag 单元测试（P3-1 · plan §F.2 step 2）
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusTag from './StatusTag.vue'

describe('StatusTag', () => {
  it('state="L" 推断为 处理中 + run tone', () => {
    const wrapper = mount(StatusTag, { props: { state: 'L' } })
    expect(wrapper.text()).toContain('处理中')
    expect(wrapper.classes()).toContain('run')
  })

  it('state="C" 推断为 完成 + ok tone', () => {
    const wrapper = mount(StatusTag, { props: { state: 'C' } })
    expect(wrapper.text()).toContain('完成')
    expect(wrapper.classes()).toContain('ok')
  })

  it('state="E" 推断为 出错 + err tone', () => {
    const wrapper = mount(StatusTag, { props: { state: 'E' } })
    expect(wrapper.text()).toContain('出错')
    expect(wrapper.classes()).toContain('err')
  })

  it('显式 text + tone 覆盖 state 推断', () => {
    const wrapper = mount(StatusTag, { props: { state: 'C', text: '外部变更', tone: 'warn' } })
    expect(wrapper.text()).toContain('外部变更')
    expect(wrapper.classes()).toContain('warn')
  })

  it('showIcon=false 不渲染 icon span', () => {
    const wrapper = mount(StatusTag, { props: { state: 'C', showIcon: false } })
    expect(wrapper.find('.rc-status-icon').exists()).toBe(false)
  })

  it('size="md" 应用 md class', () => {
    const wrapper = mount(StatusTag, { props: { state: 'C', size: 'md' } })
    expect(wrapper.classes()).toContain('md')
  })

  it('未知 state 降级为 muted tone', () => {
    const wrapper = mount(StatusTag, { props: { state: 'unknown-state' } })
    expect(wrapper.classes()).toContain('muted')
    expect(wrapper.text()).toContain('未知')
  })

  it('RuleState="draft" 推断为 草稿 + warn tone', () => {
    const wrapper = mount(StatusTag, { props: { state: 'draft' } })
    expect(wrapper.text()).toContain('草稿')
    expect(wrapper.classes()).toContain('warn')
  })
})
