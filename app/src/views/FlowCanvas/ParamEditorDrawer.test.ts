// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ParamEditorDrawer from './ParamEditorDrawer.vue'

describe('ParamEditorDrawer', () => {
  it('新建参数显示原系统一致的定义字段与五种来源类型', () => {
    const wrapper = mount(ParamEditorDrawer, { props: { modelValue: true, param: null } })

    expect(wrapper.text()).toContain('参数名称')
    expect(wrapper.text()).toContain('分组')
    expect(wrapper.text()).toContain('默认值')
    expect(wrapper.find('option[value="list"]').exists()).toBe(true)
    expect(wrapper.find('option[value="date"]').exists()).toBe(true)
    expect(wrapper.find('option[value="sequence"]').exists()).toBe(true)
    expect(wrapper.find('option[value="date_sequence"]').exists()).toBe(true)
    expect(wrapper.find('option[value="database"]').exists()).toBe(true)
  })
})
