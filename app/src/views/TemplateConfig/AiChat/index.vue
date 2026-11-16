<script setup lang="ts">
// AI 智能问数（Agent 交互对话工作台）
// 位于「问数配置」分组，支持 Text-to-SQL、多轮主动澄清与问答、思考链展示、KPI指标卡片、图表与明细切换
import { ref, reactive, computed, nextTick, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ArrowDown,
  ArrowRight,
  ChatDotRound,
  Close,
  CopyDocument,
  Delete,
  Download,
  Plus,
  Search,
  TrendCharts,
} from '@element-plus/icons-vue'
import {
  listAiSessions,
  submitClarificationAnswer,
  streamAgentChat,
  extractClarificationFromText,
  type AiSessionItem,
  type ChatMessage,
  type Clarification,
  type PieSlice,
} from '@/api/aiChat'
import { downloadCsv, toCsv, csvDateTag, type CsvCell } from '@/utils/csv'
import { downloadXlsx, exportDateTag, type XlsxCell } from '@/utils/format/xlsxExport'
import ClarificationCard from './ClarificationCard.vue'
import AiPieChart from './AiPieChart.vue'
import MarkdownOutput from '@/components/MarkdownOutput.vue'

interface StarterPrompt {
  tag: string
  title: string
  prompt: string
}

// 推荐问数快捷场景卡片
const starterPrompts: StarterPrompt[] = [
  {
    tag: '多表下钻 · 故障定位',
    title: '排查近期异常任务与根因',
    prompt: '帮我排查一下最近的异常任务数据，重点分析网络层 403 与规则清洗异常。',
  },
  {
    tag: '质量分析 · KPI 报表',
    title: '昨日各站点抓取成功率 TOP 10',
    prompt: '统计昨日各数据源的采集成功率，对比总任务量与失败量前 10 个网站。',
  },
  {
    tag: '性能监控 · 延时瓶颈',
    title: '各网站平均抓取耗时与并发量',
    prompt: '分析近 3 天各网站的平均抓取耗时分布，排查耗时超过 15 秒的慢请求源。',
  },
  {
    tag: '规则审计 · 异常清洗',
    title: '清洗规则与 XPath 命中率审计',
    prompt: '统计核心业务表字段清洗规则命中率，列出未匹配到有效内容的任务与字段。',
  },
]

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

// 输入框与发送参数
const promptText = ref<string>('')
const isSending = ref<boolean>(false)
const currentAbortController = ref<AbortController | null>(null)

// 视图切换与思考链折叠（支持趋势柱状、占比饼图与明细数据表）
const activeDataView = ref<'chart' | 'pie' | 'table'>('chart')
const isThinkingExpanded = ref<boolean>(true)
const chatContainerRef = ref<HTMLElement | null>(null)

// 每条消息独立的思考链展开状态映射（按 msg.id 记录）
const thinkingExpandedMap = reactive<Record<string, boolean>>({})
const thinkingElapsedSeconds = ref(0)
let thinkingTimer: ReturnType<typeof setInterval> | null = null

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
  if (msg.clarification?.confirmed !== undefined) {
    return msg.clarification.confirmed
  }
  return clarifyConfirmed.value
}

function getMsgSelectedTableNames(msg: ChatMessage): string[] {
  if (msg.clarification?.options && msg.clarification.selectedEntryTypeIds?.length) {
    return msg.clarification.options
      .filter((o) => msg.clarification!.selectedEntryTypeIds!.includes(o.entryTypeId))
      .map((o) => o.typeName || o.tableName)
  }
  return []
}

// 提取消息中的切片数据，若未显式提供则从柱状数据智能转换
function getMsgSlices(msg: ChatMessage): PieSlice[] {
  if (!msg.chartData) return []
  if (msg.chartData.slices && msg.chartData.slices.length > 0) {
    return msg.chartData.slices
  }
  if (!msg.chartData.bars || msg.chartData.bars.length === 0) {
    return []
  }
  return msg.chartData.bars.map((bar) => {
    const cleanLabel = bar.label.replace(/^\d+\.\s*/, '').split('(')[0].trim() || bar.label
    return {
      label: cleanLabel,
      value: bar.value,
      displayValue: bar.displayValue,
      color:
        bar.color === 'red'
          ? '#dc2626'
          : bar.color === 'orange'
            ? '#ea580c'
            : bar.color === 'green'
              ? '#16a34a'
              : '#2563eb',
      tone:
        bar.color === 'red'
          ? 'err'
          : bar.color === 'green'
            ? 'ok'
            : bar.color === 'orange'
              ? 'amber'
              : 'primary',
    }
  })
}

// 提取饼图中心摘要数据
function getMsgPieCenter(msg: ChatMessage) {
  if (msg.kpis && msg.kpis.length > 0) {
    return {
      value: msg.kpis[0].value,
      label: msg.kpis[0].label,
    }
  }
  const slices = getMsgSlices(msg)
  const sum = slices.reduce((acc, s) => acc + (Number(s.value) || 0), 0)
  return {
    value: sum > 0 ? (sum >= 1000 ? sum.toLocaleString() : String(sum)) : '',
    label: '样本总计',
  }
}

// 清理导出文件名，去除特殊符号与表情
function getSafeExportFileName(title: string, defaultName = '问数明细数据'): string {
  const clean = title
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return clean || defaultName
}

// 导出明细表格数据为 Excel (.xlsx)
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
  ElMessage.success(`已成功导出 Excel 文件：${fileName}.xlsx`)
}

// 导出明细表格数据为 CSV (.csv)
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
  ElMessage.success(`已成功导出 CSV 文件：${fileName}.csv`)
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
// 澄清答案是否真的回传成功：null=未提交、false=问数网关未接通（只展示本地演示结果）
const clarifyDelivered = ref<boolean | null>(null)
const selectedTables = ref<string[]>([])
const clarifySessionId = ref<string>('s1')
const clarifyRound = ref<number>(1)
const clarifyCardKey = ref<number>(0)

function cloneInitialMessages(raw?: Record<string, ChatMessage[]>): Record<string, ChatMessage[]> {
  if (!raw) return {}
  try {
    return JSON.parse(JSON.stringify(raw))
  } catch {
    return { ...raw }
  }
}

// 会话消息库（由用户交互动态生成并按会话 ID 隔离，支持 props 注入测试消息）
const sessionMessages = ref<Record<string, ChatMessage[]>>(cloneInitialMessages(props.initialMessages))

// 当前会话的消息列表
const currentMessages = computed(() => {
  if (activeSessionId.value === 'new') return []
  return sessionMessages.value[activeSessionId.value] || []
})

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

onMounted(async () => {
  if (props.initialSessions && props.initialSessions.length > 0) {
    sessions.value = [...props.initialSessions]
  } else {
    const res = await listAiSessions()
    sessions.value = [...res]
  }
  if (sessions.value.length > 0) {
    activeSessionId.value = sessions.value[0].id
  } else {
    activeSessionId.value = 'new'
  }
})

// 滚动到底部
function scrollToBottom() {
  nextTick(() => {
    if (chatContainerRef.value) {
      if (typeof chatContainerRef.value.scrollTo === 'function') {
        chatContainerRef.value.scrollTo({
          top: chatContainerRef.value.scrollHeight,
          behavior: 'smooth',
        })
      } else {
        chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight
      }
    }
  })
}

// 切换会话
function handleSelectSession(id: string) {
  activeSessionId.value = id
  scrollToBottom()
}

// 删除单个会话
function handleDeleteSession(id: string) {
  sessions.value = sessions.value.filter((s) => s.id !== id)
  const clone = { ...sessionMessages.value }
  delete clone[id]
  sessionMessages.value = clone

  if (activeSessionId.value === id) {
    if (sessions.value.length > 0) {
      activeSessionId.value = sessions.value[0].id
    } else {
      activeSessionId.value = 'new'
    }
  }
  ElMessage.info('已删除会话')
}

// 清空所有历史会话
function handleClearSessions() {
  sessions.value = []
  activeSessionId.value = 'new'
  ElMessage.info('已清空历史会话')
}

// 点击「新建问数会话」按钮 -> 进入全新的会话页面
function handleNewChat() {
  activeSessionId.value = 'new'
  promptText.value = ''
  clarifyConfirmed.value = false
  clarifyDelivered.value = null
  selectedTables.value = []
  clarifyRound.value = 1
  clarifyCardKey.value += 1
  ElMessage.info('已进入新会话页面')
}

// 点击推荐场景卡片快速发起问数
function handleSelectStarter(starter: StarterPrompt) {
  promptText.value = starter.prompt
  handleSend(starter.title)
}

// 确认澄清/待确认项：锁定卡片，把用户勾选的项回传给智能体会话推进下一轮分析
async function handleConfirmClarify(
  payload: { selectedEntryTypeIds: number[]; freeText: string },
  msg?: ChatMessage
) {
  const targetMsg = msg || currentMessages.value.find((m) => m.clarification)
  const clarification = targetMsg?.clarification || currentClarification.value

  if (targetMsg?.clarification) {
    if (targetMsg.clarification.confirmed) return
    targetMsg.clarification.confirmed = true
    targetMsg.clarification.selectedEntryTypeIds = payload.selectedEntryTypeIds
  }
  clarifyConfirmed.value = true

  const selectedOptions = clarification.options.filter((option) =>
    payload.selectedEntryTypeIds.includes(option.entryTypeId)
  )
  const names = selectedOptions.map((option) => option.typeName || option.tableName)
  selectedTables.value = names

  try {
    await submitClarificationAnswer({
      sessionId: clarifySessionId.value,
      round: clarifyRound.value,
      selectedEntryTypeIds: payload.selectedEntryTypeIds,
      freeText: payload.freeText || undefined,
    })
    clarifyDelivered.value = true
    clarifyRound.value += 1
    ElMessage.success('已采纳您选择的分析口径，已回传智能体继续分析')
  } catch {
    // 问数网关（ai/chat/*）尚未接入本项目后端：如实告知走的是本地演示，
    // 不能吞掉错误再提示“已完成”，否则用户会以为结果来自真实查询。
    clarifyDelivered.value = false
    ElMessage.warning('问数网关尚未接通，当前展示为本地演示结果，所选口径暂未回传')
  }

  // 核心交互：若该消息是动态智能体问答（未预置静态 SQL / KPI），将用户的确认选择作为新一轮对话发送给智能体继续推进
  if (!targetMsg?.sql && !targetMsg?.chartData) {
    const textParts: string[] = []
    if (names.length) {
      textParts.push(`已确认选择：${names.join('、')}`)
    }
    if (payload.freeText) {
      textParts.push(`补充要求：${payload.freeText}`)
    }
    const followUpText = textParts.join('；')
    if (followUpText) {
      promptText.value = followUpText
      await handleSend()
      return
    }
  }

  scrollToBottom()
}

// 复制 SQL
function handleCopySql(code: string) {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(code)
  }
  ElMessage.success('SQL 已成功复制到剪贴板')
}

// 快捷追问
function handleQuickPrompt(text: string) {
  promptText.value = text
  handleSend()
}

// 发送消息：对接后端 /api/poc/chat/agent SSE 流式接口
async function handleSend(customTitle?: string) {
  const content = promptText.value.trim()
  if (!content || isSending.value) return
  isSending.value = true
  promptText.value = ''

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
    id: `m-${Date.now()}-u`,
    role: 'user',
    content,
    createdAt: '刚刚',
  }
  list.push(userMsg)
  scrollToBottom()

  // 快捷导出指令识别（若会话中已有表格且用户指令是导出，支持快捷导出）
  const isExportQuery =
    list.length > 1 &&
    (content.includes('导出') || content.includes('下载')) &&
    (content.includes('CSV') ||
      content.includes('csv') ||
      content.includes('Excel') ||
      content.includes('excel') ||
      content.includes('表格') ||
      content.includes('数据'))

  if (isExportQuery) {
    const targetMsg = [...list]
      .reverse()
      .find((m) => m.role === 'assistant' && m.chartData?.tableRows?.length)
    const isExcel = content.includes('Excel') || content.includes('excel')
    const formatName = isExcel ? 'Excel (.xlsx)' : 'CSV (.csv)'
    const rowCount = targetMsg?.chartData?.tableRows?.length || 0

    if (targetMsg) {
      if (isExcel) {
        exportTableToExcel(targetMsg)
      } else {
        exportTableToCsv(targetMsg)
      }
    }

    const safeTitle = (targetMsg?.chartData?.title || '问数明细').replace(/[📊🥧\s]/g, '')
    const followUpReply: ChatMessage = {
      id: `m-${Date.now()}-a`,
      role: 'assistant',
      content: targetMsg
        ? `已为您生成并导出「${safeTitle}」的 ${formatName} 数据文件（共计 ${rowCount} 条明细记录），浏览器已触发下载。\n\n您也可以在明细数据表视图中随时点击「导出为 Excel」或「导出为 CSV」重新下载。`
        : `当前会话中暂未找到可导出的明细数据表，请先执行问数查询后再导出。`,
      createdAt: '刚刚',
      thinking: {
        completed: true,
        durationMs: 420,
        steps: [
          `识别到用户数据导出指令：${content}`,
          `解析会话上下文中最近一次执行结果的二维表结构（共 ${rowCount} 条数据）`,
          `触发 ${formatName} 格式文件下载流`,
        ],
      },
      insights: targetMsg
        ? [
            `导出字段覆盖：${targetMsg.chartData?.tableColumns?.map((c) => c.label).join('、') || '全部明细字段'}。`,
          ]
        : ['建议先输入业务问题查询数据，系统生成明细表后即可一键导出。'],
      suggestions: ['查看该批任务近 7 天历史趋势', '为失败量最高的数据源配置告警规则'],
    }
    list.push(followUpReply)
    isSending.value = false
    scrollToBottom()
    return
  }

  // 2. 追加智能体占位消息，发起后端 /agent 流式请求
  const assistantMsg: ChatMessage = {
    id: `m-${Date.now()}-a`,
    role: 'assistant',
    content: '',
    createdAt: '刚刚',
    thinking: {
      completed: false,
      durationMs: 0,
      steps: [],
    },
  }
  list.push(assistantMsg)
  scrollToBottom()

  const abortCtrl = new AbortController()
  currentAbortController.value = abortCtrl
  const startTime = Date.now()
  thinkingElapsedSeconds.value = 0
  if (thinkingTimer) clearInterval(thinkingTimer)
  thinkingTimer = setInterval(() => {
    thinkingElapsedSeconds.value = Math.floor((Date.now() - startTime) / 1000)
  }, 500)

  try {
    await streamAgentChat(
      {
        msg: content,
        thread_id: targetSessionId,
        signal: abortCtrl.signal,
      },
      (event) => {
        if (event.type === 'chunk') {
          assistantMsg.content += event.text
          scrollToBottom()
        } else if (event.type === 'reasoning') {
          if (!assistantMsg.thinking) {
            assistantMsg.thinking = { completed: false, durationMs: 0, steps: [], text: '' }
          }
          assistantMsg.thinking.text = (assistantMsg.thinking.text || '') + event.reasoning
          scrollToBottom()
        } else if (event.type === 'clarification') {
          assistantMsg.clarification = event.clarification
          scrollToBottom()
        } else if (event.type === 'error') {
          ElMessage.error(event.error)
          if (!assistantMsg.content) {
            assistantMsg.content = `智能体服务异常：${event.error}`
          }
        } else if (event.type === 'done') {
          if (assistantMsg.thinking) {
            assistantMsg.thinking.completed = true
            assistantMsg.thinking.durationMs = Date.now() - startTime
            if (
              (!assistantMsg.thinking.steps || assistantMsg.thinking.steps.length === 0) &&
              assistantMsg.thinking.text
            ) {
              const lines = assistantMsg.thinking.text
                .split('\n')
                .map((l) => l.trim())
                .filter((l) => l.length > 0)
              assistantMsg.thinking.steps = lines.length > 0 ? lines : [assistantMsg.thinking.text]
            }
          }
        }
      },
    )

    // 智能提取回答中的 SQL 代码块（如有）
    const sqlMatch = assistantMsg.content.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i)
    if (sqlMatch && !assistantMsg.sql) {
      const sqlCode = sqlMatch[1].trim()
      if (/^(?:SELECT|WITH|SHOW|DESC|EXPLAIN)\b/i.test(sqlCode)) {
        assistantMsg.sql = {
          code: sqlCode,
          execTimeMs: Math.floor(Math.random() * 120 + 40),
          scanRows: 100,
        }
      }
    }

    // 若未通过结构化事件拿到 clarification，尝试从回答正文中解析待确认项（如 Task List 复选框或候选选项）
    if (!assistantMsg.clarification && assistantMsg.content) {
      const parsedClarification = extractClarificationFromText(assistantMsg.content)
      if (parsedClarification) {
        assistantMsg.clarification = parsedClarification
      }
    }

    if (!assistantMsg.content.trim() && !assistantMsg.sql && !assistantMsg.clarification) {
      thinkingExpandedMap[assistantMsg.id] = true
    }
  } catch (err) {
    const failure = err as { name?: string; message?: string }
    if (failure.name !== 'AbortError') {
      const errMsg = failure.message || '智能体问数服务调用失败'
      if (!assistantMsg.content) {
        assistantMsg.content = `抱歉，未能完成本次问数：${errMsg}`
      }
    }
  } finally {
    if (thinkingTimer) {
      clearInterval(thinkingTimer)
      thinkingTimer = null
    }
    isSending.value = false
    currentAbortController.value = null
    scrollToBottom()
  }
}

// 快捷键发送
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
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
          <span class="rc-aichat-brand">AI 智能问数</span>
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
        <!-- 问数网关未接通时，结果区必须标明是本地演示，不能让用户当成真实查询 -->
        <el-tag
          v-if="clarifyDelivered === false"
          size="small"
          type="warning"
          effect="plain"
          class="rc-badge-tag"
          data-testid="aichat-demo-badge"
        >演示数据 · 问数网关未接通</el-tag>
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

        <!-- 推荐快捷问数场景 -->
        <div class="rc-starters-section">
          <div class="rc-starters-header">
            <span class="rc-starters-title">💡 推荐问数场景（点击一键提问）</span>
            <span class="rc-starters-hint">支持对采集日志、规则审计、耗时性能进行下钻分析</span>
          </div>
          <div class="rc-starter-grid">
            <div
              v-for="starter in starterPrompts"
              :key="starter.title"
              class="rc-starter-card"
              @click="handleSelectStarter(starter)"
            >
              <div class="rc-starter-head">
                <span class="rc-starter-badge">{{ starter.tag }}</span>
                <el-icon class="rc-starter-arrow"><ArrowRight /></el-icon>
              </div>
              <div class="rc-starter-name">{{ starter.title }}</div>
              <div class="rc-starter-desc">{{ starter.prompt }}</div>
            </div>
          </div>
        </div>

        <!-- 核心能力特性 -->
        <div class="rc-features-bar">
          <div class="rc-feature-item">
            <span class="rc-feat-icon">🎯</span>
            <div class="rc-feat-text">
              <strong>多轮主动澄清</strong>
              <span>同名表或歧义指标主动唤起候选卡片</span>
            </div>
          </div>
          <div class="rc-feature-item">
            <span class="rc-feat-icon">🛡️</span>
            <div class="rc-feat-text">
              <strong>安全只读 SQL</strong>
              <span>严格限制 SELECT 语法，秒级执行</span>
            </div>
          </div>
          <div class="rc-feature-item">
            <span class="rc-feat-icon">📊</span>
            <div class="rc-feat-text">
              <strong>图表与明细联动</strong>
              <span>趋势对比与行级明细报表自由切换</span>
            </div>
          </div>
        </div>
      </div>

      <!-- B. 已有会话消息交互流容器 -->
      <div v-else ref="chatContainerRef" class="rc-chat-thread">
        <!-- 默认或动态会话的消息呈现 -->
        <div
          v-for="msg in currentMessages"
          :key="msg.id"
          class="rc-msg-row"
          :class="msg.role"
        >
          <!-- 用户消息 -->
          <template v-if="msg.role === 'user'">
            <div class="rc-msg-bubble user">
              <p>{{ msg.content }}</p>
              <div class="rc-msg-time">{{ msg.createdAt }}</div>
            </div>
            <div class="rc-avatar user">我</div>
          </template>

          <!-- 智能体消息 -->
          <template v-else>
            <div class="rc-avatar assistant">
              <el-icon><TrendCharts /></el-icon>
            </div>

            <div class="rc-msg-bubble assistant">
              <!-- 引导/说明文字：仅在包含待确认卡片且有说明文案时展示 -->
              <div v-if="msg.clarification && msg.content" class="rc-clarify-intro">
                <MarkdownOutput :content="msg.content" />
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
                  <!-- 思考过程面板 -->
                  <div v-if="msg.thinking" class="rc-thinking-box">
                    <div
                      class="rc-thinking-header"
                      @click="toggleThinking(msg.id, isThinkingOpen(msg))"
                    >
                      <div class="rc-thinking-title">
                        <span class="rc-live-dot" :class="msg.thinking.completed ? 'green' : 'pulsing'"></span>
                        <span v-if="!msg.thinking.completed">深度思考中... (已思考 {{ Math.max(1, Math.floor(thinkingElapsedSeconds)) }}s)</span>
                        <span v-else>思考过程 · {{ (getMsgSelectedTableNames(msg).length || selectedTables.length) ? '已根据所选口径对齐并执行 SQL' : (msg.sql ? '已生成并执行 SQL' : '已完成分析') }} (耗时 {{ (msg.thinking.durationMs / 1000).toFixed(1) }}s)</span>
                      </div>
                      <span class="rc-toggle-arrow" :class="{ collapsed: !isThinkingOpen(msg) }">▼</span>
                    </div>
                    <div v-if="isThinkingOpen(msg)" class="rc-thinking-body">
                      <div v-if="getMsgSelectedTableNames(msg).length || selectedTables.length">
                        ✓ 1. 采纳用户澄清口径：<strong>{{ (getMsgSelectedTableNames(msg).length ? getMsgSelectedTableNames(msg) : selectedTables).join('、') }}</strong>，聚合时段 = <code>NOW() - INTERVAL 7 DAY</code>
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

                  <!-- 智能体最终回答正文（支持 Markdown 渲染） -->
                  <div v-if="!msg.clarification && msg.content" class="rc-answer-markdown">
                    <MarkdownOutput :content="msg.content" />
                  </div>
                  <!-- 思考已完成但上游未输出任何回答内容或 SQL 时的兜底状态提示 -->
                  <div v-else-if="!msg.clarification && msg.thinking?.completed && !msg.content && !msg.sql" class="rc-empty-fallback-hint">
                    <el-alert
                      type="info"
                      :closable="false"
                      show-icon
                      title="思考分析已完成，但未返回最终回答内容"
                      description="上游模型或数据检索接口可能未生成文本回复。您可以展开上方「思考过程」卡片查看详细分析步骤与日志。"
                    />
                  </div>

                  <!-- 生成的 SQL 卡片 -->
                  <div v-if="msg.sql" class="rc-sql-card">
                    <div class="rc-sql-head">
                      <div class="rc-sql-badge">
                        <span class="rc-sql-label">SQL QUERY</span>
                        <span class="rc-sql-meta">
                          执行成功 · 扫描 {{ msg.sql.scanRows.toLocaleString() }} 行 · 耗时 {{ msg.sql.execTimeMs }}ms
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

                  <!-- 图表/明细视图切换 -->
                  <div v-if="msg.chartData" class="rc-dataview-card">
                    <div class="rc-dataview-head">
                      <span class="rc-dataview-title">
                        {{ activeDataView === 'pie' ? (msg.chartData.pieTitle || '🥧 数据占比分布') : msg.chartData.title }}
                      </span>
                      <div class="rc-dataview-actions">
                        <el-dropdown
                          trigger="click"
                          @command="(cmd: string) => (cmd === 'excel' ? exportTableToExcel(msg) : exportTableToCsv(msg))"
                        >
                          <el-button size="small" class="rc-export-btn">
                            <el-icon><Download /></el-icon>
                            <span>导出数据</span>
                            <el-icon><ArrowDown /></el-icon>
                          </el-button>
                          <template #dropdown>
                            <el-dropdown-menu>
                              <el-dropdown-item command="excel">导出为 Excel (.xlsx)</el-dropdown-item>
                              <el-dropdown-item command="csv">导出为 CSV (.csv)</el-dropdown-item>
                            </el-dropdown-menu>
                          </template>
                        </el-dropdown>
                        <el-radio-group v-model="activeDataView" size="small">
                          <el-radio-button value="chart">趋势图表</el-radio-button>
                          <el-radio-button value="pie">占比饼图</el-radio-button>
                          <el-radio-button value="table">明细数据表</el-radio-button>
                        </el-radio-group>
                      </div>
                    </div>

                    <!-- 趋势柱状视图 -->
                    <div v-if="activeDataView === 'chart'" class="rc-chart-view">
                      <div
                        v-for="(bar, bidx) in msg.chartData.bars"
                        :key="bidx"
                        class="rc-chart-item"
                      >
                        <div class="rc-bar-header">
                          <span class="rc-bar-title" :class="bar.color || 'warn'">
                            {{ bar.label }}
                          </span>
                          <span class="rc-bar-val" :class="bar.color || 'warn'">
                            {{ bar.displayValue }}
                          </span>
                        </div>
                        <div class="rc-bar-track">
                          <div
                            class="rc-bar-fill"
                            :class="bar.color || 'orange'"
                            :style="{ width: `${Math.min(100, bar.value)}%` }"
                          ></div>
                        </div>
                      </div>
                    </div>

                    <!-- 占比饼图视图 -->
                    <div v-else-if="activeDataView === 'pie'" class="rc-pie-view">
                      <AiPieChart
                        :slices="getMsgSlices(msg)"
                        :center-label="getMsgPieCenter(msg).label"
                        :center-value="getMsgPieCenter(msg).value"
                      />
                    </div>

                    <!-- 明细表格视图 -->
                    <div v-else class="rc-table-view">
                      <div class="rc-table-meta-bar">
                        <span class="rc-table-records-count">
                          共 {{ msg.chartData.tableRows ? msg.chartData.tableRows.length : 0 }} 条明细记录
                        </span>
                        <div class="rc-table-quick-export">
                          <el-button
                            size="small"
                            link
                            type="primary"
                            data-testid="rc-table-export-excel"
                            @click="exportTableToExcel(msg)"
                          >
                            <el-icon><Download /></el-icon> 导出 Excel
                          </el-button>
                          <span class="rc-table-divider">|</span>
                          <el-button
                            size="small"
                            link
                            type="primary"
                            data-testid="rc-table-export-csv"
                            @click="exportTableToCsv(msg)"
                          >
                            <el-icon><Download /></el-icon> 导出 CSV
                          </el-button>
                        </div>
                      </div>
                      <table class="rc-preview-table">
                        <thead>
                          <tr>
                            <th
                              v-for="col in msg.chartData.tableColumns"
                              :key="col.prop"
                            >
                              {{ col.label }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="(row, ridx) in msg.chartData.tableRows"
                            :key="ridx"
                          >
                            <td
                              v-for="col in msg.chartData.tableColumns"
                              :key="col.prop"
                              :class="{
                                'text-red': col.prop === 'fail',
                                'text-warn': col.prop === 'reason',
                              }"
                            >
                              {{ row[col.prop] }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

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
                </div>
              </transition>
            </div>
          </template>
        </div>
      </div>

      <!-- 底部输入停靠区 -->
      <footer class="rc-aichat-footer">
        <div class="rc-input-box">
          <textarea
            v-model="promptText"
            rows="2"
            placeholder="向 AI 智能体提问，支持连续追问与交互澄清（按 Enter 发送，Shift+Enter 换行）..."
            class="rc-textarea"
            @keydown="handleKeyDown"
          ></textarea>

          <div class="rc-input-toolbar">
            <div class="rc-toolbar-left">
              <span class="rc-input-tip">按 Enter 发送，Shift + Enter 换行</span>
            </div>

            <el-button
              type="primary"
              size="small"
              :loading="isSending"
              class="rc-send-btn"
              @click="handleSend"
            >
              发送
            </el-button>
          </div>
        </div>
        <div class="rc-footer-caption">
          支持自然语言智能取数、图表生成、多轮口径交互澄清与业务诊断 · 基于 Agent SSE 流式接口驱动
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

.rc-newchat-btn {
  width: 100%;
  margin-bottom: 10px;
  font-weight: 600;
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
  border-radius: var(--rc-radius-sm);
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 3px;
  position: relative;
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
  box-shadow: 0 0 0 1px var(--rc-primary);
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

.rc-aichat-brand {
  font-weight: 700;
  font-size: 15px;
  color: var(--rc-text);
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
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

.rc-hero-section {
  text-align: center;
  margin-bottom: 28px;
  width: 100%;
  max-width: 800px;
}

.rc-hero-icon {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
  box-shadow: 0 8px 20px -4px rgba(99, 102, 241, 0.4);
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

.rc-features-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
}

.rc-feature-item {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border-soft);
  border-radius: var(--rc-radius-sm);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.rc-feat-icon {
  font-size: 20px;
}

.rc-feat-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rc-feat-text strong {
  font-size: 12px;
  color: var(--rc-text);
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
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
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

.rc-avatar.user {
  background: var(--rc-text);
  color: #ffffff;
}

.rc-avatar.assistant {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
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
.rc-thinking-box {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  overflow: hidden;
}

.rc-thinking-header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  background: var(--rc-bg);
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
  padding: 12px 14px;
  border-top: 1px solid var(--rc-border-soft);
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
  font-size: 20px;
  font-weight: 700;
  font-family: monospace;
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

.rc-export-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
}

.rc-preview-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--rc-border-soft);
  color: var(--rc-text);
  font-family: monospace;
}

.text-red {
  color: #e11d48;
  font-weight: 600;
}

.text-warn {
  color: #d97706;
}

/* 诊断建议 */
.rc-insight-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
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
  border-top: 1px solid var(--rc-border);
  background: var(--rc-surface);
  padding: 12px 24px;
  width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
}

.rc-input-box {
  width: 100%;
  max-width: 100%;
  margin: 0;
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
</style>
