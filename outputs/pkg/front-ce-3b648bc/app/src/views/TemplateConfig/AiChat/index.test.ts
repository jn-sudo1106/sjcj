// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AiChatView from './index.vue'

vi.mock('@/api/aiChat', () => ({
  listAiSessions: vi.fn().mockResolvedValue([
    { id: 's1', title: '排查近期异常任务与成功率', updatedAt: '刚刚', group: 'today' },
    { id: 's2', title: '各网站抓取平均耗时与并发量', updatedAt: '3天前', group: 'week' },
  ]),
  listAiAgents: vi.fn().mockResolvedValue([
    { id: 'data-analyst', name: '数据分析智能体 (ChatBI)', desc: '分析测试', icon: 'Histogram' },
  ]),
}))

describe('AI 智能问数 · AiChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('正确渲染左侧会话历史、顶部智能体与中间对话流', async () => {
    const wrapper = mount(AiChatView, {
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    expect(wrapper.find('.rc-aichat-brand').text()).toContain('AI 智能问数')
    expect(wrapper.find('.rc-newchat-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('排查近期异常任务与成功率')
  })

  it('展示多轮问答中的「交互式澄清卡片」，支持点击切换维度与时间', async () => {
    const wrapper = mount(AiChatView, {
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    const dimCards = wrapper.findAll('.rc-dim-card')
    expect(dimCards.length).toBe(3)
    expect(dimCards[0].classes()).toContain('selected')

    // 点击第二个维度
    await dimCards[1].trigger('click')
    expect(dimCards[1].classes()).toContain('selected')
    expect(dimCards[0].classes()).not.toContain('selected')

    // 切换时间窗口
    const timeBtns = wrapper.findAll('.rc-time-btn')
    expect(timeBtns.length).toBe(3)
    await timeBtns[0].trigger('click')
    expect(timeBtns[0].classes()).toContain('active')
  })

  it('点击「确认选择并开始分析」后锁定澄清卡片并展开执行结果、SQL卡片与图表', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AiChatView, {
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    expect(wrapper.find('.rc-confirmed-result').exists()).toBe(false)

    // 触发确认
    const confirmBtn = wrapper.find('.rc-card-footer .el-button')
    await confirmBtn.trigger('click')

    // 推进定时器
    vi.advanceTimersByTime(800)
    await wrapper.vm.$nextTick()

    // 确认结果区渲染出来
    expect(wrapper.find('.rc-confirmed-result').exists()).toBe(true)
    expect(wrapper.find('.rc-sql-code').text()).toContain('SELECT')
    expect(wrapper.find('.rc-kpi-grid').exists()).toBe(true)

    vi.useRealTimers()
  })

  it('支持在趋势图表与明细数据表之间切换视图', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AiChatView, {
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    // 确认口径
    await wrapper.find('.rc-card-footer .el-button').trigger('click')
    vi.advanceTimersByTime(800)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-chart-view').exists()).toBe(true)
    expect(wrapper.find('.rc-table-view').exists()).toBe(false)

    // 切换到 table
    const radioBtns = wrapper.findAll('.el-radio-button')
    if (radioBtns.length >= 2) {
      await radioBtns[1].find('input').setValue('table')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.rc-table-view').exists()).toBe(true)
    }

    vi.useRealTimers()
  })
})
