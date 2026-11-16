// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamAgentChat, extractClarificationFromText, type AgentChatEvent } from './aiChat'

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

  it('extractClarificationFromText 正确从 Markdown Task List 中提取待确认勾选项', () => {
    const markdown = `
查询南京二手房最新记录时，匹配到以下待确认的候选表，请勾选需要分析的项：
- [ ] sense_data.tb_ke_com_chengjia_esf_detail (南京链家二手房成交明细)
- [ ] sense_data.tb_anjuke_esf_summary (南京安居客二手房挂牌均价汇总)
`
    const result = extractClarificationFromText(markdown)
    expect(result).not.toBeNull()
    expect(result?.options).toHaveLength(2)
    expect(result?.options[0]).toEqual({
      entryTypeId: 1,
      tableName: 'sense_data.tb_ke_com_chengjia_esf_detail',
      typeName: 'sense_data.tb_ke_com_chengjia_esf_detail',
      hint: '南京链家二手房成交明细',
    })
    expect(result?.options[1]).toEqual({
      entryTypeId: 2,
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
      tableName: 't_sales',
      typeName: '销售订单表',
      hint: '按日汇总',
    })
  })

  it('extractClarificationFromText 在普通文本无待确认项时返回 null', () => {
    const normalText = '根据查询结果，南京二手房均价为 28,500 元/㎡。近7天成交120套。'
    expect(extractClarificationFromText(normalText)).toBeNull()
    expect(extractClarificationFromText('')).toBeNull()
  })
})
