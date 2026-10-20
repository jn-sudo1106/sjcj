// 辅助工具页（1020 新增一级入口）：目前没有接入具体工具，锁住"空态而不是空白卡片"这个约定。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AuxiliaryTool from './index.vue'

describe('辅助工具页', () => {
  it('未接入工具时渲染空态与计数，不渲染空网格', () => {
    const wrapper = mount(AuxiliaryTool)
    expect(wrapper.text()).toContain('工具列表')
    expect(wrapper.text()).toContain('0 个工具')
    expect(wrapper.text()).toContain('暂未接入工具')
    expect(wrapper.find('.at-grid').exists()).toBe(false)
  })
})
