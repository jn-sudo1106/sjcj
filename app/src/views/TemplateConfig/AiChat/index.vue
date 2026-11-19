<script setup lang="ts">
// AI 智能问数（Agent 交互对话工作台）
// 位于「问数配置」分组，支持 Text-to-SQL、多轮主动澄清与问答、思考链展示、KPI指标卡片、图表与明细切换
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { getActivePinia } from 'pinia'
import {
  ArrowDown,
  ChatDotRound,
  Close,
  CopyDocument,
  Delete,
  Plus,
  RefreshRight,
  Search,
  TrendCharts,
  VideoPause,
} from '@element-plus/icons-vue'
import {
  listAiSessions,
  deleteAiSession,
  getAiChatHistoryPage,
  clarificationOptionKey,
  extractClarificationFromText,
  extractChartDataFromText,
  type AiSessionItem,
  type AskErrorCode,
  type ChatMessage,
  type Clarification,
} from '@/api/aiChat'
import { downloadCsv, toCsv, csvDateTag, type CsvCell } from '@/utils/csv'
import { downloadXlsx, exportDateTag, type XlsxCell } from '@/utils/format/xlsxExport'
import { saveColdMessages, loadColdMessages, dropColdMessages } from '@/utils/chatColdCache'
import { copyToClipboard } from '@/utils/clipboard'
import { useAuthStore } from '@/stores/auth'
import { useAskChat, ASK_PHASE_LABELS } from './useAskChat'
import {
  buildTableDraftPrompt,
  createTableFromDraft,
  extractTableDraftFromText,
  formatTableCreatedMessage,
  parseTableCreatedMessage,
  stripTableDraftBlock,
  type TableDraft,
} from '@/utils/aiChat/tableDraft'

// 富渲染器按需加载：首屏 chunk 只留会话侧栏/输入框/消息骨架，
// marked+dompurify、澄清卡片、图表数据卡在首次出现对应消息时再拉取
const MarkdownOutput = defineAsyncComponent(() => import('@/components/MarkdownOutput.vue'))
const ClarificationCard = defineAsyncComponent(() => import('./ClarificationCard.vue'))
const DataViewCard = defineAsyncComponent(() => import('./DataViewCard.vue'))
const TableDraftCard = defineAsyncComponent(() => import('./TableDraftCard.vue'))

// 推荐问数场景（2026-11-19 用户要求先隐藏：场景内容未定下来；后端接口 listRecommendedQuestions 与
// 配置入口保留，确认场景后再放回展示，届时恢复模板、onMounted 加载与本段逻辑）
const SHOW_STARTER_PROMPTS = false

interface Props {
  initialSessions?: AiSessionItem[]
  initialMessages?: Record<string, ChatMessage[]>
}

const props = withDefaults(defineProps<Props>(), {
  initialSessions: () => [],
  initialMessages: () => ({}),
})

// 会话列表与当前活动会话（'new' 代表进入新建会话页面）
const sessions = ref<AiSessionItem[]>([])
const activeSessionId = ref<string>('new')
const searchSessionKeyword = ref<string>('')

// 输入框与发送参数（流式生命周期由 useAskChat 状态机统一管理）
const promptText = ref<string>('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// 视图切换与思考链折叠（支持趋势柱状、占比饼图与明细数据表；按用户需求默认展示明细列表）
const activeDataView = ref<'chart' | 'pie' | 'table'>('table')
const dataViewMap = reactive<Record<string, 'chart' | 'pie' | 'table'>>({})

function getMsgDataView(msg: ChatMessage): 'chart' | 'pie' | 'table' {
  return dataViewMap[msg.id] ?? activeDataView.value
}

function setMsgDataView(msg: ChatMessage, view: 'chart' | 'pie' | 'table') {
  dataViewMap[msg.id] = view
  activeDataView.value = view
}

let msgIdCounter = 0
function nextMsgId(suffix: string): string {
  return `m-${Date.now()}-${++msgIdCounter}-${suffix}`
}

const isThinkingExpanded = ref<boolean>(true)
const chatContainerRef = ref<HTMLElement | null>(null)

// 每条消息独立的思考链展开状态映射（按 msg.id 记录）
const thinkingExpandedMap = reactive<Record<string, boolean>>({})
const thinkingElapsedSeconds = ref(0)
let thinkingTimer: ReturnType<typeof setInterval> | null = null
let scrollRafId: number | null = null

// ===== 流式状态机（useAskChat）=====
let activeAssistantMsg: ChatMessage | null = null
let streamSessionId = ''
let streamStartTime = 0

const askChat = useAskChat({
  onChunkFlush: (text) => {
    if (!activeAssistantMsg) return
    const isFirstChunk = !activeAssistantMsg.content
    activeAssistantMsg.content += text
    // 正文一开始就把思考过程收起：等答完再收起会把下方回答整体顶上去一大截
    // （实测 160px+ 的位移，看起来就是「答完抖一下」）；在正文还空的时候收，位移最小。
    // 用户仍可点头部展开回看，历史消息沿用默认收起逻辑。
    if (isFirstChunk) thinkingExpandedMap[activeAssistantMsg.id] = false
    followScroll()
  },
  onReasoning: (text) => {
    if (!activeAssistantMsg) return
    if (!activeAssistantMsg.thinking) {
      activeAssistantMsg.thinking = { completed: false, durationMs: 0, steps: [], text: '' }
    }
    activeAssistantMsg.thinking.text = (activeAssistantMsg.thinking.text || '') + text
    followScroll()
  },
  onClarification: (clarification) => {
    if (!activeAssistantMsg) return
    // 建表模式下智能体检索已有表的结果不是选表澄清，不出勾选卡片
    if (activeAssistantMsg.draftMode === 'table' || activeAssistantMsg.tableDraft) return
    activeAssistantMsg.clarification = { ...clarification, confirmed: false }
    followScroll()
  },
  onTableDraft: (draft) => {
    if (!activeAssistantMsg) return
    activeAssistantMsg.tableDraft = { draft, status: 'pending' }
    activeAssistantMsg.clarification = undefined
    followScroll()
  },
  onSessionAssigned: (sessionId, threadId) => {
    if (!sessionId) return
    const oldId = streamSessionId
    if (oldId === sessionId) return
    const target = sessions.value.find((s) => s.id === oldId)
    if (target) {
      target.id = sessionId
      if (threadId) target.uuid = threadId
    }
    sessionMessages.value[sessionId] = sessionMessages.value[oldId] || []
    delete sessionMessages.value[oldId]
    if (historyMeta[oldId]) {
      historyMeta[sessionId] = historyMeta[oldId]
      delete historyMeta[oldId]
    }
    if (activeSessionId.value === oldId) {
      activeSessionId.value = sessionId
    }
    streamSessionId = sessionId
  },
  onError: (info) => {
    if (activeAssistantMsg) {
      activeAssistantMsg.status = 'failed'
      activeAssistantMsg.errorInfo = info
    }
    ElMessage.error(info.message)
  },
  onFinished: ({ state }) => {
    finalizeActiveMessage(state)
  },
})
const isSending = computed(() => askChat.isBusy.value)
const askState = askChat.state
const askPhase = askChat.phase

function startThinkingTimer() {
  thinkingElapsedSeconds.value = 0
  if (thinkingTimer) clearInterval(thinkingTimer)
  thinkingTimer = setInterval(() => {
    thinkingElapsedSeconds.value = Math.floor((Date.now() - streamStartTime) / 1000)
  }, 500)
}

function stopThinkingTimer() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer)
    thinkingTimer = null
  }
}

// 流结束/中断/失败：定稿思考链、提取富卡片、落消息状态
function finalizeActiveMessage(state: 'done' | 'done_empty' | 'failed' | 'interrupted') {
  const msg = activeAssistantMsg
  activeAssistantMsg = null
  stopThinkingTimer()
  if (!msg) return

  if (msg.thinking) {
    msg.thinking.completed = true
    msg.thinking.durationMs = Date.now() - streamStartTime
    if (state === 'interrupted') msg.thinking.interrupted = true
    if (
      (!msg.thinking.steps || msg.thinking.steps.length === 0) &&
      msg.thinking.text
    ) {
      const lines = msg.thinking.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      msg.thinking.steps = lines.length > 0 ? lines : [msg.thinking.text]
    }
  }

  if (state === 'interrupted') {
    msg.interrupted = true
    msg.status = 'interrupted'
    ElMessage.info('已中断问数响应')
  } else if (state === 'failed') {
    msg.status = 'failed'
  } else {
    // 智能提取回答中的 SQL 代码块（如有）；指标未知 → 标注待执行口径，不造假
    const sqlMatch = msg.content.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i)
    if (sqlMatch && !msg.sql) {
      const sqlCode = sqlMatch[1].trim()
      if (/^(?:SELECT|WITH|SHOW|DESC|EXPLAIN)\b/i.test(sqlCode)) {
        msg.sql = { code: sqlCode, estimated: true }
      }
    }
    if (!msg.tableDraft && msg.content) {
      const draft = extractTableDraftFromText(msg.content)
      if (draft) msg.tableDraft = { draft, status: 'pending' }
    }
    if (msg.tableDraft) msg.clarification = undefined
    if (!msg.clarification && !msg.tableDraft && msg.content) {
      const parsedClarification = extractClarificationFromText(msg.content)
      if (parsedClarification) {
        msg.clarification = { ...parsedClarification, confirmed: false }
      }
    }
    // 回复「建表结果」时智能体常复述字段表，那是表结构不是业务数据，不出统计图
    if (!msg.clarification && !msg.chartData && !msg.tableDraft && msg.content && !parseTableCreatedMessage(msg.question || '')) {
      const parsedChartData = extractChartDataFromText(msg.content)
      if (parsedChartData) {
        msg.chartData = parsedChartData
      }
    }
    const hasBody = Boolean(
      msg.content.trim() || msg.sql || msg.clarification || msg.chartData || msg.tableDraft,
    )
    msg.status = hasBody ? 'done' : 'empty'
    if (!hasBody) {
      thinkingExpandedMap[msg.id] = true
    }
  }

  const currentSession = sessions.value.find((s) => s.id === streamSessionId)
  if (currentSession) {
    currentSession.updatedAt = '刚刚'
  }
  followScroll()
}

// ===== 滚动跟随：距底 ≤80px 才自动拉底，上翻时不打断用户 =====
const isFollowingScroll = ref(true)
const unreadBelowCount = ref(0)

// 自己写 scrollTop 触发的 scroll 事件不能当成「用户上翻」：
// rAF 里读到的高度可能已经落后于最新内容（大 chunk 一到就差出几十~上百 px），
// 旧逻辑会把这种滚动判成用户离开底部 → 自动跟随被关掉、内容卡住，收尾时再一下跳到底。
let ignoreOwnScrollEvents = 0
let ignoreOwnScrollTimer: number | null = null
let lastProgrammaticTop = -1

function markOwnScrollEvent() {
  ignoreOwnScrollEvents += 1
  if (ignoreOwnScrollTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(ignoreOwnScrollTimer)
  }
  ignoreOwnScrollTimer =
    typeof window !== 'undefined'
      ? window.setTimeout(() => {
          ignoreOwnScrollEvents = 0
          ignoreOwnScrollTimer = null
        }, 400)
      : null
}

function scrollThreadToBottom(el: HTMLElement) {
  const target = el.scrollHeight
  // 值没变就不会派发 scroll 事件，不能预先记账，否则会把下一次真实滚动吃掉
  if (Math.abs(el.scrollTop - target) > 1) {
    markOwnScrollEvent()
    lastProgrammaticTop = target
  }
  el.scrollTop = target
}

function handleThreadScroll() {
  const el = chatContainerRef.value
  if (!el) return
  // 只忽略「停在我们自己刚写进去的位置」的那次滚动；用户在同一帧里往上拖走就不是这个位置了
  if (ignoreOwnScrollEvents > 0 && Math.abs(el.scrollTop - lastProgrammaticTop) <= 1) {
    ignoreOwnScrollEvents -= 1
    return
  }
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  isFollowingScroll.value = distance <= 80
  if (isFollowingScroll.value) unreadBelowCount.value = 0
}

function followScroll() {
  if (isFollowingScroll.value) {
    scrollToBottom()
  } else {
    unreadBelowCount.value += 1
  }
}

function backToBottom() {
  isFollowingScroll.value = true
  unreadBelowCount.value = 0
  scrollToBottom(true)
}

function isThinkingOpen(msg: ChatMessage): boolean {
  if (thinkingExpandedMap[msg.id] !== undefined) {
    return thinkingExpandedMap[msg.id]
  }
  // 正在思考时自动展开
  if (msg.thinking && !msg.thinking.completed) {
    return true
  }
  // 思考已完成但无正文回复时自动展开，方便用户查看排查步骤与思考日志
  if (msg.thinking?.completed && !msg.content) {
    return true
  }
  // 澄清卡片场景继承原默认值
  if (msg.clarification) {
    return isThinkingExpanded.value
  }
  // 有最终回答时默认收起
  return false
}

function toggleThinking(msgId: string, currentOpen: boolean) {
  thinkingExpandedMap[msgId] = !currentOpen
}

function isMsgClarifyConfirmed(msg: ChatMessage): boolean {
  if (msg.clarification) {
    return Boolean(msg.clarification.confirmed)
  }
  return clarifyConfirmed.value
}

function getMsgSelectedTableNames(msg: ChatMessage): string[] {
  if (msg.clarification?.options && msg.clarification.selectedEntryTypeIds?.length) {
    return msg.clarification.options
      .filter((o, i) =>
        msg.clarification!.selectedEntryTypeIds!.includes(clarificationOptionKey(o, i))
      )
      .map((o) => o.typeName || o.tableName)
  }
  return []
}

function formatClarifyIntro(content: string, hasClarification = false): string {
  if (!content) return ''
  if (!hasClarification) return content

  // 1. 若该消息已成功提取并渲染了待确认卡片/表格，从正文中移除冗余的静态 Markdown 表格
  let cleaned = content
    .replace(
      /(?:^|\n)\s*\|[^\n]+\|\s*\n\s*\|[\s:\-|]+\|\s*\n(?:(?:\s*\|[^\n]+\|\s*(?:\n|$))+)/g,
      '\n'
    )

  // 2. 移除冗余的静态候选列表项（由 ClarificationCard 交互勾选表格承载）
  cleaned = cleaned.replace(
    /(?:^|\n)(?:\s*(?:[-*+•]|\d+[\.、]|\(\d+\)|\d+\))\s+[^\n]+(?:\n|$))+/g,
    '\n'
  )

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  return cleaned
}

// 正文清洗结果按消息缓存：流式合帧后只有正在输出的那条会失效，
// 避免长对话里每次渲染对全部历史消息重跑全文正则
const markdownContentCache = new Map<string, { src: string; out: string }>()

function formatMarkdownContent(msg: ChatMessage): string {
  if (!msg.content) return ''
  const hit = markdownContentCache.get(msg.id)
  if (hit && hit.src === msg.content) return hit.out
  // 建表草稿代码块由草稿卡片承载，正文里只留说明文字
  let out = /```table-draft/i.test(msg.content) ? stripTableDraftBlock(msg.content) : msg.content
  // 若已解析出业务图表/导出结构 chartData，则从正文中移除冗余的静态 Markdown 表格，由数据卡统一承载图表与表格及导出交互
  if (msg.chartData) {
    out = out
      .replace(
        /(?:^|\n)\s*\|[^\n]+\|\s*\n\s*\|[\s:\-|]+\|\s*\n(?:(?:\s*\|[^\n]+\|\s*(?:\n|$))+)/g,
        '\n'
      )
      .trim()
  }
  if (markdownContentCache.size > 300) markdownContentCache.clear()
  markdownContentCache.set(msg.id, { src: msg.content, out })
  return out
}

// 清理导出文件名，去除特殊符号与表情
function getSafeExportFileName(title: string, defaultName = '问数明细数据'): string {
  const clean = title
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return clean || defaultName
}

// 导出明细表格数据为 Excel (.xlsx)（全量导出）
function exportTableToExcel(msg: ChatMessage) {
  if (!msg.chartData?.tableColumns?.length || !msg.chartData?.tableRows?.length) {
    ElMessage.warning('当前暂无可导出的明细数据')
    return
  }
  const cols = msg.chartData.tableColumns
  const rows = msg.chartData.tableRows

  const headerRow: XlsxCell[] = cols.map((c) => c.label)
  const dataRows: XlsxCell[][] = rows.map((r) =>
    cols.map((c) => {
      const v = r[c.prop]
      return v != null ? (typeof v === 'number' ? v : String(v)) : ''
    })
  )
  const baseName = getSafeExportFileName(msg.chartData.title || '', '问数明细报表')
  const fileName = `${baseName}_${exportDateTag()}`
  downloadXlsx(fileName, [headerRow, ...dataRows], baseName.slice(0, 31))
  ElMessage.success(`已成功导出 ${rows.length} 条数据为 Excel 文件：${fileName}.xlsx`)
}

// 导出明细表格数据为 CSV (.csv)（全量导出）
function exportTableToCsv(msg: ChatMessage) {
  if (!msg.chartData?.tableColumns?.length || !msg.chartData?.tableRows?.length) {
    ElMessage.warning('当前暂无可导出的明细数据')
    return
  }
  const cols = msg.chartData.tableColumns
  const rows = msg.chartData.tableRows

  const headers = cols.map((c) => c.label)
  const dataRows: CsvCell[][] = rows.map((r) =>
    cols.map((c) => {
      const v = r[c.prop]
      return v != null ? (typeof v === 'number' ? v : String(v)) : ''
    })
  )
  const baseName = getSafeExportFileName(msg.chartData.title || '', '问数明细数据')
  const fileName = `${baseName}_${csvDateTag()}`
  const csvContent = toCsv(headers, dataRows)
  downloadCsv(fileName, csvContent)
  ElMessage.success(`已成功导出 ${rows.length} 条数据为 CSV 文件：${fileName}.csv`)
}

// 交互澄清卡片：载荷结构与 MCP 的 clarification 一致
const currentClarification = ref<Clarification>({
  kind: 'table_choice',
  reason: 'TOO_MANY',
  question: '「异常任务」可能落在多张表里，请选择本次要排查的范围（可多选）：',
  allowFreeText: true,
  maxSelect: 5,
  options: [
    {
      entryTypeId: 101,
      tableName: 'ck_source_log',
      typeName: '抓取网络层异常',
      hint: 'HTTP 403 被封锁、504 超时、SSL 握手失败等网络拦截',
    },
    {
      entryTypeId: 102,
      tableName: 'ck_clean_error',
      typeName: '规则清洗异常',
      hint: '网页改版导致 XPath 失效、字段提取为空、正则未命中',
    },
    {
      entryTypeId: 103,
      tableName: 'sys_runner_task',
      typeName: '调度队列积压',
      hint: 'Runner 执行器离线、任务排队超时被系统强制取消',
    },
  ],
})
const clarifyConfirmed = ref<boolean>(false)
const selectedTables = ref<string[]>([])
const clarifySessionId = ref<string>('s1')
const clarifyCardKey = ref<number>(0)

function cloneInitialMessages(raw?: Record<string, ChatMessage[]>): Record<string, ChatMessage[]> {
  if (!raw) return {}
  let result: Record<string, ChatMessage[]> = {}
  try {
    result = JSON.parse(JSON.stringify(raw))
  } catch {
    result = { ...raw }
  }
  // 遍历历史消息，若有包含待确认项或业务数据表格但未预置结构的消息，自动补充解析
  for (const key of Object.keys(result)) {
    for (const msg of result[key]) {
      if (msg.role === 'assistant' && !msg.clarification && msg.content) {
        const parsedClarify = extractClarificationFromText(msg.content)
        if (parsedClarify) {
          msg.clarification = parsedClarify
        }
      }
      if (msg.role === 'assistant' && !msg.chartData && !msg.clarification && msg.content) {
        const parsed = extractChartDataFromText(msg.content)
        if (parsed) {
          msg.chartData = parsed
        }
      }
    }
  }
  return result
}

// 会话消息库（由用户交互动态生成并按会话 ID 隔离，支持 props 注入测试消息）
const sessionMessages = ref<Record<string, ChatMessage[]>>(cloneInitialMessages(props.initialMessages))

// 当前会话的消息列表
const currentMessages = computed(() => {
  if (activeSessionId.value === 'new') return []
  return sessionMessages.value[activeSessionId.value] || []
})

// ===== 渲染窗口：长对话只挂载尾部 N 条，向上翻页逐步揭示 =====
const RENDER_WINDOW = 60
const extraRevealed = ref(0)
const visibleMessages = computed(() => {
  const all = currentMessages.value
  const limit = RENDER_WINDOW + extraRevealed.value
  if (all.length <= limit) return all
  return all.slice(all.length - limit)
})
const hasHiddenEarlier = computed(() => {
  const meta = historyMeta[activeSessionId.value]
  const hiddenInMemory = currentMessages.value.length - visibleMessages.value.length
  const hiddenOnServer = meta ? (meta.loadedPageNo - 1) * meta.pageSize : 0
  return hiddenInMemory > 0 || hiddenOnServer > 0
})

// ===== 会话内存 LRU：只保留最近使用的会话消息在内存，其余下沉 IndexedDB 冷缓存 =====
// 智能体上下文由 thread_id 承载（后端只转发当前问题），前端驱逐本地消息不影响 AI 记忆
const SESSION_LRU = 3
const sessionUsageOrder: string[] = []

function touchSession(id: string) {
  if (!id || id === 'new') return
  const idx = sessionUsageOrder.indexOf(id)
  if (idx >= 0) sessionUsageOrder.splice(idx, 1)
  sessionUsageOrder.push(id)
  while (sessionUsageOrder.length > SESSION_LRU) {
    const evictId = sessionUsageOrder.shift()!
    const msgs = sessionMessages.value[evictId]
    if (msgs && msgs.length > 0 && evictId !== streamSessionId) {
      void saveColdMessages(evictId, msgs)
      delete sessionMessages.value[evictId]
      delete historyMeta[evictId]
    }
  }
}

// 堆内存告警阈值：超过即把非当前会话消息全部下沉冷缓存
const HEAP_SOFT_LIMIT = 350 * 1024 * 1024
function checkMemoryPressure() {
  const used = (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize
  if (!used || used < HEAP_SOFT_LIMIT) return
  for (const id of Object.keys(sessionMessages.value)) {
    if (id === activeSessionId.value || id === streamSessionId) continue
    const msgs = sessionMessages.value[id]
    if (msgs && msgs.length > 0) void saveColdMessages(id, msgs)
    delete sessionMessages.value[id]
    delete historyMeta[id]
    const idx = sessionUsageOrder.indexOf(id)
    if (idx >= 0) sessionUsageOrder.splice(idx, 1)
  }
}

// ===== 历史分页元信息：后端 chat_log 按 id 升序分页，pageNo=1 是最旧一页 =====
const historyMeta = reactive<Record<string, { loadedPageNo: number; total: number; pageSize: number }>>({})
const loadingEarlier = ref(false)

// 是否处于新建问数会话页面
const isNewSession = computed(() => activeSessionId.value === 'new')

// 当前会话标题
const currentSessionTitle = computed(() => {
  const target = sessions.value.find((s) => s.id === activeSessionId.value)
  return target ? target.title : ''
})

// 过滤后的会话分组
const todaySessions = computed(() =>
  sessions.value.filter(
    (s) =>
      s.group === 'today' &&
      (!searchSessionKeyword.value || s.title.includes(searchSessionKeyword.value))
  )
)

const weekSessions = computed(() =>
  sessions.value.filter(
    (s) =>
      s.group === 'week' &&
      (!searchSessionKeyword.value || s.title.includes(searchSessionKeyword.value))
  )
)

const earlierSessions = computed(() =>
  sessions.value.filter(
    (s) =>
      s.group === 'earlier' &&
      (!searchSessionKeyword.value || s.title.includes(searchSessionKeyword.value))
  )
)

// 异步加载指定会话的历史消息（如果内存中尚未加载）
// 冷缓存（IndexedDB）只是加速层，缺件回源后端 chat_log；首屏只取最新一页
async function loadSessionHistoryIfNeeded(id: string) {
  if (!id || id === 'new') return
  if (sessionMessages.value[id]?.length || historyMeta[id]) return
  const cold = await loadColdMessages(id)
  if (cold && cold.length > 0) {
    sessionMessages.value[id] = cold
    return
  }
  try {
    const pageSize = 100
    let page = await getAiChatHistoryPage(id, 1, pageSize)
    if (page.total > pageSize) {
      page = await getAiChatHistoryPage(id, Math.ceil(page.total / pageSize), pageSize)
    }
    sessionMessages.value[id] = page.messages
    historyMeta[id] = { loadedPageNo: page.pageNo, total: page.total, pageSize }
  } catch (e) {
    console.warn('[loadSessionHistoryIfNeeded] 加载会话历史失败:', e)
    if (!sessionMessages.value[id]) {
      sessionMessages.value[id] = []
    }
  }
}

// 向上翻更早的历史：先揭示内存中被窗口隐藏的部分，再向服务端要上一页，并保持滚动锚点
async function handleLoadEarlier() {
  const id = activeSessionId.value
  if (id === 'new' || loadingEarlier.value) return
  const all = currentMessages.value
  if (all.length > visibleMessages.value.length) {
    extraRevealed.value += RENDER_WINDOW
    return
  }
  const meta = historyMeta[id]
  if (!meta || meta.loadedPageNo <= 1) return
  loadingEarlier.value = true
  const el = chatContainerRef.value
  const prevHeight = el?.scrollHeight ?? 0
  const prevTop = el?.scrollTop ?? 0
  try {
    const page = await getAiChatHistoryPage(id, meta.loadedPageNo - 1, meta.pageSize)
    const known = new Set(all.map((m) => m.id))
    const fresh = page.messages.filter((m) => !known.has(m.id))
    sessionMessages.value[id] = [...fresh, ...all]
    meta.loadedPageNo = page.pageNo
    meta.total = page.total
    await nextTick()
    if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight)
  } catch (e) {
    console.warn('[handleLoadEarlier] 加载更早消息失败:', e)
    ElMessage.warning('加载更早消息失败，请稍后重试')
  } finally {
    loadingEarlier.value = false
  }
}

onMounted(async () => {
  if (props.initialSessions && props.initialSessions.length > 0) {
    sessions.value = [...props.initialSessions]
  } else {
    // 测试环境可能未安装 Pinia：仅在存在活跃 store 时携带用户过滤
    const userId = getActivePinia() ? useAuthStore().info?.id : undefined
    const res = await listAiSessions(userId)
    sessions.value = [...res]
  }
  if (sessions.value.length > 0) {
    activeSessionId.value = sessions.value[0].id
    clarifySessionId.value = sessions.value[0].id
    touchSession(activeSessionId.value)
    await loadSessionHistoryIfNeeded(activeSessionId.value)
    scrollToBottom()
  } else {
    activeSessionId.value = 'new'
  }

})

// 滚动到底部；force=true 时同时恢复自动跟随并清零未读
function scrollToBottom(force = false) {
  if (force) {
    isFollowingScroll.value = true
    unreadBelowCount.value = 0
  }
  nextTick(() => {
    if (!chatContainerRef.value) return
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      if (scrollRafId !== null) return
      scrollRafId = window.requestAnimationFrame(() => {
        scrollRafId = null
        if (chatContainerRef.value) {
          scrollThreadToBottom(chatContainerRef.value)
        }
      })
    } else {
      scrollThreadToBottom(chatContainerRef.value)
    }
  })
}

// 中断当前正在进行的问数会话
function handleStop() {
  if (!isSending.value) return
  askChat.stop()
}

// 切换会话
async function handleSelectSession(id: string) {
  if (isSending.value) {
    handleStop()
  }
  activeSessionId.value = id
  clarifySessionId.value = id
  extraRevealed.value = 0
  touchSession(id)
  await loadSessionHistoryIfNeeded(id)
  checkMemoryPressure()
  scrollToBottom(true)
}

// 删除单个会话
function handleDeleteSession(id: string) {
  if (activeSessionId.value === id && isSending.value) {
    handleStop()
  }

  sessions.value = sessions.value.filter((s) => s.id !== id)
  const clone = { ...sessionMessages.value }
  delete clone[id]
  sessionMessages.value = clone
  delete historyMeta[id]
  void dropColdMessages(id)
  const usageIdx = sessionUsageOrder.indexOf(id)
  if (usageIdx >= 0) sessionUsageOrder.splice(usageIdx, 1)

  if (activeSessionId.value === id) {
    if (sessions.value.length > 0) {
      activeSessionId.value = sessions.value[0].id
      clarifySessionId.value = sessions.value[0].id
      touchSession(activeSessionId.value)
      loadSessionHistoryIfNeeded(activeSessionId.value)
    } else {
      activeSessionId.value = 'new'
      clarifySessionId.value = 'new'
    }
  }
  ElMessage.info('已删除会话')

  // 异步通知后端软删除（不阻塞前端响应）
  deleteAiSession(id).catch((err) => {
    console.warn('[handleDeleteSession] 后端会话软删除失败:', err)
  })
}

// 清空所有历史会话
function handleClearSessions() {
  if (isSending.value) {
    handleStop()
  }
  const currentList = [...sessions.value]
  sessions.value = []
  sessionMessages.value = {}
  for (const key of Object.keys(historyMeta)) delete historyMeta[key]
  sessionUsageOrder.length = 0
  for (const s of currentList) void dropColdMessages(s.id)
  activeSessionId.value = 'new'
  clarifySessionId.value = 'new'
  ElMessage.info('已清空历史会话')

  Promise.allSettled(currentList.map((s) => deleteAiSession(s.id))).catch(() => {})
}

// 点击「新建问数会话」按钮 -> 进入全新的会话页面
function handleNewChat() {
  if (isSending.value) {
    handleStop()
  }
  activeSessionId.value = 'new'
  clarifySessionId.value = 'new'
  promptText.value = ''
  clarifyConfirmed.value = false
  selectedTables.value = []
  extraRevealed.value = 0
  clarifyCardKey.value += 1
  ElMessage.info('已进入新会话页面')
}

// 确认澄清/待确认项：锁定卡片，把用户勾选的项回传给智能体会话推进下一轮分析
async function handleConfirmClarify(
  payload: { selectedEntryTypeIds: number[]; freeText: string },
  msg?: ChatMessage
) {
  const targetMsg = msg || currentMessages.value.find((m) => m.clarification && !m.clarification.confirmed) || currentMessages.value.find((m) => m.clarification)
  const clarification = targetMsg?.clarification || currentClarification.value

  if (targetMsg?.clarification) {
    if (targetMsg.clarification.confirmed) return
    targetMsg.clarification.confirmed = true
    targetMsg.clarification.selectedEntryTypeIds = payload.selectedEntryTypeIds
  } else {
    clarifyConfirmed.value = true
  }

  const selectedOptions = clarification.options.filter((option, index) =>
    payload.selectedEntryTypeIds.includes(clarificationOptionKey(option, index))
  )
  const names = selectedOptions.map((option) => option.typeName || option.tableName)
  selectedTables.value = names

  // 澄清答案走文本通道回传智能体（唯一通道）：把勾选结果拼成下一轮用户消息，
  // 由智能体在 thread 上下文中继续分析；不再调用独立的澄清提交端点。
  // 文本里带上物理表名：中文名完全相同的两张表只有表名能区分，
  // 也是智能体 submit_table_selection(locked_tables=[...]) 的锁定依据。
  if (!targetMsg?.sql && !targetMsg?.chartData) {
    const describeOption = (option: Clarification['options'][number]) => {
      const display = option.typeName || option.tableName
      return option.tableName && option.tableName !== display
        ? `${display}（${option.tableName}）`
        : display
    }
    const textParts: string[] = []
    if (selectedOptions.length) {
      if (selectedOptions.length === 1) {
        textParts.push(describeOption(selectedOptions[0]))
      } else {
        textParts.push(`已确认选择：${selectedOptions.map(describeOption).join('、')}`)
      }
    }
    if (payload.freeText) {
      textParts.push(`补充要求：${payload.freeText}`)
    }
    const followUpText = textParts.join('；')
    if (followUpText) {
      ElMessage.success('已采纳所选口径，正在继续分析')
      promptText.value = followUpText
      await handleSend()
      return
    }
  }

  scrollToBottom()
}

// ===== 智能体对话建表 =====
// 输入框「建表模式」开关：开启后提问会附带草稿格式要求，回答里的草稿渲染成确认卡片
const tableDraftMode = ref(false)

function toggleTableDraftMode() {
  tableDraftMode.value = !tableDraftMode.value
  if (tableDraftMode.value && !promptText.value.trim()) {
    promptText.value = '帮我建一张表，用来存：'
  }
  nextTick(() => textareaRef.value?.focus())
}

// 确认草稿：真实建表（entrySave → config/entryTypeAddAll），成功后把结果回传智能体
async function handleConfirmTableDraft(msg: ChatMessage, draft: TableDraft) {
  const state = msg.tableDraft
  if (!state || state.status === 'creating' || state.status === 'created') return
  state.draft = draft
  state.status = 'creating'
  state.error = undefined
  try {
    const { tableId } = await createTableFromDraft(draft)
    state.status = 'created'
    state.tableId = tableId
    ElMessage.success(`数据表「${draft.name}」已创建，表 ID ${tableId}`)
  } catch (error) {
    state.status = 'failed'
    state.error = error instanceof Error ? error.message : String(error)
    ElMessage.error(`建表失败：${state.error}`)
    return
  }
  // 结果回传：让智能体知道表已建好、可继续追问；也是刷新后把草稿判为「已创建」的依据
  promptText.value = formatTableCreatedMessage(draft, state.tableId!)
  await handleSend(undefined, { draftMode: false })
}

function handleCancelTableDraft(msg: ChatMessage) {
  if (msg.tableDraft && msg.tableDraft.status !== 'created') msg.tableDraft.status = 'cancelled'
}

// 复制 SQL（统一走 utils/clipboard：http 部署站没有 navigator.clipboard，兜底与手动复制弹窗都在那里）
async function handleCopySql(code: string) {
  await copyToClipboard(code, 'SQL')
}

// 快捷追问
function handleQuickPrompt(text: string) {
  promptText.value = text
  handleSend()
}

// 发送消息：经 useAskChat 状态机对接后端 /api/poc/chat/agent SSE 流式接口
async function handleSend(customTitle?: string, opts?: { draftMode?: boolean }) {
  const content = promptText.value.trim()
  if (!content || isSending.value) return
  promptText.value = ''
  // 建表模式：显式传入优先（重新生成沿用原消息的模式、建表结果回传强制普通模式），否则跟随输入框开关
  const useTableDraft = opts?.draftMode ?? tableDraftMode.value

  let targetSessionId = activeSessionId.value

  if (targetSessionId === 'new') {
    // 从新建会话页发起：创建全新会话项并立即渲染对话
    const newSessionId = `s-${Date.now()}`
    const sessionTitle =
      customTitle || (content.length > 20 ? `${content.slice(0, 20)}...` : content)
    const newSession: AiSessionItem = {
      id: newSessionId,
      title: sessionTitle,
      updatedAt: '刚刚',
      group: 'today',
    }
    sessions.value = [newSession, ...sessions.value]
    activeSessionId.value = newSessionId
    targetSessionId = newSessionId
    sessionMessages.value[newSessionId] = []
  }

  const list = sessionMessages.value[targetSessionId] || []
  if (!sessionMessages.value[targetSessionId]) {
    sessionMessages.value[targetSessionId] = list
  }

  // 1. 追加用户消息
  const userMsg: ChatMessage = {
    id: nextMsgId('u'),
    role: 'user',
    content,
    createdAt: '刚刚',
  }
  list.push(userMsg)
  scrollToBottom()

  // 快捷导出指令识别（若会话中已有表格且用户指令是导出，支持快捷导出）
  const lowerContent = content.toLowerCase()
  const isExportQuery =
    !useTableDraft &&
    list.length > 1 &&
    (content.includes('导出') || content.includes('下载')) &&
    (lowerContent.includes('csv') ||
      lowerContent.includes('excel') ||
      lowerContent.includes('xlsx') ||
      content.includes('表格') ||
      content.includes('数据'))

  if (isExportQuery) {
    const targetMsg = [...list]
      .reverse()
      .find((m) => m.role === 'assistant' && (m.chartData?.tableRows?.length || m.chartData?.bars?.length))
    const isExcel = lowerContent.includes('excel') || lowerContent.includes('xlsx') || !lowerContent.includes('csv')
    const formatName = isExcel ? 'Excel (.xlsx)' : 'CSV (.csv)'
    const rowCount = targetMsg?.chartData?.tableRows?.length || targetMsg?.chartData?.bars?.length || 0

    if (targetMsg) {
      if (isExcel) {
        exportTableToExcel(targetMsg)
      } else {
        exportTableToCsv(targetMsg)
      }
    }

    const safeTitle = (targetMsg?.chartData?.title || '问数明细').replace(/[📊🥧\s]/g, '')
    // 本地快捷指令回执：不是智能体产出，不伪造思考链与执行耗时
    const followUpReply: ChatMessage = {
      id: nextMsgId('a'),
      role: 'assistant',
      localAction: true,
      status: 'done',
      content: targetMsg
        ? `已为您生成并导出「${safeTitle}」的 ${formatName} 数据文件（共计 ${rowCount} 条明细记录），浏览器已触发下载。\n\n您也可以在明细数据表视图中随时点击「导出为 Excel」或「导出为 CSV」重新下载。`
        : `当前会话中暂未找到可导出的明细数据表，请先执行问数查询后再导出。`,
      createdAt: '刚刚',
      insights: targetMsg
        ? [
            `导出字段覆盖：${targetMsg.chartData?.tableColumns?.map((c) => c.label).join('、') || '全部明细字段'}。`,
          ]
        : ['建议先输入业务问题查询数据，系统生成明细表后即可一键导出。'],
      suggestions: ['查看该批任务近 7 天历史趋势', '把结果导出成 Excel', '导出为 CSV 表格'],
    }
    list.push(followUpReply)
    scrollToBottom(true)
    return
  }

  // 快捷图表形态转换指令识别（若会话中已有表格且用户指令要求做成图表/饼图/明细表）
  const isChartViewQuery =
    !useTableDraft &&
    list.length > 1 &&
    (content.includes('图表') ||
      content.includes('柱状图') ||
      content.includes('趋势') ||
      content.includes('饼图') ||
      content.includes('明细表') ||
      content.includes('表格形式')) &&
    (content.includes('做成') ||
      content.includes('生成') ||
      content.includes('切换') ||
      content.includes('查看') ||
      content.includes('显示') ||
      content.includes('变成') ||
      content.includes('转为') ||
      content.includes('形式'))

  if (isChartViewQuery) {
    const targetMsg = [...list]
      .reverse()
      .find((m) => m.role === 'assistant' && (m.chartData?.tableRows?.length || m.chartData?.bars?.length))
    if (targetMsg) {
      if (content.includes('饼图')) {
        setMsgDataView(targetMsg, 'pie')
      } else if (content.includes('明细') || content.includes('表格')) {
        setMsgDataView(targetMsg, 'table')
      } else {
        setMsgDataView(targetMsg, 'chart')
      }
      const currentView = getMsgDataView(targetMsg)
      const viewLabel =
        currentView === 'chart'
          ? '趋势柱状图'
          : currentView === 'pie'
            ? '占比饼图'
            : '明细数据表'
      const followUpReply: ChatMessage = {
        id: nextMsgId('a'),
        role: 'assistant',
        localAction: true,
        status: 'done',
        content: `已为您将查询结果转换为「${viewLabel}」展示。\n\n您也可以在上方卡片右上角自由切换「趋势图表」、「占比饼图」与「明细数据表」，或在明细表上方点击「导出 Excel」「导出 CSV」下载数据。`,
        createdAt: '刚刚',
        suggestions: ['把结果导出成 Excel', '导出为 CSV 表格'],
      }
      list.push(followUpReply)
      scrollToBottom(true)
      return
    }
  }

  // 2. 追加智能体占位消息，经状态机发起流式请求
  const assistantMsg: ChatMessage = {
    id: nextMsgId('a'),
    role: 'assistant',
    content: '',
    createdAt: '刚刚',
    question: content,
    status: 'streaming',
    ...(useTableDraft ? { draftMode: 'table' as const } : {}),
    thinking: {
      completed: false,
      durationMs: 0,
      steps: [],
    },
  }
  list.push(assistantMsg)
  touchSession(targetSessionId)
  scrollToBottom(true)
  await beginStream(assistantMsg, targetSessionId, content)
}

// 绑定当前流式目标消息并交给 useAskChat；回调统一写 activeAssistantMsg
async function beginStream(
  msg: ChatMessage,
  sessionId: string,
  question: string,
  opts?: { bypassDebounce?: boolean },
) {
  // 必须绑定响应式代理而不是 push 前的原始对象：
  // 直接改原始对象不会触发视图更新，流式正文会“写进去了但看不见”
  const ownerList = sessionMessages.value[sessionId]
  const idx = ownerList ? ownerList.indexOf(msg) : -1
  activeAssistantMsg = idx >= 0 ? ownerList![idx] : msg
  streamSessionId = sessionId
  streamStartTime = Date.now()
  startThinkingTimer()

  const currentSessionObj = sessions.value.find((s) => s.id === sessionId)
  const sessionIdParam = /^\d+$/.test(sessionId) ? Number(sessionId) : undefined
  const threadIdParam = currentSessionObj?.uuid || (sessionIdParam ? undefined : sessionId)

  const started = await askChat.send(
    {
      // 建表模式：界面显示用户原文，发给智能体的消息追加草稿格式要求（历史回放时按标记剥掉）
      msg: msg.draftMode === 'table' ? buildTableDraftPrompt(question) : question,
      session_id: sessionIdParam,
      thread_id: threadIdParam,
    },
    opts,
  )
  if (!started) {
    // 状态机拒发（忙/防抖）：回收占位消息，避免留下永远转圈的空气泡
    activeAssistantMsg = null
    stopThinkingTimer()
    const list = sessionMessages.value[streamSessionId]
    if (list) {
      const idx = list.indexOf(msg)
      if (idx >= 0) list.splice(idx, 1)
    }
  }
}

// ===== 失败/中断/空回答的可恢复操作 =====
function findQuestionForMsg(msg: ChatMessage): string {
  if (msg.question) return msg.question
  const list = currentMessages.value
  const idx = list.indexOf(msg)
  for (let i = idx - 1; i >= 0; i--) {
    if (list[i].role === 'user' && !list[i].localAction) return list[i].content
  }
  return ''
}

// 重试：原位重置失败的助手消息重发同一问题，不追加重复的用户气泡
async function handleRetry(msg: ChatMessage) {
  if (isSending.value) return
  const question = findQuestionForMsg(msg)
  if (!question) {
    ElMessage.warning('未找到本次提问内容，请重新输入问题')
    return
  }
  msg.content = ''
  msg.status = 'streaming'
  msg.errorInfo = undefined
  msg.interrupted = false
  msg.sql = undefined
  msg.clarification = undefined
  msg.chartData = undefined
  msg.tableDraft = undefined
  msg.question = question
  msg.thinking = { completed: false, durationMs: 0, steps: [], text: '' }
  // 上一轮正文开始时把思考面板收起了（见 onChunkFlush），重试要恢复「思考中自动展开」
  delete thinkingExpandedMap[msg.id]
  scrollToBottom(true)
  await beginStream(msg, activeSessionId.value, question, { bypassDebounce: true })
}

// 重新生成：保留原回答，追加新一轮问答
async function handleRegenerate(msg: ChatMessage) {
  if (isSending.value) return
  const question = findQuestionForMsg(msg)
  if (!question) {
    ElMessage.warning('未找到本次提问内容，请重新输入问题')
    return
  }
  promptText.value = question
  await handleSend(undefined, { draftMode: msg.draftMode === 'table' })
}

// 继续输出：中断/截断后让智能体接着上文继续
async function handleContinue() {
  if (isSending.value) return
  promptText.value = '继续'
  await handleSend()
}

// 补充说明：把原问题带回输入框，让用户补口径后再发
function handleSupplement(msg: ChatMessage) {
  const question = findQuestionForMsg(msg)
  promptText.value = question ? `${question}，补充说明：` : ''
  nextTick(() => textareaRef.value?.focus())
}

async function handleCopyQuestion(msg: ChatMessage) {
  const question = findQuestionForMsg(msg)
  if (!question) return
  await copyToClipboard(question, '提问内容')
}

// 消息操作条形态：本地回执与待澄清消息不出操作条；未标注 status 的历史注入消息不出操作条
function msgActionKind(msg: ChatMessage): 'failed' | 'interrupted' | 'empty' | 'done' | null {
  if (msg.role !== 'assistant' || msg.localAction) return null
  if (msg.clarification && !msg.clarification.confirmed) return null
  if (msg.status === 'failed') return 'failed'
  if (msg.status === 'interrupted') return 'interrupted'
  if (msg.status === 'empty') return 'empty'
  if (msg.status === 'done') return 'done'
  return null
}

const ASK_ERROR_TITLES: Record<AskErrorCode, string> = {
  NETWORK: '网络连接异常',
  UPSTREAM_ERROR: '智能体服务异常',
  PARAM_MISSING: '提问信息不完整',
  TOOL_FAILED: '数据查询失败',
  EMPTY_RESULT: '未查询到数据',
  PERMISSION_DENIED: '无权限访问该数据',
  CONTEXT_LOST: '会话上下文已失效',
  UNKNOWN: '本次问数未完成',
}

// 快捷键发送与中断：按 Enter 发送，按 Esc 中断
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isSending.value) {
    e.preventDefault()
    handleStop()
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// 组件卸载时安全终止未完成的流式任务与定时器
onUnmounted(() => {
  if (isSending.value) {
    handleStop()
  }
  if (thinkingTimer) {
    clearInterval(thinkingTimer)
    thinkingTimer = null
  }
  if (scrollRafId !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  if (ignoreOwnScrollTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(ignoreOwnScrollTimer)
    ignoreOwnScrollTimer = null
  }
})
</script>

<template>
  <div class="rc-aichat-workbench">
    <!-- 1. 左侧会话历史侧栏 -->
    <aside class="rc-aichat-sidebar">
      <div class="rc-sidebar-header">
        <el-button
          type="primary"
          :icon="Plus"
          class="rc-newchat-btn"
          :class="{ 'is-active': isNewSession }"
          @click="handleNewChat"
        >
          新建问数会话
        </el-button>
        <div class="rc-search-box">
          <el-input
            v-model="searchSessionKeyword"
            placeholder="搜索历史会话..."
            :prefix-icon="Search"
            size="small"
            clearable
          />
        </div>
      </div>

      <div class="rc-sidebar-sessions">
        <div v-if="todaySessions.length" class="rc-session-group">
          <div class="rc-session-group-title">今天</div>
          <div
            v-for="s in todaySessions"
            :key="s.id"
            class="rc-session-item"
            :class="{ active: activeSessionId === s.id }"
            @click="handleSelectSession(s.id)"
          >
            <div class="rc-session-item-main">
              <el-icon class="rc-session-icon"><ChatDotRound /></el-icon>
              <span class="rc-session-title" :title="s.title">{{ s.title }}</span>
            </div>
            <el-button
              class="rc-session-delete"
              link
              type="info"
              :icon="Close"
              size="small"
              title="删除会话"
              @click.stop="handleDeleteSession(s.id)"
            />
          </div>
        </div>

        <div v-if="weekSessions.length" class="rc-session-group">
          <div class="rc-session-group-title">近 7 天</div>
          <div
            v-for="s in weekSessions"
            :key="s.id"
            class="rc-session-item"
            :class="{ active: activeSessionId === s.id }"
            @click="handleSelectSession(s.id)"
          >
            <div class="rc-session-item-main">
              <el-icon class="rc-session-icon"><ChatDotRound /></el-icon>
              <span class="rc-session-title" :title="s.title">{{ s.title }}</span>
            </div>
            <el-button
              class="rc-session-delete"
              link
              type="info"
              :icon="Close"
              size="small"
              title="删除会话"
              @click.stop="handleDeleteSession(s.id)"
            />
          </div>
        </div>

        <div v-if="earlierSessions.length" class="rc-session-group">
          <div class="rc-session-group-title">更早</div>
          <div
            v-for="s in earlierSessions"
            :key="s.id"
            class="rc-session-item"
            :class="{ active: activeSessionId === s.id }"
            @click="handleSelectSession(s.id)"
          >
            <div class="rc-session-item-main">
              <el-icon class="rc-session-icon"><ChatDotRound /></el-icon>
              <span class="rc-session-title" :title="s.title">{{ s.title }}</span>
            </div>
            <el-button
              class="rc-session-delete"
              link
              type="info"
              :icon="Close"
              size="small"
              title="删除会话"
              @click.stop="handleDeleteSession(s.id)"
            />
          </div>
        </div>
      </div>

      <div class="rc-sidebar-footer">
        <span class="rc-history-count">已存 {{ sessions.length }} 个会话</span>
        <el-button
          class="rc-clear-btn"
          link
          type="info"
          size="small"
          :icon="Delete"
          @click="handleClearSessions"
        >
          清空
        </el-button>
      </div>
    </aside>

    <!-- 2. 中间对话与分析工作台 -->
    <main class="rc-aichat-main">
      <!-- 顶部控制条 -->
      <header class="rc-aichat-topbar">
        <div class="rc-topbar-left">
          <span class="rc-aichat-brand" aria-hidden="true">AI 智能问数</span>
          <el-tag
            size="small"
            :type="isNewSession ? 'success' : 'primary'"
            effect="plain"
            class="rc-badge-tag"
          >
            {{ isNewSession ? '新建问数会话' : 'Agent 工作台' }}
          </el-tag>
          <span v-if="!isNewSession && currentSessionTitle" class="rc-topbar-session-title">
            / {{ currentSessionTitle }}
          </span>
        </div>
      </header>

      <!-- A. 新建问数会话页面（静态引导页） -->
      <div v-if="isNewSession" class="rc-new-session-view" data-testid="new-session-view">
        <div class="rc-hero-section">
          <div class="rc-hero-icon">
            <el-icon :size="36"><TrendCharts /></el-icon>
          </div>
          <h1 class="rc-hero-title">您好，我是 AI 智能问数助手</h1>
          <p class="rc-hero-subtitle">
            支持自然语言直接取数（Text-to-SQL）、多表关联、多轮主动澄清、指标下钻与自动化图表可视化分析
          </p>
        </div>

        <!-- 推荐快捷问数场景（2026-11-19 用户要求先隐藏，场景定下来后再放回） -->
        <div v-if="SHOW_STARTER_PROMPTS" class="rc-starters-section"></div>

        <!-- 核心能力特性：压缩为一行图标条，图标用线性 SVG 替代 emoji（原型设计说明 ①②） -->
        <div class="rc-features-bar">
          <div class="rc-feature-item">
            <span class="rc-feat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <div class="rc-feat-text">
              <strong>多轮主动澄清</strong>
              <span>同名表或歧义指标主动唤起候选卡片</span>
            </div>
          </div>
          <div class="rc-feature-item">
            <span class="rc-feat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <div class="rc-feat-text">
              <strong>安全只读 SQL</strong>
              <span>严格限制 SELECT 语法，秒级执行</span>
            </div>
          </div>
          <div class="rc-feature-item">
            <span class="rc-feat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-8" /><path d="M22 20H2" />
              </svg>
            </span>
            <div class="rc-feat-text">
              <strong>图表与明细联动</strong>
              <span>趋势对比与行级明细报表自由切换</span>
            </div>
          </div>
        </div>
      </div>

      <!-- B. 已有会话消息交互流容器 -->
      <div v-else ref="chatContainerRef" class="rc-chat-thread" @scroll.passive="handleThreadScroll">
        <!-- 更早历史：内存窗口隐藏或服务端未加载分页时可见 -->
        <div v-if="hasHiddenEarlier" class="rc-load-earlier">
          <el-button
            size="small"
            link
            type="primary"
            :loading="loadingEarlier"
            data-testid="load-earlier-btn"
            @click="handleLoadEarlier"
          >
            加载更早的消息
          </el-button>
        </div>
        <!-- 默认或动态会话的消息呈现（长对话仅挂载渲染窗口内的尾部消息） -->
        <div
          v-for="msg in visibleMessages"
          :key="msg.id"
          class="rc-msg-row"
          :class="[msg.role, {
            'is-local-action': msg.localAction,
            'is-failed': msg.status === 'failed',
            'is-interrupted': msg.status === 'interrupted',
            'is-clarification': !!msg.clarification,
          }]"
        >
          <!-- 用户消息：不展示头像，气泡靠右即可（原型设计说明 ①） -->
          <template v-if="msg.role === 'user'">
            <div class="rc-msg-bubble user">
              <p>{{ msg.content }}</p>
              <div class="rc-msg-time">{{ msg.createdAt }}</div>
            </div>
          </template>

          <!-- 智能体消息 -->
          <template v-else>
            <div class="rc-avatar assistant">
              <el-icon><TrendCharts /></el-icon>
            </div>

            <div class="rc-msg-bubble assistant">
              <!-- 引导/说明文字：仅在包含待确认卡片且有说明文案时展示 -->
              <div v-if="msg.clarification && formatClarifyIntro(msg.content, !!msg.clarification)" class="rc-clarify-intro">
                <MarkdownOutput :content="formatClarifyIntro(msg.content, !!msg.clarification)" :streaming="msg.status === 'streaming'" />
              </div>

              <!-- 待确认项交互勾选卡片：支持多选/单选与自由补充，确认后锁定并推进会话 -->
              <ClarificationCard
                v-if="msg.clarification"
                :key="msg.id + '-' + (isMsgClarifyConfirmed(msg) ? 'confirmed' : 'pending')"
                :clarification="msg.clarification || currentClarification"
                :confirmed="isMsgClarifyConfirmed(msg)"
                @confirm="(payload) => handleConfirmClarify(payload, msg)"
              />

              <!-- 用户确认后或无需澄清时的执行结果呈现区 -->
              <transition name="el-fade-in-linear">
                <div
                  v-if="!msg.clarification || isMsgClarifyConfirmed(msg)"
                  class="rc-confirmed-result"
                >
                  <!-- 阶段感知条：由 reasoning 关键词推断（SSE 暂无工具事件契约），如实标注推断态 -->
                  <div v-if="msg.status === 'streaming'" class="rc-phase-bar" data-testid="phase-bar">
                    <span class="rc-live-dot pulsing"></span>
                    <span v-if="askState === 'stalled'" class="rc-phase-stalled" data-testid="stalled-banner">
                      上游长时间未返回新内容，仍在等待…可随时停止后重试
                    </span>
                    <template v-else>
                      <span>{{ askPhase ? ASK_PHASE_LABELS[askPhase] : '正在连接智能体' }}</span>
                      <el-tag v-if="askPhase" size="small" type="info" effect="plain" class="rc-phase-infer-tag">推断</el-tag>
                    </template>
                  </div>

                  <!-- 失败信息卡：明确错误类别 + 可恢复指引，配合下方重试操作 -->
                  <div v-if="msg.status === 'failed' && msg.errorInfo" class="rc-error-card" data-testid="error-card">
                    <div class="rc-error-title">{{ ASK_ERROR_TITLES[msg.errorInfo.code] || '本次问数未完成' }}</div>
                    <div class="rc-error-detail">{{ msg.errorInfo.message }}</div>
                    <div class="rc-error-hint">
                      {{ msg.errorInfo.retryable ? '可直接重试；若反复失败，请补充口径后重新提问。' : '请调整提问口径或确认数据权限后再试。' }}
                    </div>
                  </div>

                  <!-- 思考过程面板 -->
                  <div v-if="msg.thinking" class="rc-thinking-box">
                    <div
                      class="rc-thinking-header"
                      @click="toggleThinking(msg.id, isThinkingOpen(msg))"
                    >
                      <div class="rc-thinking-title">
                        <span
                          class="rc-live-dot"
                          :class="msg.thinking?.interrupted ? 'amber' : (msg.thinking?.completed ? 'green' : 'pulsing')"
                        ></span>
                        <span v-if="msg.thinking?.interrupted">
                          思考已中断 (已思考 {{ (msg.thinking.durationMs / 1000).toFixed(1) }}s)
                        </span>
                        <span v-else-if="!msg.thinking?.completed">
                          深度思考中... (已思考 {{ Math.max(1, Math.floor(thinkingElapsedSeconds)) }}s)
                        </span>
                        <span v-else>
                          思考过程 · {{ (getMsgSelectedTableNames(msg).length || selectedTables.length) ? '已根据所选口径对齐并执行 SQL' : (msg.sql ? (msg.sql.estimated ? '已生成 SQL（待执行）' : '已生成并执行 SQL') : '已完成分析') }} (耗时 {{ (msg.thinking.durationMs / 1000).toFixed(1) }}s)
                        </span>
                      </div>
                      <span class="rc-toggle-arrow" :class="{ collapsed: !isThinkingOpen(msg) }">▼</span>
                    </div>
                    <div v-if="isThinkingOpen(msg)" class="rc-thinking-body">
                      <div v-if="getMsgSelectedTableNames(msg).length || selectedTables.length">
                        ✓ 1. 采纳用户澄清口径：<strong>{{ (getMsgSelectedTableNames(msg).length ? getMsgSelectedTableNames(msg) : selectedTables).join('、') }}</strong>
                      </div>
                      <div v-if="msg.thinking.text" class="rc-thinking-text">
                        {{ msg.thinking.text }}
                      </div>
                      <div v-else-if="msg.thinking.steps && msg.thinking.steps.length">
                        <div v-for="(step, idx) in msg.thinking.steps" :key="idx">
                          ✓ {{ idx + (selectedTables.length ? 2 : 1) }}. {{ step }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 智能体最终回答正文（支持 Markdown 渲染；流式期按块增量渲染，不整体替换 DOM） -->
                  <div v-if="!msg.clarification && formatMarkdownContent(msg)" class="rc-answer-markdown">
                    <MarkdownOutput :content="formatMarkdownContent(msg)" :streaming="msg.status === 'streaming'" />
                    <div v-if="msg.interrupted" class="rc-interrupted-tag" data-testid="interrupted-tag">
                      <span class="rc-stop-square-small">■</span>
                      <span>本次回答已中断</span>
                    </div>
                  </div>
                  <!-- 中途已中断且尚未输出回答正文时的状态提示 -->
                  <div v-else-if="msg.interrupted && !msg.clarification && !msg.content && !msg.sql && !msg.chartData" class="rc-interrupted-notice" data-testid="interrupted-notice">
                    <el-alert
                      type="warning"
                      :closable="false"
                      show-icon
                      title="问数对话已中断"
                      description="您已手动停止本次问数响应。如需重新分析，可调整问题后再次提问。"
                    />
                  </div>
                  <!-- 思考已完成但上游未输出任何回答内容或 SQL 时的兜底状态提示 -->
                  <div v-else-if="!msg.clarification && msg.thinking?.completed && !msg.content && !msg.sql && !msg.chartData" class="rc-empty-fallback-hint">
                    <el-alert
                      type="info"
                      :closable="false"
                      show-icon
                      title="思考分析已完成，但未返回最终回答内容"
                      description="上游模型或数据检索接口可能未生成文本回复。您可以展开上方「思考过程」卡片查看详细分析步骤与日志。"
                    />
                  </div>

                  <!-- 智能体对话建表：草稿确认卡片（确认后才真实建表） -->
                  <TableDraftCard
                    v-if="msg.tableDraft"
                    :state="msg.tableDraft"
                    :disabled="isSending"
                    @confirm="(draft: TableDraft) => handleConfirmTableDraft(msg, draft)"
                    @cancel="handleCancelTableDraft(msg)"
                  />

                  <!-- 生成的 SQL 卡片 -->
                  <div v-if="msg.sql" class="rc-sql-card">
                    <div class="rc-sql-head">
                      <div class="rc-sql-badge">
                        <span class="rc-sql-label">SQL QUERY</span>
                        <span v-if="msg.sql.estimated" class="rc-sql-meta">
                          SQL 由 AI 生成（待执行）
                        </span>
                        <span v-else-if="msg.sql.execTimeMs != null || msg.sql.scanRows != null" class="rc-sql-meta">
                          执行成功<template v-if="msg.sql.scanRows != null"> · 扫描 {{ msg.sql.scanRows.toLocaleString() }} 行</template><template v-if="msg.sql.execTimeMs != null"> · 耗时 {{ msg.sql.execTimeMs }}ms</template>
                        </span>
                        <span v-else class="rc-sql-meta">
                          已执行（耗时指标未回传）
                        </span>
                      </div>
                      <el-button
                        link
                        type="primary"
                        size="small"
                        :icon="CopyDocument"
                        @click="handleCopySql(msg.sql.code)"
                      >
                        复制 SQL
                      </el-button>
                    </div>
                    <pre class="rc-sql-code">{{ msg.sql.code }}</pre>
                  </div>

                  <!-- KPI 指标卡片 -->
                  <div v-if="msg.kpis && msg.kpis.length" class="rc-kpi-grid">
                    <div
                      v-for="(kpi, kidx) in msg.kpis"
                      :key="kidx"
                      class="rc-kpi-card"
                      :class="kpi.type"
                    >
                      <span class="rc-kpi-label">{{ kpi.label }}</span>
                      <span
                        class="rc-kpi-value"
                        :class="{
                          green: kpi.type === 'success',
                          red: kpi.type === 'danger',
                        }"
                      >
                        {{ kpi.value }}
                      </span>
                      <span class="rc-kpi-tip" :class="{ red: kpi.type === 'danger' }">
                        {{ kpi.subtext }}
                      </span>
                    </div>
                  </div>

                  <!-- 图表/饼图/明细数据卡（按需加载子组件，内含视图切换、分页与导出） -->
                  <DataViewCard
                    v-if="msg.chartData"
                    :chart-data="msg.chartData"
                    :kpis="msg.kpis"
                    :view="getMsgDataView(msg)"
                    @update:view="(v: 'chart' | 'pie' | 'table') => setMsgDataView(msg, v)"
                    @export="(fmt: 'excel' | 'csv') => (fmt === 'excel' ? exportTableToExcel(msg) : exportTableToCsv(msg))"
                  />

                  <!-- 专家诊断与建议 -->
                  <div v-if="msg.insights && msg.insights.length" class="rc-insight-card">
                    <div class="rc-insight-title">💡 诊断与处置建议：</div>
                    <ul class="rc-insight-list">
                      <li v-for="(insight, iidx) in msg.insights" :key="iidx">
                        {{ insight }}
                      </li>
                    </ul>
                  </div>

                  <!-- 追问胶囊 -->
                  <div
                    v-if="msg.suggestions && msg.suggestions.length"
                    class="rc-followup-chips"
                  >
                    <span class="rc-chips-label">智能追问:</span>
                    <el-button
                      v-for="(sug, sidx) in msg.suggestions"
                      :key="sidx"
                      size="small"
                      round
                      class="rc-chip-btn"
                      @click="handleQuickPrompt(sug)"
                    >
                      {{ sug }}
                    </el-button>
                  </div>

                  <!-- 消息操作条：失败重试 / 中断续写 / 空回答重试 / 正常重新生成 -->
                  <div
                    v-if="msgActionKind(msg)"
                    class="rc-msg-actions"
                    :data-testid="`msg-actions-${msgActionKind(msg)}`"
                  >
                    <template v-if="msgActionKind(msg) === 'failed' || msgActionKind(msg) === 'empty'">
                      <el-button
                        size="small"
                        type="primary"
                        plain
                        :icon="RefreshRight"
                        :disabled="isSending"
                        data-testid="retry-btn"
                        @click="handleRetry(msg)"
                      >
                        重试
                      </el-button>
                      <el-button
                        size="small"
                        plain
                        data-testid="supplement-btn"
                        @click="handleSupplement(msg)"
                      >
                        补充说明
                      </el-button>
                      <el-button
                        size="small"
                        link
                        :icon="CopyDocument"
                        data-testid="copy-question-btn"
                        @click="handleCopyQuestion(msg)"
                      >
                        复制提问
                      </el-button>
                    </template>
                    <template v-else-if="msgActionKind(msg) === 'interrupted'">
                      <el-button
                        size="small"
                        type="primary"
                        plain
                        :disabled="isSending"
                        data-testid="continue-btn"
                        @click="handleContinue"
                      >
                        继续输出
                      </el-button>
                      <el-button
                        size="small"
                        plain
                        :icon="RefreshRight"
                        :disabled="isSending"
                        data-testid="retry-btn"
                        @click="handleRetry(msg)"
                      >
                        重新提问
                      </el-button>
                    </template>
                    <template v-else>
                      <el-button
                        size="small"
                        link
                        :icon="RefreshRight"
                        :disabled="isSending"
                        data-testid="regenerate-btn"
                        @click="handleRegenerate(msg)"
                      >
                        重新生成
                      </el-button>
                      <el-button
                        size="small"
                        link
                        :icon="CopyDocument"
                        data-testid="copy-question-btn"
                        @click="handleCopyQuestion(msg)"
                      >
                        复制提问
                      </el-button>
                    </template>
                  </div>
                </div>
              </transition>
            </div>
          </template>
        </div>
      </div>

      <!-- 回到底部：用户上翻阅读时不打断，仅提示有新内容 -->
      <transition name="el-fade-in-linear">
        <button
          v-if="!isNewSession && !isFollowingScroll"
          type="button"
          class="rc-back-to-bottom"
          data-testid="back-to-bottom"
          @click="backToBottom"
        >
          <el-icon><ArrowDown /></el-icon>
          <span>{{ unreadBelowCount > 0 ? `${unreadBelowCount} 条新内容` : '回到底部' }}</span>
        </button>
      </transition>

      <!-- 底部输入停靠区 -->
      <footer class="rc-aichat-footer">
        <!-- 浮动停止响应按钮：处于流式响应中时居中浮现 -->
        <transition name="el-fade-in-linear">
          <div v-if="isSending" class="rc-stop-float-bar">
            <button
              type="button"
              class="rc-stop-float-btn"
              data-testid="float-stop-btn"
              @click="handleStop"
            >
              <span class="rc-stop-square">■</span>
              <span>停止生成 (Esc)</span>
            </button>
          </div>
        </transition>

        <div class="rc-input-box">
          <textarea
            ref="textareaRef"
            v-model="promptText"
            rows="2"
            :placeholder="tableDraftMode ? '描述要建的表：存什么数据、有哪些字段、是否用 CK 存储…（确认草稿后才会真正建表）' : '向 AI 智能体提问，支持连续追问与交互澄清（按 Enter 发送，Shift+Enter 换行）...'"
            class="rc-textarea"
            @keydown="handleKeyDown"
          ></textarea>

          <div class="rc-input-toolbar">
            <div class="rc-toolbar-left">
              <button
                type="button"
                class="rc-mode-chip"
                :class="{ active: tableDraftMode }"
                :aria-pressed="tableDraftMode"
                :disabled="isSending"
                data-testid="table-draft-mode-toggle"
                title="开启后，智能体会把你的需求整理成建表草稿，确认后才真正建表"
                @click="toggleTableDraftMode"
              >
                <span class="rc-mode-dot" />对话建表
              </button>
              <span class="rc-input-tip">{{ isSending ? '正在分析响应中，可按 Esc 或点击「停止响应」中断' : '按 Enter 发送，Shift + Enter 换行' }}</span>
            </div>

            <el-button
              v-if="isSending"
              type="danger"
              plain
              size="small"
              class="rc-stop-btn"
              data-testid="stop-btn"
              @click="handleStop"
            >
              <el-icon class="rc-stop-icon"><VideoPause /></el-icon>
              <span>停止响应</span>
            </el-button>
            <el-button
              v-else
              type="primary"
              size="small"
              class="rc-send-btn"
              data-testid="send-btn"
              :disabled="!promptText.trim()"
              @click="handleSend"
            >
              发送
            </el-button>
          </div>
        </div>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.rc-aichat-workbench {
  display: flex;
  height: 100%;
  width: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--rc-bg);
  overflow: hidden;
  box-sizing: border-box;
}

/* 左侧会话侧栏 */
.rc-aichat-sidebar {
  width: 240px;
  background: var(--rc-surface);
  border-right: 1px solid var(--rc-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
}

.rc-sidebar-header {
  padding: 14px 12px 10px;
  border-bottom: 1px solid var(--rc-border-soft);
}

/* 新建会话按钮：品牌渐变（原型设计说明 ①），选中态保留外发光提示 */
.rc-newchat-btn {
  width: 100%;
  margin-bottom: 10px;
  font-weight: 600;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
  border: none !important;
  color: #ffffff !important;
  transition: transform 0.15s ease, box-shadow 0.2s ease, opacity 0.2s ease;
}

.rc-newchat-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
}

.rc-newchat-btn.is-active {
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.35);
}

.rc-sidebar-sessions {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.rc-session-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rc-muted);
  text-transform: uppercase;
  padding: 6px 8px;
}

.rc-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 0 var(--rc-radius-sm) var(--rc-radius-sm) 0;
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 3px;
  position: relative;
}

/* 选中态左侧 3px 色条（原型设计说明 ④） */
.rc-session-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.15s ease;
}

.rc-session-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.rc-session-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.rc-session-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rc-session-delete {
  opacity: 0;
  transition: opacity 0.15s ease;
  padding: 2px !important;
  margin-left: 4px;
  color: var(--rc-muted) !important;
}

.rc-session-item:hover {
  background: var(--rc-primary-bg);
  color: var(--rc-primary);
}

.rc-session-item:hover .rc-session-delete {
  opacity: 1;
}

.rc-session-delete:hover {
  color: #e11d48 !important;
}

.rc-session-item.active {
  background: var(--rc-primary-bg);
  color: var(--rc-primary);
  font-weight: 600;
  box-shadow: none;
}

.rc-session-item.active::before {
  background: var(--rc-primary);
}

.rc-sidebar-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--rc-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--rc-muted);
}

/* 右侧主工作区 */
.rc-aichat-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--rc-bg);
  position: relative;
}

/* 顶部控制栏 */
.rc-aichat-topbar {
  height: 48px;
  border-bottom: 1px solid var(--rc-border);
  background: var(--rc-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
}

.rc-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 顶栏不再展示品牌大字（原型设计说明 ④），类名保留以兼容测试查询 */
.rc-aichat-brand {
  display: none;
}

.rc-topbar-session-title {
  font-size: 12px;
  color: var(--rc-muted);
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rc-mode-tag {
  font-size: 11px;
}

/* 新建会话引导页面 */
.rc-new-session-view {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

/* 空状态内容统一限宽 780（原型设计说明 ②） */
.rc-new-session-view > * {
  max-width: 780px;
}

.rc-hero-section {
  text-align: center;
  margin-bottom: 28px;
  width: 100%;
  max-width: 780px;
}

/* 品牌渐变统一：hero 与智能体头像同一套渐变（原型设计说明 ①） */
.rc-hero-icon {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
  box-shadow: 0 8px 20px -4px rgba(37, 99, 235, 0.4);
}

.rc-hero-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--rc-text);
  margin: 0 0 8px 0;
}

.rc-hero-subtitle {
  font-size: 13px;
  color: var(--rc-muted);
  max-width: 620px;
  margin: 0 auto;
  line-height: 1.6;
}

.rc-starters-section {
  width: 100%;
  margin-bottom: 24px;
}

.rc-starters-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.rc-starters-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--rc-text);
}

.rc-starters-hint {
  font-size: 11px;
  color: var(--rc-muted);
}

.rc-starter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
}

.rc-starter-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: var(--rc-shadow-soft);
}

.rc-starter-card:hover {
  border-color: var(--rc-primary);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.12);
}

.rc-starter-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.rc-starter-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--rc-primary-bg);
  color: var(--rc-primary);
  font-weight: 600;
}

.rc-starter-arrow {
  font-size: 12px;
  color: var(--rc-muted);
  transition: transform 0.2s;
}

.rc-starter-card:hover .rc-starter-arrow {
  color: var(--rc-primary);
  transform: translateX(3px);
}

.rc-starter-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--rc-text);
  margin-bottom: 4px;
}

.rc-starter-desc {
  font-size: 12px;
  color: var(--rc-muted);
  line-height: 1.5;
}

/* 能力特性：压缩为一行图标条，去掉白卡边框（原型设计说明 ②） */
.rc-features-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 24px;
  width: 100%;
  max-width: 780px;
  box-sizing: border-box;
  padding: 4px 0 2px;
  border-top: 1px solid var(--rc-border-soft);
}

.rc-feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 2px 0;
}

.rc-feat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--rc-primary);
  flex-shrink: 0;
}

.rc-feat-icon svg {
  width: 18px;
  height: 18px;
  display: block;
}

.rc-feat-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rc-feat-text strong {
  font-size: 12px;
  color: var(--rc-text);
  line-height: 1.3;
}

.rc-feat-text span {
  font-size: 11px;
  color: var(--rc-muted);
}

/* 对话流 */
.rc-chat-thread {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  /* 流式追加内容时不让浏览器做滚动锚定：跟随逻辑自己管滚动，
     锚定会在追加瞬间改 scrollTop，看起来像「自己往上跳」 */
  overflow-anchor: none;
  /* 出现/收起滚动条时不再挤压内容宽度（否则每次越过一屏都会整体重排一下） */
  scrollbar-gutter: stable;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  box-sizing: border-box;
}

/* 对话流内容限宽 860 居中（原型设计说明 ⑤） */
.rc-chat-thread > * {
  width: 100%;
  max-width: 860px;
  margin-left: auto;
  margin-right: auto;
  box-sizing: border-box;
}

.rc-msg-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
}

.rc-msg-row.user {
  justify-content: flex-end;
}

.rc-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

/* 用户消息不展示头像（原型设计说明 ①），保留类名以兼容历史 CSS/测试查询 */
.rc-avatar.user {
  display: none;
}

.rc-avatar.assistant {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #ffffff;
}

.rc-msg-bubble {
  border-radius: var(--rc-radius);
}

.rc-msg-bubble.user {
  background: var(--rc-primary);
  color: #ffffff;
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: var(--rc-shadow-soft);
  max-width: min(720px, 80%);
  word-break: break-word;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}

/* 卡片 hover 轻微位移（原型设计说明 ⑤） */
.rc-msg-bubble.user:hover {
  transform: translateY(-1px);
}

.rc-msg-time {
  font-size: 10px;
  opacity: 0.8;
  margin-top: 4px;
  text-align: right;
}

.rc-msg-bubble.assistant {
  flex: 1;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rc-clarify-intro {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  padding: 12px 16px;
  border-radius: var(--rc-radius);
  font-size: 13px;
  line-height: 1.6;
  color: var(--rc-text);
  width: 100%;
  box-sizing: border-box;
  word-break: break-word;
}

/* 确认后展示区域 */
.rc-confirmed-result {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 思考折叠面板 */
/* 思考折叠面板：降噪为浅色细线条（原型设计说明 ③） */
.rc-thinking-box {
  background: transparent;
  border: none;
  border-top: 1px solid var(--rc-border-soft);
  border-bottom: 1px solid var(--rc-border-soft);
  border-radius: 0;
  overflow: hidden;
}

.rc-thinking-header {
  padding: 8px 2px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  background: transparent;
}

.rc-thinking-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.rc-live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.rc-live-dot.green {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}

.rc-live-dot.amber {
  background: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
}

.rc-live-dot.pulsing {
  background: var(--rc-primary);
  box-shadow: 0 0 8px rgba(37, 99, 235, 0.6);
  animation: rc-pulse 1.5s infinite;
}

@keyframes rc-pulse {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
  100% { opacity: 1; transform: scale(1); }
}

.rc-toggle-arrow {
  font-size: 10px;
  transition: transform 0.2s;
}

.rc-toggle-arrow.collapsed {
  transform: rotate(-90deg);
}

.rc-thinking-body {
  padding: 10px 2px 12px;
  border-top: none;
  font-size: 12px;
  color: var(--rc-muted);
  line-height: 1.6;
}

.rc-thinking-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--rc-muted);
  max-height: 360px;
  overflow-y: auto;
  padding: 4px 0;
}

.rc-answer-markdown {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  width: 100%;
  box-sizing: border-box;
}

.rc-answer-markdown :deep(.markdown-output) {
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.65;
}

.rc-empty-fallback-hint {
  width: 100%;
}

/* SQL 卡片 */
.rc-sql-card {
  background: #0f172a;
  border-radius: var(--rc-radius);
  overflow: hidden;
  box-shadow: var(--rc-shadow-soft);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.rc-sql-head {
  padding: 8px 14px;
  background: #1e293b;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #334155;
}

.rc-sql-badge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rc-sql-label {
  background: rgba(6, 182, 212, 0.15);
  color: #38bdf8;
  font-family: monospace;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(6, 182, 212, 0.3);
}

.rc-sql-meta {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}

.rc-sql-code {
  margin: 0;
  padding: 12px 14px;
  font-family: monospace;
  font-size: 12px;
  color: #7dd3fc;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.5;
  box-sizing: border-box;
}

/* KPI 卡片 */
.rc-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
}

.rc-kpi-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  padding: 12px;
  border-radius: var(--rc-radius);
  display: flex;
  flex-direction: column;
}

.rc-kpi-card.danger {
  border-color: #fecdd3;
  background: #fff1f2;
}

.rc-kpi-label {
  font-size: 11px;
  color: var(--rc-muted);
}

.rc-kpi-value {
  font-size: 22px;
  font-weight: 700;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  margin: 4px 0;
  color: var(--rc-text);
}

.rc-kpi-value.green {
  color: #16a34a;
}

.rc-kpi-value.red {
  color: #e11d48;
}

.rc-kpi-tip {
  font-size: 10px;
  color: var(--rc-muted);
}

.rc-kpi-tip.red {
  color: #e11d48;
}

/* 数据视图卡片 */
.rc-dataview-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  padding: 16px;
  border-radius: var(--rc-radius);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.rc-dataview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  flex-wrap: wrap;
  gap: 10px;
}

.rc-dataview-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--rc-text);
}

.rc-dataview-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rc-chart-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rc-chart-item {
  display: flex;
  flex-direction: column;
}

.rc-bar-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}

.rc-bar-title.danger,
.rc-bar-val.danger,
.rc-bar-title.red,
.rc-bar-val.red {
  color: #e11d48;
  font-weight: 600;
}

.rc-bar-title.warn,
.rc-bar-val.warn,
.rc-bar-title.orange,
.rc-bar-val.orange {
  color: #d97706;
  font-weight: 600;
}

.rc-bar-title.green,
.rc-bar-val.green {
  color: #16a34a;
  font-weight: 600;
}

.rc-bar-title.cyan,
.rc-bar-val.cyan {
  color: #0891b2;
  font-weight: 600;
}

.rc-bar-title.indigo,
.rc-bar-val.indigo {
  color: #4f46e5;
  font-weight: 600;
}

.rc-bar-title.primary,
.rc-bar-val.primary {
  color: #2563eb;
  font-weight: 600;
}

.rc-bar-title.purple,
.rc-bar-val.purple {
  color: #7c3aed;
  font-weight: 600;
}

.rc-bar-track {
  width: 100%;
  height: 8px;
  background: var(--rc-border-soft);
  border-radius: 4px;
  overflow: hidden;
}

.rc-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--rc-primary, #3b82f6);
}

.rc-bar-fill.red {
  background: #f43f5e;
}

.rc-bar-fill.orange {
  background: #f59e0b;
}

.rc-bar-fill.green {
  background: #10b981;
}

.rc-bar-fill.cyan {
  background: #06b6d4;
}

.rc-bar-fill.indigo {
  background: #6366f1;
}

.rc-bar-fill.primary {
  background: #2563eb;
}

.rc-bar-fill.purple {
  background: #8b5cf6;
}

.rc-pie-view {
  width: 100%;
  box-sizing: border-box;
}

.rc-table-view {
  width: 100%;
  overflow-x: auto;
  box-sizing: border-box;
}

.rc-table-meta-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: var(--rc-bg, #f8fafc);
  border: 1px solid var(--rc-border-soft, #e2e8f0);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  font-size: 12px;
}

.rc-table-records-count {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
}

.rc-table-selected-badge {
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  background: rgba(37, 99, 235, 0.1);
  color: var(--el-color-primary, #2563eb);
  font-weight: 500;
}

.rc-table-quick-export {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rc-table-divider {
  color: var(--rc-border, #cbd5e1);
  font-size: 11px;
}

.rc-table-scroll-wrapper {
  width: 100%;
  overflow-x: auto;
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid var(--rc-border-soft, #e2e8f0);
}

.rc-preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.rc-preview-table th {
  background: var(--rc-bg);
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--rc-border);
  color: var(--rc-muted);
  white-space: nowrap;
}

.rc-preview-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--rc-border-soft);
  color: var(--rc-text);
  font-family: monospace;
  white-space: nowrap;
}

.rc-preview-table tbody tr {
  transition: background 0.15s ease;
}

.rc-preview-table tbody tr:hover {
  background: var(--rc-bg, rgba(0, 0, 0, 0.02));
}

.text-red {
  color: #e11d48;
  font-weight: 600;
}

.text-warn {
  color: #d97706;
}

/* 诊断建议：左侧色条（原型设计说明 ③） */
.rc-insight-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-left: 3px solid var(--rc-primary);
  border-radius: var(--rc-radius);
  padding: 14px 16px;
  font-size: 12px;
  width: 100%;
  box-sizing: border-box;
}

.rc-insight-title {
  font-weight: 600;
  color: var(--rc-text);
  margin-bottom: 6px;
}

.rc-insight-list {
  padding-left: 18px;
  margin: 0;
  color: var(--rc-text-2);
  line-height: 1.6;
}

/* 追问胶囊 */
.rc-followup-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.rc-chips-label {
  font-size: 11px;
  color: var(--rc-muted);
}

.rc-chip-btn {
  font-size: 11px;
}

/* 底部输入框 */
.rc-aichat-footer {
  position: relative;
  border-top: 1px solid var(--rc-border);
  background: var(--rc-surface);
  padding: 12px 24px;
  width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
}

/* 输入卡与对话流同宽（860 内容 + 两侧 24 留白，原型设计说明 ②⑤） */
.rc-input-box {
  width: 100%;
  max-width: 908px;
  margin: 0 auto;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: var(--rc-surface);
  padding: 10px 14px;
  box-shadow: var(--rc-shadow-soft);
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.rc-input-box:focus-within {
  border-color: var(--rc-primary);
  box-shadow: 0 0 0 1px var(--rc-primary);
}

/* 发送按钮：空内容灰禁用，有内容品牌渐变点亮（原型设计说明 ⑤） */
.rc-send-btn {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
  border: none !important;
  color: #ffffff !important;
  font-weight: 600;
  transition: opacity 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
}

.rc-send-btn:not(.is-disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
}

.rc-send-btn.is-disabled {
  background: var(--rc-border-soft) !important;
  color: var(--rc-muted) !important;
}

.rc-textarea {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 13px;
  color: var(--rc-text);
  background: transparent;
  line-height: 1.5;
  box-sizing: border-box;
}

.rc-input-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--rc-border-soft);
}

.rc-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rc-mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: 12px;
  background: transparent;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.rc-mode-chip:hover:not(:disabled) {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.rc-mode-chip:focus-visible {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 1px;
}

.rc-mode-chip:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.rc-mode-chip.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.rc-mode-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
}

.rc-mode-chip.active .rc-mode-dot {
  opacity: 1;
}

.rc-input-tip {
  font-size: 12px;
  color: var(--rc-muted);
  user-select: none;
}

.rc-footer-caption {
  width: 100%;
  max-width: 100%;
  margin: 6px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--rc-faint);
}

/* 中断状态与控制按钮 */
.rc-interrupted-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #fef2f2;
  color: #dc2626;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid #fee2e2;
}

.rc-stop-square-small {
  font-size: 8px;
  line-height: 1;
}

.rc-interrupted-notice {
  margin-top: 8px;
}

.rc-stop-float-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  position: absolute;
  top: -42px;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 10;
}

.rc-stop-float-btn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  background: var(--rc-surface, #ffffff);
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: 9999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  font-size: 13px;
  font-weight: 500;
  color: #ef4444;
  cursor: pointer;
  transition: all 0.2s ease;
}

.rc-stop-float-btn:hover {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #dc2626;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.15);
}

.rc-stop-square {
  font-size: 10px;
  line-height: 1;
}

.rc-stop-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.rc-stop-icon {
  font-size: 14px;
}

/* ===== 1117 优化：滚动条 / 阶段条 / 错误卡 / 操作条 / 回到底部 / 更早历史 ===== */
.rc-chat-thread::-webkit-scrollbar {
  width: 8px;
}

.rc-chat-thread::-webkit-scrollbar-track {
  background: transparent;
}

.rc-chat-thread::-webkit-scrollbar-thumb {
  background: var(--rc-border);
  border-radius: 4px;
}

.rc-chat-thread::-webkit-scrollbar-thumb:hover {
  background: var(--rc-primary);
}

.rc-load-earlier {
  display: flex;
  justify-content: center;
  padding: 2px 0 6px;
}

.rc-phase-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--rc-border-soft);
  border-radius: var(--rc-radius-sm);
  background: var(--rc-primary-bg);
  font-size: 12px;
  color: var(--rc-primary);
}

.rc-phase-infer-tag {
  flex-shrink: 0;
}

.rc-phase-stalled {
  color: #b45309;
}

.rc-error-card {
  border: 1px solid #fecaca;
  border-left: 3px solid #ef4444;
  border-radius: var(--rc-radius-sm);
  background: #fef2f2;
  padding: 10px 14px;
  margin-bottom: 10px;
}

.rc-error-title {
  font-size: 13px;
  font-weight: 600;
  color: #b91c1c;
  margin-bottom: 4px;
}

.rc-error-detail {
  font-size: 12px;
  color: #7f1d1d;
  overflow-wrap: anywhere;
  margin-bottom: 4px;
}

.rc-error-hint {
  font-size: 12px;
  color: #9ca3af;
}

.rc-msg-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--rc-border-soft);
}

/* 操作条文字按钮降噪（原型设计说明 ③） */
.rc-msg-actions .el-button {
  font-size: 11.5px;
}

.rc-msg-actions .el-button + .el-button {
  margin-left: 4px;
}

.rc-msg-row.is-local-action .rc-msg-bubble.assistant {
  border-style: dashed;
}

.rc-back-to-bottom {
  position: absolute;
  right: 28px;
  bottom: 128px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--rc-border);
  background: var(--rc-surface);
  color: var(--rc-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
  transition: all 0.2s ease;
}

.rc-back-to-bottom:hover {
  border-color: var(--rc-primary);
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.18);
}
</style>
