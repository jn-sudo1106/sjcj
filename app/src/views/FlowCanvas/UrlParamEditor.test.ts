// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import UrlParamEditor from './UrlParamEditor.vue'

describe('UrlParamEditor', () => {
  it('默认折叠在运行设置上方的参数配置，点击后展示参数写法提示', async () => {
    const wrapper = mount(UrlParamEditor, {
      props: {
        url: 'https://example.com/notice?lang=zh',
        paramValues: {},
      },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })

    expect(wrapper.find('.upe-toggle').text()).toContain('参数配置')
    expect(wrapper.find('.upe-body').exists()).toBe(false)

    await wrapper.find('.upe-toggle').trigger('click')

    expect(wrapper.find('.upe-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无参数占位符')
    expect(wrapper.text()).toContain('$PARAM$_参数ID')
  })

  it('标题显示节点已绑定的参数数量，而不是 URL 中 token 数量', () => {
    const wrapper = mount(UrlParamEditor, {
      props: {
        url: 'https://example.com/notice',
        paramRefs: ['1035', '1036'],
        paramValues: {},
      },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })

    expect(wrapper.find('.upe-toggle').text()).toContain('参数配置（2 个）')
  })

  it('最终 URL 预览支持一键复制当前预览 URL', async () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mount(UrlParamEditor, {
      props: {
        url: 'https://example.com/list?date=$PARAM$_p-date',
        paramRefs: ['p-date'],
        paramValues: { 'p-date': '2026-07-12' },
      },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
    })

    await wrapper.find('.upe-toggle').trigger('click')
    await wrapper.find('.upe-copy').trigger('click')

    expect(writeText).toHaveBeenCalledWith('https://example.com/list?date=2026-07-12')
  })
})
