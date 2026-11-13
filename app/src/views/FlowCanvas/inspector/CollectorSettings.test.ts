// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { runnerManagementApi as api } from '@/api/runnerManagement'
import CollectorSettings from './CollectorSettings.vue'
import { COLLECTOR_CAPABILITIES } from '@/views/FlowCanvas/canvas/flowModel'

describe('CollectorSettings（0711 R5：采集节点运行设置，默认折叠）', () => {
  it('保存代理实际调用接口，切换源后重新打开同一配置能回读，不串到其他配置', async () => {
    let saved = { configId: '1401218', configured: false, revision: 0, useProxy: false }
    const load = vi.spyOn(api, 'nodeProxySettings').mockImplementation(async id => id === saved.configId ? saved : { configId: id, configured: false, revision: 0, useProxy: false })
    const save = vi.spyOn(api, 'saveNodeProxySettings').mockImplementation(async input => { saved = { ...input, configured: true, revision: 1 }; return saved })
    const props = { modelValue: { useProxy: false }, configId: '1401218', persistent: true, capability: COLLECTOR_CAPABILITIES.web }
    const first = mount(CollectorSettings, { props }); await flushPromises()
    await first.get('.cs-toggle').trigger('click')
    await first.get('input[type="checkbox"]').setValue(true)
    await first.get('[data-testid="proxy-curl-open"]').trigger('click')
    await first.get('[data-testid="proxy-curl-input"]').setValue('curl -x proxy.example.com:31100 -U "user:secret" cip.cc')
    await first.get('[data-testid="proxy-curl-apply"]').trigger('click'); await flushPromises()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ configId: '1401218', revision: 0, proxyDetail: expect.objectContaining({ ip: 'proxy.example.com', password: 'secret' }) }))
    expect(first.get('[role="status"]').text()).toContain('代理已保存')
    first.unmount()
    const second = mount(CollectorSettings, { props }); await flushPromises()
    await second.get('.cs-toggle').trigger('click')
    expect(second.get('input[type="password"]').element).toHaveProperty('value', 'secret')
    await second.setProps({ configId: '1401219' }); await flushPromises()
    expect(second.find('input[type="password"]').exists()).toBe(false)
    second.unmount(); load.mockRestore(); save.mockRestore()
  })
  it('勾选使用代理后才能导入，保存代理填入配置并清空原始命令', async () => {
    const wrapper = mount(CollectorSettings, { props: { modelValue: { useProxy: false }, capability: COLLECTOR_CAPABILITIES.web } })
    await wrapper.get('.cs-toggle').trigger('click')
    expect(wrapper.find('[data-testid="proxy-curl-open"]').exists()).toBe(false)
    await wrapper.setProps({ modelValue: { useProxy: true } })
    await wrapper.get('[data-testid="proxy-curl-open"]').trigger('click')
    await wrapper.get('[data-testid="proxy-curl-input"]').setValue('curl -x proxy.example.com:31100 -U "test-user:test-secret" cip.cc')
    expect(wrapper.get('[data-testid="proxy-curl-apply"]').text()).toBe('保存代理')
    await wrapper.get('[data-testid="proxy-curl-apply"]').trigger('click')
    const patch = wrapper.emitted('update:modelValue')![0]![0]
    expect(patch).toEqual({ useProxy: true, proxyDetail: { ip: 'proxy.example.com', port: 31100, account: 'test-user', password: 'test-secret' } })
    expect(wrapper.find('[data-testid="proxy-curl-input"]').exists()).toBe(false)
    await wrapper.setProps({ modelValue: patch as never })
    expect(wrapper.get('input[type="password"]').element).toHaveProperty('value', 'test-secret')
    await wrapper.get('[data-testid="proxy-curl-open"]').trigger('click')
    expect(wrapper.get('[data-testid="proxy-curl-input"]').element).toHaveProperty('value', '')
    await wrapper.setProps({ modelValue: { useProxy: false } })
    expect(wrapper.find('[data-testid="proxy-curl-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="proxy-curl-input"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('导入无效 cURL 只显示错误，不修改原来的代理设置', async () => {
    const wrapper = mount(CollectorSettings, { props: { modelValue: { useProxy: true, proxyDetail: { ip: 'old.proxy', port: 8080 } }, capability: COLLECTOR_CAPABILITIES.web } })
    await wrapper.get('.cs-toggle').trigger('click')
    await wrapper.get('[data-testid="proxy-curl-open"]').trigger('click')
    await wrapper.get('[data-testid="proxy-curl-input"]').setValue('curl cip.cc')
    await wrapper.get('[data-testid="proxy-curl-apply"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('缺少 -x')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
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

  it('运行设置不再承载定时策略', async () => {
    const wrapper = mount(CollectorSettings, {
      props: { modelValue: {}, capability: COLLECTOR_CAPABILITIES.web },
    })
    await wrapper.find('.cs-toggle').trigger('click')
    expect(wrapper.find('.tss-wrap').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('定时策略')
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

  it('旧登录配置只显示迁移提示，不再提供编辑入口', async () => {
    const wrapper = mount(CollectorSettings, {
      props: {
        modelValue: { needLogin: true, loginUrl: 'https://x.com/login', account: 'admin', credentialRef: 'cred-1' },
        capability: COLLECTOR_CAPABILITIES.web,
      },
    })
    await wrapper.find('.cs-toggle').trigger('click')
    expect(wrapper.text()).toContain('旧登录配置')
    expect(wrapper.find('.rc-segment').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
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

  // 代理明细（0804 S3-1）：勾选后才展开 IP/端口/账号/密码 4 个输入
  describe('代理明细（0804 S3-1）', () => {
    it('未勾选代理时不展示明细输入', async () => {
      const wrapper = mount(CollectorSettings, {
        props: { modelValue: { useProxy: false }, capability: COLLECTOR_CAPABILITIES.web },
      })
      await wrapper.find('.cs-toggle').trigger('click')
      expect(wrapper.find('.cs-proxy-grid').exists()).toBe(false)
    })

    it('已勾选代理时展示明细输入，填写后 patch proxyDetail', async () => {
      const wrapper = mount(CollectorSettings, {
        props: { modelValue: { useProxy: true }, capability: COLLECTOR_CAPABILITIES.web },
      })
      await wrapper.find('.cs-toggle').trigger('click')
      expect(wrapper.find('.cs-proxy-grid').exists()).toBe(true)

      const ipInput = wrapper.findAll('.cs-proxy-grid input')[0]
      await ipInput.setValue('192.168.1.1')
      const emitted = wrapper.emitted('update:modelValue')
      const last = emitted![emitted!.length - 1][0] as Record<string, unknown>
      expect(last).toEqual({ proxyDetail: { ip: '192.168.1.1' } })
    })

    it('填写端口时转成数字；清空时转回 undefined', async () => {
      const wrapper = mount(CollectorSettings, {
        props: { modelValue: { useProxy: true, proxyDetail: { ip: '10.0.0.1' } }, capability: COLLECTOR_CAPABILITIES.web },
      })
      await wrapper.find('.cs-toggle').trigger('click')
      const portInput = wrapper.findAll('.cs-proxy-grid input')[1]
      await portInput.setValue('8080')
      let emitted = wrapper.emitted('update:modelValue')
      let last = emitted![emitted!.length - 1][0] as Record<string, unknown>
      expect(last).toEqual({ proxyDetail: { ip: '10.0.0.1', port: 8080 } })

      await portInput.setValue('')
      emitted = wrapper.emitted('update:modelValue')
      last = emitted![emitted!.length - 1][0] as Record<string, unknown>
      expect((last.proxyDetail as Record<string, unknown>).port).toBeUndefined()
    })

    it('取消勾选代理时清空明细，避免残留脏数据', async () => {
      const wrapper = mount(CollectorSettings, {
        props: { modelValue: { useProxy: true, proxyDetail: { ip: '10.0.0.1', port: 8080 } }, capability: COLLECTOR_CAPABILITIES.web },
      })
      await wrapper.find('.cs-toggle').trigger('click')
      const proxyCheckbox = wrapper.find('.cs-check input[type="checkbox"]')
      await proxyCheckbox.setValue(false)
      const emitted = wrapper.emitted('update:modelValue')
      const last = emitted![emitted!.length - 1][0] as Record<string, unknown>
      expect(last).toEqual({ useProxy: false, proxyDetail: undefined })
    })
  })
})
