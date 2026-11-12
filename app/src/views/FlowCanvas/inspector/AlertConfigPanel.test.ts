// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AlertConfigPanel from './AlertConfigPanel.vue'

// 节点上已保存的告警配置（对应 NodeConfig.alertConfig）。面板只回填它，不再自带演示值。
const SAVED_CONFIG = {
  enabled: true,
  policies: [
    {
      name: '数据延迟超过阈值',
      metric: 'delay_minutes',
      operator: 'gt',
      threshold: '30',
      consecutiveCount: 3,
      repeatMinutes: 30,
      recoveryNotify: true,
      enabled: true,
      channelTypes: ['email', 'dingtalk'] as Array<'email' | 'dingtalk'>,
    },
  ],
  channels: [
    { type: 'email' as const, enabled: true, target: 'ops@example.com' },
    { type: 'dingtalk' as const, enabled: true, target: 'Webhook 已配置 · @数据值班' },
  ],
}

function mountPanel(alertConfig: typeof SAVED_CONFIG | null = SAVED_CONFIG) {
  return mount(AlertConfigPanel, {
    props: {
      nodeId: 'monitor-1',
      nodeTitle: '数据质量监控',
      sourceLabel: 'test1 / TEST_ADB',
      scriptPath: '/code01/202609/monitor.py',
      alertConfig: alertConfig ?? undefined,
    },
    global: { plugins: [ElementPlus] },
  })
}

function lastInput(testId: string): HTMLInputElement {
  const items = Array.from(document.body.querySelectorAll(`[data-testid="${testId}"]`))
  return items.at(-1) as HTMLInputElement
}

function lastElement(testId: string): HTMLElement {
  const items = Array.from(document.body.querySelectorAll(`[data-testid="${testId}"]`))
  return items.at(-1) as HTMLElement
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

  it('策略或渠道保存后向父组件同步规范化告警配置', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.get('[data-testid="alert-channel-edit-email"]').trigger('click')
    const recipients = lastInput('alert-email-recipients')
    recipients.value = 'alarm@example.com'
    recipients.dispatchEvent(new Event('input', { bubbles: true }))
    lastElement('alert-save-channel').dispatchEvent(new Event('click', { bubbles: true }))
    await flushPromises()

    const emitted = wrapper.emitted('update:alert-config')?.at(-1)?.[0]
    expect(emitted).toMatchObject({
      enabled: true,
      policies: [{
        name: '数据延迟超过阈值',
        metric: 'delay_minutes',
        operator: 'gt',
        threshold: '30',
        enabled: true,
        channelTypes: ['email', 'dingtalk'],
      }],
      channels: expect.arrayContaining([
        expect.objectContaining({ type: 'email', enabled: true, target: 'alarm@example.com' }),
      ]),
    })
  })

  // 评审 E1 回归：挂载/切节点只回填，不得 emit——否则「打开编排页 + 任意一次保存」
  // 就会把已存告警配置改成面板里的演示值。
  it('挂载时不 emit（浏览节点不等于修改告警）', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.emitted('update:alert-config')).toBeUndefined()
  })

  it('节点没有告警配置时显示空态，不注入演示策略', async () => {
    const wrapper = mountPanel(null)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="alert-policy-row"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('还没有通知渠道')
    expect(wrapper.emitted('update:alert-config')).toBeUndefined()
  })

  it('没有渠道时保存策略会被拦下（提示先加渠道）', async () => {
    const wrapper = mountPanel(null)
    await wrapper.get('[data-testid="alert-add-policy"]').trigger('click')
    const name = document.body.querySelector('[data-testid="alert-policy-name"]') as HTMLInputElement
    name.value = '空值率'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector('[data-testid="alert-save-policy"]')?.dispatchEvent(new Event('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:alert-config')).toBeUndefined()
  })
})
