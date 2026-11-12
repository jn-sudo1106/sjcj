// 监控中心的接口编排层（1110 方案，前端先行版）。
//
// 这一层只做三件事，页面不要绕过它直接拼旧接口：
//   1. 分页拉全量（旧 paged 只支持单 sourceId，无法按网站/多源一次查完）：带页数上限，
//      超限抛 `MonitorQueryLimitError` 由页面提示，**不静默截断**成看起来完整的数据；
//   2. 旧行 → 视图（复用 utils/monitor/record 的口径），页面只读 MonitorRecordView；
//   3. 保存时以原始行为底做**受控合并**：只写定义字段，启停/运行回执/未识别键原样带去，
//      避免「保存一次就把启用改成停用、把 state 重置成 C」（1109 §3 问题 4）。
//
// 尚未就绪的服务端能力（C01 保存回执 / C06 运行列表 / C07 源聚合 / C08 通知回执）在这里
// 保持缺席：页面按 C07 缺失显示「—（需服务端聚合）」，不要自己算全站数字。

import {
  addSourceCheck,
  changeSourceCheckEnable,
  handleRunNow,
  pagedCheckJobLogs,
  pagedSourceCheck,
  pagedSourceSummary,
  updateSourceCheck,
} from './monitor'
import type { SourceCheck, SourceCheckLog } from './types/monitor'
import type {
  MonitorCheckConf,
  MonitorDataStatus,
  MonitorKind,
  MonitorRecordView,
  MonitorRunView,
  MonitorSourceRow,
} from './types/monitorCenter'
import { requestRunnerManagement } from './runnerManagement'
import { parseCheckConf, serializeCheckConf, toMonitorRecord, toMonitorRun } from '../utils/monitor/record'

/** 单页大小：旧接口按 page/limit 分页 */
export const MONITOR_PAGE_SIZE = 200
/** 最多翻多少页（约 4000 条）。超限说明查询范围有问题，必须让用户缩小范围而不是继续翻。 */
export const MONITOR_MAX_PAGES = 20

/** 分页拉取超过上限。页面要提示「范围过大，请按源/网站缩小」，不能当作查询完成。 */
export class MonitorQueryLimitError extends Error {
  /** 超过的上限页数；单独声明而不是用构造参数属性（tsconfig `erasableSyntaxOnly` 不允许） */
  readonly pages: number

  constructor(pages: number) {
    super(`监控记录超过 ${pages} 页，请按源或网站缩小范围后再查`)
    this.name = 'MonitorQueryLimitError'
    this.pages = pages
  }
}

interface ListOptions {
  sourceId?: string
  name?: string
  maxPages?: number
}

/**
 * 按旧 paged 接口翻页拉全量原始行（不自动去重，保存时以最后一次读到的为准）。
 *
 * 首页拿到 total 后，其余页并发取——串行翻页在真机上是「首屏慢」的主要来源之一
 * （首页 300ms、每多一页多一个往返，用户看到的就是白屏越等越久）。
 */
export async function listMonitorRows(options: ListOptions = {}): Promise<SourceCheck[]> {
  const maxPages = options.maxPages ?? MONITOR_MAX_PAGES
  const query = (page: number) =>
    pagedSourceCheck({
      page,
      // 契约是 page/limit；adaptPage 只认 pageNo/pageSize，传 size 会被当未知字段带上、
      // 而 limit 仍是 undefined，真实后端按默认 10 条返回（fe-list 报的坑）。
      limit: MONITOR_PAGE_SIZE,
      sourceId: options.sourceId,
      name: options.name,
    } as never)

  const first = await query(1)
  const firstList = Array.isArray(first?.list) ? first.list : []
  const total = Number(first?.total ?? 0)
  if (!firstList.length || firstList.length >= total) return firstList

  // 后端可能按自己的上限给页大小（例如历史接口默认 10 条）：按首页实际条数推算页数，
  // 否则 total 对了也会漏取后半段。
  const pageSize = firstList.length || MONITOR_PAGE_SIZE
  const pages = Math.ceil(total / pageSize)
  if (pages > maxPages) throw new MonitorQueryLimitError(maxPages)
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => query(index + 2)))
  const rows = [...firstList]
  for (const res of rest) {
    if (Array.isArray(res?.list)) rows.push(...res.list)
  }
  return rows
}

/** 列表视图：一行一条监控记录（按记录身份，不是按源）。 */
export async function listMonitors(options: ListOptions = {}): Promise<MonitorRecordView[]> {
  const rows = await listMonitorRows(options)
  return rows.map((row) => toMonitorRecord(row))
}

/** 按源拉该源下全部监控（源内视图 / 展开检查项用）。 */
export async function listMonitorsOfSource(sourceId: string): Promise<MonitorRecordView[]> {
  const rows = await listMonitorRows({ sourceId })
  return rows.filter((row) => String(row.sourceId) === String(sourceId)).map((row) => toMonitorRecord(row))
}

/**
 * 按记录主键取一条。
 * 旧接口没有 get-by-id：只能按 sourceId 拉回来再按 id 匹配（所以调用方必须知道 sourceId）。
 * 匹配不到返回 undefined，由页面提示「记录已不存在」，不要用同源第一条顶上（1109 §3 问题 1）。
 */
export async function findMonitor(sourceId: string, monitorId: string): Promise<MonitorRecordView | undefined> {
  const rows = await listMonitorsOfSource(sourceId)
  return rows.find((row) => row.id === String(monitorId))
}

export interface SaveMonitorInput {
  /** 编辑时必填：记录主键。新建时不传。 */
  record?: MonitorRecordView
  sourceId: string
  name: string
  kind: MonitorKind
  conf: MonitorCheckConf
  tableName?: string
  schedule?: string
}

/**
 * 保存监控定义。
 *
 * 编辑：以 `record.raw` 为底（保留 id / isDelete / state / jobId / 额外时间字段），只替换
 * name / tableName / schedule / checkConf 四个定义字段——这是「保存不改启停」的最小保护
 * （1109 §3 问题 4 / 评审 R06 的前端侧）。
 * 新建：只提交定义字段，isDelete 由后端按「新增强制启用」或业务确认的默认值处理。
 *
 * 返回旧接口的原始回执（可能是中文消息串）。**回执里没有 id/revision 时不要猜**：
 * 调用方应重新 listMonitorsOfSource 回查，再按 name+tableName 找新记录（1109 §5.3 / 1110 §8.1）。
 */
export async function saveMonitor(input: SaveMonitorInput): Promise<{ created: boolean; raw: unknown }> {
  const conf: MonitorCheckConf = {
    ...input.conf,
    kind: input.kind,
    ...(input.schedule !== undefined ? { cron: input.schedule } : {}),
  }
  if (input.record) {
    const raw = input.record.raw
    const payload: Record<string, unknown> = {
      ...raw,
      id: raw.id,
      sourceId: input.record.sourceId,
      name: input.name,
      tableName: input.tableName ?? raw.tableName,
      schedule: input.schedule ?? raw.schedule,
      checkConf: serializeCheckConf(conf),
    }
    const res = await updateSourceCheck(payload)
    return { created: false, raw: res }
  }
  const payload: Record<string, unknown> = {
    sourceId: input.sourceId,
    name: input.name,
    tableName: input.tableName ?? '',
    schedule: input.schedule ?? '',
    checkConf: serializeCheckConf(conf),
  }
  const res = await addSourceCheck(payload)
  return { created: true, raw: res }
}

/** 批量启停（旧契约 enable 语义是反的，见 api/monitor.ts 注释）。 */
export async function setMonitorsEnabled(ids: string[], enabled: boolean): Promise<unknown> {
  return changeSourceCheckEnable(ids, enabled)
}

export interface MonitorRunnerItem {
  runId?: string
  monitorId?: number | string
  status?: string
  checkedCount?: number
  abnormalCount?: number
  message?: string
  error?: string | null
  /** 没抢到占位锁（另一实例正在执行同一条检查）时为 true，此时既没跑脚本也没写库。 */
  skipped?: boolean
  reason?: string
}

export interface MonitorRunnerScanResult {
  applied?: boolean
  count?: number
  items?: MonitorRunnerItem[]
}

/**
 * 触发「脚本检查（AI）」的执行器立即运行。
 *
 * 和旧 `runNow` 的区别：旧接口只是把 `next_run` 置为 now，等 Java 调度器捡起；
 * 而脚本检查不由 Java 执行（`lockForDeal` 已经排除 `kind=ai`），必须走执行器才有真实结论。
 * 返回的 runId 才是「这次运行」的身份，`accepted` 只代表已受理。
 */
export async function runScriptMonitorsNow(
  ids: string[],
  options: { apply?: boolean; force?: boolean } = {},
): Promise<MonitorRunnerScanResult> {
  const monitorIds = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
  return requestRunnerManagement<MonitorRunnerScanResult>('/monitor-runner/scan', 'POST', {
    apply: options.apply ?? true,
    force: options.force ?? true,
    monitorIds,
  })
}

export interface RunNowResult {
  /** 走执行器的（AI 脚本检查） */
  viaRunner: number
  /** 走旧 Java 调度器的（SQL 规则检查） */
  viaLegacy: number
  /** 执行器里因「另一实例正在执行」被跳过的条数（不是失败，也不是已执行） */
  runnerSkipped: number
  /** 执行器本次真正产生的运行编号（用于提示「本次运行是 run-…」） */
  runnerRunIds: string[]
  runner?: MonitorRunnerScanResult
}

/** 执行器返回项里哪些是「跳过」：显式 skipped，或 status=SKIPPED（兼容旧字段）。 */
export function countRunnerSkipped(result?: MonitorRunnerScanResult): number {
  return (result?.items ?? []).filter((item) => item.skipped === true || item.status === 'SKIPPED').length
}

/** 执行器本次产生的 runId（跳过项没有 runId，不能混进来）。 */
export function runnerRunIdsOf(result?: MonitorRunnerScanResult): string[] {
  return (result?.items ?? [])
    .filter((item) => !item.skipped && item.status !== 'SKIPPED' && typeof item.runId === 'string')
    .map((item) => String(item.runId))
}

/**
 * 立即运行。按检查方式分流：
 *   · `ai`（脚本检查）→ 执行器，按 monitorId 真跑；
 *   · 其它（规则检查）→ 旧 `runNow`，把 next_run 置 now 交给 Java 调度器。
 * 两种都只代表「已受理」，执行结果以运行记录为准。
 */
export async function runMonitorsNow(ids: string[], kinds: Record<string, MonitorKind> = {}): Promise<RunNowResult> {
  const scriptIds = ids.filter((id) => kinds[id] === 'ai')
  const legacyIds = ids.filter((id) => kinds[id] !== 'ai')
  if (!scriptIds.length) {
    await handleRunNow(legacyIds.length ? legacyIds : ids)
    return { viaRunner: 0, viaLegacy: legacyIds.length || ids.length, runnerSkipped: 0, runnerRunIds: [] }
  }
  const runner = await runScriptMonitorsNow(scriptIds)
  if (legacyIds.length) await handleRunNow(legacyIds)
  return {
    viaRunner: scriptIds.length,
    viaLegacy: legacyIds.length,
    runnerSkipped: countRunnerSkipped(runner),
    runnerRunIds: runnerRunIdsOf(runner),
    runner,
  }
}

export interface ListRunsOptions {
  /** 监控记录主键。**旧日志的 jobId 字段存的就是 ckSource.id**，不是采集调度 jobId（1109 §5.3⑧）。 */
  monitorId?: string
  sourceId?: string
  name?: string
  state?: string
  page?: number
  size?: number
}

/**
 * 运行记录。
 * 传 monitorId 时按 `jobId=monitorId` 查——这是旧后端 `CkJobLogService.saveLog` 的真实口径；
 * 不要传采集任务的 jobId，也不要传日志行序号，两者都查不到。
 */
export async function listRuns(options: ListRunsOptions = {}): Promise<{ total: number; list: MonitorRunView[] }> {
  const res = await pagedCheckJobLogs({
    page: options.page ?? 1,
    // 同上：旧日志接口也只认 page/limit
    limit: options.size ?? 50,
    sourceId: options.sourceId,
    jobId: options.monitorId,
    name: options.name,
    state: options.state,
  } as never)
  const logs: SourceCheckLog[] = Array.isArray(res?.list) ? res.list : []
  return { total: Number(res?.total ?? logs.length), list: logs.map((log) => toMonitorRun(log)) }
}

/** 从旧行直接拿 checkConf（页面需要原始 JSON 时用，不经过视图）。 */
export function rawCheckConf(row: SourceCheck): MonitorCheckConf {
  return parseCheckConf(row.checkConf)
}
/** 源目录项：监控中心的「未配置检查的源」也要出现在列表里，所以需要源目录而不只是监控记录。 */
export interface MonitorSourceOption {
  sourceId: string
  name: string
  siteId?: string
  siteName?: string
  tableName?: string
}

const SOURCE_PAGE_SIZE = 200
const SOURCE_MAX_PAGES = 20

function toSourceOption(source: {
  sourceId: string
  name: string
  siteId?: string
  siteName?: string
  mainTable?: string
  tableName?: string
}): MonitorSourceOption {
  return {
    sourceId: source.sourceId,
    name: source.name,
    siteId: source.siteId,
    siteName: source.siteName,
    // 源目录的物理表字段在不同接口里叫 mainTable / tableName，展示前统一取到 tableName
    tableName: source.mainTable || source.tableName,
  }
}

/**
 * 拉源目录（用于「未配置检查的源也要出行」与源名回显）。
 *
 * - 网站上下文用 `site/sources`（后端按网站过滤，带 10s 缓存）；
 * - 全局上下文用 `source/sourcePaged` 翻页，超过上限抛 `MonitorQueryLimitError`，
 *   不静默截断成「看起来只有这些源」。全局一次拉全量在 6000+ 源上偏慢，
 *   页面在拿不到时应当降级为「仅已配置监控的源」，而不是把分页结果相加。
 */
export async function listSourceOptions(options: { siteId?: string } = {}): Promise<MonitorSourceOption[]> {
  const { siteApi, sourceApi } = await import('./index')
  if (options.siteId) {
    const sources = await siteApi.siteSources(options.siteId)
    return sources.map(toSourceOption)
  }
  const collected = new Map<string, MonitorSourceOption>()
  for (let page = 1; page <= SOURCE_MAX_PAGES; page += 1) {
    const res = await sourceApi.sourcePaged({ page, size: SOURCE_PAGE_SIZE })
    // 首页就能看出总量超不超上限：超了立刻失败，不要一页一页翻满 20 次再报错
    // （真机 24 万源，20 次串行请求要等十几秒，页面看起来像卡死）。
    if (page === 1) assertSourceCountWithinLimit(Number(res?.total ?? 0))
    const list = Array.isArray(res?.list) ? res.list : []
    for (const source of list) {
      if (!source?.sourceId || collected.has(source.sourceId)) continue
      collected.set(source.sourceId, toSourceOption(source))
    }
    if (list.length < SOURCE_PAGE_SIZE || collected.size >= Number(res?.total ?? 0)) {
      return [...collected.values()]
    }
  }
  // 翻满上限还没取完（total 在翻页过程中变大）：同样按「源太多」处理。
  throw new Error(sourceTooManyMessage())
}

function sourceTooManyMessage(): string {
  return `源数量超过 ${SOURCE_MAX_PAGES * SOURCE_PAGE_SIZE} 个，无法一次列全；请按网站查看，或直接用名称/ID 搜索`
}

/** 源目录一次拉全的上限：超了直接失败，不做无意义的翻页。 */
function assertSourceCountWithinLimit(total: number): void {
  if (Number.isFinite(total) && total > SOURCE_MAX_PAGES * SOURCE_PAGE_SIZE) {
    throw new Error(sourceTooManyMessage())
  }
}

/**
 * 按源 ID 批量取名称（列表回显用）。
 *
 * 生产有 24 万+ 源，`listSourceOptions` 拉全量必然触顶；但列表其实只需要「本页出现过的那些源」
 * 的名字。后端 `source/sourcePaged` 支持 `ids`（逗号分隔），按 200 个一批取，373 条监控只要 2 次请求。
 * 取不到的源仍按 `源 <ID>` 兜底，不编造名称。
 */
export async function listSourceNames(sourceIds: string[]): Promise<MonitorSourceOption[]> {
  const ids = [...new Set(sourceIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (!ids.length) return []
  const { sourceApi } = await import('./index')
  const collected = new Map<string, MonitorSourceOption>()
  for (let start = 0; start < ids.length; start += SOURCE_PAGE_SIZE) {
    const chunk = ids.slice(start, start + SOURCE_PAGE_SIZE)
    const res = await sourceApi.sourcePaged({ ids: chunk.join(','), page: 1, size: chunk.length })
    const list = Array.isArray(res?.list) ? res.list : []
    for (const source of list) {
      if (!source?.sourceId || collected.has(source.sourceId)) continue
      collected.set(source.sourceId, toSourceOption(source))
    }
  }
  return [...collected.values()]
}

/** 服务端源聚合返回的一行（C07 首期）。字段名与后端 `source/check/sourceSummary` 对齐。 */
interface SourceSummaryPayload {
  sourceId?: number | string
  sourceName?: string
  siteId?: number | string | null
  siteName?: string
  tableName?: string
  monitorTotal?: number
  monitorEnabled?: number
  lastCheckAt?: string | null
  /** none 未配置 / disabled 全停用 / unknown 有启用但没跑过 / abnormal 有告警 / normal 正常 */
  dataState?: string
}

function dataOfState(state: string | undefined): MonitorDataStatus {
  if (state === 'abnormal') return 'abnormal'
  if (state === 'normal') return 'normal'
  return 'unknown'
}

function labelOfState(state: string | undefined): { label: string; tone: MonitorSourceRow['tone'] } {
  switch (state) {
    case 'abnormal':
      return { label: '数据异常', tone: 'bad' }
    case 'normal':
      return { label: '数据正常', tone: 'good' }
    case 'disabled':
      return { label: '已停用', tone: 'muted' }
    case 'none':
      return { label: '未配置检查', tone: 'muted' }
    default:
      return { label: '尚未检查', tone: 'unknown' }
  }
}

function toSourceSummaryRow(item: SourceSummaryPayload): MonitorSourceRow {
  const total = Number(item.monitorTotal ?? 0)
  const enabled = Number(item.monitorEnabled ?? 0)
  const state = item.dataState
  const { label, tone } = labelOfState(state)
  return {
    sourceId: String(item.sourceId ?? ''),
    sourceName: item.sourceName || undefined,
    tableName: item.tableName || undefined,
    siteId: item.siteId == null ? undefined : String(item.siteId),
    siteName: item.siteName || undefined,
    monitorTotal: total,
    monitorEnabled: enabled,
    // 计划覆盖需要「预期时隙」表，服务端首期只给出不可用标记，页面如实显示「—（需服务端聚合）」。
    coverage: null,
    coverageUnavailable: true,
    data: total === 0 ? 'unknown' : dataOfState(state),
    exec: 'unknown',
    notifyFailures: 0,
    lastCheckAt: item.lastCheckAt || undefined,
    label,
    tone,
    monitors: [],
    unconfigured: total === 0,
  }
}

/**
 * 拉服务端源聚合（C07 首期）。
 * 不可用时返回 `unavailable: true`，页面回落到「只列已配置源」的老路径——**不要**用前端拼全量源目录顶替。
 */
export async function listSourceSummary(
  options: { siteId?: string; keyword?: string; maxPages?: number } = {},
): Promise<{ total: number; rows: MonitorSourceRow[]; unavailable: boolean }> {
  const maxPages = options.maxPages ?? 10
  const query = (page: number) =>
    pagedSourceSummary({
      page,
      limit: MONITOR_PAGE_SIZE,
      siteId: options.siteId,
      keyword: options.keyword,
    })

  try {
    const first = await query(1)
    const firstList = Array.isArray(first?.list) ? (first.list as SourceSummaryPayload[]) : []
    const total = Number(first?.total ?? firstList.length)
    const rows = firstList.map(toSourceSummaryRow)
    if (!firstList.length || firstList.length >= total) return { total, rows, unavailable: false }

    const pageSize = firstList.length || MONITOR_PAGE_SIZE
    const pages = Math.min(Math.ceil(total / pageSize), maxPages)
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
        query(index + 2).then((res) => (Array.isArray(res?.list) ? (res.list as SourceSummaryPayload[]) : [])),
      ),
    )
    for (const list of rest) rows.push(...list.map(toSourceSummaryRow))
    return { total, rows, unavailable: false }
  } catch {
    return { total: 0, rows: [], unavailable: true }
  }
}
