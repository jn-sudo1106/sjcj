// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AlertConfigPanel from './AlertConfigPanel.vue'

function mountPanel() {
  return mount(AlertConfigPanel, {
    props: {
      nodeId: 'monitor-1',
      nodeTitle: '数据质量监控',
      sourceLabel: 'test1 / TEST_ADB',
      scriptPath: '/code01/202609/monitor.py',
    },
    global: { plugins: [ElementPlus] },
  })
}

describe('AlertConfigPanel', () => {
  it('展示默认策略、邮件和钉钉渠道，并支持启停策略', async () => {
    const wrapper = mountPanel()

    expect(wrapper.get('[data-testid="monitor-alert-config"]').text()).toContain('告警配置')
    expect(wrapper.get('[data-testid="alert-policy-row"]').text()).toContain('数据延迟超过阈值')
    expect(wrapper.get('[data-testid="alert-channel-email"]').text()).toContain('邮件')
    expect(wrapper.get('[data-testid="alert-channel-dingtalk"]').text()).toContain('钉钉')

    await wrapper.get('[data-testid="alert-policy-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="alert-policy-toggle"]').attributes('aria-pressed')).toBe('false')
  })

  it('新增策略时可编辑阈值、通知渠道和恢复通知', async () => {
    const wrapper = mountPanel()

    await wrapper.get('[data-testid="alert-add-policy"]').trigger('click')
    expect(document.body.textContent).toContain('新增告警策略')

    const name = document.body.querySelector('[data-testid="alert-policy-name"]') as HTMLInputElement
    name.value = '入库数量为零'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    const threshold = document.body.querySelector('[data-testid="alert-policy-threshold"]') as HTMLInputElement
    threshold.value = '0'
    threshold.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const dingtalk = document.body.querySelector('[data-testid="alert-channel-option-dingtalk"]') as HTMLInputElement
    dingtalk.click()
    const recovery = document.body.querySelector('[data-testid="alert-recovery-toggle"]') as HTMLInputElement
    recovery.click()
    document.body.querySelector('[data-testid="alert-save-policy"]')?.dispatchEvent(new Event('click', { bubbles: true }))
    await flushPromises()

    expect(wrapper.findAll('[data-testid="alert-policy-row"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('入库数量为零')
  })

  it('可配置邮件收件人并在渠道卡片回显', async () => {
    const wrapper = mountPanel()

    await wrapper.get('[data-testid="alert-channel-edit-email"]').trigger('click')
    expect(document.body.textContent).toContain('配置邮件渠道')

    const recipients = document.body.querySelector('[data-testid="alert-email-recipients"]') as HTMLInputElement
    recipients.value = 'data@example.com; ops@example.com'
    recipients.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector('[data-testid="alert-save-channel"]')?.dispatchEvent(new Event('click', { bubbles: true }))
    await flushPromises()

    expect(wrapper.get('[data-testid="alert-channel-email"]').text()).toContain('data@example.com; ops@example.com')
  })

  it('可配置钉钉 Webhook 和加签密钥，保存后只回显已配置状态', async () => {
    const wrapper = mountPanel()

    await wrapper.get('[data-testid="alert-channel-edit-dingtalk"]').trigger('click')
    expect(document.body.textContent).toContain('配置钉钉渠道')

    const webhook = document.body.querySelector('[data-testid="alert-dingtalk-webhook"]') as HTMLInputElement
    webhook.value = 'https://oapi.dingtalk.com/robot/send?access_token=demo'
    webhook.dispatchEvent(new Event('input', { bubbles: true }))
    const secret = document.body.querySelector('[data-testid="alert-dingtalk-secret"]') as HTMLInputElement
    secret.value = 'demo-secret'
    secret.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector('[data-testid="alert-save-channel"]')?.dispatchEvent(new Event('click', { bubbles: true }))
    await flushPromises()

    expect(wrapper.get('[data-testid="alert-channel-dingtalk"]').text()).toContain('Webhook 已配置')
    expect(wrapper.get('[data-testid="alert-channel-dingtalk"]').text()).not.toContain('demo-secret')
  })
})
