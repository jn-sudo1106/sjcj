// 智能问数统一客户端状态机（题面 useAskMcp 的实际落点：前端从不直连 MCP，
// 工具链由外部智能体执行，这里封装的是 /api/poc/chat/agent 的流式生命周期）。
// 状态迁移见 设计稿/设计方案/1117-智能问数对话页与ask-mcp链路_现状梳理与优化方案_2026-11-17.md §6。
import { computed, getCurrentInstance, onUnmounted, ref } from 'vue'
import {
  normalizeAskError,
  streamAgentChat,
  type AgentChatEvent,
  type AgentChatParams,
  type AskErrorInfo,
  type Clarification,
} from '@/api/aiChat'
import type { TableDraft } from '@/utils/aiChat/tableDraft'

export type AskChatState =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'stalled'
  | 'awaiting_clarification'
  | 'finalizing'
  | 'done'
  | 'done_empty'
  | 'failed'
  | 'interrupted'

export type AskPhase =
  | 'selecting_tables'
  | 'confirming'
  | 'generating_sql'
  | 'executing'
  | 'summarizing'

export const ASK_PHASE_LABELS: Record<AskPhase, string> = {
  selecting_tables: '正在检索候选表',
  confirming: '正在确认口径',
  generating_sql: '正在生成 SQL',
  executing: '正在查询数据',
  summarizing: '正在整理回答',
}

const PHASE_PATTERNS: Array<{ phase: AskPhase; re: RegExp }> = [
  { phase: 'selecting_tables', re: /检索|搜索|候选表|选表|匹配[^，。\n]{0,8}表|查找[^，。\n]{0,8}表|表元数据|元数据|search_tables/gi },
  { phase: 'confirming', re: /澄清|待确认|确认[^，。\n]{0,6}口径|clarification/gi },
  { phase: 'generating_sql', re: /生成\s*SQL|SQL\s*生成|构造查询|编写查询|改写|修复\s*SQL|sql_clean|sql_amend|sql_repair/gi },
  { phase: 'executing', re: /执行\s*SQL|运行\s*SQL|执行查询|查询数据|取数|execute_sql|正在执行/gi },
  { phase: 'summarizing', re: /总结|整理回答|汇总|归纳|组织回答/gi },
]

/**
 * 从思考文本推断当前阶段（降级版：SSE 工具事件契约未确认前的推断态）。
 * 取「最后出现」的关键词，保证阶段随思考推进而不是被早期关键词钉死。
 */
export function inferPhaseFromReasoning(text: string): AskPhase | null {
  if (!text) return null
  let best: AskPhase | null = null
  let bestIdx = -1
  for (const { phase, re } of PHASE_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m.index > bestIdx) {
        bestIdx = m.index
        best = phase
      }
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return best
}

export interface AskChatFinishInfo {
  state: 'done' | 'done_empty' | 'failed' | 'interrupted'
  hadContent: boolean
}

export interface UseAskChatOptions {
  /** chunk 合帧后的批量回调（≤12 次/秒），页面在此一次性追加正文 */
  onChunkFlush: (text: string) => void
  onReasoning?: (text: string) => void
  onClarification?: (clarification: Clarification) => void
  /** 后端结构化建表草稿（SSE 顶层 tableDraft / proposal.table）；正文代码块由页面在定稿时提取 */
  onTableDraft?: (draft: TableDraft) => void
  onSessionAssigned?: (sessionId: string, threadId: string) => void
  /** 上游结束原因（finish_reason / connection_closed），空回答时页面据此解释 */
  onFinishReason?: (reason: string) => void
  onError?: (info: AskErrorInfo) => void
  onFinished?: (info: AskChatFinishInfo) => void
  onStateChange?: (state: AskChatState) => void
  /** 无事件软超时：只提示「仍在思考」，不自动断（后端 read 上限 300s） */
  stallTimeoutMs?: number
  flushIntervalMs?: number
  /** 同会话同文本去抖窗口，防连点；不做问数结果缓存（数据随时在变） */
  debounceMs?: number
  /** 测试注入口；缺省走真实 streamAgentChat */
  streamFn?: typeof streamAgentChat
}

const BUSY_STATES: AskChatState[] = [
  'preparing',
  'streaming',
  'stalled',
  'awaiting_clarification',
  'finalizing',
]

export function useAskChat(options: UseAskChatOptions) {
  const stallTimeoutMs = options.stallTimeoutMs ?? 90_000
  const flushIntervalMs = options.flushIntervalMs ?? 80
  const debounceMs = options.debounceMs ?? 3_000
  const streamFn = options.streamFn ?? streamAgentChat

  const state = ref<AskChatState>('idle')
  const phase = ref<AskPhase | null>(null)
  const error = ref<AskErrorInfo | null>(null)
  const isBusy = computed(() => BUSY_STATES.includes(state.value))

  let controller: AbortController | null = null
  let chunkBuffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let reasoningAcc = ''
  let receivedChars = 0
  let gotClarification = false
  let lastParams: AgentChatParams | null = null
  let lastSendKey = ''
  let lastSendAt = 0
  let disposed = false

  function setState(next: AskChatState) {
    if (state.value === next) return
    state.value = next
    options.onStateChange?.(next)
  }

  function flushNow() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (chunkBuffer) {
      const text = chunkBuffer
      chunkBuffer = ''
      options.onChunkFlush(text)
    }
  }

  function scheduleFlush() {
    if (flushTimer !== null) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushNow()
    }, flushIntervalMs)
  }

  function clearStallTimer() {
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
  }

  function armStallTimer() {
    clearStallTimer()
    stallTimer = setTimeout(() => {
      stallTimer = null
      if (state.value === 'streaming' || state.value === 'preparing') {
        setState('stalled')
      }
    }, stallTimeoutMs)
  }

  function clearTimers() {
    clearStallTimer()
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  function finalize(kind: 'done' | 'done_empty' | 'failed' | 'interrupted') {
    flushNow()
    clearTimers()
    controller = null
    setState(kind)
    options.onFinished?.({ state: kind, hadContent: receivedChars > 0 || gotClarification })
  }

  function handleEvent(event: AgentChatEvent) {
    armStallTimer()
    switch (event.type) {
      case 'session_assigned':
        options.onSessionAssigned?.(event.sessionId, event.threadId)
        break
      case 'chunk':
        receivedChars += event.text.length
        chunkBuffer += event.text
        scheduleFlush()
        if (state.value === 'preparing' || state.value === 'stalled' || state.value === 'awaiting_clarification') {
          setState('streaming')
        }
        break
      case 'reasoning':
        reasoningAcc += event.reasoning
        phase.value = inferPhaseFromReasoning(reasoningAcc) ?? phase.value
        options.onReasoning?.(event.reasoning)
        if (state.value === 'preparing' || state.value === 'stalled') {
          setState('streaming')
        }
        break
      case 'clarification':
        gotClarification = true
        options.onClarification?.(event.clarification)
        setState('awaiting_clarification')
        break
      case 'table_draft':
        gotClarification = true
        options.onTableDraft?.(event.draft)
        break
      case 'finish':
        options.onFinishReason?.(event.reason)
        break
      case 'error':
        error.value = normalizeAskError(event.error)
        options.onError?.(error.value)
        setState('failed')
        break
      case 'done':
        if (state.value === 'failed' || state.value === 'interrupted') {
          flushNow()
          clearTimers()
          controller = null
          options.onFinished?.({ state: state.value, hadContent: receivedChars > 0 || gotClarification })
        } else {
          setState('finalizing')
          finalize(receivedChars > 0 || gotClarification ? 'done' : 'done_empty')
        }
        break
    }
  }

  /** 发起一次问数；忙碌中或去抖窗口内的重复发送返回 false。重试/重新生成可绕过去抖 */
  async function send(params: AgentChatParams, opts?: { bypassDebounce?: boolean }): Promise<boolean> {
    if (disposed || isBusy.value) return false
    const key = `${params.session_id ?? ''}|${params.thread_id ?? ''}|${params.msg}`
    const now = Date.now()
    if (!opts?.bypassDebounce && key === lastSendKey && now - lastSendAt < debounceMs) return false
    lastSendKey = key
    lastSendAt = now
    lastParams = { ...params }

    error.value = null
    phase.value = null
    chunkBuffer = ''
    reasoningAcc = ''
    receivedChars = 0
    gotClarification = false
    const request = new AbortController()
    controller = request
    setState('preparing')
    armStallTimer()

    try {
      await streamFn({ ...params, signal: request.signal }, (event) => {
        if (controller === request && !request.signal.aborted) handleEvent(event)
      })
      // streamAgentChat 正常结束必发 done；兜底处理未走 done 的实现
      if (controller === request) {
        if (request.signal.aborted) finalize('interrupted')
        else if (isBusy.value) finalize(receivedChars > 0 || gotClarification ? 'done' : 'done_empty')
      }
      return true
    } catch (err) {
      if (controller !== request) return true
      const aborted = (err as { name?: string })?.name === 'AbortError' || request.signal.aborted
      if (aborted) {
        finalize('interrupted')
      } else {
        error.value = normalizeAskError(err)
        options.onError?.(error.value)
        finalize('failed')
      }
      return true
    }
  }

  /** 停止当前流（Esc / 停止按钮）；后端会落 INTERRUPTED */
  function stop() {
    controller?.abort()
  }

  /** 重试：原问题、原会话/thread 重发，不新建会话 */
  async function retry(): Promise<boolean> {
    if (!lastParams || isBusy.value) return false
    lastSendKey = ''
    return send({ ...lastParams })
  }

  function reset() {
    stop()
    controller = null
    clearTimers()
    chunkBuffer = ''
    error.value = null
    phase.value = null
    setState('idle')
  }

  function dispose() {
    disposed = true
    stop()
    clearTimers()
    controller = null
  }

  if (getCurrentInstance()) {
    onUnmounted(dispose)
  }

  return {
    state,
    phase,
    error,
    isBusy,
    send,
    stop,
    retry,
    reset,
    dispose,
    get lastParams() {
      return lastParams
    },
  }
}
