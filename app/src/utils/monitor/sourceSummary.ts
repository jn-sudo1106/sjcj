// 源级聚合（1110 §3.2 / §9.1）：一行一源，取「最差事实」，不把一项通过当整源正常。
//
// 重要边界：这里**只做前端可算的部分**。计划覆盖、漏跑、通知投递这些需要服务端按时隙判定
// （C07/C08），前端拿不到就返回 null / 'unknown'，页面显示「—（需服务端聚合）」，
// 绝不用「本页数据」拼一个看起来像全站的数字（1109 §4.1 / §1.8 降级红线）。

import type { MonitorDataStatus, MonitorExecStatus, MonitorRecordView, MonitorSourceRow } from '../../api/types/monitorCenter'

export interface SourceLike {
  id: string
  name?: string
  siteId?: string
  siteName?: string
}

export type MonitorTone = MonitorSourceRow['tone']

/** 一条源最差的数据结论：异常 > 待判断 > 无待检 > 正常。 */
export function worstDataOf(monitors: MonitorRecordView[]): MonitorDataStatus {
  const enabled = monitors.filter((m) => m.enabled)
  const pool = enabled.length ? enabled : monitors
  if (pool.some((m) => m.data === 'abnormal')) return 'abnormal'
  if (pool.some((m) => m.data === 'unknown')) return 'unknown'
  if (pool.some((m) => m.data === 'no_data')) return 'no_data'
  if (pool.some((m) => m.data === 'normal')) return 'normal'
  return 'unknown'
}

/** 一条源最差的执行状态：失败 > 超时 > 取消 > 执行中 > 排队 > 成功 > 未执行。 */
export function worstExecOf(monitors: MonitorRecordView[]): MonitorExecStatus {
  const enabled = monitors.filter((m) => m.enabled)
  const pool = enabled.length ? enabled : monitors
  const order: MonitorExecStatus[] = ['failed', 'timeout', 'cancelled', 'running', 'queued', 'succeeded', 'unknown', 'none']
  for (const status of order) {
    if (pool.some((m) => m.exec === status)) return status
  }
  return 'none'
}

/**
 * 聚合一行源。优先级与原型/结论一致：
 * 未配置 → 已停用 → 数据异常 → 执行失败 → 未生效（启用但无可执行版本）→ 尚未检查 → 待判断
 * → 无待检记录（全部启用项都 no_data）→ 数据正常。
 *
 * 为什么 no_data 单独一档而不是并进「数据正常」：0 条记录不代表检查通过（1110 §7.3 / R04），
 * 只有真到过「有数据且全部通过」才算正常；否则页面会把「今天没数据」当绿灯。
 *
 * 为什么「未生效」排在「尚未检查」之前：一条草稿被启用后永远不会按计划执行，
 * 若显示「尚未检查」，读者会以为它还没到时间——这是两件事（R01 / 三轮 S2）。
 */
export function summarizeSource(sourceId: string, monitors: MonitorRecordView[], source?: SourceLike): MonitorSourceRow {
  const total = monitors.length
  const enabledMonitors = monitors.filter((m) => m.enabled)
  const enabled = enabledMonitors.length
  const data = worstDataOf(monitors)
  const exec = worstExecOf(monitors)
  const notifyFailures = monitors.filter((m) => m.notify === 'failed').length
  const lastChecks = monitors
    .map((m) => m.lastCheckAt)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .sort()

  const anyAbnormal = monitors.some((m) => m.data === 'abnormal')
  const anyExecFailed = enabledMonitors.some((m) => m.exec === 'failed' || m.exec === 'timeout' || m.exec === 'cancelled')
  const anyDraft = enabledMonitors.some((m) => m.publishStatus === 'draft')
  const anyChecked = enabledMonitors.some((m) => m.exec !== 'none')
  // 只有「所有启用项都没有待检数据」才算无待检；只要有任一项真查到数据并通过，
  // 这一源的最差事实仍是正常（不能因为同源另一项 0 条就把整源标黄）。
  const pool = enabledMonitors.length ? enabledMonitors : monitors
  const allNoData = pool.length > 0 && pool.every((m) => m.data === 'no_data')

  let label = '数据正常'
  let tone: MonitorTone = 'good'
  if (total === 0) {
    label = '未配置检查'
    tone = 'muted'
  } else if (enabled === 0) {
    label = '已停用'
    tone = 'muted'
  } else if (anyAbnormal) {
    label = '数据异常'
    tone = 'bad'
  } else if (anyExecFailed) {
    label = '执行失败 · 数量未知'
    tone = 'warn'
  } else if (anyDraft) {
    label = '未生效 · 不会执行'
    tone = 'warn'
  } else if (!anyChecked) {
    label = '尚未检查'
    tone = 'unknown'
  } else if (data === 'unknown') {
    label = '待判断'
    tone = 'unknown'
  } else if (allNoData) {
    label = '无待检记录'
    tone = 'warn'
  }

  return {
    sourceId,
    sourceName: source?.name ?? monitors[0]?.sourceName,
    siteId: source?.siteId,
    siteName: source?.siteName,
    monitorTotal: total,
    monitorEnabled: enabled,
    // 没有 C07 聚合接口：不给数字，也不给 0
    coverage: null,
    data,
    exec,
    notifyFailures,
    lastCheckAt: lastChecks.length ? lastChecks[lastChecks.length - 1] : undefined,
    label,
    tone,
    monitors,
    unconfigured: total === 0,
  }
}

/**
 * 按源分组聚合。
 * `sources` 传入源目录时，**未配置检查的源也会出现在结果里**（1110 §3.2 要求）；
 * 不传则只返回有监控记录的源，页面需要提示「当前只展示已配置源」。
 */
export function summarizeSources(records: MonitorRecordView[], sources?: SourceLike[]): MonitorSourceRow[] {
  const bySource = new Map<string, MonitorRecordView[]>()
  for (const record of records) {
    const key = record.sourceId
    const list = bySource.get(key)
    if (list) list.push(record)
    else bySource.set(key, [record])
  }
  const nameOf = new Map((sources ?? []).map((s) => [s.id, s.name]))

  if (!sources || !sources.length) {
    return [...bySource.entries()].map(([sourceId, monitors]) => summarizeSource(sourceId, monitors, { id: sourceId, name: nameOf.get(sourceId) }))
  }

  const rows: MonitorSourceRow[] = []
  for (const source of sources) {
    const monitors = (bySource.get(source.id) ?? []).map((m) => ({ ...m, sourceName: m.sourceName ?? source.name }))
    rows.push(summarizeSource(source.id, monitors, source))
    bySource.delete(source.id)
  }
  // 源目录里没有、但监控里存在的源（源可能已删除/迁组）：仍然列出来，不能静默丢数据
  for (const [sourceId, monitors] of bySource) {
    rows.push(summarizeSource(sourceId, monitors, { id: sourceId, name: monitors[0]?.sourceName }))
  }
  return rows
}