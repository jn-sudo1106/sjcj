// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AiChatView from './index.vue'
import { submitClarificationAnswer, listRecommendedQuestions, streamAgentChat } from '@/api/aiChat'
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

vi.mock('@/api/aiChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/aiChat')>()
  return {
    ...actual,
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
  }
})

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
    expect(wrapper.find('[data-testid="clarification-card"]').text()).toContain('最多 3 张')

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

    // 默认展示用户要求的明细数据表（列表）视图
    expect(wrapper.find('.rc-table-view').exists()).toBe(true)
    expect(wrapper.find('.rc-pie-view').exists()).toBe(false)
    expect(wrapper.find('.rc-chart-view').exists()).toBe(false)

    // 切换到「趋势图表」视图
    const chartRadio = wrapper
      .findAll('.el-radio-button')
      .find((btn) => btn.text().includes('趋势图表'))
    expect(chartRadio).toBeTruthy()
    await chartRadio!.find('input').setValue('chart')
    await wrapper.vm.$nextTick()

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

    // 切换回「明细数据表」视图
    const tableRadio = wrapper
      .findAll('.el-radio-button')
      .find((btn) => btn.text().includes('明细数据表'))
    expect(tableRadio).toBeTruthy()
    await tableRadio!.find('input').setValue('table')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-table-view').exists()).toBe(true)
    expect(wrapper.find('.rc-pie-view').exists()).toBe(false)
    expect(wrapper.find('.rc-chart-view').exists()).toBe(false)
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

  it('点击「新建问数会话」应切换到新的会话页面，展示欢迎语；无后端推荐数据时不展示推荐卡片', async () => {
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
    // 后端无配置时不渲染推荐卡片区域
    expect(wrapper.find('.rc-starters-section').exists()).toBe(false)
    expect(wrapper.findAll('.rc-starter-card')).toHaveLength(0)
    expect(wrapper.find('.rc-chat-thread').exists()).toBe(false)
  })

  it('生产无预置会话且后端配置推荐场景时，展示后端卡片，点击推荐卡片发起真实流式问数', async () => {
    vi.mocked(listRecommendedQuestions).mockResolvedValueOnce([
      '排查近期异常任务与根因',
      '昨日各站点抓取成功率 TOP 10',
    ])
    const wrapper = mountView(false)
    await flushPromises()

    // 生产无会话时，初始就是新建会话页面
    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(true)
    expect(wrapper.find('.rc-chat-thread').exists()).toBe(false)

    const starterCards = wrapper.findAll('.rc-starter-card')
    expect(starterCards).toHaveLength(2)

    // 点击第二个推荐场景卡片（昨日各站点抓取成功率 TOP 10）
    await starterCards[1].trigger('click')
    await flushPromises()

    // 新会话已创建，进入对话流，新会话欢迎页隐藏
    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(false)
    expect(wrapper.find('.rc-chat-thread').exists()).toBe(true)
    expect(wrapper.text()).toContain('昨日各站点抓取成功率 TOP 10')
  })

  it('后端未配置推荐问数场景（返回空列表）时，整块推荐问数场景不展示', async () => {
    vi.mocked(listRecommendedQuestions).mockResolvedValueOnce([])
    const wrapper = mountView(false)
    await flushPromises()

    expect(wrapper.find('[data-testid="new-session-view"]').exists()).toBe(true)
    expect(wrapper.find('.rc-starters-section').exists()).toBe(false)
    expect(wrapper.findAll('.rc-starter-card')).toHaveLength(0)
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
    expect(card.text()).toContain('最多 2 张')

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

  it('当智能体返回 Markdown 业务数据表格时，自动生成图表与明细数据卡片，支持多视图切换与一键导出', async () => {
    const testSession = [
      { id: 's-data', title: '查询南京二手房成交记录', updatedAt: '刚刚', group: 'today' as const },
    ]
    const testMessages = {
      's-data': [
        {
          id: 'm-u1',
          role: 'user' as const,
          content: '查询下南京二手房最新的价格',
          createdAt: '刚刚',
        },
        {
          id: 'm-a1',
          role: 'assistant' as const,
          content: `为您检索到南京二手房最新成交记录如下：

| 小区 | 成交日期 | 户型 | 建筑面积(m²) |
| --- | --- | --- | --- |
| 创维文汇苑 | 2026-10-18 | 3室2厅 | 100.7 |
| 雍澜和府 | 2026-10-18 | 3室2厅 | 105.41 |
| 欧陆经典花园 | 2026-10-18 | 2室2厅 | 89.55 |
| 威尼斯水城第十四街区 | 2026-10-18 | 2室2厅 | 91.27 |`,
          createdAt: '刚刚',
          thinking: {
            completed: true,
            durationMs: 850,
            steps: ['执行 SQL 检索二手房明细数据'],
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

    // 1. 数据视图卡片自动渲染
    expect(wrapper.find('.rc-dataview-card').exists()).toBe(true)
    // 标题包含度量指标
    expect(wrapper.find('.rc-dataview-title').text()).toContain('建筑面积(m²)')

    // 2. 默认呈现用户要求的明细数据表（列表）视图
    expect(wrapper.find('.rc-table-view').exists()).toBe(true)
    expect(wrapper.text()).toContain('共 4 条明细记录')
    expect(wrapper.text()).toContain('创维文汇苑')
    expect(wrapper.text()).toContain('100.7')

    // 3. 点击明细表顶部的「导出 Excel」按钮触发下载
    const exportExcelBtn = wrapper.find('[data-testid="rc-table-export-excel"]')
    expect(exportExcelBtn.exists()).toBe(true)
    await exportExcelBtn.trigger('click')
    expect(downloadXlsx).toHaveBeenCalled()

    // 4. 点击「导出 CSV」按钮触发下载
    const exportCsvBtn = wrapper.find('[data-testid="rc-table-export-csv"]')
    expect(exportCsvBtn.exists()).toBe(true)
    await exportCsvBtn.trigger('click')
    expect(downloadCsv).toHaveBeenCalled()

    // 5. 切换到趋势柱状图视图
    const radioButtons = wrapper.findAll('.el-radio-button')
    await radioButtons[0].find('input').trigger('change')
    await flushPromises()

    expect(wrapper.find('.rc-chart-view').exists()).toBe(true)
    expect(wrapper.text()).toContain('1. 创维文汇苑')
    expect(wrapper.text()).toContain('100.7')
  })

  it('返回的日期与最新价格数据展示为明细列表，无勾选框，支持直接导出与切换趋势图/饼图，不渲染选表澄清卡片', async () => {
    const testSession = [
      { id: 's-nj-price', title: '南京二手房最新价格', updatedAt: '刚刚', group: 'today' as const },
    ]
    const priceMarkdown = `为您查询到南京二手房最新价格记录如下：

| 编号 | 日期 | 价格 |
| --- | --- | --- |
| 1 | 2026-10-18 | 5,557 |
| 2 | 2026-10-18 | 17,574 |
| 3 | 2026-10-18 | 13,297 |
| 4 | 2026-10-18 | 9,502 |
| 5 | 2026-10-18 | 9,046 |
| 6 | 2026-10-18 | 12,946 |
| 7 | 2026-10-18 | 15,238 |
| 8 | 2026-10-18 | 9,634 |
`
    const testMessages = {
      's-nj-price': [
        { id: 'm-u1', role: 'user' as const, content: '查询下南京二手房最新的价格', createdAt: '刚刚' },
        { id: 'm-a1', role: 'assistant' as const, content: priceMarkdown, createdAt: '刚刚' },
      ],
    }

    const wrapper = mount(AiChatView, {
      props: {
        initialSessions: testSession,
        initialActiveSessionId: 's-nj-price',
        initialMessages: testMessages,
      },
      global: {
        plugins: [ElementPlus],
      },
    })
    await flushPromises()

    // 1. 验证坚决不渲染 ClarificationCard 选表卡片
    expect(wrapper.find('[data-testid="clarification-card"]').exists()).toBe(false)
    expect(wrapper.find('.cc-interactive-table').exists()).toBe(false)

    // 2. 验证渲染了 rc-dataview-card，且默认呈现明细数据表（列表）
    expect(wrapper.find('.rc-dataview-card').exists()).toBe(true)
    expect(wrapper.find('.rc-table-view').exists()).toBe(true)
    expect(wrapper.text()).toContain('共 8 条明细记录')
    expect(wrapper.text()).toContain('5557')
    expect(wrapper.text()).toContain('17574')

    // 3. 验证明细表格无多选勾选框，第一列直接为业务列
    expect(wrapper.find('.rc-row-checkbox').exists()).toBe(false)
    expect(wrapper.find('.th-row-select').exists()).toBe(false)
    const rows = wrapper.findAll('.rc-preview-table tbody tr')
    expect(rows).toHaveLength(8)

    // 4. 点击「导出 Excel」按钮，验证直接导出全量数据
    const exportExcelBtn = wrapper.find('[data-testid="rc-table-export-excel"]')
    expect(exportExcelBtn.text()).toContain('导出 Excel')
    expect(exportExcelBtn.text()).not.toContain('已选')
    await exportExcelBtn.trigger('click')
    expect(downloadXlsx).toHaveBeenCalled()

    // 5. 切换到「趋势图表」视图
    const chartRadio = wrapper.findAll('.el-radio-button').find((btn) => btn.text().includes('趋势图表'))
    expect(chartRadio).toBeTruthy()
    await chartRadio!.find('input').setValue('chart')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rc-chart-view').exists()).toBe(true)

    // 6. 切换到「占比饼图」视图
    const pieRadio = wrapper.findAll('.el-radio-button').find((btn) => btn.text().includes('占比饼图'))
    expect(pieRadio).toBeTruthy()
    await pieRadio!.find('input').setValue('pie')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rc-pie-view').exists()).toBe(true)
  })

  it('用户输入「做成图表形式」或「把结果导出成 Excel」等自然语言指令时，能智能响应图表切换与即时下载', async () => {
    const testSession = [
      { id: 's-cmd', title: '二手房数据分析', updatedAt: '刚刚', group: 'today' as const },
    ]
    const testMessages = {
      's-cmd': [
        {
          id: 'm-u1',
          role: 'user' as const,
          content: '查询下南京二手房最新的价格',
          createdAt: '刚刚',
        },
        {
          id: 'm-a1',
          role: 'assistant' as const,
          content: `| 小区 | 建筑面积(m²) |\n| --- | --- |\n| 创维文汇苑 | 100.7 |\n| 雍澜和府 | 105.41 |`,
          createdAt: '刚刚',
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

    // 1. 用户先切换到表格视图
    const radioButtons = wrapper.findAll('.el-radio-button')
    await radioButtons[2].find('input').trigger('change')
    await flushPromises()
    expect(wrapper.find('.rc-table-view').exists()).toBe(true)

    // 2. 用户在输入框中输入「做成图表形式」并回车
    const textarea = wrapper.find('textarea')
    await textarea.setValue('做成图表形式')
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
    await flushPromises()

    // 应自动识别为图表转换指令，将视图切回图表，且回复确认文案
    expect(wrapper.find('.rc-chart-view').exists()).toBe(true)
    expect(wrapper.text()).toContain('已为您将查询结果转换为「趋势柱状图」展示')

    // 3. 用户在输入框中输入「把结果导出成 Excel」并发送
    await textarea.setValue('把结果导出成 Excel')
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
    await flushPromises()

    // 触发 Excel 导出
    expect(downloadXlsx).toHaveBeenCalled()
    expect(wrapper.text()).toContain('已为您生成并导出')
  })

  it('智能体返回无序列表候选数据源时，自动渲染勾选列表卡片，勾选后点击确认直接发送答案', async () => {
    const testSession = [
      { id: 's-clarify-bullet', title: '南京二手房价格查询', updatedAt: '刚刚', group: 'today' as const },
    ]
    const testMessages = {
      's-clarify-bullet': [
        {
          id: 'm-u1',
          role: 'user' as const,
          content: '查询下南京二手房最新的价格',
          createdAt: '刚刚',
        },
        {
          id: 'm-a1',
          role: 'assistant' as const,
          content: `南京二手房最新价格查询

查询"南京二手房最新价格"存在多种数据源候选，需要您确认用哪个来源的数据：

* 贝壳二手房成交信息（sense_data.tb_ke_com_chengjiao_esf_detail）—— 含城市维度，可查南京成交价
* 贝壳二手房_在售（sense_data.TB_ke_com_ershoufang_sale）—— 在售挂牌价
* 中指-二手房销售价格（sense_data.TB_ZZ_MONTH_OLD_PRICE）—— 月度均价
* 南京网上房地产（sense_data.TB_NJWSFDC）—— 南京本地官方数据

请问您希望用哪个数据源？另外"最新价格"是指成交均价还是挂牌价？`,
          createdAt: '刚刚',
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

    // 1. 验证渲染了待确认交互卡片，而不是让用户看静态列表自己手动打字
    expect(wrapper.find('[data-testid="clarification-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="clarification-table"]').exists()).toBe(true)

    // 2. 验证选项列表已提取
    expect(wrapper.text()).toContain('贝壳二手房成交信息')
    expect(wrapper.text()).toContain('sense_data.tb_ke_com_chengjiao_esf_detail')
    expect(wrapper.text()).toContain('含城市维度，可查南京成交价')
    expect(wrapper.text()).toContain('南京网上房地产')

    // 3. 用户直接勾选第 1 项（贝壳二手房成交信息）
    const option1 = wrapper.find('[data-testid="clarification-option-1"]')
    expect(option1.exists()).toBe(true)
    await option1.trigger('click')
    await flushPromises()

    // 验证勾选框变为已选状态
    expect(option1.find('.cc-check').classes()).toContain('checked')
    expect(wrapper.text()).toContain('已选 1/4：贝壳二手房成交信息')

    // 4. 用户点击「确认选择并开始分析」按钮，答案自动发出并推进下一轮流式问数
    const confirmBtn = wrapper.find('[data-testid="clarification-confirm"]')
    expect(confirmBtn.attributes('disabled')).toBeUndefined()

    await confirmBtn.trigger('click')
    await flushPromises()

    // 确认状态呈现
    expect(wrapper.find('[data-testid="clarification-confirmed"]').exists()).toBe(true)
    // 对话流中自动发送所选项，无需用户在输入框敲字
    expect(wrapper.text()).toContain('1（贝壳二手房成交信息）')
  })

  it('多轮对话中第二轮返回新的选表卡片时，不会被第一轮确认状态锁定，仍可正常勾选与确认', async () => {
    const testSession = [
      { id: 's-multi-clarify', title: '多轮选表测试', updatedAt: '刚刚', group: 'today' as const },
    ]
    const testMessages = {
      's-multi-clarify': [
        {
          id: 'm-u1',
          role: 'user' as const,
          content: '查二手房数据',
          createdAt: '刚刚',
        },
        {
          id: 'm-a1',
          role: 'assistant' as const,
          content: '第一轮待确认：',
          createdAt: '刚刚',
          clarification: {
            kind: 'table_choice' as const,
            reason: 'TOO_MANY' as const,
            question: '请选择城市数据源：',
            allowFreeText: true,
            maxSelect: 2,
            confirmed: true,
            selectedEntryTypeIds: [1],
            options: [
              { entryTypeId: 1, tableName: 't_city_1', typeName: '南京二手房' },
              { entryTypeId: 2, tableName: 't_city_2', typeName: '苏州二手房' },
            ],
          },
        },
        {
          id: 'm-u2',
          role: 'user' as const,
          content: '已确认选择：南京二手房',
          createdAt: '刚刚',
        },
        {
          id: 'm-a2',
          role: 'assistant' as const,
          content: '第二轮待确认：',
          createdAt: '刚刚',
          clarification: {
            kind: 'table_choice' as const,
            reason: 'TOO_MANY' as const,
            question: '请选择具体指标明细表：',
            allowFreeText: true,
            maxSelect: 3,
            options: [
              { entryTypeId: 10, tableName: 't_detail_1', typeName: '成交均价明细' },
              { entryTypeId: 20, tableName: 't_detail_2', typeName: '成交面积明细' },
              { entryTypeId: 30, tableName: 't_detail_3', typeName: '挂牌量明细' },
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

    // 应该渲染 2 张澄清卡片
    const cards = wrapper.findAll('[data-testid="clarification-card"]')
    expect(cards).toHaveLength(2)

    // 第一张卡片是已采纳状态
    expect(cards[0].classes()).toContain('confirmed')

    // 第二张卡片绝不能被第一张卡片的状态锁定（未确认）
    expect(cards[1].classes()).not.toContain('confirmed')
    expect(cards[1].find('[data-testid="clarification-confirmed"]').exists()).toBe(false)
    expect(cards[1].find('[data-testid="clarification-confirm"]').exists()).toBe(true)

    // 第二张卡片可以正常交互勾选
    const opt10 = cards[1].find('[data-testid="clarification-option-10"]')
    expect(opt10.exists()).toBe(true)
    await opt10.trigger('click')
    expect(opt10.classes()).toContain('selected')

    // 快捷「直接使用」按钮在第二轮中依然正常可用
    const directBtn20 = cards[1].find('[data-testid="clarification-direct-20"]')
    expect(directBtn20.exists()).toBe(true)
  })

  it('对话发起之后，处于响应中时显示停止按钮，点击停止按钮可中断对话', async () => {
    let capturedSignal: AbortSignal | undefined

    vi.mocked(streamAgentChat).mockImplementation(async (params, onEvent) => {
      capturedSignal = params.signal
      onEvent({ type: 'reasoning', reasoning: '正在读取表结构与元数据...' })
      return new Promise((_, reject) => {
        params.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'))
        })
      })
    })

    const wrapper = mountView(true)
    await flushPromises()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('分析昨日抓取成功率')

    const sendBtn = wrapper.find('[data-testid="send-btn"]')
    expect(sendBtn.exists()).toBe(true)

    // 发起对话
    await sendBtn.trigger('click')
    await flushPromises()

    // 发起后处于发送中：发送按钮被替换为停止响应按钮，浮动停止按钮也显现
    const stopBtn = wrapper.find('[data-testid="stop-btn"]')
    expect(stopBtn.exists()).toBe(true)
    expect(stopBtn.text()).toContain('停止响应')

    const floatStopBtn = wrapper.find('[data-testid="float-stop-btn"]')
    expect(floatStopBtn.exists()).toBe(true)
    expect(floatStopBtn.text()).toContain('停止生成')

    expect(capturedSignal?.aborted).toBe(false)

    // 点击停止响应按钮
    await stopBtn.trigger('click')
    await flushPromises()

    // 确认信号已被 abort
    expect(capturedSignal?.aborted).toBe(true)

    // 中断后，停止按钮消失，发送按钮恢复
    expect(wrapper.find('[data-testid="stop-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="send-btn"]').exists()).toBe(true)

    // 界面展示中断提示
    expect(wrapper.find('[data-testid="interrupted-notice"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('问数对话已中断')
    expect(wrapper.text()).toContain('思考已中断')
  })

  it('支持点击居中浮动的「停止生成」按钮中断对话', async () => {
    let capturedSignal: AbortSignal | undefined

    vi.mocked(streamAgentChat).mockImplementation(async (params) => {
      capturedSignal = params.signal
      return new Promise((_, reject) => {
        params.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'))
        })
      })
    })

    const wrapper = mountView(true)
    await flushPromises()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('查询近7天异常任务')
    await wrapper.find('[data-testid="send-btn"]').trigger('click')
    await flushPromises()

    const floatStopBtn = wrapper.find('[data-testid="float-stop-btn"]')
    expect(floatStopBtn.exists()).toBe(true)

    await floatStopBtn.trigger('click')
    await flushPromises()

    expect(capturedSignal?.aborted).toBe(true)
    expect(wrapper.find('[data-testid="float-stop-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="send-btn"]').exists()).toBe(true)
  })

  it('对话响应中支持通过 Esc 按键中断生成', async () => {
    let capturedSignal: AbortSignal | undefined

    vi.mocked(streamAgentChat).mockImplementation(async (params) => {
      capturedSignal = params.signal
      return new Promise((_, reject) => {
        params.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'))
        })
      })
    })

    const wrapper = mountView(true)
    await flushPromises()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('排查响应超时')
    await wrapper.find('[data-testid="send-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="stop-btn"]').exists()).toBe(true)

    // 按下 Esc 键
    await textarea.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(capturedSignal?.aborted).toBe(true)
    expect(wrapper.find('[data-testid="stop-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="send-btn"]').exists()).toBe(true)
  })

  it('流式已有部分文本输出时中断，保留已输出内容并展示本次回答已中断标识', async () => {
    let capturedSignal: AbortSignal | undefined

    vi.mocked(streamAgentChat).mockImplementation(async (params, onEvent) => {
      capturedSignal = params.signal
      onEvent({ type: 'chunk', text: '根据数据统计，当前网络层异常主要集中在' })
      return new Promise((_, reject) => {
        params.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'))
        })
      })
    })

    const wrapper = mountView(true)
    await flushPromises()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('输出网络层异常分析')
    await wrapper.find('[data-testid="send-btn"]').trigger('click')
    await flushPromises()

    // 此时已有部分文本在页面上
    expect(wrapper.text()).toContain('根据数据统计，当前网络层异常主要集中在')

    // 触发中断
    await wrapper.find('[data-testid="stop-btn"]').trigger('click')
    await flushPromises()

    expect(capturedSignal?.aborted).toBe(true)
    // 已输出的文本依然保留
    expect(wrapper.text()).toContain('根据数据统计，当前网络层异常主要集中在')
    // 渲染中断标签
    expect(wrapper.find('[data-testid="interrupted-tag"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('本次回答已中断')
  })

  it('对话响应中点击新建会话或切换会话时，自动中断上一次流式会话', async () => {
    let capturedSignal: AbortSignal | undefined

    vi.mocked(streamAgentChat).mockImplementation(async (params) => {
      capturedSignal = params.signal
      return new Promise((_, reject) => {
        params.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'))
        })
      })
    })

    const wrapper = mountView(true)
    await flushPromises()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('长文本分析')
    await wrapper.find('[data-testid="send-btn"]').trigger('click')
    await flushPromises()

    expect(capturedSignal?.aborted).toBe(false)

    // 点击新建问数会话按钮
    const newChatBtn = wrapper.find('.rc-newchat-btn')
    await newChatBtn.trigger('click')
    await flushPromises()

    // 旧流式请求被成功 abort
    expect(capturedSignal?.aborted).toBe(true)
    expect(wrapper.find('[data-testid="stop-btn"]').exists()).toBe(false)
  })
})
