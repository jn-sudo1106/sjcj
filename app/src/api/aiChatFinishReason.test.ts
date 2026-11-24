import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamAgentChat, describeEmptyAnswer, type AgentChatEvent } from './aiChat'

function mockSse(lines: string[]) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      lines.forEach((l) => c.enqueue(encoder.encode(l)))
      c.close()
    },
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
  )
}

async function collect(lines: string[]) {
  mockSse(lines)
  const events: AgentChatEvent[] = []
  await streamAgentChat({ msg: '新加坡近 7 天资讯' }, (e) => events.push(e))
  return events
}

describe('上游结束原因 finish_reason', () => {
  afterEach(() => vi.restoreAllMocks())

  it('choices[0].finish_reason 派发 finish 事件（只派发一次）', async () => {
    const events = await collect([
      'data: {"choices":[{"delta":{"reasoning_content":"查询完成"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ])
    expect(events.filter((e) => e.type === 'finish')).toEqual([{ type: 'finish', reason: 'length' }])
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('没收到 [DONE] 就断流记为 connection_closed', async () => {
    const events = await collect(['data: {"choices":[{"delta":{"reasoning_content":"查询中"}}]}\n\n'])
    expect(events.slice(-2)).toEqual([{ type: 'finish', reason: 'connection_closed' }, { type: 'done' }])
  })

  it('正常 [DONE] 结束且上游没给原因时不派发 finish', async () => {
    const events = await collect(['data: {"choices":[{"delta":{"content":"好的"}}]}\n\n', 'data: [DONE]\n\n'])
    expect(events.some((e) => e.type === 'finish')).toBe(false)
  })
})

describe('describeEmptyAnswer', () => {
  it('按原因给出说明并附原始原因', () => {
    expect(describeEmptyAnswer('length').title).toContain('输出长度已用完')
    expect(describeEmptyAnswer('length').description).toContain('结束原因：length')
    expect(describeEmptyAnswer('connection_closed').title).toContain('断开')
    expect(describeEmptyAnswer('content_filter').title).toContain('内容安全')
    expect(describeEmptyAnswer('tool_calls').title).toContain('工具调用')
    expect(describeEmptyAnswer('stop').title).toContain('没有输出回答正文')
    expect(describeEmptyAnswer('weird').description).toContain('结束原因：weird')
  })

  it('没有原因时保持原通用提示', () => {
    expect(describeEmptyAnswer()).toEqual({
      title: '思考分析已完成，但未返回最终回答内容',
      description: '上游模型或数据检索接口可能未生成文本回复。您可以展开上方「思考过程」卡片查看详细分析步骤与日志。',
    })
  })
})
