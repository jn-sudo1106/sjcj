// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AiChatView from './index.vue'
import { submitClarificationAnswer } from '@/api/aiChat'

vi.mock('@/api/aiChat', () => ({
  listAiSessions: vi.fn().mockResolvedValue([
    { id: 's1', title: '排查近期异常任务与成功率', updatedAt: '刚刚', group: 'today' },
    { id: 's2', title: '各网站抓取平均耗时与并发量', updatedAt: '3天前', group: 'week' },
  ]),
  listAiAgents: vi.fn().mockResolvedValue([
    { id: 'data-analyst', name: '数据分析智能体 (ChatBI)', desc: '分析测试', icon: 'Histogram' },
  ]),
  submitClarificationAnswer: vi.fn().mockResolvedValue(undefined),
}))

function mountView() {
  return mount(AiChatView, {
    global: {
      plugins: [ElementPlus],
    },
  })
}

async function confirmWithTables(wrapper: ReturnType<typeof mount>, ids: number[]) {
  for (const id of ids) {
    await wrapper.find(`[data-testid="clarification-option-${id}"]`).trigger('click')
  }
  await wrapper.find('[data-testid="clarification-confirm"]').trigger('click')
  await flushPromises()
}

describe('AI 智能问数 · AiChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('正确渲染左侧会话历史、顶部智能体与中间对话流', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.rc-aichat-brand').text()).toContain('AI 智能问数')
    expect(wrapper.find('.rc-newchat-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('排查近期异常任务与成功率')
  })

  it('多选表澄清卡片：选项来自候选，支持多选与取消', async () => {
    const wrapper = mountView()
    await flushPromises()

    const options = wrapper.findAll('[data-testid^="clarification-option-"]')
    expect(options).toHaveLength(3)
    expect(wrapper.find('[data-testid="clarification-card"]').text()).toContain('最多 5 张')

    await options[0].trigger('click')
    await options[2].trigger('click')
    expect(options[0].classes()).toContain('selected')
    expect(options[2].classes()).toContain('selected')
    expect(wrapper.find('[data-testid="clarification-confirm"]').attributes('disabled')).toBeUndefined()

    // 再点一次取消选择
    await options[0].trigger('click')
    expect(options[0].classes()).not.toContain('selected')
  })

  it('确认后锁定卡片、按 entryTypeId 回传并展开执行结果', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.rc-confirmed-result').exists()).toBe(false)

    await confirmWithTables(wrapper, [101, 102])

    expect(wrapper.find('.rc-confirmed-result').exists()).toBe(true)
    expect(wrapper.find('[data-testid="clarification-confirmed"]').exists()).toBe(true)
    expect(wrapper.find('.rc-sql-code').text()).toContain('SELECT')
    expect(wrapper.find('.rc-kpi-grid').exists()).toBe(true)
    expect(submitClarificationAnswer).toHaveBeenCalledWith(expect.objectContaining({
      selectedEntryTypeIds: [101, 102],
    }))
    // 思考链里回显用户选中的表，而不是写死的演示文案
    expect(wrapper.text()).toContain('抓取网络层异常')
  })

  it('回传失败时如实标注演示数据，不再提示“已完成”', async () => {
    vi.mocked(submitClarificationAnswer).mockRejectedValueOnce(new Error('[mock] 端点不在契约清单: ai/chat/clarification'))
    const wrapper = mountView()
    await flushPromises()

    await confirmWithTables(wrapper, [101])

    expect(submitClarificationAnswer).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="aichat-demo-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="aichat-demo-badge"]').text()).toContain('问数网关未接通')
    // 结果区照常展示，但卡片仍锁定为已采纳，不回到未确认状态
    expect(wrapper.find('[data-testid="clarification-confirmed"]').exists()).toBe(true)
  })

  it('支持在趋势图表与明细数据表之间切换视图', async () => {
    const wrapper = mountView()
    await flushPromises()
    await confirmWithTables(wrapper, [101])

    expect(wrapper.find('.rc-chart-view').exists()).toBe(true)
    expect(wrapper.find('.rc-table-view').exists()).toBe(false)

    const radioBtns = wrapper.findAll('.el-radio-button')
    if (radioBtns.length >= 2) {
      await radioBtns[1].find('input').setValue('table')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.rc-table-view').exists()).toBe(true)
    }
  })
})
