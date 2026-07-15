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
  it('子源基础表单只展示名称和 URL，不展示源 ID、分类或标签', () => {
    const wrapper = mount(SourceBasicForm, { props: { modelValue: blankSource() } })
    expect(wrapper.text()).toContain('源名称')
    expect(wrapper.text()).toContain('源 URL')
    expect(wrapper.text()).not.toContain('源 ID')
    expect(wrapper.text()).not.toContain('分类')
    expect(wrapper.text()).not.toContain('标签')
    expect(wrapper.find('.sbf-more-toggle').exists()).toBe(false)
  })

  it('不再提供选用或新建配置入口', () => {
    const wrapper = mount(SourceBasicForm, { props: { modelValue: blankSource() } })
    expect(wrapper.text()).not.toContain('选用配置')
    expect(wrapper.text()).not.toContain('新建配置')
    expect(wrapper.text()).not.toContain('使用已有配置')
  })

  // 0711 R5：代理/断点续爬/登录/凭据迁到节点级 CollectorSettings，SourceBasicForm 不再展示这些字段
  it('不再展示代理/断点续爬/登录/凭据（已迁到节点级 CollectorSettings）', () => {
    const wrapper = mount(SourceBasicForm, { props: { modelValue: blankSource() } })
    const text = wrapper.text()
    expect(text).not.toContain('使用代理')
    expect(text).not.toContain('断点续爬')
    expect(text).not.toContain('是否要求登陆')
    expect(text).not.toContain('登录凭据')
    expect(wrapper.find('.sbf-more-toggle').exists()).toBe(false)
  })
})
