// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UrlParamEditor from './UrlParamEditor.vue'

describe('UrlParamEditor', () => {
  it('参数配置作为独立 Tab 内容时默认展开', () => {
    const wrapper = mount(UrlParamEditor, {
      props: {
        url: 'https://example.com/notice?lang=zh',
        paramValues: {},
      },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })

    expect(wrapper.find('.upe-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无参数占位符')
    expect(wrapper.text()).toContain('$PARAM$_参数ID')
  })

  it('已绑定参数会直接显示在展开内容中', () => {
    const wrapper = mount(UrlParamEditor, {
      props: {
        url: 'https://example.com/notice',
        paramRefs: ['1035', '1036'],
        paramValues: {},
      },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })

    expect(wrapper.findAll('.upe-row')).toHaveLength(2)
  })
})
