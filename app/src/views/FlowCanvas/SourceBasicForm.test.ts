// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceBasicForm from './SourceBasicForm.vue'
import type { Source } from '../../api'

function blankSource(): Source {
  return { sourceId: 's1', name: '', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}

// 0707 优化·补：回归测试——withDefaults 修复前，showIdentity/defaultOpen 不传时 Vue 把可选 boolean prop
// 隐式落成 false（不是 undefined），导致「不传 showIdentity」这个最常见的调用方式（CanvasHeader 的编辑源信息抽屉）
// 反而被误判成 showIdentity=false，整块源ID/名称/URL/分类全部消失——这个 bug 曾经真实复现过，加测试锁住。
describe('SourceBasicForm', () => {
  it('不传 showIdentity（默认用法）：源ID/名称/URL/分类正常展示，更多设置标题含"标签"', () => {
    const wrapper = mount(SourceBasicForm, { props: { modelValue: blankSource() } })
    expect(wrapper.text()).toContain('源 ID')
    expect(wrapper.text()).toContain('源名称')
    expect(wrapper.text()).toContain('源 URL')
    expect(wrapper.text()).toContain('分类')
    expect(wrapper.find('.sbf-more-toggle').text()).toContain('标签')
  })

  it('showIdentity=false：隐藏源ID/名称/URL，更多设置标题不含"标签"', () => {
    const wrapper = mount(SourceBasicForm, { props: { modelValue: blankSource(), showIdentity: false } })
    expect(wrapper.text()).not.toContain('源 ID')
    expect(wrapper.text()).not.toContain('源名称')
    expect(wrapper.find('.sbf-more-toggle').text()).not.toContain('标签')
  })

  it('不传 defaultOpen：更多设置默认收起；defaultOpen=true：默认展开', () => {
    const collapsed = mount(SourceBasicForm, { props: { modelValue: blankSource() } })
    expect(collapsed.find('.sbf-more-body').exists()).toBe(false)

    const expanded = mount(SourceBasicForm, { props: { modelValue: blankSource(), defaultOpen: true } })
    expect(expanded.find('.sbf-more-body').exists()).toBe(true)
  })
})
