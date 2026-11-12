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
  updateSourceCheck,
} from './monitor'
import type { SourceCheck, SourceCheckLog } from './types/monitor'
import type { MonitorCheckConf, MonitorKind, MonitorRecordView, MonitorRunView } from './types/monitorCenter'
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

/** 按旧 paged 接口翻页拉全量原始行（不自动去重，保存时以最后一次读到的为准）。 */
export async function listMonitorRows(options: ListOptions = {}): Promise<SourceCheck[]> {
  const maxPages = options.maxPages ?? MONITOR_MAX_PAGES
  const rows: SourceCheck[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await pagedSourceCheck({
      page,
      // 契约是 page/limit；adaptPage 只认 pageNo/pageSize，传 size 会被当未知字段带上、
      // 而 limit 仍是 undefined，真实后端按默认 10 条返回（fe-list 报的坑）。
      limit: MONITOR_PAGE_SIZE,
      sourceId: options.sourceId,
      name: options.name,
    } as never)
    const list = Array.isArray(res?.list) ? res.list : []
    rows.push(...list)
    const total = Number(res?.total ?? 0)
    if (!list.length || rows.length >= total) return rows
  }
  throw new MonitorQueryLimitError(maxPages)
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

/** 立即运行：返回的是旧接口回执（无 runId），页面必须区分「已受理」与「执行成功」。 */
export async function runMonitorsNow(ids: string[]): Promise<unknown> {
  return handleRunNow(ids)
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
    const list = Array.isArray(res?.list) ? res.list : []
    for (const source of list) {
      if (!source?.sourceId || collected.has(source.sourceId)) continue
      collected.set(source.sourceId, toSourceOption(source))
    }
    if (list.length < SOURCE_PAGE_SIZE || collected.size >= Number(res?.total ?? 0)) {
      return [...collected.values()]
    }
  }
  // 源目录和监控记录不是一回事：这里超限说明「源太多、一次列不全」，
  // 不能复用 MonitorQueryLimitError 的「监控记录超过 N 页」，否则排查会被引到错的地方。
  throw new Error(`源数量超过 ${SOURCE_MAX_PAGES * SOURCE_PAGE_SIZE} 个，无法一次列全；请按网站查看，或直接用名称/ID 搜索`)
}
