// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AiChatView from './index.vue'
import { submitClarificationAnswer, listRecommendedQuestions } from '@/api/aiChat'
import { downloadCsv } from '@/utils/csv'
import { downloadXlsx } from '@/utils/format/xlsxExport'

vi.mock('@/utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/csv')>()
  return {
    ...actual,
    downloadCsv: vi.fn(),
    csvDateTag: vi.fn(() => '20261111'),
  }
})

vi.mock('@/utils/format/xlsxExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/format/xlsxExport')>()
  return {
    ...actual,
    downloadXlsx: vi.fn(),
    exportDateTag: vi.fn(() => '20261111'),
  }
})

vi.mock('@/api/aiChat', () => ({
  listAiSessions: vi.fn().mockResolvedValue([]),
  listAiAgents: vi.fn().mockResolvedValue([
    { id: 'data-analyst', name: '数据分析智能体 (ChatBI)', desc: '分析测试', icon: 'Histogram' },
  ]),
  listRecommendedQuestions: vi.fn().mockResolvedValue([]),
  submitClarificationAnswer: vi.fn().mockResolvedValue(undefined),
  streamAgentChat: vi.fn().mockImplementation(async (_params, onEvent) => {
    onEvent({ type: 'chunk', text: '智能体已响应问数请求。' })
    onEvent({ type: 'done' })
  }),
}))

const mockSessions = [
  { id: 's1', title: '排查近期异常任务与成功率', updatedAt: '刚刚', group: 'today' as const },
  { id: 's2', title: '各网站抓取平均耗时与并发量', updatedAt: '3天前', group: 'week' as const },
]

const mockSessionMessages = {
  s1: [
    {
      id: 'm1-1',
      role: 'user' as const,
      content: '帮我排查一下最近的异常任务数据。',
      createdAt: '今天 15:35',
    },
    {
      id: 'm1-2',
      role: 'assistant' as const,
      content: '收到排查诉求，请选择表：',
      createdAt: '今天 15:35',
      clarification: {
        kind: 'table_choice' as const,
        reason: 'TOO_MANY' as const,
        question: '「异常任务」可能落在多张表里，请选择本次要排查的范围（可多选）：',
        allowFreeText: true,
        maxSelect: 5,
        options: [
          { entryTypeId: 101, tableName: 'ck_source_log', typeName: '抓取网络层异常', hint: 'HTTP 403' },
          { entryTypeId: 102, tableName: 'ck_clean_error', typeName: '规则清洗异常', hint: 'XPath失效' },
          { entryTypeId: 103, tableName: 'sys_runner_task', typeName: '调度队列积压', hint: '任务排队' },
        ],
      },
      thinking: {
        completed: true,
        durationMs: 1100,
        steps: ['定位数据表：ck_source_log'],
      },
      sql: {
        code: 'SELECT site_name FROM ck_source_log LIMIT 10;',
        execTimeMs: 82,
        scanRows: 32450,
      },
      kpis: [
        { label: '7天平均成功率', value: '97.45%', subtext: '正常', type: 'success' as const },
      ],
      chartData: {
        title: '📊 网络层失败率最高 TOP 3 网站对比',
        pieTitle: '🥧 异常任务网络故障成因占比分布',
        bars: [
          { label: '1. 行业资讯网', value: 68.2, displayValue: '68.20%', color: 'red' },
        ],
        slices: [
          { label: '行业资讯网', value: 412, displayValue: '412 次', color: '#dc2626', tone: 'err' as const },
        ],
        tableColumns: [
          { prop: 'siteName', label: '网站名称' },
          { prop: 'total', label: '总任务数' },
          { prop: 'success', label: '成功数' },
          { prop: 'fail', label: '失败数' },
          { prop: 'reason', label: '主要异常码' },
        ],
        tableRows: [
          { siteName: '行业资讯网', total: '1,296', success: '884', fail: '412', reason: 'HTTP 403 Forbidden' },
        ],
      },
      insights: ['建议启用动态隧道代理'],
      suggestions: ['帮我把上面失败率最高的前3个网站的数据导出为CSV表格'],
    },
  ],
  s2: [
    {
      id: 'm2-1',
      role: 'user' as const,
      content: '统计各网站近 3 天平均抓取耗时与并发量分布情况',
      createdAt: '3天前 11:15',
    },
    {
      id: 'm2-2',
      role: 'assistant' as const,
      content: '已完成各网站响应延时计算：',
      createdAt: '3天前 11:15',
    },
  ],
}

function mountView(withMockData = true) {
  return mount(AiChatView, {
    props: withMockData
      ? {
          initialSessions: mockSessions,
          initialMessages: mockSessionMessages,
        }
      : {},
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
    const wrapper = mountView(true)
    await flushPromises()

    expect(wrapper.find('.rc-aichat-brand').text()).toContain('AI 智能问数')
    expect(wrapper.find('.rc-newchat-btn').exists()).toBe(true)
    expect(wrapper.text()).toContain('排查近期异常任务与成功率')
  })

  it('多选表澄清卡片：选项来自候选，支持多选与取消', async () => {
    const wrapper = mountView(true)
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
    const wrapper = mountView(true)
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
    // 思考链里回显用户选中的表
    expect(wrapper.text()).toContain('抓取网络层异常')
  })

  it('回传失败时如实标注演示数据，不再提示“已完成”', async () => {
    vi.mocked(submitClarificationAnswer).mockRejectedValueOnce(new Error('[mock] 端点不在契约清单: ai/chat/clarification'))
    const wrapper = mountView(true)
    await flushPromises()

    await confirmWithTables(wrapper, [101])

    expect(submitClarificationAnswer).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="aichat-demo-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="aichat-demo-badge"]').text()).toContain('问数网关未接通')
    expect(wrapper.find('[data-testid="clarification-confirmed"]').exists()).toBe(true)
  })

  it('支持在趋势图表、占比饼图与明细数据表之间切换视图', async () => {
    const wrapper = mountView(true)
    await flushPromises()
    await confirmWithTables(wrapper, [101])

    expect(wrapper.find('.rc-chart-view').exists()).toBe(true)
    expect(wrapper.find('.rc-pie-view').exists()).toBe(false)
    expect(wrapper.find('.rc-table-view').exists()).toBe(false)

    // 切换到「占比饼图」视图
    const pieRadio = wrapper
      .findAll('.el-radio-button')
      .find((btn) => btn.text().includes('占比饼图'))
    expect(pieRadio).toBeTruthy()
    await pieRadio!.find('input').setValue('pie')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-pie-view').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rc-pie-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rc-pie-legend"]').exists()).toBe(true)
    expect(wrapper.findAll('.rc-pie-slice').length).toBeGreaterThan(0)
    expect(wrapper.find('.rc-chart-view').exists()).toBe(false)
    expect(wrapper.find('.rc-table-view').exists()).toBe(false)

    // 切换到「明细数据表」视图
    const tableRadio = wrapper
      .findAll('.el-radio-button')
      .find((btn) => btn.text().includes('明细数据表'))
    expect(tableRadio).toBeTruthy()
    await tableRadio!.find('input').setValue('table')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-table-view').exists()).toBe(true)
    expect(wrapper.find('.rc-pie-view').exists()).toBe(false)
    expect(wrapper.find('.rc-chart-view').exists()).toBe(false)

    // 切换回「趋势图表」视图
    const chartRadio = wrapper
      .findAll('.el-radio-button')
      .find((btn) => btn.text().includes('趋势图表'))
    expect(chartRadio).toBeTruthy()
    await chartRadio!.find('input').setValue('chart')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-chart-view').exists()).toBe(true)
    expect(wrapper.find('.rc-pie-view').exists()).toBe(false)
    expect(wrapper.find('.rc-table-view').exists()).toBe(false)
  })

  it('支持在明细数据表视图快捷导出 Excel 与 CSV', async () => {
    const wrapper = mountView(true)
    await flushPromises()
    await confirmWithTables(wrapper, [101])

    const tableRadio = wrapper
      .findAll('.el-radio-button')
      .find((btn) => btn.text().includes('明细数据表'))
    await tableRadio!.find('input').setValue('table')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-table-view').exists()).toBe(true)

    await wrapper.find('[data-testid="rc-table-export-excel"]').trigger('click')
    expect(downloadXlsx).toHaveBeenCalledTimes(1)
    const [xlsxFileName, xlsxRows] = vi.mocked(downloadXlsx).mock.calls[0]
    expect(xlsxFileName).toContain('20261111')
    expect(xlsxRows[0]).toEqual(['网站名称', '总任务数', '成功数', '失败数', '主要异常码'])

    await wrapper.find('[data-testid="rc-table-export-csv"]').trigger('click')
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [csvFileName, csvContent] = vi.mocked(downloadCsv).mock.calls[0]
    expect(csvFileName).toContain('20261111')
    expect(csvContent).toContain('网站名称,总任务数,成功数,失败数,主要异常码')
  })

  it('支持通过卡片顶部的导出下拉菜单导出 Excel 与 CSV', async () => {
    const wrapper = mountView(true)
    await flushPromises()
    await confirmWithTables(wrapper, [101])

    vi.mocked(downloadXlsx).mockClear()
    vi.mocked(downloadCsv).mockClear()

    const dropdown = wrapper.findComponent({ name: 'ElDropdown' })
    expect(dropdown.exists()).toBe(true)

    dropdown.vm.$emit('command', 'excel')
    await wrapper.vm.$nextTick()
    expect(downloadXlsx).toHaveBeenCalledTimes(1)

    dropdown.vm.$emit('command', 'csv')
    await wrapper.vm.$nextTick()
    expect(downloadCsv).toHaveBeenCalledTimes(1)
  })

  it('输入包含导出的自然语言指令时，能识别意图并自动触发对应文件下载', async () => {
    vi.useFakeTimers()
    const wrapper = mountView(true)
    await flushPromises()
    await confirmWithTables(wrapper, [101])

    vi.mocked(downloadCsv).mockClear()

    const input = wrapper.find('.rc-textarea')
    await input.setValue('帮我把上面失败率最高的前3个网站的数据导出为CSV表格')
    await wrapper.find('.rc-send-btn').trigger('click')
    await wrapper.vm.$nextTick()

    vi.advanceTimersByTime(700)
    await flushPromises()

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('已为您生成并导出')
    vi.useRealTimers()
  })

  it('点击「新建问数会话」应切换到新的会话页面，展示欢迎语与推荐场景卡片', async () => {
    const wrapper = mountView(true)
    await flushPromises()

    // 初始在 s1 会话中，不应存在新会话页面
    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(false)

    // 点击「新建问数会话」按钮
    await wrapper.find('.rc-newchat-btn').trigger('click')
    await wrapper.vm.$nextTick()

    // 应该显示新会话页面
    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(true)
    expect(wrapper.find('.rc-hero-title').text()).toContain('AI 智能问数助手')
    expect(wrapper.findAll('.rc-starter-card')).toHaveLength(4)
    expect(wrapper.find('.rc-chat-thread').exists()).toBe(false)
  })

  it('生产无预置会话时，初始直接进入新建会话页面，点击推荐卡片发起真实流式问数', async () => {
    const wrapper = mountView(false)
    await flushPromises()

    // 生产无会话时，初始就是新建会话页面
    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(true)
    expect(wrapper.find('.rc-chat-thread').exists()).toBe(false)

    const starterCards = wrapper.findAll('.rc-starter-card')
    expect(starterCards.length).toBeGreaterThan(0)

    // 点击第二个推荐场景卡片（昨日各站点抓取成功率 TOP 10）
    await starterCards[1].trigger('click')
    await flushPromises()

    // 新会话已创建，进入对话流，新会话欢迎页隐藏
    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(false)
    expect(wrapper.find('.rc-chat-thread').exists()).toBe(true)
    expect(wrapper.text()).toContain('昨日各站点抓取成功率 TOP 10')
  })

  it('当后端配置推荐问数场景（sys_page_config）时，动态加载并渲染后端配置的卡片', async () => {
    vi.mocked(listRecommendedQuestions).mockResolvedValueOnce([
      '近7天抓取异常最多的前5个网站',
      '统计各业务库的数据同步延时分布',
    ])
    const wrapper = mountView(false)
    await flushPromises()

    const cards = wrapper.findAll('.rc-starter-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].find('.rc-starter-badge').text()).toBe('推荐场景 01')
    expect(cards[0].find('.rc-starter-name').text()).toBe('近7天抓取异常最多的前5个网站')
    expect(cards[0].find('.rc-starter-desc').text()).toBe('近7天抓取异常最多的前5个网站')

    expect(cards[1].find('.rc-starter-badge').text()).toBe('推荐场景 02')
    expect(cards[1].find('.rc-starter-name').text()).toBe('统计各业务库的数据同步延时分布')

    // 点击第一个动态推荐卡片能够正常发起流式对话
    await cards[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(false)
    expect(wrapper.find('.rc-chat-thread').exists()).toBe(true)
    expect(wrapper.text()).toContain('近7天抓取异常最多的前5个网站')
  })

  it('在左侧会话列表中点击不同会话可切换会话内容', async () => {
    const wrapper = mountView(true)
    await flushPromises()

    // 初始渲染 s1
    expect(wrapper.text()).toContain('帮我排查一下最近的异常任务数据。')

    // 切换到 s2
    const sessionItems = wrapper.findAll('.rc-session-item')
    expect(sessionItems.length).toBeGreaterThanOrEqual(2)
    await sessionItems[1].trigger('click')
    await wrapper.vm.$nextTick()

    // s2 内容呈现，s1 专属问题不呈现
    expect(wrapper.text()).toContain('各网站抓取平均耗时与并发量')
    expect(wrapper.text()).not.toContain('帮我排查一下最近的异常任务数据。')

    // 切回 s1
    await sessionItems[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('帮我排查一下最近的异常任务数据。')
  })

  it('支持删除单条会话与清空所有会话', async () => {
    const wrapper = mountView(true)
    await flushPromises()

    const deleteBtns = wrapper.findAll('.rc-session-delete')
    expect(deleteBtns.length).toBeGreaterThan(0)
    await deleteBtns[0].trigger('click')
    await wrapper.vm.$nextTick()

    // s1 被删除
    expect(wrapper.text()).not.toContain('排查近期异常任务与成功率')

    // 点击清空
    await wrapper.find('.rc-clear-btn').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.rc-session-item')).toHaveLength(0)
    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(true)
  })

  it('智能体问答支持 Markdown 渲染与思考过程折叠展开', async () => {
    const testSession = [{ id: 'test_s1', title: '二手房价格查询', updatedAt: '刚刚', group: 'today' as const }]
    const testMessages = {
      test_s1: [
        {
          id: 'u-1',
          role: 'user' as const,
          content: '查询下南京二手房最新的价格',
          createdAt: '刚刚',
        },
        {
          id: 'a-1',
          role: 'assistant' as const,
          content: '根据数据查询，**南京二手房最新均价为 28,500 元/㎡**。\n- 近7天成交：120 套\n- 环比变动：+0.5%',
          createdAt: '刚刚',
          thinking: {
            completed: true,
            durationMs: 3200,
            steps: ['解析意图：南京 二手房 最新价格', '定位主表：tb_ke_com_chengjiao_esf_detail', '执行只读聚合查询'],
          },
        },
      ],
    }

    const wrapper = mount(AiChatView, {
      props: {
        initialSessions: testSession,
        initialMessages: testMessages,
      },
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    // 验证 Markdown 内容正常渲染
    expect(wrapper.find('.rc-answer-markdown').exists()).toBe(true)
    expect(wrapper.text()).toContain('南京二手房最新均价为 28,500 元/㎡')
    expect(wrapper.text()).toContain('近7天成交：120 套')

    // 验证思考过程卡片
    expect(wrapper.find('.rc-thinking-box').exists()).toBe(true)
    expect(wrapper.find('.rc-thinking-title').text()).toContain('耗时 3.2s')

    // 默认折叠（有 content 回复时默认折叠）
    expect(wrapper.find('.rc-thinking-body').exists()).toBe(false)

    // 点击展开思考过程
    await wrapper.find('.rc-thinking-header').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rc-thinking-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('解析意图：南京 二手房 最新价格')
  })

  it('当思考完成但未返回任何正文时，自动展开思考过程并展示兜底提示', async () => {
    const testSession = [{ id: 'test_empty', title: '无结果测试', updatedAt: '刚刚', group: 'today' as const }]
    const testMessages = {
      test_empty: [
        {
          id: 'u-2',
          role: 'user' as const,
          content: '查询下南京二手房最新的价格',
          createdAt: '刚刚',
        },
        {
          id: 'a-2',
          role: 'assistant' as const,
          content: '',
          createdAt: '刚刚',
          thinking: {
            completed: true,
            durationMs: 14423,
            steps: ['正在检索上游表元数据...', '上游服务超时未响应，无法生成 SQL'],
          },
        },
      ],
    }

    const wrapper = mount(AiChatView, {
      props: {
        initialSessions: testSession,
        initialMessages: testMessages,
      },
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    // 自动展示兜底状态提示
    expect(wrapper.find('.rc-empty-fallback-hint').exists()).toBe(true)
    expect(wrapper.find('.rc-empty-fallback-hint').text()).toContain('思考分析已完成，但未返回最终回答内容')

    // 思考过程自动展开呈现，日志可见
    expect(wrapper.find('.rc-thinking-body').exists()).toBe(true)
    expect(wrapper.text()).toContain('正在检索上游表元数据...')
    expect(wrapper.text()).toContain('上游服务超时未响应，无法生成 SQL')
  })

  it('智能体回答中包含待确认项时，自动渲染勾选卡片并支持用户交互勾选与确认推进', async () => {
    const testSession = [{ id: 'test_clarify', title: '二手房选表待确认', updatedAt: '刚刚', group: 'today' as const }]
    const testMessages = {
      test_clarify: [
        {
          id: 'u-clarify',
          role: 'user' as const,
          content: '查询下南京二手房最新的价格',
          createdAt: '刚刚',
        },
        {
          id: 'a-clarify',
          role: 'assistant' as const,
          content: '为您检索到以下待确认的候选表，请勾选需要分析的项：',
          createdAt: '刚刚',
          clarification: {
            kind: 'table_choice' as const,
            reason: 'TOO_MANY' as const,
            question: '请勾选需要分析的表：',
            allowFreeText: true,
            maxSelect: 5,
            options: [
              {
                entryTypeId: 301,
                tableName: 'sense_data.tb_ke_com_chengjia_esf_detail',
                typeName: '南京链家二手房成交明细',
                hint: '含单价与成交走势',
              },
              {
                entryTypeId: 302,
                tableName: 'sense_data.tb_anjuke_esf_summary',
                typeName: '南京安居客二手房挂牌均价',
                hint: '各区挂牌均价汇总',
              },
            ],
          },
        },
      ],
    }

    const wrapper = mount(AiChatView, {
      props: {
        initialSessions: testSession,
        initialMessages: testMessages,
      },
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    // 待确认勾选卡片应存在
    const card = wrapper.find('[data-testid="clarification-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('最多 5 张')

    // 勾选第 1 个选项
    const opt1 = wrapper.find('[data-testid="clarification-option-301"]')
    expect(opt1.exists()).toBe(true)
    await opt1.trigger('click')
    expect(opt1.classes()).toContain('selected')

    // 勾选第 2 个选项
    const opt2 = wrapper.find('[data-testid="clarification-option-302"]')
    expect(opt2.exists()).toBe(true)
    await opt2.trigger('click')
    expect(opt2.classes()).toContain('selected')

    // 点击确认选择
    const confirmBtn = wrapper.find('[data-testid="clarification-confirm"]')
    expect(confirmBtn.exists()).toBe(true)
    await confirmBtn.trigger('click')
    await flushPromises()

    // 确认后卡片锁定并展示已采纳状态
    expect(wrapper.find('[data-testid="clarification-confirmed"]').exists()).toBe(true)

    // 智能体对话自动推进，将勾选的项作为新轮次发送给会话
    expect(wrapper.text()).toContain('已确认选择：南京链家二手房成交明细、南京安居客二手房挂牌均价')
  })

  it('智能体返回 Markdown 候选表表格时，自动渲染成交互表格并支持点击「直接使用」一键推进会话', async () => {
    const tableContent = `
| 编号 | 表名 | 说明 |
| --- | --- | --- |
| 1 | \`TB_ZZ_MONTH_OLD_PRICE\` | 中指-二手房销售价格 |
| 6 | \`tb_ke_com_chengjiao_esf\` | 贝壳二手房成交信息 |

请问你希望用哪张表？例如回复"6"（贝壳二手房成交信息）。
`
    const testSession = [{ id: 'test_table_click', title: '点击选表测试', updatedAt: '刚刚', group: 'today' as const }]
    const testMessages = {
      test_table_click: [
        {
          id: 'u-table',
          role: 'user' as const,
          content: '查询下南京二手房最新的价格',
          createdAt: '刚刚',
        },
        {
          id: 'a-table',
          role: 'assistant' as const,
          content: tableContent,
          createdAt: '刚刚',
          clarification: {
            kind: 'table_choice' as const,
            reason: 'TOO_MANY' as const,
            question: '请问你希望用哪张表？例如回复"6"（贝壳二手房成交信息）。',
            allowFreeText: true,
            maxSelect: 5,
            options: [
              {
                entryTypeId: 1,
                tableName: 'TB_ZZ_MONTH_OLD_PRICE',
                typeName: '中指-二手房销售价格',
                hint: '编号: 1',
              },
              {
                entryTypeId: 6,
                tableName: 'tb_ke_com_chengjiao_esf',
                typeName: '贝壳二手房成交信息',
                hint: '编号: 6',
              },
            ],
          },
        },
      ],
    }

    const wrapper = mount(AiChatView, {
      props: {
        initialSessions: testSession,
        initialMessages: testMessages,
      },
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    // 交互表格应存在
    expect(wrapper.find('[data-testid="clarification-table"]').exists()).toBe(true)

    // 点击编号 6 行的「直接使用」按钮
    const directBtn6 = wrapper.find('[data-testid="clarification-direct-6"]')
    expect(directBtn6.exists()).toBe(true)
    await directBtn6.trigger('click')
    await flushPromises()

    // 确认状态呈现
    expect(wrapper.find('[data-testid="clarification-confirmed"]').exists()).toBe(true)

    // 对话流中自动发出单项指令，无需用户手动在输入框敲字
    expect(wrapper.text()).toContain('6（贝壳二手房成交信息）')
  })
})
