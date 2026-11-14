<script setup lang="ts">
// AI 智能问数（Agent 交互对话工作台）
// 位于「问数配置」分组，支持 Text-to-SQL、多轮主动澄清与问答、思考链展示、KPI指标卡片、图表与明细切换
import { ref, computed, nextTick, onMounted } from 'vue'
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
  type AiSessionItem,
  type ChatMessage,
  type Clarification,
  type PieSlice,
} from '@/api/aiChat'
import { downloadCsv, toCsv, csvDateTag, type CsvCell } from '@/utils/csv'
import { downloadXlsx, exportDateTag, type XlsxCell } from '@/utils/format/xlsxExport'
import ClarificationCard from './ClarificationCard.vue'
import AiPieChart from './AiPieChart.vue'

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

// 会话列表与当前活动会话（'new' 代表进入新建会话页面）
const sessions = ref<AiSessionItem[]>([])
const activeSessionId = ref<string>('s1')
const searchSessionKeyword = ref<string>('')

// 输入框与发送参数
const promptText = ref<string>('')
const enableReasoning = ref<boolean>(true)
const enableAutoChart = ref<boolean>(true)
const isSending = ref<boolean>(false)
const currentAbortController = ref<AbortController | null>(null)

// 视图切换与思考链折叠（支持趋势柱状、占比饼图与明细数据表）
const activeDataView = ref<'chart' | 'pie' | 'table'>('chart')
const isThinkingExpanded = ref<boolean>(true)
const chatContainerRef = ref<HTMLElement | null>(null)

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

// 静态会话消息库
const sessionMessages = ref<Record<string, ChatMessage[]>>({
  s1: [
    {
      id: 'm1-1',
      role: 'user',
      content: '帮我排查一下最近的异常任务数据。',
      createdAt: '今天 15:35',
    },
    {
      id: 'm1-2',
      role: 'assistant',
      content:
        '👋 收到您的排查诉求：由于采集平台的「异常任务」涵盖不同故障阶段与业务口径，为了给您生成最准确的 SQL 与分析结论，请选择本次排查涉及的表（可多选）：',
      createdAt: '今天 15:35',
      clarification: {
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
      },
      thinking: {
        completed: true,
        durationMs: 1100,
        steps: [
          '采纳用户澄清口径：抓取网络层异常，聚合时段 = NOW() - INTERVAL 7 DAY',
          '定位数据表：ck_source_log (记录失败原因)，关联 sys_site 提取站点名称',
          'SQL 审查通过，执行耗时 82ms，扫描 32,450 行数据。',
        ],
      },
      sql: {
        code: `SELECT 
    s.site_name AS "网站名称",
    COUNT(l.log_id) AS "总采集任务数",
    SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END) AS "成功数",
    ROUND(SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(l.log_id), 2) AS "采集成功率(%)"
FROM ck_source_log l
LEFT JOIN sys_site s ON l.site_id = s.site_id
WHERE l.create_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY s.site_id, s.site_name
ORDER BY "采集成功率(%)" ASC
LIMIT 10;`,
        execTimeMs: 82,
        scanRows: 32450,
      },
      kpis: [
        { label: '7天平均成功率', value: '97.45%', subtext: '↑ 较上周提升 +1.2%', type: 'success' },
        { label: '总采集样本量', value: '142,580 次', subtext: '覆盖全站 26 个源', type: 'normal' },
        { label: '网络异常最多网站', value: '行业资讯网', subtext: '成功率仅 68.20% (失败 412 次)', type: 'danger' },
      ],
      chartData: {
        title: '📊 网络层失败率最高 TOP 3 网站对比',
        pieTitle: '🥧 异常任务网络故障成因占比分布',
        bars: [
          { label: '1. 行业资讯网 (主要报错: HTTP 403 触发 IP 防火墙)', value: 68.2, displayValue: '68.20%', color: 'red' },
          { label: '2. 地方科技信息通报 (主要报错: Read timed out 响应超时)', value: 81.5, displayValue: '81.50%', color: 'orange' },
          { label: '3. 某商业招标采购网 (主要报错: Connection reset 连接重置)', value: 87.3, displayValue: '87.30%', color: 'orange' },
        ],
        slices: [
          { label: '行业资讯网 (403阻断)', value: 412, displayValue: '412 次 (32.8%)', color: '#dc2626', tone: 'err' },
          { label: '某商业招标采购网 (连接重置)', value: 447, displayValue: '447 次 (35.6%)', color: '#ea580c', tone: 'orange' },
          { label: '地方科技信息通报 (响应超时)', value: 396, displayValue: '396 次 (31.6%)', color: '#f59e0b', tone: 'amber' },
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
          { siteName: '地方科技信息通报', total: '2,140', success: '1,744', fail: '396', reason: 'SocketTimeoutException' },
          { siteName: '某商业招标采购网', total: '3,520', success: '3,073', fail: '447', reason: 'ConnectionReset' },
        ],
      },
      insights: [
        '针对 行业资讯网：集中在每日上午 09:00~11:00 触发 403，建议启用动态隧道代理并设置随机延时（3~8秒）；',
        '针对 地方科技信息通报：超时集中在详情页长文本抓取，建议将超时阈值从 15s 调宽至 30s。',
      ],
      suggestions: [
        '帮我把上面失败率最高的前3个网站的数据导出为CSV表格',
        '给成功率低于85%的网站自动生成告警规则配置',
      ],
    },
  ],
  s2: [
    {
      id: 'm2-1',
      role: 'user',
      content: '统计各网站近 3 天平均抓取耗时与并发量分布情况',
      createdAt: '3天前 11:15',
    },
    {
      id: 'm2-2',
      role: 'assistant',
      content: '已完成各网站响应延时、并发 Worker 负载与 P95/P99 耗时计算：',
      createdAt: '3天前 11:15',
      thinking: {
        completed: true,
        durationMs: 780,
        steps: [
          '计算近 3 天日志表 ck_source_log 的响应耗时指标：AVG、P95',
          '按站点维度聚合统计，并关联调度集群统计实时运行 Worker 数',
          '标记耗时超过 15 秒的慢请求站点',
        ],
      },
      sql: {
        code: `SELECT 
    s.site_name AS "站点名称",
    ROUND(AVG(l.cost_time_ms), 1) AS "平均耗时(ms)",
    ROUND(quantile(0.95)(l.cost_time_ms), 1) AS "P95耗时(ms)",
    MAX(l.cost_time_ms) AS "最大耗时(ms)"
FROM ck_source_log l
JOIN sys_site s ON l.site_id = s.site_id
WHERE l.create_time >= DATE_SUB(NOW(), INTERVAL 3 DAY)
GROUP BY s.site_name
ORDER BY "平均耗时(ms)" DESC
LIMIT 10;`,
        execTimeMs: 112,
        scanRows: 48900,
      },
      kpis: [
        { label: '全网平均响应耗时', value: '1,420 ms', subtext: '处于正常响应区间', type: 'success' },
        { label: '最慢响应站点', value: '科技政策公开网', subtext: '平均耗时 18.6 秒', type: 'danger' },
        { label: '峰值并发 Worker 数', value: '64 节点', subtext: '集群资源利用率 72%', type: 'normal' },
      ],
      chartData: {
        title: '📊 响应耗时最长 TOP 3 网站对比',
        pieTitle: '🥧 慢请求站点耗时与超时重试占比',
        bars: [
          { label: '1. 科技政策公开网 (平均 18.6s)', value: 92, displayValue: '18,600 ms', color: 'red' },
          { label: '2. 产经统计公报网 (平均 12.4s)', value: 68, displayValue: '12,400 ms', color: 'orange' },
          { label: '3. 地方企业信用公示 (平均 8.1s)', value: 45, displayValue: '8,100 ms', color: 'orange' },
        ],
        slices: [
          { label: '科技政策公开网 (>15s)', value: 190, displayValue: '190 次 (44.2%)', color: '#dc2626', tone: 'err' },
          { label: '产经统计公报网 (JS延迟)', value: 120, displayValue: '120 次 (27.9%)', color: '#ea580c', tone: 'orange' },
          { label: '地方企业信用公示 (验证码)', value: 120, displayValue: '120 次 (27.9%)', color: '#f59e0b', tone: 'amber' },
        ],
        tableColumns: [
          { prop: 'siteName', label: '网站名称' },
          { prop: 'total', label: '总请求量' },
          { prop: 'success', label: '正常响应' },
          { prop: 'fail', label: '超时重试' },
          { prop: 'reason', label: '延迟成因' },
        ],
        tableRows: [
          { siteName: '科技政策公开网', total: '3,200', success: '3,010', fail: '190', reason: '页面加载过大(超15MB)' },
          { siteName: '产经统计公报网', total: '4,100', success: '3,980', fail: '120', reason: '动态JS渲染迟缓' },
          { siteName: '地方企业信用公示', total: '2,900', success: '2,810', fail: '90', reason: '验证码加载延迟' },
        ],
      },
      insights: [
        '慢响应主要由于目标站点采用了无分页的超大 HTML 页面返回，建议开启按需流式解析模式；',
        '建议针对耗时大于 15s 的站点调整单任务超时阈值，避免占用过多 Worker 连接。',
      ],
      suggestions: [
        '将科技政策公开网抓取超时时间调整为 30s',
        '启用 Headless 浏览器资源加载拦截规则',
      ],
    },
  ],
  s3: [
    {
      id: 'm3-1',
      role: 'user',
      content: '分析昨日异常抓取任务 TOP 10 网站分布及主要错误类型',
      createdAt: '昨天 17:20',
    },
    {
      id: 'm3-2',
      role: 'assistant',
      content: '已为您提取昨日全站采集异常日志，完成错误分类聚合与排序下钻：',
      createdAt: '昨天 17:20',
      thinking: {
        completed: true,
        durationMs: 850,
        steps: [
          '时间范围对齐：昨日 00:00:00 至 23:59:59',
          '按 site_name 聚合失败日志，统计各站点主要错误码分布',
          '过滤心跳探测任务，按失败数降序取 TOP 10 异常站点',
        ],
      },
      sql: {
        code: `SELECT 
    s.site_name AS "站点名称",
    COUNT(l.log_id) AS "失败总次数",
    l.err_code AS "主要报错原因",
    ROUND(COUNT(l.log_id) * 100.0 / SUM(COUNT(l.log_id)) OVER(), 2) AS "全站占比(%)"
FROM ck_source_log l
JOIN sys_site s ON l.site_id = s.site_id
WHERE l.status = 0 AND l.create_time >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
GROUP BY s.site_name, l.err_code
ORDER BY "失败总次数" DESC
LIMIT 10;`,
        execTimeMs: 65,
        scanRows: 18200,
      },
      kpis: [
        { label: '昨日抓取失败总量', value: '3,428 次', subtext: '全站失败率 2.4%', type: 'danger' },
        { label: '高频异常站点数', value: '10 个', subtext: '覆盖财经资讯与招标公示', type: 'normal' },
        { label: '首要故障原因', value: 'HTTP 403 阻断', subtext: '单日触发 1,980 次 (57.7%)', type: 'danger' },
      ],
      chartData: {
        title: '📊 昨日异常抓取任务 TOP 3 网站失败量对比',
        pieTitle: '🥧 昨日主要故障原因与失败量占比',
        bars: [
          { label: '1. 宏观商业智库 (HTTP 403 反爬拦截)', value: 890, displayValue: '890 次', color: 'red' },
          { label: '2. 地方招投标公示台 (Gateway 504 超时)', value: 654, displayValue: '654 次', color: 'orange' },
          { label: '3. 医药信息技术网 (SSL 握手拒绝)', value: 432, displayValue: '432 次', color: 'orange' },
        ],
        slices: [
          { label: '宏观商业智库 (403反爬)', value: 890, displayValue: '890 次 (45.0%)', color: '#dc2626', tone: 'err' },
          { label: '地方招投标公示台 (504超时)', value: 654, displayValue: '654 次 (33.1%)', color: '#ea580c', tone: 'orange' },
          { label: '医药信息技术网 (SSL拒绝)', value: 432, displayValue: '432 次 (21.9%)', color: '#f59e0b', tone: 'amber' },
        ],
        tableColumns: [
          { prop: 'siteName', label: '网站名称' },
          { prop: 'total', label: '总任务数' },
          { prop: 'success', label: '成功数' },
          { prop: 'fail', label: '失败数' },
          { prop: 'reason', label: '主要异常码' },
        ],
        tableRows: [
          { siteName: '宏观商业智库', total: '1,200', success: '310', fail: '890', reason: 'HTTP 403 Forbidden' },
          { siteName: '地方招投标公示台', total: '1,500', success: '846', fail: '654', reason: 'Gateway Timeout (504)' },
          { siteName: '医药信息技术网', total: '800', success: '368', fail: '432', reason: 'SSL Handshake Failed' },
        ],
      },
      insights: [
        '昨日异常主要集中于 08:30~10:00 早高峰期，「宏观商业智库」开启了严格 IP 频控，建议调配商业高匿代理池；',
        '「地方招投标公示台」由于详情页并发下载过载导致 504，建议限制单站点并发 Worker 数为 2。',
      ],
      suggestions: [
        '一键将宏观商业智库切换为专属代理通道',
        '为地方招投标公示台调整任务并发上限至 2',
      ],
    },
  ],
  s4: [
    {
      id: 'm4-1',
      role: 'user',
      content: '查看清洗规则命中率与 XPath 提取失败率报表',
      createdAt: '5天前 09:30',
    },
    {
      id: 'm4-2',
      role: 'assistant',
      content: '已为您汇总清洗规则执行记录与字段提取质量审计结果：',
      createdAt: '5天前 09:30',
      thinking: {
        completed: true,
        durationMs: 760,
        steps: [
          '扫描清洗日志表 ck_clean_error 与规则执行明细',
          '计算字段级命中率 = (总提取数 - 字段为空数) / 总提取数',
          '按照规则模板维度聚合展示提取质量',
        ],
      },
      sql: {
        code: `SELECT 
    r.rule_name AS "规则名称",
    COUNT(c.clean_id) AS "清洗总次数",
    SUM(CASE WHEN c.field_val IS NOT NULL AND c.field_val != '' THEN 1 ELSE 0 END) AS "有效提取数",
    ROUND(SUM(CASE WHEN c.field_val IS NOT NULL AND c.field_val != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(c.clean_id), 2) AS "规则命中率(%)"
FROM sys_clean_log c
JOIN sys_rule r ON c.rule_id = r.rule_id
WHERE c.create_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY r.rule_name
ORDER BY "规则命中率(%)" ASC
LIMIT 10;`,
        execTimeMs: 76,
        scanRows: 24100,
      },
      kpis: [
        { label: '规则总体命中率', value: '98.20%', subtext: '较昨日持平', type: 'success' },
        { label: '清洗空值异常数', value: '182 条', subtext: '主要影响作者与发布时间字段', type: 'danger' },
        { label: '涉及改版模板数', value: '2 个', subtext: '建议进入规则中心核验 XPath', type: 'normal' },
      ],
      chartData: {
        title: '📊 提取命中率较低的规则 TOP 3 对比',
        pieTitle: '🥧 清洗空值异常成因分布占比',
        bars: [
          { label: '1. 财经新闻正文抽取 (命中率 84.5%)', value: 84.5, displayValue: '84.50%', color: 'orange' },
          { label: '2. 标讯发布时间解析 (命中率 88.2%)', value: 88.2, displayValue: '88.20%', color: 'orange' },
          { label: '3. 附件下载链接抽取 (命中率 96.0%)', value: 96.0, displayValue: '96.00%', color: 'green' },
        ],
        slices: [
          { label: 'DOM 结构变更/class改名', value: 868, displayValue: '868 条 (58.4%)', color: '#dc2626', tone: 'err' },
          { label: '日期格式变更包含周几', value: 449, displayValue: '449 条 (30.2%)', color: '#ea580c', tone: 'orange' },
          { label: '详情页无附件标签', value: 168, displayValue: '168 条 (11.4%)', color: '#16a34a', tone: 'ok' },
        ],
        tableColumns: [
          { prop: 'siteName', label: '规则/模板名称' },
          { prop: 'total', label: '总执行数' },
          { prop: 'success', label: '有效提取' },
          { prop: 'fail', label: '空值异常' },
          { prop: 'reason', label: '失效成因' },
        ],
        tableRows: [
          { siteName: '财经新闻正文抽取', total: '5,600', success: '4,732', fail: '868', reason: 'DOM 结构变更，class 改名' },
          { siteName: '标讯发布时间解析', total: '3,800', success: '3,351', fail: '449', reason: '日期格式变更包含周几' },
          { siteName: '附件下载链接抽取', total: '4,200', success: '4,032', fail: '168', reason: '部分详情页无附件标签' },
        ],
      },
      insights: [
        '「财经新闻正文抽取」模板由于目标网站上周升级为单页前端应用导致特定类名消失，建议使用通用正文提取算法；',
        '「标讯发布时间解析」建议增加对「2026年11月10日 星期二」格式的兼容正则。',
      ],
      suggestions: [
        '一键跳转到规则资产配置页面修正 XPath',
        '重跑近 24 小时清洗失败的数据记录',
      ],
    },
  ],
})

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
  const res = await listAiSessions()
  sessions.value = [...res]
  if (sessions.value.length > 0) {
    activeSessionId.value = 's1'
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

// 确认澄清：锁定卡片，把「选了哪几张表」按 entryTypeId 回传给智能体会话
async function handleConfirmClarify(payload: { selectedEntryTypeIds: number[]; freeText: string }) {
  if (clarifyConfirmed.value) return
  clarifyConfirmed.value = true
  selectedTables.value = currentClarification.value.options
    .filter((option) => payload.selectedEntryTypeIds.includes(option.entryTypeId))
    .map((option) => option.typeName || option.tableName)

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
    thinking: enableReasoning.value
      ? {
          completed: false,
          durationMs: 0,
          steps: [],
        }
      : undefined,
  }
  list.push(assistantMsg)
  scrollToBottom()

  const abortCtrl = new AbortController()
  currentAbortController.value = abortCtrl
  const startTime = Date.now()

  try {
    await streamAgentChat(
      {
        msg: content,
        signal: abortCtrl.signal,
      },
      (event) => {
        if (event.type === 'chunk') {
          assistantMsg.content += event.text
          scrollToBottom()
        } else if (event.type === 'reasoning') {
          if (!assistantMsg.thinking) {
            assistantMsg.thinking = { completed: false, durationMs: 0, steps: [] }
          }
          assistantMsg.thinking.steps.push(event.reasoning)
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
  } catch (err) {
    const failure = err as { name?: string; message?: string }
    if (failure.name !== 'AbortError') {
      const errMsg = failure.message || '智能体问数服务调用失败'
      if (!assistantMsg.content) {
        assistantMsg.content = `抱歉，未能完成本次问数：${errMsg}`
      }
    }
  } finally {
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
        <div class="rc-topbar-right">
          <el-tag size="small" type="info" effect="light" class="rc-mode-tag">
            智能体：只读数据分析专家 (ClickHouse & MySQL)
          </el-tag>
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
              <!-- 引导/说明文字 -->
              <div v-if="msg.content" class="rc-clarify-intro">
                {{ msg.content }}
              </div>

              <!-- 多选表澄清卡片：仅在包含澄清配置的会话轮次展示 -->
              <ClarificationCard
                v-if="msg.clarification"
                :key="clarifyCardKey"
                :clarification="currentClarification"
                :confirmed="clarifyConfirmed"
                @confirm="handleConfirmClarify"
              />

              <!-- 用户确认后或无需澄清时的执行结果呈现区 -->
              <transition name="el-fade-in-linear">
                <div
                  v-if="!msg.clarification || clarifyConfirmed"
                  class="rc-confirmed-result"
                >
                  <!-- 思考过程面板 -->
                  <div v-if="msg.thinking" class="rc-thinking-box">
                    <div
                      class="rc-thinking-header"
                      @click="isThinkingExpanded = !isThinkingExpanded"
                    >
                      <div class="rc-thinking-title">
                        <span class="rc-live-dot green"></span>
                        <span>思考过程 · 已根据所选口径对齐并执行 SQL (耗时 {{ msg.thinking.durationMs / 1000 }}s)</span>
                      </div>
                      <span class="rc-toggle-arrow" :class="{ collapsed: !isThinkingExpanded }">▼</span>
                    </div>
                    <div v-if="isThinkingExpanded" class="rc-thinking-body">
                      <div v-if="selectedTables.length">
                        ✓ 1. 采纳用户澄清口径：<strong>{{ selectedTables.join('、') }}</strong>，聚合时段 = <code>NOW() - INTERVAL 7 DAY</code>
                      </div>
                      <div v-for="(step, idx) in msg.thinking.steps" :key="idx">
                        ✓ {{ idx + (selectedTables.length ? 2 : 1) }}. {{ step }}
                      </div>
                    </div>
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
              <el-checkbox v-model="enableReasoning" label="深度思维(Reasoning)" size="small" />
              <el-checkbox v-model="enableAutoChart" label="自动生成图表" size="small" />
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
  gap: 12px;
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
