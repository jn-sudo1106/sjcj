// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  streamAgentChat,
  extractClarificationFromText,
  extractClarificationFromReasoning,
  extractChartDataFromText,
  listRecommendedQuestions,
  listAiSessions,
  deleteAiSession,
  getAiChatHistory,
  convertChatLogsToMessages,
  formatSessionGroupAndDate,
  type AgentChatEvent,
} from './aiChat'
import * as clientModule from './client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('streamAgentChat 智能体问数流式接口对接', () => {
  it('向 /api/poc/chat/agent 发送 POST 请求并流式解析 content 与 reasoning_content', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const events: AgentChatEvent[] = []
    const encoder = new TextEncoder()

    const streamPromise = streamAgentChat({ msg: '查询贝壳今天的数据量' }, (e) => events.push(e))

    // 模拟 SSE 推送 reasoning 与 content
    controller.enqueue(
      encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"正在分析问句意图..."}}]}\n\n')
    )
    controller.enqueue(
      encoder.encode('data: {"choices":[{"delta":{"content":"贝壳今日采集总量为 "}}]}\n\n')
    )
    controller.enqueue(
      encoder.encode('data: {"choices":[{"delta":{"content":"8,123 条。"}}]}\n\n')
    )
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()

    await streamPromise

    // 验证请求入参与路径
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/poc/chat/agent')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ msg: '查询贝壳今天的数据量' })
    expect((init?.headers as Record<string, string>)?.Accept).toBe('text/event-stream')

    // 验证事件流解析
    expect(events).toEqual([
      { type: 'reasoning', reasoning: '正在分析问句意图...' },
      { type: 'chunk', text: '贝壳今日采集总量为 ' },
      { type: 'chunk', text: '8,123 条。' },
      { type: 'done' },
    ])
  })

  it('上游返回 HTTP 错误时触发 error 事件并抛出异常', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '上游服务不可用' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const events: AgentChatEvent[] = []
    await expect(
      streamAgentChat({ msg: '测试错误' }, (e) => events.push(e))
    ).rejects.toThrow('智能体服务请求失败(HTTP 502): 上游服务不可用')

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        error: expect.stringContaining('502'),
      })
    )
  })

  it('流中返回 error payload 时派发 error 事件', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const events: AgentChatEvent[] = []
    const encoder = new TextEncoder()

    const streamPromise = streamAgentChat({ msg: '测试流中错误' }, (e) => events.push(e))

    controller.enqueue(
      encoder.encode('data: {"error":{"message":"模型超时中断","type":"upstream_error"}}\n\n')
    )
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()

    await streamPromise

    expect(events).toContainEqual({
      type: 'error',
      error: '模型超时中断',
    })
    expect(events).toContainEqual({
      type: 'done',
    })
  })

  it('流中返回 clarification 结构化载荷时派发 clarification 事件', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const events: AgentChatEvent[] = []
    const encoder = new TextEncoder()

    const streamPromise = streamAgentChat({ msg: '查询南京二手房' }, (e) => events.push(e))

    const clarifyPayload = {
      clarification: {
        kind: 'table_choice',
        reason: 'TOO_MANY',
        question: '查询到多个待确认候选表，请勾选需要分析的表：',
        allowFreeText: true,
        maxSelect: 3,
        options: [
          {
            entryTypeId: 201,
            tableName: 'sense_data.tb_ke_com_chengjia_esf_detail',
            typeName: '南京链家成交明细表',
            hint: '成交周期与真实成交价',
          },
          {
            entryTypeId: 202,
            tableName: 'sense_data.tb_anjuke_esf_summary',
            typeName: '南京安居客二手房均价表',
            hint: '挂牌均价统计',
          },
        ],
      },
    }

    controller.enqueue(encoder.encode(`data: ${JSON.stringify(clarifyPayload)}\n\n`))
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()

    await streamPromise

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'clarification',
        clarification: expect.objectContaining({
          kind: 'table_choice',
          question: '查询到多个待确认候选表，请勾选需要分析的表：',
          maxSelect: 3,
          options: expect.arrayContaining([
            expect.objectContaining({
              entryTypeId: 201,
              tableName: 'sense_data.tb_ke_com_chengjia_esf_detail',
              typeName: '南京链家成交明细表',
            }),
            expect.objectContaining({
              entryTypeId: 202,
              tableName: 'sense_data.tb_anjuke_esf_summary',
              typeName: '南京安居客二手房均价表',
            }),
          ]),
        }),
      })
    )
  })

  it('思考链里的 MCP 工具结果能恢复带主键的选表澄清（模型只回一句话、不列候选时仍可渲染选项）', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    )

    const events: AgentChatEvent[] = []
    const encoder = new TextEncoder()
    const streamPromise = streamAgentChat({ msg: '南京二手房最新价格' }, (e) => events.push(e))

    // 现场实测的原样形态：两张中文名完全相同的表，模型只回一句「需要你确认查哪一张」，
    // 候选与真实主键只存在于 reasoning 的工具结果 JSON 里
    const toolResult = {
      sessionId: '175973c9ce8b4cdeafb755ab1e04ace2',
      status: 'needs_clarification',
      outcome: 'NEEDS_CLARIFICATION',
      round: 2,
      total: 2,
      truncated: false,
      candidates: [
        { entryTypeId: 6399962, tableName: 'sense_data.TB_ZZ_MONTH_OLD_PRICE', typeName: '中指-二手房销售价格' },
        { entryTypeId: 6399961, tableName: 'sense_data.TBC_ZZ_MONTH_OLD_PRICE', typeName: '中指-二手房销售价格' },
      ],
      clarification: {
        kind: 'table_choice',
        reason: 'AMBIGUOUS',
        question: '命中两张中文名相同的表，需要你确认查哪一张。',
        allowFreeText: true,
        maxSelect: 2,
        options: [
          { entryTypeId: 6399962, tableName: 'sense_data.TB_ZZ_MONTH_OLD_PRICE', typeName: '中指-二手房销售价格' },
          { entryTypeId: 6399961, tableName: 'sense_data.TBC_ZZ_MONTH_OLD_PRICE', typeName: '中指-二手房销售价格' },
        ],
      },
    }
    // 实测上游会把 reasoning 里的工具结果截断（约 2KB 后以 ... 结尾）：
    // candidates 完整、clarification 只剩半截 —— 必须按 candidates 恢复选项
    const fullJson = JSON.stringify(toolResult, null, 2)
    const truncatedJson = `${fullJson.slice(0, fullJson.indexOf('"question"') + 30)}...`
    expect(truncatedJson).not.toContain('"maxSelect"')
    const reasoningText =
      '[工具调用] data-ask-mcp_submit_table_selection({"question":"南京二手房最新价格"})' +
      `[工具结果] data-ask-mcp_submit_table_selection: ${truncatedJson}`

    // 切三段推送：前两段 JSON 未闭合，解析必须安静跳过，只有收全后才派发一次
    const cutA = Math.floor(reasoningText.length / 3)
    const cutB = Math.floor((reasoningText.length * 2) / 3)
    for (const part of [reasoningText.slice(0, cutA), reasoningText.slice(cutA, cutB), reasoningText.slice(cutB)]) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: part } }] })}\n\n`)
      )
    }

    const shortReply = '南京二手房最新价格候选表较多，我提交选表会话让服务端收敛。命中两张"中指-二手房销售价格"表，需要你确认查哪一张。'
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: shortReply } }] })}\n\n`)
    )
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()

    await streamPromise

    // 正文本身不含任何候选表单，纯文本兜底一定拿不到选项 —— 这正是页面上「没有可选项」的原因
    expect(extractClarificationFromText(shortReply)).toBeNull()

    const clarifications = events.filter((e) => e.type === 'clarification')
    expect(clarifications).toHaveLength(1)
    const payload = clarifications[0] as Extract<AgentChatEvent, { type: 'clarification' }>
    expect(payload.clarification.kind).toBe('table_choice')
    expect(payload.clarification.maxSelect).toBe(2)
    expect(payload.clarification.options).toEqual([
      expect.objectContaining({
        entryTypeId: 6399962,
        tableName: 'sense_data.TB_ZZ_MONTH_OLD_PRICE',
        typeName: '中指-二手房销售价格',
      }),
      expect.objectContaining({
        entryTypeId: 6399961,
        tableName: 'sense_data.TBC_ZZ_MONTH_OLD_PRICE',
        typeName: '中指-二手房销售价格',
      }),
    ])
    // 结构化澄清必须早于 done 派发，否则状态机会停在 awaiting_clarification 收不了尾
    const clarifyIndex = events.findIndex((e) => e.type === 'clarification')
    const doneIndex = events.findIndex((e) => e.type === 'done')
    expect(clarifyIndex).toBeGreaterThanOrEqual(0)
    expect(clarifyIndex).toBeLessThan(doneIndex)
  })

  it('convertChatLogsToMessages 从落库思考链恢复选表澄清，刷新后选项不丢', () => {
    const reasoningText =
      '[工具结果] data-ask-mcp_submit_table_selection: ' +
      JSON.stringify({
        sessionId: 'sess-1',
        status: 'needs_clarification',
        clarification: {
          kind: 'table_choice',
          reason: 'TOO_MANY',
          question: '命中的表超过 5 张，请补充限定条件。',
          maxSelect: 5,
          options: [
            { entryTypeId: 6399962, tableName: 'sense_data.TB_ZZ_MONTH_OLD_PRICE', typeName: '中指-二手房销售价格' },
            { entryTypeId: 6399964, tableName: 'sense_data.TB_ZZ_MONTH_OLD_CNT', typeName: '中指-二手房销售套数' },
          ],
        },
      })

    const messages = convertChatLogsToMessages([
      {
        id: 8001,
        sessionId: 3001,
        msg: '南京二手房最新价格',
        modelMsg: '南京二手房最新价格候选表较多，我提交选表会话让服务端收敛。',
        status: 'SUCCESS',
        data: JSON.stringify({
          thinking: { completed: true, durationMs: 26100, text: reasoningText },
        }),
        createTime: '2026-11-17 13:20:00',
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].clarification).toEqual({
      kind: 'table_choice',
      reason: 'TOO_MANY',
      question: '命中的表超过 5 张，请补充限定条件。',
      allowFreeText: true,
      maxSelect: 5,
      options: [
        { entryTypeId: 6399962, ordinal: 1, tableName: 'sense_data.TB_ZZ_MONTH_OLD_PRICE', typeName: '中指-二手房销售价格', hint: null },
        { entryTypeId: 6399964, ordinal: 2, tableName: 'sense_data.TB_ZZ_MONTH_OLD_CNT', typeName: '中指-二手房销售套数', hint: null },
      ],
    })
  })

  it('extractClarificationFromReasoning 对未闭合 JSON、无澄清载荷的工具结果返回 null', () => {
    expect(extractClarificationFromReasoning('')).toBeNull()
    expect(
      extractClarificationFromReasoning('[工具结果] data-ask-mcp_submit_table_selection: {"sessionId":"x","status":"rea')
    ).toBeNull()
    expect(
      extractClarificationFromReasoning(
        '[工具结果] data-ask-mcp_search_tables: {"total":2,"candidates":[{"entryTypeId":1,"tableName":"t_a"}]}'
      )
    ).toBeNull()
  })


  it('extractClarificationFromText 正确从 Markdown Task List 中提取待确认勾选项', () => {
    const markdown = `
查询南京二手房最新记录时，匹配到以下待确认的候选表，请勾选需要分析的项：
- [ ] sense_data.tb_ke_com_chengjia_esf_detail (南京链家二手房成交明细)
- [ ] sense_data.tb_anjuke_esf_summary (南京安居客二手房挂牌均价汇总)
`
    const result = extractClarificationFromText(markdown)
    expect(result).not.toBeNull()
    expect(result?.options).toHaveLength(2)
    // 文本提取的候选项没有真实主键：entryTypeId 必须为 null，用 ordinal 作本地展示/勾选序号
    expect(result?.options[0]).toEqual({
      entryTypeId: null,
      ordinal: 1,
      tableName: 'sense_data.tb_ke_com_chengjia_esf_detail',
      typeName: 'sense_data.tb_ke_com_chengjia_esf_detail',
      hint: '南京链家二手房成交明细',
    })
    expect(result?.options[1]).toEqual({
      entryTypeId: null,
      ordinal: 2,
      tableName: 'sense_data.tb_anjuke_esf_summary',
      typeName: 'sense_data.tb_anjuke_esf_summary',
      hint: '南京安居客二手房挂牌均价汇总',
    })
  })

  it('extractClarificationFromText 正确解析代码块中嵌入的 JSON clarification', () => {
    const content = `
以下为待确认的分析表范围：
\`\`\`json
{
  "clarification": {
    "question": "请选择要查询的表：",
    "options": [
      { "entryTypeId": 11, "tableName": "t_sales", "typeName": "销售订单表", "hint": "按日汇总" }
    ]
  }
}
\`\`\`
`
    const result = extractClarificationFromText(content)
    expect(result).not.toBeNull()
    expect(result?.question).toBe('请选择要查询的表：')
    expect(result?.options[0]).toEqual({
      entryTypeId: 11,
      ordinal: 1,
      tableName: 't_sales',
      typeName: '销售订单表',
      hint: '按日汇总',
    })
  })

  it('extractClarificationFromText 正确解析 Markdown 表格形式的待确认候选表列表', () => {
    const tableText = `
| 编号 | 表名 | 说明 |
| --- | --- | --- |
| 1 | \`TB_ZZ_MONTH_OLD_PRICE\` | 中指-二手房销售价格 |
| 2 | \`TB_ZZ_MONTH_OLD_CNT\` | 中指-二手房销售套数 |
| 3 | \`TB_ZZ_MONTH_OLD_SUM\` | 中指-二手房销售额 |
| 4 | \`TB_ZZ_MONTH_OLD_AREA\` | 中指-二手房销售面积 |
| 5 | \`TB_RS_ESFYTJ\` | RS_二手房预统计 |
| 6 | \`tb_ke_com_chengjiao_esf\` | 贝壳二手房成交信息 |
| 7 | \`tb_ke_com_chengjiao_esf_detail\` | 贝壳二手房成交信息(新增详情字段) |
| 8 | \`TB_ke_com_ershoufang_sale\` | 贝壳二手房_在售 |
| 9 | \`tb_chengjiao_test\` | 贝壳二手房成交信息_copy |
| 10 | \`TB_creprice_forsale_supply\` | 全国房价行情平台_二手房_供给量 |

请问你希望用哪张表？例如回复"3"（中指-二手房销售价格）或"6"（贝壳二手房成交信息）。
`
    const result = extractClarificationFromText(tableText)
    expect(result).not.toBeNull()
    expect(result?.options).toHaveLength(10)
    expect(result?.question).toContain('请问你希望用哪张表')

    expect(result?.options[0]).toEqual({
      entryTypeId: null,
      ordinal: 1,
      tableName: 'TB_ZZ_MONTH_OLD_PRICE',
      typeName: '中指-二手房销售价格',
      hint: '编号: 1',
    })

    expect(result?.options[5]).toEqual({
      entryTypeId: null,
      ordinal: 6,
      tableName: 'tb_ke_com_chengjiao_esf',
      typeName: '贝壳二手房成交信息',
      hint: '编号: 6',
    })
  })

  it('extractClarificationFromText 正确解析无序列表候选数据源（如 * 贝壳二手房成交信息...）', () => {
    const listText = `南京二手房最新价格查询

查询"南京二手房最新价格"存在多种数据源候选，需要您确认用哪个来源的数据：

* 贝壳二手房成交信息（sense_data.tb_ke_com_chengjiao_esf_detail）—— 含城市维度，可查南京成交价
* 贝壳二手房_在售（sense_data.TB_ke_com_ershoufang_sale）—— 在售挂牌价
* 中指-二手房销售价格（sense_data.TB_ZZ_MONTH_OLD_PRICE）—— 月度均价
* 南京网上房地产（sense_data.TB_NJWSFDC）—— 南京本地官方数据

请问您希望用哪个数据源？另外"最新价格"是指成交均价还是挂牌价？`

    const result = extractClarificationFromText(listText)
    expect(result).not.toBeNull()
    expect(result?.options).toHaveLength(4)
    expect(result?.question).toContain('请问您希望用哪个数据源')
    expect(result?.options[0]).toEqual({
      entryTypeId: null,
      ordinal: 1,
      tableName: 'sense_data.tb_ke_com_chengjiao_esf_detail',
      typeName: '贝壳二手房成交信息',
      hint: '含城市维度，可查南京成交价',
    })
    expect(result?.options[1]).toEqual({
      entryTypeId: null,
      ordinal: 2,
      tableName: 'sense_data.TB_ke_com_ershoufang_sale',
      typeName: '贝壳二手房_在售',
      hint: '在售挂牌价',
    })
    expect(result?.options[2]).toEqual({
      entryTypeId: null,
      ordinal: 3,
      tableName: 'sense_data.TB_ZZ_MONTH_OLD_PRICE',
      typeName: '中指-二手房销售价格',
      hint: '月度均价',
    })
    expect(result?.options[3]).toEqual({
      entryTypeId: null,
      ordinal: 4,
      tableName: 'sense_data.TB_NJWSFDC',
      typeName: '南京网上房地产',
      hint: '南京本地官方数据',
    })
  })

  it('extractClarificationFromText 在普通文本无待确认项时返回 null', () => {
    const normalText = '根据查询结果，南京二手房均价为 28,500 元/㎡。近7天成交120套。'
    expect(extractClarificationFromText(normalText)).toBeNull()
    expect(extractClarificationFromText('')).toBeNull()
  })
})

describe('listRecommendedQuestions 推荐问数场景获取', () => {
  it('正确解析直接返回的 string 数组并过滤空串', async () => {
    const spy = vi.spyOn(clientModule, 'request').mockResolvedValue(['近7天异常任务分析', '', '   ', '各源采集成功率 TOP 10'] as never)
    const list = await listRecommendedQuestions()
    expect(spy).toHaveBeenCalledWith('poc/chat/help/question', undefined, {
      method: 'GET',
      httpEndpoint: '/api/poc/chat/help/question',
    })
    expect(list).toEqual(['近7天异常任务分析', '各源采集成功率 TOP 10'])
  })

  it('支持带有 { data: [...] } 包装的响应结构', async () => {
    vi.spyOn(clientModule, 'request').mockResolvedValue({
      data: ['规则清洗未命中排查'],
    } as never)
    const list = await listRecommendedQuestions()
    expect(list).toEqual(['规则清洗未命中排查'])
  })

  it('请求发生异常时静默降级返回空数组，不向外抛出异常', async () => {
    vi.spyOn(clientModule, 'request').mockRejectedValue(new Error('Network error'))
    const list = await listRecommendedQuestions()
    expect(list).toEqual([])
  })
})

describe('extractChartDataFromText 业务数据表格自动解析为图表与明细数据', () => {
  const nanjingEsfTableText = `区、户型、建筑面积等基础信息。因此无法给出南京二手房的实际价格数值。

| 小区 | 成交日期 | 户型 | 建筑面积(m²) |
| --- | --- | --- | --- |
| 创维文汇苑 | 2026-10-18 | 3室2厅 | 100.7 |
| 雍澜和府 | 2026-10-18 | 3室2厅 | 105.41 |
| 欧陆经典花园 | 2026-10-18 | 2室2厅 | 89.55 |
| 威尼斯水城第十四街区 | 2026-10-18 | 2室2厅 | 91.27 |
| 天润城第八街区 | 2026-10-18 | 2室2厅 | 79.75 |
| 三牌楼大街 | 2026-10-18 | 3室1厅 | 76.5 |
| 托乐嘉贵邻居 | 2026-10-18 | 1室1厅 | 40.04 |
| 天润城第十三街区 | 2026-10-18 | 3室1厅 | 85.99 |`

  it('能精准解析 Markdown 数据表格为包含列结构、行数据与柱/饼图的 chartData', () => {
    const chartData = extractChartDataFromText(nanjingEsfTableText)
    expect(chartData).not.toBeNull()
    if (!chartData) return

    expect(chartData.tableColumns).toEqual([
      { prop: 'col_0', label: '小区' },
      { prop: 'col_1', label: '成交日期' },
      { prop: 'col_2', label: '户型' },
      { prop: 'col_3', label: '建筑面积(m²)' },
    ])
    expect(chartData.tableRows).toHaveLength(8)
    expect(chartData.tableRows[0]).toEqual({
      col_0: '创维文汇苑',
      col_1: '2026-10-18',
      col_2: '3室2厅',
      col_3: 100.7,
    })
    expect(chartData.tableRows[1].col_3).toBe(105.41)

    // 验证柱状图生成：自动选取「建筑面积(m²)」作为数值度量，以「小区」作为分类标签
    expect(chartData.bars).toHaveLength(8)
    expect(chartData.bars?.[0].label).toBe('1. 创维文汇苑')
    expect(chartData.bars?.[0].displayValue).toBe('100.7')
    expect(chartData.bars?.[1].value).toBe(100) // 最大值为 105.41，占比 100%

    // 验证饼图生成：前 7 项 + 第 8 项汇总为「其他」
    expect(chartData.slices).toHaveLength(8)
    expect(chartData.slices?.[0].label).toBe('创维文汇苑')
    expect(chartData.slices?.[0].value).toBe(100.7)
    expect(chartData.slices?.[7].label).toBe('其他')
    expect(chartData.slices?.[7].value).toBe(85.99)
    expect(chartData.title).toContain('建筑面积(m²)')
  })

  it('用户问数返回的最新价格数据（编号/日期/价格）正确解析为明细列表与趋势图，且不被误判为选表澄清', () => {
    const priceTableText = `为您查询到南京二手房最新价格记录如下：

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
    // 1. 验证坚决不被误判为待选物理表澄清卡片
    const clarification = extractClarificationFromText(priceTableText)
    expect(clarification).toBeNull()

    // 2. 验证正确解析为业务数据图表与明细数据
    const chartData = extractChartDataFromText(priceTableText)
    expect(chartData).not.toBeNull()
    if (!chartData) return

    expect(chartData.tableColumns).toEqual([
      { prop: 'col_0', label: '编号' },
      { prop: 'col_1', label: '日期' },
      { prop: 'col_2', label: '价格' },
    ])
    expect(chartData.tableRows).toHaveLength(8)
    expect(chartData.tableRows[0]).toEqual({
      col_0: 1,
      col_1: '2026-10-18',
      col_2: 5557,
    })
    expect(chartData.tableRows[1].col_2).toBe(17574)

    // 验证柱状图生成：自动排除「编号」，选择「价格」作为度量，「日期」作为标签
    expect(chartData.bars).toHaveLength(8)
    expect(chartData.bars?.[0].displayValue).toBe('5,557')
    expect(chartData.bars?.[1].displayValue).toBe('17,574')
    expect(chartData.bars?.[1].value).toBe(100) // 最大值为 17,574，归一化占比 100%

    // 验证饼图切片生成
    expect(chartData.slices).toHaveLength(8)
    expect(chartData.title).toContain('价格')
  })

  it('即使表格包含表名/说明列头，若每行内容为日期与纯数值，仍判定为业务数据而非选表澄清', () => {
    const rawTableText = `| 编号 | 表名 | 说明 |
| --- | --- | --- |
| 1 | 2026-10-18 | 5,557 |
| 2 | 2026-10-18 | 17,574 |
| 3 | 2026-10-18 | 13,297 |
`
    const clarification = extractClarificationFromText(rawTableText)
    expect(clarification).toBeNull()

    const chartData = extractChartDataFromText(rawTableText)
    expect(chartData).not.toBeNull()
    expect(chartData?.tableRows).toHaveLength(3)
  })

  it('对候选表澄清指引表格返回 null，避免与待确认项卡片混淆', () => {
    const clarifyTable = `| 编号 | 表名 | 说明 |
| --- | --- | --- |
| 1 | TB_ZZ_MONTH_OLD_PRICE | 中指-二手房销售价格 |
| 2 | TB_ZZ_MONTH_OLD_CNT | 中指-二手房销售套数 |

请问你希望用哪张表？例如回复"3"或"6"。`
    const chartData = extractChartDataFromText(clarifyTable)
    expect(chartData).toBeNull()
  })

  it('对无数值度量列的纯分类表格，自动按频次汇总生成分类图表', () => {
    const categoryTable = `| 小区名称 | 区域 |
| --- | --- |
| 创维文汇苑 | 江宁 |
| 雍澜和府 | 江宁 |
| 欧陆经典花园 | 鼓楼 |`
    const chartData = extractChartDataFromText(categoryTable)
    expect(chartData).not.toBeNull()
    if (!chartData) return
    expect(chartData.tableColumns).toHaveLength(2)
    expect(chartData.bars?.length).toBeGreaterThan(0)
    expect(chartData.slices?.some((s) => s.label === '江宁' && s.value === 2)).toBe(true)
  })

  it('空文本或无表格文本返回 null', () => {
    expect(extractChartDataFromText('')).toBeNull()
    expect(extractChartDataFromText('普通的文本说明，没有任何表格')).toBeNull()
  })
})

describe('问数会话管理与历史记录持久化对接', () => {
  it('listAiSessions 将后端 ChatSession 映射为 AiSessionItem 并按时间分组', async () => {
    const today = new Date().toISOString()
    const mockData = [
      { id: 1, uuid: 'sess_1', name: '今日问数', updateTime: today },
      { id: 2, uuid: 'sess_2', name: '旧会话', updateTime: '2020-01-01 10:00:00' },
    ]
    vi.spyOn(clientModule, 'request').mockResolvedValue(mockData as any)

    const list = await listAiSessions()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('1')
    expect(list[0].uuid).toBe('sess_1')
    expect(list[0].title).toBe('今日问数')
    expect(list[0].group).toBe('today')

    expect(list[1].id).toBe('2')
    expect(list[1].uuid).toBe('sess_2')
    expect(list[1].group).toBe('earlier')
  })

  it('deleteAiSession 发起后端会话软删除', async () => {
    const requestSpy = vi.spyOn(clientModule, 'request').mockResolvedValue(undefined as any)
    const success = await deleteAiSession('123')
    expect(success).toBe(true)
    expect(requestSpy).toHaveBeenCalledWith(
      'poc/session/stop',
      undefined,
      expect.objectContaining({
        method: 'POST',
        query: { id: '123' },
      })
    )
  })

  it('convertChatLogsToMessages 正确还原问答、SQL、思考过程与中断标记', () => {
    const rawLogs = [
      {
        id: 10,
        sessionId: 1,
        msg: '统计昨日成功率',
        modelMsg: '查询完成：\n```sql\nSELECT site, rate FROM t_stat\n```',
        status: 'SUCCESS',
        data: JSON.stringify({
          thinking: { completed: true, durationMs: 500, text: '思考中...' },
          sql: { code: 'SELECT site, rate FROM t_stat', execTimeMs: 40, scanRows: 50 },
        }),
        createTime: '2026-11-16 10:00:00',
      },
      {
        id: 11,
        sessionId: 1,
        msg: '排查慢请求',
        modelMsg: '正在排查...',
        status: 'INTERRUPTED',
        data: JSON.stringify({
          interrupted: true,
          thinking: { completed: true, durationMs: 200, interrupted: true, text: '解析中' },
        }),
        createTime: '2026-11-16 10:05:00',
      },
    ]

    const messages = convertChatLogsToMessages(rawLogs as any)
    expect(messages).toHaveLength(4)

    // 第一轮用户消息
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('统计昨日成功率')

    // 第一轮助手回复
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toContain('SELECT site')
    expect(messages[1].sql?.code).toBe('SELECT site, rate FROM t_stat')
    expect(messages[1].thinking?.completed).toBe(true)
    expect(messages[1].thinking?.text).toBe('思考中...')
    expect(messages[1].interrupted).toBe(false)

    // 第二轮助手回复中断状态
    expect(messages[3].role).toBe('assistant')
    expect(messages[3].interrupted).toBe(true)
    expect(messages[3].thinking?.interrupted).toBe(true)
  })

  it('getAiChatHistory 从后端拉取日志并返回转换后的 ChatMessage 列表', async () => {
    const rawLogs = [
      {
        id: 99,
        sessionId: 88,
        msg: '测试历史消息',
        modelMsg: '历史回复',
        status: 'SUCCESS',
        createTime: '2026-11-16 11:00:00',
      },
    ]
    vi.spyOn(clientModule, 'request').mockResolvedValue(rawLogs as any)

    const history = await getAiChatHistory(88)
    expect(history).toHaveLength(2)
    expect(history[0].role).toBe('user')
    expect(history[0].content).toBe('测试历史消息')
    expect(history[1].role).toBe('assistant')
    expect(history[1].content).toBe('历史回复')
  })

  it('formatSessionGroupAndDate 正确区分今天、近7天与更早会话', () => {
    const now = new Date()
    expect(formatSessionGroupAndDate(now).group).toBe('today')

    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 3600 * 1000)
    expect(formatSessionGroupAndDate(fourDaysAgo).group).toBe('week')

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000)
    expect(formatSessionGroupAndDate(tenDaysAgo).group).toBe('earlier')
  })

  it('streamAgentChat 从响应头读取 X-Session-Id 与 X-Thread-Id 并分发 session_assigned 事件', async () => {
    const headers = new Headers()
    headers.set('Content-Type', 'text/event-stream')
    headers.set('X-Session-Id', '888')
    headers.set('X-Thread-Id', 'sess_custom_888')

    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        c.close()
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, {
        status: 200,
        headers,
      })
    )

    const events: AgentChatEvent[] = []
    await streamAgentChat(
      { msg: '新会话提问', session_id: 'new' },
      (e) => events.push(e)
    )

    const assignedEvent = events.find((e) => e.type === 'session_assigned')
    expect(assignedEvent).toBeDefined()
    expect(assignedEvent).toEqual({
      type: 'session_assigned',
      sessionId: '888',
      threadId: 'sess_custom_888',
    })
  })
})
