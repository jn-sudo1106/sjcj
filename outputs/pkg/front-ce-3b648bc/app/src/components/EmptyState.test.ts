// EmptyState 单元测试（P3-1 · plan §F.2 step 2）
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyState from './EmptyState.vue'

describe('EmptyState', () => {
  it('size=sm 单行模式', () => {
    const wrapper = mount(EmptyState, { props: { text: '没有匹配的网站', size: 'sm' } })
    expect(wrapper.find('.empty-sm').exists()).toBe(true)
    expect(wrapper.text()).toContain('没有匹配的网站')
  })

  it('size=md 标题+文本+hint', () => {
    const wrapper = mount(EmptyState, {
      props: { title: '没有匹配的网站', text: '调整筛选条件', hint: '或返回全部', size: 'md' },
    })
    expect(wrapper.find('.empty-md-title').text()).toBe('没有匹配的网站')
    expect(wrapper.find('.empty-md-text').text()).toBe('调整筛选条件')
    expect(wrapper.find('.empty-md-hint').text()).toBe('或返回全部')
  })

  it('size=lg 大块模式：图标+标题+文本+按钮', () => {
    const wrapper = mount(EmptyState, {
      props: { icon: '!', title: '加载失败', text: '网络异常', action: '重新加载', size: 'lg' },
    })
    expect(wrapper.find('.empty-lg-icon').text()).toBe('!')
    expect(wrapper.find('.empty-lg-title').text()).toBe('加载失败')
    expect(wrapper.find('.empty-lg-text').text()).toBe('网络异常')
    expect(wrapper.find('.empty-lg-btn').text()).toBe('重新加载')
  })

  it('action 按钮点击触发 action emit', async () => {
    const wrapper = mount(EmptyState, {
      props: { text: '无数据', action: '重试', size: 'lg' },
    })
    await wrapper.find('.empty-lg-btn').trigger('click')
    expect(wrapper.emitted('action')).toBeTruthy()
    expect(wrapper.emitted('action')!.length).toBe(1)
  })

  it('不传 action 不渲染按钮', () => {
    const wrapper = mount(EmptyState, { props: { text: '无数据', size: 'lg' } })
    expect(wrapper.find('.empty-lg-btn').exists()).toBe(false)
  })
})
