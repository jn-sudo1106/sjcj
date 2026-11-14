// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamAgentChat, type AgentChatEvent } from './aiChat'

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
})
