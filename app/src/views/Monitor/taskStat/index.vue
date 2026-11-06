<script setup lang="ts">
// 任务统计 —— 1:1 迁移旧 data-view `src/page/inst/TaskStat.vue`（路由 /inst/task-stat，标题「任务统计」）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   页头：标题 + 问号帮助 +（查过之后）「本次查询 Xms · 更新于 HH:mm:ss」+「自动刷新」开关（60s）
//   搜索栏：快捷时间(今天/昨天/近7天/近30天/自定义…) + 自定义时展开的[时间范围 datetimerange + 指定日期]
//           + 分组维度(按来源/按配置/来源+配置) + 来源ID过滤 + 配置ID过滤 + 状态过滤(16 项，不选=双重视角)
//           + [查询] [重置]
//   提示条：查询失败（可点此重试）/ 已按状态过滤（错误率、ERROR 分布、状态构成图暂不适用）
//   指标卡：任务总数(蓝) + [不限状态时] ERROR 任务数(红) / 错误率(琥珀，环形进度) / 涉及分组数(绿)
//           [状态过滤时] 涉及分组数(青) / 最大分组任务数(橙)
//   告警条：错误率 ≥ 阈值分组（默认 100）的 chips（前 8 个可点，>8 提示看明细表）
//   图表：任务状态构成(环图，仅不限状态) + 总任务分布(TOP10 柱) + ERROR 分布(TOP10 柱，仅不限状态)
//   明细表：#, 来源ID, 配置ID, 任务数, 任务占比, [ERROR数, 错误率], 操作(任务明细 | 错误明细)
//           错误率 100% 的行整行标红；点行 = 打开「任务明细」
//   表头 extra：「错误率 ≥」预设 100/90/80/70/60/50 + 自定义输入 + 清除 + 筛出 N 个；导出（全部/当前视图）
//   分页：filteredRows ≤ 10 不出现分页器；否则 pageSize 20，选项 10/20/50/100，共 N 条 + 快速跳页
//   接口：taskStat → GET /v1/task/stat（date | startTime+endTime、group、sourceId、configId、state）
//
// ⚠️ 旧页最复杂的一块是**请求编排 + 后端能力探测**（statCapability），这里 1:1 保留：
//   · 'v2'（后端支持多状态聚合）= 2 请求模式：total + state=E,C,AC,W1,W,L（响应行带 state 字段）
//   · 'v1'（历史版本）= 7 请求模式：total + E + 其余关键状态各一发
//   · 未探测 → 先发多状态请求兼任探测：行里有 state → v2；行里没有 → v1 并**补发**
//     （先渲染总数 → 补 E → 再后台取其余状态）；空数组无法区分新旧后端，不锁定能力、下次再探。
//   同参数还有一层**会话内快速缓存**（quickCache）：命中先渲染旧数据再后台刷新，避免白屏。
//
// 有意偏差（交付说明里单列）：
//   1. 导出：旧页用 xlsx-style 生成**带样式的 .xlsx**；新项目没有 xlsx 写库（@lucky-office/excel 只是预览组件），
//      改用平台既定的前端 CSV 导出（`utils/csv`，带 BOM 与公式注入转义），把旧 output 的 4 行说明放在文件顶部，
//      表头与列语义保持不变。按钮文案仍是「导出Excel」（与旧页一致），实际落地 .csv。
//   2. 图表：旧页用 v-chart（ant-design-vue 的 viser/g2）。新项目 package.json 里**没有**任何图表依赖，
//      为了不外溢依赖面，环图与柱状图在 StatePieChart.vue / TopBarChart.vue 里用 SVG 重画
//      （环图内/外比例沿用 0.6/0.8，柱状图沿用 y 轴 5 档 + 旋转 x 标签 + 悬停 tooltip）。
//   3. 请求取消：旧层用 axios CancelToken，新 client 只认 AbortSignal，改用 AbortController（语义一致：
//      新一轮查询取消上一轮未完成的请求，并用递增序号丢弃过期响应）。
//   4. 排序：旧页 a-table 的 sorter 是**客户端全量排序**（先排序再分页）。el-table 自带排序只作用于传入的
//      data，而这里 data 是分页后的一页 → 会退化成"只排当前页"。故自己维护排序状态（sortable="custom"
//      + @sort-change），在全量 filteredRows 上排序后再分页，与原行为等价；比较器照抄旧页（任务占比比 cnt）。
//   5. 「任务明细 / 错误明细」：旧页 $multiTab.open('/inst/task-list?...') 开新标签；新平台的监控中心是
//      单页签容器，改为 router.push 到 /monitor?tab=taskList 并带上 sourceId/configId/state
//      （taskList 侧已支持读这些路由参数做初始筛选）。旧页传的也只有这三个，时间范围本来就不透传（旧页注释）。
//   6. 指标卡的图标：旧页是 antd 的 iconfont（fund / close-circle / cluster / trophy），新平台没有这套
//      图标字体，用等价的 Element Plus 图标替代（Histogram / CircleClose / Grid / Trophy；错误率卡沿用环形进度），
//      位置与配色不变。
//   7. 卡片加载态：旧页 a-card 的 loading 是 antd 的转圈遮罩；这里按产品要求换成 Element Plus 骨架屏
//      （CardSkeleton.vue，el-skeleton 包住真实内容：指标卡复刻「图标+三行」、图表卡复刻整块图表区）。
//      只有卡片用骨架屏，**明细表的 v-loading 保持不动**（表格有固定表头，骨架屏反而会顶掉表头）。
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search,
  Refresh,
  Warning,
  QuestionFilled,
  CircleCloseFilled,
  Download,
  CircleClose,
  Grid,
  Histogram,
  Trophy,
} from '@element-plus/icons-vue'
import { taskStat, type TaskStatGroup, type TaskStatRow } from '@/api/taskStat'
import { csvCell, downloadCsv } from '@/utils/csv'
import { HELP_TEXT, PIE_OTHER_NOTE, RATE_PRESETS, STAT_STATE_OPTIONS, emptyText, statColumns } from './columns'
import {
  PIE_STATES,
  alertRowsOf,
  clampRange30,
  dayStart,
  errorBarData as errorBarsOf,
  errorColor,
  filteredRowsOf,
  fmtDate,
  fmtDateTag,
  fmtDateTime,
  fmtMonthDay,
  fmtTimeTag,
  groupLabel,
  mergeRows,
  percentOf,
  pieSlices,
  progressOf,
  quickRange,
  rateActiveOf,
  thresholdOf,
  topBarData as topBarsOf,
  toNum,
  type StatRow,
} from './stat'
import StatePieChart from './StatePieChart.vue'
import TopBarChart from './TopBarChart.vue'
import CardSkeleton from './CardSkeleton.vue'

defineOptions({ name: 'TaskStat' })

const route = useRoute()
const router = useRouter()

type TimeMode = 'today' | 'yesterday' | '7d' | '30d' | 'custom'

// ---- 查询条件 ----
const timeMode = ref<TimeMode>('today')
/** 自定义时间范围（旧 a-range-picker，format YYYY-MM-DD HH:mm:ss） */
const rangeValue = ref<[string, string] | null>(null)
/** 指定日期（旧 a-date-picker，与时间范围互斥；默认当天） */
const dateValue = ref<string>(fmtDate(dayStart()))
const queryParam = reactive({
  group: 'source' as TaskStatGroup,
  sourceId: '',
  configId: '',
  /** '' = 不限（总任务与 ERROR 双重视角） */
  state: '',
})

// ---- 数据与状态 ----
const loading = ref(false)
const pieLoading = ref(false)
const rows = ref<StatRow[]>([])
const stateCounts = ref<Record<string, number>>({})
const errorMsg = ref('')
const lastQueryMs = ref(0)
const updatedAt = ref('')
/** 错误率阈值筛选：'' = 关闭；数值 = 只看「错误率 ≥ 该值」的分组 */
const errThreshold = ref<number | ''>('')
const autoRefresh = ref(false)
const autoRefreshing = ref(false)

// ---- computed（顺序与旧页一致，便于逐条比对）----
/** 指定了单一状态过滤时，ERROR 双重视角不适用 */
const stateFiltered = computed(() => !!queryParam.state)
const totalCnt = computed(() => rows.value.reduce((sum, item) => sum + item.cnt, 0))
const errorCnt = computed(() => rows.value.reduce((sum, item) => sum + item.errorCnt, 0))
const errorRate = computed(() => (totalCnt.value ? Number(((errorCnt.value / totalCnt.value) * 100).toFixed(2)) : 0))
const maxCnt = computed(() => (rows.value.length ? Math.max(...rows.value.map((item) => item.cnt)) : 0))
const thresholdRate = computed(() => thresholdOf(errThreshold.value))
const rateActive = computed(() => rateActiveOf(errThreshold.value))
const alertRows = computed(() => alertRowsOf(rows.value, thresholdRate.value))
const filteredRows = computed(() => filteredRowsOf(rows.value, errThreshold.value))
const topLabel = computed(() => (rows.value.length ? groupLabel(rows.value[0], queryParam.group) : ''))
const groupTitle = computed(() => ({ source: '按来源', config: '按配置', both: '来源+配置' })[queryParam.group])
const timeDesc = computed(() => {
  const range = rangeValue.value
  if (range && range[0] && range[1]) {
    const s = new Date(range[0].replace(' ', 'T'))
    const e = new Date(range[1].replace(' ', 'T'))
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) return `${fmtMonthDay(s)} ~ ${fmtMonthDay(e)}`
  }
  if (dateValue.value) return dateValue.value
  return '今天'
})
const totalBarData = computed(() => topBarsOf(rows.value, queryParam.group))
const errorBarData = computed(() => errorBarsOf(rows.value, queryParam.group))
const statePieData = computed(() => (stateFiltered.value ? [] : pieSlices(stateCounts.value, totalCnt.value)))
const columns = computed(() => statColumns(stateFiltered.value, rateActive.value))
const emptyLabel = computed(() => emptyText(rateActive.value, thresholdRate.value))

// ---- 明细表：排序（旧页是全量排序）+ 分页（旧页 filteredRows ≤ 10 时不出现分页器）----
const page = ref(1)
const size = ref(20)
const sortProp = ref<string | null>(null)
const sortOrder = ref<'ascending' | 'descending' | null>(null)
const defaultSort = computed(() =>
  sortProp.value && sortOrder.value ? { prop: sortProp.value, order: sortOrder.value } : undefined,
)
/** 旧页各列 sorter 的口径：任务数/任务占比都按 cnt，ERROR 数按 errorCnt，错误率按 errorRate */
function sortValue(row: StatRow, prop: string): number {
  if (prop === 'errorCnt') return row.errorCnt
  if (prop === 'errorRate') return row.errorRate
  return row.cnt
}
const sortedRows = computed(() => {
  const list = filteredRows.value
  if (!sortProp.value || !sortOrder.value) return list
  const dir = sortOrder.value === 'ascending' ? 1 : -1
  const prop = sortProp.value
  return list.slice().sort((a, b) => (sortValue(a, prop) - sortValue(b, prop)) * dir)
})
const showPager = computed(() => filteredRows.value.length > 10)
const pagedRows = computed(() =>
  showPager.value ? sortedRows.value.slice((page.value - 1) * size.value, page.value * size.value) : sortedRows.value,
)
const tableKey = computed(() => `stat-table-${rateActive.value ? errThreshold.value : 'all'}`)
function onSortChange(payload: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  sortProp.value = payload.order ? payload.prop : null
  sortOrder.value = payload.order
  page.value = 1
}
// 行数变少（改阈值/换条件）后可能停在不存在的页码上，回到第 1 页
watch(
  () => filteredRows.value.length,
  (n) => {
    const maxPage = Math.max(1, Math.ceil(n / size.value))
    if (page.value > maxPage) page.value = 1
  },
)
// 旧页 `:key="'stat-table-' + (rateActive ? errThreshold : 'all')"` 重建表格：开启阈值筛选时
// 「错误率」列默认降序（defaultSortOrder='descend'），关掉时恢复无排序
watch(rateActive, (on) => {
  sortProp.value = on ? 'errorRate' : null
  sortOrder.value = on ? 'descending' : null
  page.value = 1
})

// ---- 请求编排（旧页 handleQuery 的 1:1 复刻）----
/** 查询序号：递增后旧响应一律丢弃 */
let querySeq = 0
let abortCtrl: AbortController | null = null
/** 后端能力（会话内永久生效）：'v2' 支持多状态聚合 / 'v1' 历史版本 / null 未探测 */
let statCapability: 'v1' | 'v2' | null = null
/** 同参数快速缓存：本次会话内重进页面/重复查询先渲染缓存，再后台刷新 */
const quickCache: {
  key: string | null
  rows: StatRow[] | null
  stateCounts: Record<string, number> | null
  at: string | null
} = { key: null, rows: null, stateCounts: null, at: null }

const nowStamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e ?? '未知错误'))
/** 新 client 把取消包进了 ApiError，原始 AbortError 在 cause 上 */
const isAbort = (e: unknown) => {
  const cause = (e as { cause?: { name?: string } } | null)?.cause
  return cause?.name === 'AbortError' || (e as Error | null)?.name === 'AbortError'
}

/** 组装配参（旧页 buildParams）：时间范围 > 指定日期 > 默认当天；空值不下发 */
function buildParams(): Record<string, string> {
  const params: Record<string, string> = {}
  const range = rangeValue.value
  if (range && range[0] && range[1]) {
    params.startTime = range[0]
    params.endTime = range[1]
  } else if (range && range[0]) {
    params.startTime = range[0]
  } else if (range && range[1]) {
    params.endTime = range[1]
  } else if (dateValue.value) {
    params.date = dateValue.value
  }
  if (queryParam.group) params.group = queryParam.group
  if (queryParam.sourceId.trim()) params.sourceId = queryParam.sourceId.trim()
  if (queryParam.configId.trim()) params.configId = queryParam.configId.trim()
  if (queryParam.state) params.state = queryParam.state
  return params
}

/** 带计时的统计请求（同一 AbortSignal，便于统一取消） */
function statReq(params: Record<string, string>, label: string) {
  const t0 = performance.now()
  return taskStat(params, abortCtrl?.signal).then((res) => {
    if (import.meta.env.DEV) console.warn(`[stat] ${label}: ${Math.round(performance.now() - t0)}ms`)
    return res
  })
}

type Settled = { ok: true; v: TaskStatRow[] } | { ok: false; e: unknown }
const settle = (p: Promise<TaskStatRow[]>): Promise<Settled> =>
  p.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e }),
  )

async function handleQuery() {
  const params = buildParams()
  const seq = ++querySeq
  abortCtrl?.abort()
  abortCtrl = new AbortController()
  const key = JSON.stringify(params)

  // 同参数快速缓存命中：先渲染旧数据，避免白屏等待
  if (quickCache.key === key && quickCache.rows) {
    rows.value = quickCache.rows
    stateCounts.value = quickCache.stateCounts ?? {}
    updatedAt.value = quickCache.at ?? ''
    lastQueryMs.value = 0
    loading.value = false
    errorMsg.value = ''
  } else {
    loading.value = true
  }
  errorMsg.value = ''

  const t0 = performance.now()
  const reqs: Promise<Settled>[] = [settle(statReq(params, 'total'))]
  const probing = !stateFiltered.value && statCapability !== 'v1'
  if (!stateFiltered.value) {
    if (statCapability === 'v1') {
      reqs.push(settle(statReq({ ...params, state: 'E' }, 'state=E')))
    } else {
      // v2 或未探测：发多状态请求（未探测时兼任探测）
      reqs.push(
        settle(statReq({ ...params, state: PIE_STATES.join(',') }, probing ? 'multi-state(probe)' : 'multi-state')),
      )
    }
  }

  try {
    const [totalRes, subRes] = await Promise.all(reqs)
    if (seq !== querySeq) return
    // 总数请求失败 = 真实错误（不参与能力判定）
    if (!totalRes.ok) {
      if (isAbort(totalRes.e)) return
      rows.value = []
      stateCounts.value = {}
      errorMsg.value = '查询失败: ' + errText(totalRes.e)
      return
    }
    const all = totalRes.v
    if (stateFiltered.value) {
      // 单一状态过滤：只有总数一路
      applyMain(all, [], seq, key, t0)
      return
    }
    if (!subRes) return
    if (!subRes.ok) {
      if (isAbort(subRes.e)) return
      // 第二路失败：仅在探测期视为旧后端（静默回退），已定 v2 时是真实错误
      if (statCapability === null) {
        statCapability = 'v1'
        if (import.meta.env.DEV) console.warn('[stat] 多状态探测失败，回退 v1: ', subRes.e)
        backfillV1(params, all, seq, key, t0)
      } else {
        rows.value = []
        stateCounts.value = {}
        errorMsg.value = '查询失败: ' + errText(subRes.e)
      }
      return
    }
    const sub = subRes.v
    if (!probing) {
      // 能力已确定：v2 用多状态响应直接消费；v1 走历史路径
      if (statCapability === 'v2') {
        consumeMulti(all, sub, seq, key, t0)
      } else {
        applyMain(all, sub, seq, key, t0)
        void loadStatePie(params, sub, seq)
      }
      return
    }
    // 探测期：多状态响应行带 state 字段 → v2；否则回退 v1
    const hasState = sub.length > 0 && sub[0].state !== undefined
    if (hasState) {
      statCapability = 'v2'
      if (import.meta.env.DEV) console.warn('[stat] 后端支持多状态聚合(v2)，已切换为 2 请求模式')
      consumeMulti(all, sub, seq, key, t0)
    } else {
      if (sub.length > 0) {
        statCapability = 'v1'
        if (import.meta.env.DEV) console.warn('[stat] 后端为历史版本(v1)，保持 7 请求模式')
      }
      // 空数组无法区分新旧后端（该时段可能恰好无关键状态任务），暂不固定能力，下次再探测
      backfillV1(params, all, seq, key, t0)
    }
  } catch (err) {
    // settle 包装后理论不可达，仅作兜底
    if (isAbort(err) || seq !== querySeq) return
    rows.value = []
    stateCounts.value = {}
    errorMsg.value = '查询失败: ' + errText(err)
  } finally {
    if (seq === querySeq) {
      loading.value = false
      autoRefreshing.value = false
    }
  }
}

/** 汇总主数据（合并 total + error 行），刷新缓存与更新时间 */
function applyMain(all: TaskStatRow[], errRows: TaskStatRow[], seq: number, key: string, t?: number) {
  if (seq !== querySeq) return
  const merged = mergeRows(all, errRows)
  rows.value = merged
  updatedAt.value = nowStamp()
  if (t !== undefined) lastQueryMs.value = Math.round(performance.now() - t)
  quickCache.key = key
  quickCache.rows = merged
  quickCache.at = updatedAt.value
}

/** v2 消费：多状态一次聚合 → ERROR 行 + 各状态计数（不再需要第二阶段请求） */
function consumeMulti(all: TaskStatRow[], multi: TaskStatRow[], seq: number, key: string, t0: number) {
  if (seq !== querySeq) return
  const errRows = multi.filter((r) => r.state === 'E')
  applyMain(all, errRows, seq, key, t0)
  const states: Record<string, number> = {}
  PIE_STATES.forEach((s) => {
    states[s] = multi.reduce((sum, r) => (r.state === s ? sum + toNum(r.cnt) : sum), 0)
  })
  stateCounts.value = states
  quickCache.stateCounts = states
  pieLoading.value = false
}

/** 探测判 v1 后的回退：先渲染总数，补发 E，再后台取其余状态 */
function backfillV1(params: Record<string, string>, all: TaskStatRow[], seq: number, key: string, t0: number) {
  applyMain(all, [], seq, key, t0)
  statReq({ ...params, state: 'E' }, 'state=E(retry)')
    .then((errRows) => {
      if (seq !== querySeq) return
      applyMain(all, errRows, seq, key)
      void loadStatePie(params, errRows, seq)
    })
    .catch((e: unknown) => {
      if (!isAbort(e) && seq === querySeq) {
        if (import.meta.env.DEV) console.warn('[stat] E 补发失败（v1 回退中）: ', e)
        ElMessage.warning('ERROR 数据获取失败，错误率/ERROR 分布暂不准确')
      }
    })
}

/** 第二阶段：后台并行取其余关键状态计数（E 已由第一阶段提供），填充状态构成图 */
async function loadStatePie(params: Record<string, string>, errRows: TaskStatRow[], seq: number) {
  const states: Record<string, number> = { E: errRows.reduce((sum, r) => sum + toNum(r.cnt), 0) }
  const rest = PIE_STATES.filter((s) => s !== 'E')
  pieLoading.value = true
  try {
    const results = await Promise.all(rest.map((s) => statReq({ ...params, state: s }, `pie:${s}`)))
    if (seq !== querySeq) return
    rest.forEach((s, i) => {
      states[s] = results[i].reduce((sum, r) => sum + toNum(r.cnt), 0)
    })
    stateCounts.value = states
    quickCache.stateCounts = states
  } catch {
    // 状态构成失败不影响主视图，保留 E 数据
  } finally {
    if (seq === querySeq) pieLoading.value = false
  }
}

// ---- 自动刷新（60s，错峰：加载中会跳过当轮）----
let autoTimer: number | null = null
function toggleAutoRefresh(checked: string | number | boolean) {
  autoRefresh.value = Boolean(checked)
  if (autoTimer !== null) {
    window.clearInterval(autoTimer)
    autoTimer = null
  }
  if (autoRefresh.value) {
    autoTimer = window.setInterval(() => {
      if (loading.value) return
      autoRefreshing.value = true
      void handleQuery() // 转圈状态由 handleQuery 的 finally 复位
    }, 60_000)
    ElMessage.success('已开启自动刷新（每60秒）')
  } else {
    ElMessage.info('已关闭自动刷新')
  }
}

// ---- 阈值筛选交互 ----
function onRatePreset(p: number) {
  errThreshold.value = errThreshold.value === p ? '' : p
}
function onRateInput(v: number | undefined | null) {
  if (v === null || v === undefined || (v as unknown) === '') {
    errThreshold.value = ''
    return
  }
  const n = Math.floor(Number(v))
  errThreshold.value = Number.isNaN(n) ? '' : Math.min(100, Math.max(1, n))
}
function clearRate() {
  errThreshold.value = ''
}
/** 一键聚焦重点关注：按当前阈值开启筛选并滚动到明细表 */
function focusDanger() {
  if (!rateActive.value) errThreshold.value = 100
  void nextTick(() => {
    // el-card 的模板 ref 拿到的是组件实例，真实 DOM 在其 $el 上（旧页是 this.$el.querySelector('.detail-card')）
    const el = (detailRef.value as unknown as { $el?: HTMLElement } | null)?.$el
    // jsdom 没有 scrollIntoView（仅单测环境），真实浏览器不受影响
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

// ---- 时间交互 ----
function onTimeModeChange(mode: TimeMode) {
  timeMode.value = mode
  dateValue.value = ''
  rangeValue.value = null
  if (mode === 'custom') {
    // 自定义：先给「今天」（可用范围/日期替换）
    dateValue.value = fmtDate(dayStart())
  } else {
    const q = quickRange(mode)
    if (q.date) dateValue.value = q.date
    else if (q.range) rangeValue.value = q.range
  }
  void handleQuery()
}
function onRangeChange(val: [string, string] | null) {
  rangeValue.value = val && (val[0] || val[1]) ? [val[0] ?? '', val[1] ?? ''] : null
  if (!rangeValue.value) {
    // 清空后回到「今天」
    timeMode.value = 'today'
    dateValue.value = fmtDate(dayStart())
    void handleQuery()
    return
  }
  timeMode.value = 'custom'
  if (rangeValue.value[0] && rangeValue.value[1]) {
    // 选了时间范围后，日期参数按后端优先级让位于时间范围
    dateValue.value = ''
    const { range, clamped } = clampRange30(rangeValue.value[0], rangeValue.value[1])
    rangeValue.value = range
    if (clamped) ElMessage.warning(`时间范围不能超过30天，已自动截取为从 ${range[0].slice(0, 10)} 起的30天`)
  }
  void handleQuery()
}
function onDateChange(val: string | null) {
  dateValue.value = val ?? ''
  rangeValue.value = null
  if (!val) {
    // 清空后回到「今天」
    timeMode.value = 'today'
    dateValue.value = fmtDate(dayStart())
  } else {
    timeMode.value = 'custom'
  }
  void handleQuery()
}

// ---- 查询 / 重置 ----
function handleReset() {
  queryParam.group = 'source'
  queryParam.sourceId = ''
  queryParam.configId = ''
  queryParam.state = ''
  rangeValue.value = null
  timeMode.value = 'today'
  dateValue.value = fmtDate(dayStart())
  errThreshold.value = ''
  sortProp.value = null
  sortOrder.value = null
  void handleQuery()
}

// ---- 钻取（旧页 handleDrill）----
function handleDrill(row: StatRow, err: boolean) {
  const query: Record<string, string> = { tab: 'taskList' }
  if (row.sourceId !== null && row.sourceId !== undefined) query.sourceId = String(row.sourceId)
  if (row.configId !== null && row.configId !== undefined) query.configId = String(row.configId)
  if (err) query.state = 'E'
  else if (queryParam.state) query.state = queryParam.state
  void router.push({ path: '/monitor', query })
}
function onRowClick(row: StatRow) {
  handleDrill(row, false)
}
/** 错误率 100% 的行整行标红，便于扫视定位 */
function rowClassName({ row }: { row: StatRow }) {
  return row.errorCnt > 0 && row.errorRate >= 100 ? 'row-danger' : ''
}
function rowKeyOf(row: StatRow) {
  return `${row.sourceId ?? 's-'}_${row.configId ?? 'c-'}`
}

// ---- 导出（前端 CSV，见文件头偏差 1）----
const detailRef = ref<HTMLElement>()
function tagOf(v: string) {
  const d = new Date(v.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? '' : fmtDateTag(d)
}
function timeRangeTag() {
  const range = rangeValue.value
  if (range && range[0] && range[1]) return `${tagOf(range[0])}-${tagOf(range[1])}`
  if (dateValue.value) return dateValue.value.replace(/-/g, '')
  if (range && range[0]) return tagOf(range[0])
  if (range && range[1]) return tagOf(range[1])
  return fmtDateTag(new Date())
}
async function handleExport(mode?: string) {
  const list = mode === 'all' ? rows.value : filteredRows.value
  if (!list.length) return
  // 大数据量保护：超过 2 万行先确认（浏览器端生成文件可能卡顿）
  if (list.length > 20000) {
    try {
      await ElMessageBox.confirm(
        '浏览器端生成文件可能较慢甚至卡顿，建议缩小时间范围/增加过滤后再导出。是否继续？',
        `分组数量较大（${list.length} 行）`,
        { type: 'warning', confirmButtonText: '继续导出', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  doExport(list, mode)
}
function doExport(list: StatRow[], mode?: string) {
  const fileName = `任务统计_${queryParam.group}_${timeRangeTag()}_${fmtTimeTag(new Date())}`
  const headers = ['排名', '来源ID', '配置ID', '任务数', '任务占比(%)']
  if (!stateFiltered.value) headers.push('ERROR数', '错误率(%)')
  const dataRows = list.map((item, i) => {
    const row: (string | number)[] = [
      i + 1,
      item.sourceId === null || item.sourceId === undefined ? '' : item.sourceId,
      item.configId === null || item.configId === undefined ? '' : item.configId,
      item.cnt,
      percentOf(item.cnt, totalCnt.value),
    ]
    if (!stateFiltered.value) row.push(item.errorCnt, item.errorRate)
    return row
  })
  // 范围标注：全部导出 / 仅当前视图（阈值筛选）——与文件内容一致
  let scopeNote = '（全部状态）'
  if (stateFiltered.value) {
    scopeNote = `（状态 ${queryParam.state}）`
  } else if (rateActive.value && mode !== 'all') {
    scopeNote = `（仅错误率≥${thresholdRate.value}%分组 ${list.length} 个）`
  } else if (rateActive.value) {
    scopeNote = `（全部状态，错误率≥${thresholdRate.value}%分组 ${alertRows.value.length} 个）`
  }
  // 旧 exportExcel 会把这几行说明放在文件最上方；toCsv 只支持单行表头，故用 csvCell 自拼抬头
  const notes = [
    `${groupTitle.value} 任务统计`,
    `统计时间: ${timeRangeTag()}${scopeNote}`,
    '口径: 按任务创建时间(CREATE_DT)统计，范围≤30天，含全部状态（含AC自动完成/D删除）',
    '错误率(%) = ERROR数 / 任务数 * 100',
  ]
  const blocks: string[][] = [...notes.map((n) => [n]), [], headers, ...dataRows.map((r) => r.map(String))]
  const csv = `\uFEFF${blocks.map((r) => r.map(csvCell).join(',')).join('\r\n')}`
  downloadCsv(fileName, csv)
}

// ---- 初始化：支持从其它页面带参跳转（?group=&sourceId=&configId=&state=&startTime=&endTime=&date=）----
onMounted(() => {
  const q = route.query
  if (q.group && ['source', 'config', 'both'].includes(String(q.group))) {
    queryParam.group = String(q.group) as TaskStatGroup
  }
  if (q.sourceId) queryParam.sourceId = String(q.sourceId)
  if (q.configId) queryParam.configId = String(q.configId)
  if (q.state) queryParam.state = String(q.state)
  if (q.date) dateValue.value = String(q.date)
  // 传了 startTime / endTime 以时间范围为准（优先级高于 date）
  if (q.startTime || q.endTime) {
    dateValue.value = ''
    const s = q.startTime ? fmtDateTime(new Date(String(q.startTime).replace(' ', 'T'))) : ''
    const e = q.endTime ? fmtDateTime(new Date(String(q.endTime).replace(' ', 'T'))) : ''
    if (s || e) {
      if (s && e) {
        // 路由带入的范围同样受 30 天限制（静默截断）
        rangeValue.value = clampRange30(s, e).range
      } else {
        rangeValue.value = [s, e]
      }
    }
  }
  if (q.date || q.startTime || q.endTime) timeMode.value = 'custom'
  void handleQuery()
})

onUnmounted(() => {
  if (autoTimer !== null) window.clearInterval(autoTimer)
  abortCtrl?.abort()
})
</script>

<template>
  <div class="ts-shell">
    <!-- 页头 -->
    <div class="ts-head">
      <div class="ts-title-row">
        <span class="ts-title">任务统计</span>
        <el-tooltip :content="HELP_TEXT" placement="bottom-end">
          <el-icon class="ts-help"><QuestionFilled /></el-icon>
        </el-tooltip>
        <span v-if="lastQueryMs > 0 || updatedAt" class="ts-head-actions">
          <span class="ts-query-time">
            本次查询 {{ lastQueryMs > 0 ? `${lastQueryMs}ms` : '-' }} · 更新于 {{ updatedAt || '-' }}
          </span>
          <span class="ts-auto">
            自动刷新
            <el-switch
              size="small"
              class="ts-auto-switch"
              :model-value="autoRefresh"
              :loading="autoRefreshing"
              @change="toggleAutoRefresh"
            />
          </span>
        </span>
      </div>

      <!-- 查询工具栏：旧 a-form layout="inline"；控件宽度照抄旧页 -->
      <div class="ts-toolbar">
        <div class="ts-controls">
          <el-form :inline="true" class="ts-form">
            <el-form-item title="快捷时间">
              <el-select :model-value="timeMode" style="width: 104px" @change="(v: TimeMode) => onTimeModeChange(v)">
                <el-option label="今天" value="today" />
                <el-option label="昨天" value="yesterday" />
                <el-option label="近7天" value="7d" />
                <el-option label="近30天" value="30d" />
                <el-option label="自定义…" value="custom" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="timeMode === 'custom'" title="时间范围">
              <el-date-picker
                :model-value="rangeValue ?? undefined"
                type="datetimerange"
                style="width: 360px"
                start-placeholder="开始"
                end-placeholder="结束"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
                :default-time="[new Date(2000, 0, 1, 0, 0, 0), new Date(2000, 0, 1, 23, 59, 59)]"
                unlink-panels
                @change="onRangeChange"
              />
            </el-form-item>
            <el-form-item v-if="timeMode === 'custom'" title="指定日期">
              <el-date-picker
                :model-value="dateValue || undefined"
                type="date"
                style="width: 150px"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
                placeholder="指定日期"
                @change="onDateChange"
              />
            </el-form-item>
            <el-form-item title="分组维度">
              <el-select v-model="queryParam.group" style="width: 106px" @change="() => handleQuery()">
                <el-option label="按来源" value="source" />
                <el-option label="按配置" value="config" />
                <el-option label="来源+配置" value="both" />
              </el-select>
            </el-form-item>
            <el-form-item title="来源ID过滤">
              <el-input
                v-model="queryParam.sourceId"
                style="width: 96px"
                placeholder="来源ID"
                @keyup.enter="() => handleQuery()"
              />
            </el-form-item>
            <el-form-item title="配置ID过滤">
              <el-input
                v-model="queryParam.configId"
                style="width: 96px"
                placeholder="配置ID"
                @keyup.enter="() => handleQuery()"
              />
            </el-form-item>
            <el-form-item title="状态过滤，不选=总任务&ERROR双重视角">
              <el-select v-model="queryParam.state" style="width: 148px" @change="() => handleQuery()">
                <el-option label="-不限-" value="" />
                <el-option
                  v-for="opt in STAT_STATE_OPTIONS"
                  :key="opt.value"
                  :label="`${opt.value} - ${opt.label}`"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-form>
        </div>
        <div class="ts-search-actions">
          <el-button type="primary" :icon="Search" @click="() => handleQuery()">查询</el-button>
          <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        </div>
      </div>

      <!-- 提示条 -->
      <el-alert v-if="errorMsg" type="error" show-icon :closable="false" class="ts-alert" :title="errorMsg">
        <div class="ts-retry"><a @click="() => handleQuery()">点此重试</a></div>
      </el-alert>
      <el-alert
        v-else-if="stateFiltered"
        type="warning"
        show-icon
        :closable="false"
        class="ts-alert"
        :title="`当前已按状态「${queryParam.state}」过滤：任务总数/明细均为该状态，错误率、ERROR 分布、状态构成图暂不适用。`"
      />
    </div>

    <!-- 概览指标 -->
    <el-row :gutter="16" class="ts-metric-row">
      <el-col :xs="12" :sm="12" :md="6">
        <el-card shadow="never" class="ts-metric-card">
          <CardSkeleton :loading="loading">
            <div class="ts-metric">
              <div class="ts-metric-icon ts-i-blue">
                <el-icon><Histogram /></el-icon>
              </div>
              <div class="ts-metric-main">
                <div class="ts-metric-label">任务总数</div>
                <div class="ts-metric-value">{{ totalCnt.toLocaleString() }}</div>
                <div class="ts-metric-footer">
                  <span class="ts-metric-tag">{{ timeDesc }}</span>
                  <span v-if="stateFiltered">仅状态 {{ queryParam.state }}</span>
                  <span v-else>含全部状态</span>
                </div>
              </div>
            </div>
          </CardSkeleton>
        </el-card>
      </el-col>

      <el-col v-if="!stateFiltered" :xs="12" :sm="12" :md="6">
        <el-card shadow="never" class="ts-metric-card">
          <CardSkeleton :loading="loading">
            <div class="ts-metric">
              <div class="ts-metric-icon ts-i-red">
                <el-icon><CircleClose /></el-icon>
              </div>
              <div class="ts-metric-main">
                <div class="ts-metric-label">ERROR 任务数</div>
                <div class="ts-metric-value">{{ errorCnt.toLocaleString() }}</div>
                <div class="ts-metric-footer">
                  状态 E（ERROR）
                  <a v-if="alertRows.length > 0" class="ts-danger-link" @click="focusDanger">
                    · 错误率≥{{ thresholdRate }}%分组 {{ alertRows.length }} 个 →
                  </a>
                </div>
              </div>
            </div>
          </CardSkeleton>
        </el-card>
      </el-col>

      <el-col v-if="!stateFiltered" :xs="12" :sm="12" :md="6">
        <el-card shadow="never" class="ts-metric-card">
          <CardSkeleton :loading="loading">
            <div class="ts-metric">
              <div class="ts-metric-icon ts-i-amber">
                <el-progress
                  type="circle"
                  :percentage="progressOf(errorRate)"
                  :width="34"
                  :stroke-width="4"
                  :color="errorColor(errorRate)"
                  :show-text="false"
                />
              </div>
              <div class="ts-metric-main">
                <div class="ts-metric-label">错误率</div>
                <div class="ts-metric-value">{{ errorRate }}%</div>
                <div class="ts-metric-footer">ERROR / 全部任务（含排队中，参考值）</div>
              </div>
            </div>
          </CardSkeleton>
        </el-card>
      </el-col>

      <el-col v-if="!stateFiltered" :xs="12" :sm="12" :md="6">
        <el-card shadow="never" class="ts-metric-card">
          <CardSkeleton :loading="loading">
            <div class="ts-metric">
              <div class="ts-metric-icon ts-i-green">
                <el-icon><Grid /></el-icon>
              </div>
              <div class="ts-metric-main">
                <div class="ts-metric-label">涉及分组数</div>
                <div class="ts-metric-value">{{ rows.length }}</div>
                <div class="ts-metric-footer">{{ groupTitle }} · TOP1 {{ topLabel || '-' }}</div>
              </div>
            </div>
          </CardSkeleton>
        </el-card>
      </el-col>

      <template v-if="stateFiltered">
        <el-col :xs="12" :sm="12" :md="6">
          <el-card shadow="never" class="ts-metric-card">
            <CardSkeleton :loading="loading">
              <div class="ts-metric">
                <div class="ts-metric-icon ts-i-cyan">
                  <el-icon><Grid /></el-icon>
                </div>
                <div class="ts-metric-main">
                  <div class="ts-metric-label">涉及分组数</div>
                  <div class="ts-metric-value">{{ rows.length }}</div>
                  <div class="ts-metric-footer">{{ groupTitle }}</div>
                </div>
              </div>
            </CardSkeleton>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="12" :md="6">
          <el-card shadow="never" class="ts-metric-card">
            <CardSkeleton :loading="loading">
              <div class="ts-metric">
                <div class="ts-metric-icon ts-i-orange">
                  <el-icon><Trophy /></el-icon>
                </div>
                <div class="ts-metric-main">
                  <div class="ts-metric-label">最大分组任务数</div>
                  <div class="ts-metric-value">{{ maxCnt.toLocaleString() }}</div>
                  <div class="ts-metric-footer">TOP1 {{ topLabel || '-' }}</div>
                </div>
              </div>
            </CardSkeleton>
          </el-card>
        </el-col>
      </template>
    </el-row>

    <!-- 重点告警：错误率 ≥ 阈值分组 -->
    <div v-if="!stateFiltered && alertRows.length > 0" class="ts-danger-bar">
      <div class="ts-danger-icon">
        <el-icon><Warning /></el-icon>
      </div>
      <div class="ts-danger-body">
        <div class="ts-danger-title">
          错误率 ≥ {{ thresholdRate }}% 分组（{{ alertRows.length }} 个）—— 失败占比高于阈值，建议优先排查
          <a class="ts-danger-more" @click="focusDanger">在明细表中查看全部 →</a>
        </div>
        <div class="ts-danger-chips">
          <el-tag
            v-for="item in alertRows.slice(0, 8)"
            :key="rowKeyOf(item)"
            class="ts-danger-chip"
            @click.stop.prevent="handleDrill(item, true)"
          >
            {{ groupLabel(item, queryParam.group) }} · {{ item.errorCnt.toLocaleString() }}/{{
              item.cnt.toLocaleString()
            }}
          </el-tag>
          <span v-if="alertRows.length > 8" class="ts-danger-tip">
            +{{ alertRows.length - 8 }} 个，见下方明细表（可用"错误率 ≥"筛选查看）
          </span>
        </div>
      </div>
    </div>

    <!-- 图表 -->
    <el-row :gutter="16" class="ts-chart-row">
      <el-col v-if="!stateFiltered" :xs="24" :sm="24" :md="6">
        <el-card shadow="never" class="ts-chart-card">
          <template #header>
            <div class="ts-card-head">
              <span class="ts-card-title">任务状态构成</span>
              <span v-if="!loading && !pieLoading" class="ts-card-meta">合计 {{ totalCnt.toLocaleString() }}</span>
            </div>
          </template>
          <CardSkeleton :loading="loading || pieLoading" variant="chart">
            <StatePieChart v-if="statePieData.length > 0" :slices="statePieData" />
            <el-empty v-else description="暂无统计数据" :image-size="70" />
            <div v-if="statePieData.length > 0" class="ts-chart-note">{{ PIE_OTHER_NOTE }}</div>
          </CardSkeleton>
        </el-card>
      </el-col>

      <el-col :xs="24" :sm="24" :md="stateFiltered ? 24 : 9">
        <el-card shadow="never" class="ts-chart-card">
          <template #header>
            <div class="ts-card-head">
              <span class="ts-card-title">总任务分布</span>
              <span class="ts-card-meta">TOP10 · {{ groupTitle }}</span>
            </div>
          </template>
          <CardSkeleton :loading="loading" variant="chart">
            <TopBarChart v-if="totalBarData.length > 0" :items="totalBarData" color="#3e79f7" />
            <el-empty v-else description="暂无统计数据" :image-size="70" />
          </CardSkeleton>
        </el-card>
      </el-col>

      <el-col v-if="!stateFiltered" :xs="24" :sm="24" :md="9">
        <el-card shadow="never" class="ts-chart-card">
          <template #header>
            <div class="ts-card-head">
              <span class="ts-card-title">ERROR 分布</span>
              <span class="ts-card-meta ts-meta-red">TOP10 · {{ groupTitle }}</span>
            </div>
          </template>
          <CardSkeleton :loading="loading" variant="chart">
            <TopBarChart
              v-if="errorBarData.length > 0"
              :items="errorBarData"
              color="#f5222d"
              empty-text="当前时间范围内无 ERROR 任务"
            />
            <el-empty v-else description="当前时间范围内无 ERROR 任务" :image-size="70" />
          </CardSkeleton>
        </el-card>
      </el-col>
    </el-row>

    <!-- 明细表 -->
    <el-card ref="detailRef" shadow="never" class="ts-detail-card">
      <template #header>
        <div class="ts-card-head">
          <span class="ts-card-title">
            分组明细
            <span class="ts-count" :class="{ 'ts-count-red': rateActive }">
              {{ filteredRows.length }}/{{ rows.length }}
            </span>
          </span>
          <el-tooltip
            placement="bottom-end"
            content="点击行或操作列可在任务实例页查看该分组的任务实例；任务实例页为全时间段展示（stat 接口的时间范围不支持透传）。"
          >
            <el-icon class="ts-info"><QuestionFilled /></el-icon>
          </el-tooltip>

          <span class="ts-detail-extra">
            <span v-if="!stateFiltered" class="ts-rate" :class="{ 'ts-rate-on': rateActive }">
              <span class="ts-rate-label">错误率 ≥</span>
              <el-button
                v-for="p in RATE_PRESETS"
                :key="p"
                class="ts-preset"
                :type="errThreshold === p ? 'primary' : 'default'"
                @click="onRatePreset(p)"
              >
                {{ p }}%
              </el-button>
              <el-input-number
                class="ts-rate-input"
                :model-value="errThreshold === '' ? undefined : errThreshold"
                :min="1"
                :max="100"
                :step="5"
                :precision="0"
                :controls="false"
                placeholder="自定义"
                @change="onRateInput"
              />
              <el-icon v-if="rateActive" class="ts-rate-clear" title="清除筛选" @click="clearRate()">
                <CircleCloseFilled />
              </el-icon>
              <span v-if="rateActive" class="ts-rate-count">筛出 {{ filteredRows.length }} 个</span>
            </span>

            <el-dropdown v-if="rateActive && rows.length > 0" trigger="click" class="ts-export" @command="handleExport">
              <el-button type="primary" :icon="Download">导出Excel</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="all">导出全部（{{ rows.length }} 行）</el-dropdown-item>
                  <el-dropdown-item command="current" :disabled="filteredRows.length === 0">
                    导出当前视图（{{ filteredRows.length }} 行）
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button
              v-else
              class="ts-export"
              type="primary"
              :icon="Download"
              :disabled="rows.length === 0"
              @click="handleExport()"
            >
              导出Excel
            </el-button>
          </span>
        </div>
      </template>

      <el-table
        :key="tableKey"
        v-loading="loading"
        class="ts-table"
        size="small"
        border
        :data="pagedRows"
        :row-key="rowKeyOf"
        :row-class-name="rowClassName"
        :default-sort="defaultSort"
        :empty-text="emptyLabel"
        @sort-change="onSortChange"
        @row-click="onRowClick"
      >
        <el-table-column
          v-for="col in columns"
          :key="col.prop"
          :prop="col.prop"
          :label="col.title"
          :min-width="col.minWidth"
          :sortable="col.sortMethod ? 'custom' : false"
        >
          <template #default="scope">
            <!-- # 序号：旧 a-table 的 index 是**当前页内**序号（每页从 1 开始），前 3 名带徽章 -->
            <template v-if="col.slot === 'index'">
              <span v-if="scope.$index < 3" class="ts-rank" :class="`ts-rank-${scope.$index + 1}`">
                {{ scope.$index + 1 }}
              </span>
              <span v-else>{{ scope.$index + 1 }}</span>
            </template>

            <template v-else-if="col.slot === 'source'">
              <el-tag
                v-if="scope.row.sourceId !== null && scope.row.sourceId !== undefined"
                size="small"
                class="ts-tag-source"
              >
                {{ scope.row.sourceId }}
              </el-tag>
              <span v-else>-</span>
            </template>

            <template v-else-if="col.slot === 'config'">
              <el-tag
                v-if="scope.row.configId !== null && scope.row.configId !== undefined"
                size="small"
                class="ts-tag-config"
              >
                {{ scope.row.configId }}
              </el-tag>
              <span v-else>-</span>
            </template>

            <template v-else-if="col.slot === 'cnt'">
              <b>{{ scope.row.cnt.toLocaleString() }}</b>
            </template>

            <template v-else-if="col.slot === 'rate'">
              <el-progress
                class="ts-inline-progress"
                :percentage="progressOf(percentOf(scope.row.cnt, totalCnt))"
                :show-text="false"
                :stroke-width="6"
                color="#3e79f7"
              />
              <span class="ts-rate-text">{{ percentOf(scope.row.cnt, totalCnt) }}%</span>
            </template>

            <template v-else-if="col.slot === 'errorCnt'">
              <b v-if="scope.row.errorCnt > 0" class="ts-error-num">{{ scope.row.errorCnt.toLocaleString() }}</b>
              <span v-else>-</span>
            </template>

            <template v-else-if="col.slot === 'errorRate'">
              <template v-if="scope.row.errorCnt > 0">
                <el-progress
                  class="ts-inline-progress"
                  :percentage="progressOf(scope.row.errorRate)"
                  :show-text="false"
                  :stroke-width="6"
                  :color="errorColor(scope.row.errorRate)"
                />
                <span
                  class="ts-rate-text"
                  :style="{
                    color: errorColor(scope.row.errorRate),
                    fontWeight: scope.row.errorRate >= 100 ? 600 : 'normal',
                  }"
                >
                  {{ scope.row.errorRate }}%
                </span>
                <el-tag v-if="scope.row.errorRate >= 100" type="danger" size="small" class="ts-100">100%</el-tag>
              </template>
              <span v-else>-</span>
            </template>

            <template v-else-if="col.slot === 'action'">
              <span class="ts-op">
                <a class="ts-op-link" @click.stop="handleDrill(scope.row, false)">任务明细</a>
                <template v-if="!stateFiltered && scope.row.errorCnt > 0">
                  <span class="ts-op-divider">|</span>
                  <a class="ts-op-link ts-op-error" @click.stop="handleDrill(scope.row, true)">错误明细</a>
                </template>
              </span>
            </template>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="showPager" class="ts-pager">
        <el-pagination
          size="small"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="filteredRows.length"
          :current-page="page"
          :page-size="size"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="(p: number) => (page = p)"
          @size-change="
            (s: number) => {
              size = s
              page = 1
            }
          "
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.ts-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.ts-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ts-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ts-title {
  color: var(--rc-text, #0f172a);
  font-size: 17px;
  font-weight: 700;
}
.ts-help {
  color: var(--rc-faint, #94a3b8);
  cursor: help;
  font-size: 15px;
}
.ts-head-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
  font-size: 12px;
}
.ts-query-time {
  color: var(--rc-muted, #64748b);
  font-variant-numeric: tabular-nums;
}
.ts-auto {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--rc-text-2, #475569);
}
/* 查询工具栏 */
.ts-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 12px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: var(--rc-radius, 8px);
}
.ts-controls {
  min-width: 0;
  flex: 1;
}
.ts-form :deep(.el-form-item) {
  margin-right: 12px;
  margin-bottom: 0;
}
.ts-search-actions {
  flex: none;
}
.ts-alert {
  margin-bottom: 0;
}
.ts-retry a {
  color: var(--rc-error, #dc2626);
  cursor: pointer;
}

/* 指标卡 */
.ts-metric-row :deep(.el-card__body) {
  padding: 12px 16px;
}
.ts-metric-card {
  height: 100%;
  border-radius: var(--rc-radius, 8px);
}
.ts-metric {
  display: flex;
  align-items: flex-start;
}
.ts-metric-icon {
  display: flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  border-radius: 8px;
  font-size: 15px;
}
.ts-i-blue {
  color: #3e79f7;
  background: rgba(62, 121, 247, 0.1);
}
.ts-i-red {
  color: #f5222d;
  background: rgba(245, 34, 45, 0.08);
}
.ts-i-amber {
  color: #faad14;
  background: rgba(250, 173, 20, 0.12);
}
.ts-i-green {
  color: #52c41a;
  background: rgba(82, 196, 26, 0.1);
}
.ts-i-cyan {
  color: #13c2c2;
  background: rgba(19, 194, 194, 0.1);
}
.ts-i-orange {
  color: #ff7800;
  background: rgba(255, 120, 24, 0.12);
}
.ts-metric-main {
  min-width: 0;
  flex: 1;
}
.ts-metric-label {
  color: var(--rc-text-2, #475569);
  font-size: 12px;
  line-height: 16px;
}
.ts-metric-value {
  color: var(--rc-text, #0f172a);
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 36px;
}
.ts-metric-footer {
  overflow: hidden;
  color: var(--rc-faint, #94a3b8);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ts-metric-tag {
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #f0f5ff;
  color: #2f54eb;
}
.ts-danger-link {
  color: #f5222d;
  font-weight: 500;
  cursor: pointer;
}

/* 告警条 */
.ts-danger-bar {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  background: #fff1f0;
  border: 1px solid #ffa39e;
  border-radius: var(--rc-radius, 8px);
}
.ts-danger-icon {
  display: flex;
  width: 28px;
  height: 28px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
  border-radius: 50%;
  background: #f5222d;
  color: #fff;
  font-size: 14px;
}
.ts-danger-body {
  min-width: 0;
  flex: 1;
}
.ts-danger-title {
  color: #cf1322;
  font-size: 13px;
  font-weight: 600;
  line-height: 22px;
}
.ts-danger-more {
  margin-left: 10px;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
}
.ts-danger-chips {
  margin-top: 6px;
}
.ts-danger-chip {
  margin: 0 4px 4px 0;
  background: #fff;
  border-color: #ffa39e;
  color: #cf1322;
  font-size: 12px;
  cursor: pointer;
}
.ts-danger-tip {
  margin-left: 8px;
  color: #cf1322;
  font-size: 12px;
}

/* 图表卡 */
.ts-chart-row {
  margin: 0;
}
.ts-chart-card {
  height: 100%;
  border-radius: var(--rc-radius, 8px);
}
.ts-chart-card :deep(.el-card__header) {
  padding: 10px 14px;
}
.ts-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ts-card-title {
  color: var(--rc-text, #0f172a);
  font-size: 15px;
  font-weight: 600;
}
.ts-card-meta {
  margin-left: auto;
  color: var(--rc-faint, #94a3b8);
  font-size: 12px;
}
.ts-meta-red {
  color: #f5222d;
}
.ts-chart-note {
  margin-top: 2px;
  color: var(--rc-faint, #94a3b8);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

/* 明细卡 */
.ts-detail-card {
  border-radius: var(--rc-radius, 8px);
}
.ts-detail-card :deep(.el-card__header) {
  padding: 10px 14px;
}
.ts-info {
  color: var(--rc-faint, #94a3b8);
  cursor: help;
  font-size: 14px;
}
.ts-count {
  display: inline-block;
  height: 20px;
  margin-left: 8px;
  padding: 0 8px;
  border-radius: 10px;
  background: #f0f0f0;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}
.ts-count-red {
  background: #fff1f0;
  color: #f5222d;
}
.ts-detail-extra {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
/* 错误率阈值筛选 */
.ts-rate {
  display: inline-flex;
  align-items: center;
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.ts-rate-label {
  margin-right: 6px;
}
.ts-rate-on .ts-rate-label {
  color: #f5222d;
}
.ts-preset {
  min-width: 44px;
  margin-right: 4px;
  padding: 0 8px;
  font-size: 12px;
}
.ts-rate-input {
  width: 78px;
}
.ts-rate-input :deep(.el-input__wrapper) {
  padding-right: 6px;
  padding-left: 6px;
}
.ts-rate-clear {
  margin-left: 6px;
  color: #f5222d;
  cursor: pointer;
  font-size: 15px;
}
.ts-rate-count {
  margin-left: 8px;
  color: #f5222d;
  font-variant-numeric: tabular-nums;
}
/* 表 */
.ts-table :deep(.el-table__header th) {
  background: #fafafa;
  color: var(--rc-text, #0f172a);
  font-size: 12px;
  font-weight: 600;
}
.ts-table :deep(.el-table__body td) {
  font-size: 12px;
}
.ts-table :deep(tr.row-danger) {
  --el-table-tr-bg-color: #fff1f0;
  --el-table-row-hover-bg-color: #ffe7e6;
}
.ts-rank {
  display: inline-block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
}
.ts-rank-1 {
  background: #faad14;
}
.ts-rank-2 {
  background: #bfbfbf;
}
.ts-rank-3 {
  background: #cd7f32;
}
.ts-tag-source {
  background: #e6f7ff;
  border-color: #91d5ff;
  color: #1890ff;
}
.ts-tag-config {
  background: #f0f5ff;
  border-color: #adc6ff;
  color: #2f54eb;
}
.ts-inline-progress {
  display: inline-block;
  width: 120px;
  margin-right: 8px;
  vertical-align: middle;
}
.ts-rate-text {
  color: rgba(0, 0, 0, 0.65);
  font-variant-numeric: tabular-nums;
}
.ts-error-num {
  color: #f5222d;
}
.ts-100 {
  margin-left: 6px;
}
.ts-op {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ts-op-link {
  color: #1890ff;
  font-size: 12px;
  cursor: pointer;
}
.ts-op-link:hover {
  text-decoration: underline;
}
/* 旧页「错误明细」是显式的红色链接 */
.ts-op-error {
  color: #f5222d;
}
.ts-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.ts-pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
