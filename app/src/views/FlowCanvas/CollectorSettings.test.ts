// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CollectorSettings from './CollectorSettings.vue'
import { COLLECTOR_CAPABILITIES } from './flowModel'

describe('CollectorSettings（0711 R5：采集节点运行设置，默认折叠）', () => {
  it('capability 未传或不支持任何能力时不渲染任何内容', () => {
    const wrapper = mount(CollectorSettings, { props: { modelValue: {} } })
    expect(wrapper.find('.cs-wrap').exists()).toBe(false)
  })

  it('默认折叠：折叠区标题存在但内容不展示，点击后展开', async () => {
    const wrapper = mount(CollectorSettings, {
      props: { modelValue: {}, capability: COLLECTOR_CAPABILITIES.web },
    })
    expect(wrapper.find('.cs-toggle').text()).toContain('运行设置')
    expect(wrapper.find('.cs-body').exists()).toBe(false)
    await wrapper.find('.cs-toggle').trigger('click')
    expect(wrapper.find('.cs-body').exists()).toBe(true)
  })

  it('首节点将定时策略显示在运行设置内', async () => {
    const wrapper = mount(CollectorSettings, {
      props: { modelValue: {}, capability: COLLECTOR_CAPABILITIES.web, showSchedule: true },
    })
    await wrapper.find('.cs-toggle').trigger('click')
    expect(wrapper.find('.tss-wrap').exists()).toBe(true)
  })

  it('按 capability 精确显示控件：不支持代理/登录的节点类型不显示对应控件', async () => {
    // python 能力：不支持代理/断点续爬/登录（见 COLLECTOR_CAPABILITIES.python）
    const wrapper = mount(CollectorSettings, {
      props: { modelValue: {}, capability: COLLECTOR_CAPABILITIES.python },
    })
    expect(wrapper.find('.cs-wrap').exists()).toBe(false) // python 三项能力全 false，整块不渲染
  })

  it('浏览器/公众号抓取（先做成同构）：均支持代理/断点续爬/登录', () => {
    const browser = mount(CollectorSettings, { props: { modelValue: {}, capability: COLLECTOR_CAPABILITIES.browser_html } })
    const wechat = mount(CollectorSettings, { props: { modelValue: {}, capability: COLLECTOR_CAPABILITIES.wechat_official_html } })
    expect(browser.find('.cs-wrap').exists()).toBe(true)
    expect(wechat.find('.cs-wrap').exists()).toBe(true)
  })

  it('登录关闭时清理 loginUrl/credentialRef/account', async () => {
    const wrapper = mount(CollectorSettings, {
      props: {
        modelValue: { needLogin: true, loginUrl: 'https://x.com/login', account: 'admin', credentialRef: 'cred-1' },
        capability: COLLECTOR_CAPABILITIES.web,
      },
    })
    await wrapper.find('.cs-toggle').trigger('click')
    const offBtn = wrapper.findAll('.rc-segment button')[0]
    await offBtn.trigger('click')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    const patch = emitted![emitted!.length - 1][0] as Record<string, unknown>
    expect(patch.needLogin).toBe(false)
    expect(patch.loginUrl).toBe('')
    expect(patch.account).toBe('')
    expect(patch.credentialRef).toBe('')
  })

  it('切换代理 checkbox 只 emit 变更的字段', async () => {
    const wrapper = mount(CollectorSettings, {
      props: { modelValue: { useProxy: false }, capability: COLLECTOR_CAPABILITIES.web },
    })
    await wrapper.find('.cs-toggle').trigger('click')
    const proxyCheckbox = wrapper.find('.cs-check input[type="checkbox"]')
    await proxyCheckbox.setValue(true)
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toEqual({ useProxy: true })
  })
})
