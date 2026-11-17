import { describe, it, expect, vi, afterEach } from 'vitest'
import { useAskChat, inferPhaseFromReasoning, ASK_PHASE_LABELS } from './useAskChat'
import type { AgentChatEvent, AgentChatParams } from '@/api/aiChat'

type StreamFn = (params: AgentChatParams, onEvent: (e: AgentChatEvent) => void) => Promise<void>

afterEach(() => {
  vi.useRealTimers()
})

describe('useAskChat · 问数流式状态机', () => {
  it('chunk 合帧：80ms 窗口内多个 chunk 只触发一次批量回调', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const streamFn: StreamFn = async (_params, onEvent) => {
      await Promise.resolve()
      onEvent({ type: 'chunk', text: 'A' })
      onEvent({ type: 'chunk', text: 'B' })
      onEvent({ type: 'chunk', text: 'C' })
      await new Promise<void>((resolve) => { finish = resolve })
      onEvent({ type: 'done' })
    }
    const flushed: string[] = []
    const chat = useAskChat({ onChunkFlush: (t) => flushed.push(t), streamFn })

    const pending = chat.send({ msg: '查询' })
    expect(chat.state.value).toBe('preparing')
    await vi.advanceTimersByTimeAsync(80)

    expect(flushed).toEqual(['ABC'])
    expect(chat.state.value).toBe('streaming')

    finish()
    await pending
    expect(chat.state.value).toBe('done')
    chat.dispose()
  })

  it('无任何产出时落 done_empty，hadContent=false', async () => {
    const finished: Array<{ state: string; hadContent: boolean }> = []
    const streamFn: StreamFn = async (_p, onEvent) => { onEvent({ type: 'done' }) }
    const chat = useAskChat({
      onChunkFlush: () => {},
      onFinished: (info) => finished.push(info),
      streamFn,
    })
    await chat.send({ msg: '查询' })
    expect(chat.state.value).toBe('done_empty')
    expect(finished).toEqual([{ state: 'done_empty', hadContent: false }])
  })

  it('error 事件归一化为错误码并落 failed；其后的 done 不改写失败态', async () => {
    const errors: Array<{ code: string; retryable: boolean }> = []
    const finished: string[] = []
    const streamFn: StreamFn = async (_p, onEvent) => {
      onEvent({ type: 'error', error: '智能体服务请求失败(HTTP 502): 上游服务不可用' })
      onEvent({ type: 'done' })
    }
    const chat = useAskChat({
      onChunkFlush: () => {},
      onError: (info) => errors.push(info),
      onFinished: (info) => finished.push(info.state),
      streamFn,
    })
    await chat.send({ msg: '查询' })
    expect(chat.state.value).toBe('failed')
    expect(errors[0].code).toBe('UPSTREAM_ERROR')
    expect(finished).toEqual(['failed'])
  })

  it('网络异常 reject 归一化为 NETWORK 且可重试', async () => {
    const streamFn: StreamFn = async () => { throw new TypeError('failed to fetch') }
    const chat = useAskChat({ onChunkFlush: () => {}, streamFn })
    await chat.send({ msg: '查询' })
    expect(chat.state.value).toBe('failed')
    expect(chat.error.value?.code).toBe('NETWORK')
    expect(chat.error.value?.retryable).toBe(true)
  })

  it('stop() 触发 abort，状态落 interrupted', async () => {
    const streamFn: StreamFn = async (params) => {
      return new Promise((_, reject) => {
        params.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'))
        })
      })
    }
    const finished: string[] = []
    const chat = useAskChat({
      onChunkFlush: () => {},
      onFinished: (info) => finished.push(info.state),
      streamFn,
    })
    const pending = chat.send({ msg: '查询' })
    chat.stop()
    await pending
    expect(chat.state.value).toBe('interrupted')
    expect(finished).toEqual(['interrupted'])
    expect(chat.isBusy.value).toBe(false)
  })

  it('忙碌中拒发；同键 3s 去抖拒发，bypassDebounce 可绕过', async () => {
    let release!: () => void
    const calls: string[] = []
    const streamFn: StreamFn = async (params, onEvent) => {
      calls.push(params.msg)
      await new Promise<void>((resolve) => { release = resolve })
      onEvent({ type: 'done' })
    }
    const chat = useAskChat({ onChunkFlush: () => {}, streamFn })

    const first = chat.send({ msg: '同一问题' })
    expect(await chat.send({ msg: '另一问题' })).toBe(false)
    release()
    await first

    // 完成后立刻重发同键：去抖窗口内拒发
    expect(await chat.send({ msg: '同一问题' })).toBe(false)
    // 绕过窗口：真正发出
    const bypassed = chat.send({ msg: '同一问题' }, { bypassDebounce: true })
    release()
    expect(await bypassed).toBe(true)
    expect(calls).toEqual(['同一问题', '同一问题'])
  })

  it('90s 无事件进入 stalled 软超时，不自动断流；新事件恢复 streaming', async () => {
    vi.useFakeTimers()
    let emit!: (e: AgentChatEvent) => void
    const streamFn: StreamFn = async (params, onEvent) => {
      emit = onEvent
      return new Promise((_, reject) => {
        params.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    }
    const chat = useAskChat({ onChunkFlush: () => {}, streamFn })
    const pending = chat.send({ msg: '查询' })

    await vi.advanceTimersByTimeAsync(90_000)
    expect(chat.state.value).toBe('stalled')
    expect(chat.isBusy.value).toBe(true)

    emit({ type: 'chunk', text: '迟到的内容' })
    expect(chat.state.value).toBe('streaming')

    chat.stop()
    await pending
    expect(chat.state.value).toBe('interrupted')
  })

  it('clarification 事件进入 awaiting_clarification，done 后按有产出落 done', async () => {
    const clarifications: unknown[] = []
    const finished: Array<{ state: string; hadContent: boolean }> = []
    const streamFn: StreamFn = async (_p, onEvent) => {
      onEvent({
        type: 'clarification',
        clarification: {
          kind: 'table_choice',
          reason: 'TOO_MANY',
          question: '请选择表',
          allowFreeText: true,
          maxSelect: 2,
          options: [{ entryTypeId: 1, tableName: 't_a', typeName: '表A' }],
        },
      })
      onEvent({ type: 'done' })
    }
    const chat = useAskChat({
      onChunkFlush: () => {},
      onClarification: (c) => clarifications.push(c),
      onFinished: (info) => finished.push(info),
      streamFn,
    })
    await chat.send({ msg: '查询' })
    expect(clarifications).toHaveLength(1)
    expect(chat.state.value).toBe('done')
    expect(finished).toEqual([{ state: 'done', hadContent: true }])
  })

  it('retry() 用原参数重发并清掉去抖键', async () => {
    const calls: AgentChatParams[] = []
    let fail = true
    const streamFn: StreamFn = async (params, onEvent) => {
      calls.push(params)
      if (fail) {
        onEvent({ type: 'error', error: 'upstream 上游失败' })
        onEvent({ type: 'done' })
        return
      }
      onEvent({ type: 'chunk', text: '恢复后的回答' })
      onEvent({ type: 'done' })
    }
    const flushed: string[] = []
    const chat = useAskChat({ onChunkFlush: (t) => flushed.push(t), streamFn })
    await chat.send({ msg: '原问题', thread_id: 'th-1' })
    expect(chat.state.value).toBe('failed')

    fail = false
    expect(await chat.retry()).toBe(true)
    expect(chat.state.value).toBe('done')
    expect(calls).toHaveLength(2)
    expect(calls[1].msg).toBe('原问题')
    expect(calls[1].thread_id).toBe('th-1')
    expect(flushed.join('')).toBe('恢复后的回答')
  })

  it('reasoning 推进阶段推断，session_assigned 原样透传', async () => {
    const assigned: Array<[string, string]> = []
    const streamFn: StreamFn = async (_p, onEvent) => {
      onEvent({ type: 'session_assigned', sessionId: '88', threadId: 'th-88' })
      onEvent({ type: 'reasoning', reasoning: '正在检索候选表元数据…' })
      onEvent({ type: 'reasoning', reasoning: '开始执行 SQL 取数' })
      onEvent({ type: 'done' })
    }
    const chat = useAskChat({
      onChunkFlush: () => {},
      onSessionAssigned: (sid, tid) => assigned.push([sid, tid]),
      streamFn,
    })
    await chat.send({ msg: '查询' })
    expect(assigned).toEqual([['88', 'th-88']])
    expect(chat.phase.value).toBe('executing')
  })

  it('dispose 后拒发，不残留忙碌态', async () => {
    const streamFn: StreamFn = async (_p, onEvent) => { onEvent({ type: 'done' }) }
    const chat = useAskChat({ onChunkFlush: () => {}, streamFn })
    chat.dispose()
    expect(await chat.send({ msg: '查询' })).toBe(false)
    expect(chat.state.value).toBe('idle')
  })
})

describe('inferPhaseFromReasoning · 阶段关键词推断', () => {
  it('取最后出现的关键词，阶段随思考推进不被早期词钉死', () => {
    expect(inferPhaseFromReasoning('先检索候选表，再生成 SQL')).toBe('generating_sql')
    expect(inferPhaseFromReasoning('生成 SQL 完成，正在执行 SQL')).toBe('executing')
    expect(inferPhaseFromReasoning('查询结束，开始总结整理回答')).toBe('summarizing')
  })

  it('无关键词与空文本返回 null；五个阶段都有文案', () => {
    expect(inferPhaseFromReasoning('')).toBeNull()
    expect(inferPhaseFromReasoning('今天天气不错')).toBeNull()
    expect(Object.keys(ASK_PHASE_LABELS)).toHaveLength(5)
  })
})