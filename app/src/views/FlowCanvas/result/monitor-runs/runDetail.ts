// 单次运行详情的数据整形：只读 MonitorRunView（冻结视图），不查当前监控定义。
//
// 降级红线（1111 §7 / C06）：
//   - 冻结快照缺失 → 「未记录」，禁止用当前 checkConf 补齐；
//   - 旧日志没有结构化结果 → 标注「旧日志，未取得结构化结论」，逐项结果「未记录」；
//   - 条数/检查数未知 → 「—」，不补 0；
//   - 通知没有回执 → 「未取得回执」，受理 ≠ 送达。

import type {
  MonitorDelivery,
  MonitorRunCheck,
  MonitorRunConfig,
  MonitorRunView,
} from '@/api/types/monitorCenter'
import { methodLabel } from '@/utils/monitor/methods'
import {
  dataTextOf,
  dataTone,
  execTextOf,
  execTone,
  notifyTextOf,
  notifyTone,
  type RunTone,
} from './runScope'

export const MISSING_TEXT = '未记录'
export const NO_RECEIPT_TEXT = '未取得回执'
export const LEGACY_NOTE = '旧日志，未取得结构化结论'
export const DELIVERY_NOTE =
  '「已受理」只代表服务端受理，不等于送达；没有回执时显示「未取得回执」，不写「已送达」。'

export interface DetailField {
  label: string
  value: string
  mono?: boolean
  missing?: boolean
  /** 占满整行（长文本，如执行消息） */
  wide?: boolean
}

/** 有值 → trim 后的文本；null/undefined/空串 → 兜底文案。 */
export function valueText(value: unknown, fallback = MISSING_TEXT): string {
  if (value == null) return fallback
  const text = String(value).trim()
  return text || fallback
}

function field(label: string, value: unknown, opts: { mono?: boolean; wide?: boolean } = {}): DetailField {
  const text = value == null ? '' : String(value).trim()
  if (!text) return { label, value: MISSING_TEXT, missing: true, ...opts }
  return { label, value: text, ...opts }
}

/** 「未知显示 —，不是 0」：0 是有效值。 */
export function countTextOf(value: number | undefined): string {
  return value == null ? '—' : String(value)
}

const TRIGGER_TEXT: Record<MonitorRunView['trigger'], string> = {
  schedule: '计划触发',
  manual: '手动触发',
  legacy: '旧日志',
  unknown: '未知',
}

export function triggerTextOf(trigger: MonitorRunView['trigger']): string {
  return TRIGGER_TEXT[trigger] ?? TRIGGER_TEXT.unknown
}

/**
 * 结论区的文字字段（执行/数据/通知三个状态由页面用色标渲染，不在这里重复）。
 *
 * 「检查 / 异常」只认结构化值（checkedCount / abnormalCount），未知写「—」、不补 0；
 * 旧日志拿不到结构化结论时这一行直接写降级文案，不把中文日志里抠出来的条数当成检查数。
 * runId 是 C06 的运行主键，和旧日志的 logId 不是一回事：没有 runId 时只展示日志 ID。
 */
export function summaryFields(run: MonitorRunView): DetailField[] {
  const fields: DetailField[] = []

  if (run.legacy) {
    fields.push({ label: '检查 / 异常', value: LEGACY_NOTE, missing: true })
  } else {
    fields.push({
      label: '检查 / 异常',
      value: `${countTextOf(run.checkedCount)} / ${countTextOf(run.abnormalCount)}`,
      missing: run.checkedCount == null && run.abnormalCount == null,
    })
  }

  fields.push({ label: '触发方式', value: triggerTextOf(run.trigger) })

  const runId = (run.runId ?? '').trim()
  if (runId) {
    fields.push({ label: '运行 ID', value: runId, mono: true })
  } else if ((run.id ?? '').trim()) {
    fields.push({ label: '日志 ID', value: run.id, mono: true })
  }

  const message = (run.message ?? '').trim()
  if (message) fields.push({ label: '执行消息', value: message, wide: true })
  return fields
}

/**
 * 数据范围：窗口 + 时区。
 * 展示格式 `start → end（时区）`；时区缺失只显示区间，绝不拿浏览器本地时区顶替。
 */
export function windowTextOf(run: MonitorRunView): string {
  const start = (run.window?.start ?? '').trim()
  const end = (run.window?.end ?? '').trim()
  const timezone = (run.window?.timezone ?? '').trim()
  const range = start && end ? `${start} → ${end}` : start || end
  if (!range) return MISSING_TEXT
  return timezone ? `${range}（${timezone}）` : range
}

export function windowFields(run: MonitorRunView): DetailField[] {
  const value = windowTextOf(run)
  // 整行展示：窗口 + 时区拼起来在 13.6 寸下超过半行，单独一行避免省略/换行错位。
  return [{ label: '时间窗口', value, mono: true, missing: value === MISSING_TEXT, wide: true }]
}

function sampleText(samples: MonitorRunCheck['samples']): string {
  const rows = (samples ?? []).filter(Boolean)
  if (!rows.length) return '—'
  const first = rows
    .slice(0, 2)
    .map((sample) => {
      const parts = [sample.recordId, sample.actual, sample.reasonCode].map((part) => (part ?? '').trim()).filter(Boolean)
      return parts.join(' / ')
    })
    .filter(Boolean)
    .join('；')
  const more = rows.length > 2 ? `；等共 ${rows.length} 条` : ''
  return first ? `${first}${more}` : `共 ${rows.length} 条`
}

export interface CheckRow {
  key: string
  method: string
  table: string
  field: string
  exec: string
  execTone: RunTone
  data: string
  dataTone: RunTone
  checked: string
  abnormal: string
  samples: string
}

/** 逐方法逐表结果（C06 `checks[]`）；旧日志没有该数组，页面走空态文案。 */
export function checkRows(run: MonitorRunView): CheckRow[] {
  return (run.checks ?? []).map((check, index) => ({
    key: check.checkKey || `check-${index}`,
    method: valueText(check.methodLabel || (check.methodCode ? methodLabel(check.methodCode) : ''), '—'),
    table: valueText(check.tableName, '—'),
    field: valueText(check.field, '—'),
    exec: execTextOf(check.exec),
    execTone: execTone(check.exec),
    data: dataTextOf(check.data),
    dataTone: dataTone(check.data),
    checked: countTextOf(check.checkedCount),
    abnormal: countTextOf(check.abnormalCount),
    samples: sampleText(check.samples),
  }))
}

export function checksEmptyText(run: MonitorRunView): string {
  if (run.legacy) return '未记录逐项结果：旧日志只有汇总文本'
  return '未记录逐项结果：本次运行未返回逐项明细'
}

const NOTIFY_ON_TEXT: Record<string, string> = {
  error: '仅异常时',
  ok: '恢复正常时',
  all: '每次运行',
  none: '静默（不通知）',
}

const NULL_POLICY_TEXT: Record<string, string> = {
  abnormal: '空值判为异常',
  allow: '允许为空',
  skip: '跳过空值',
}

const NO_DATA_POLICY_TEXT: Record<string, string> = {
  no_data: '无待检记录',
  alarm: '无数据判为异常',
  unknown: '待判断',
}

/**
 * 冻结配置快照（只读 run.config）。
 * config 缺失时返回空数组，页面整段显示「未记录」，不用当前监控定义补齐。
 */
export function snapshotFields(config: MonitorRunConfig | undefined): DetailField[] {
  if (!config) return []
  const plan = config.plan
  return [
    field('版本', config.version, { mono: true }),
    field('快照摘要', config.digest, { mono: true }),
    field('监控名称', config.name),
    field('说明', config.desc, { wide: true }),
    field(
      '检查方法',
      config.methods?.length ? config.methods.map((method) => methodLabel(method)).join('、') : '',
    ),
    field('执行计划', plan?.text || plan?.cron, { mono: true }),
    field('通知策略', config.notifyOn ? (NOTIFY_ON_TEXT[config.notifyOn] ?? config.notifyOn) : ''),
    field('通知渠道', config.channels?.filter(Boolean).join('、')),
    field('空值策略', config.nullPolicy ? (NULL_POLICY_TEXT[config.nullPolicy] ?? config.nullPolicy) : ''),
    field(
      '无数据策略',
      config.noDataPolicy ? (NO_DATA_POLICY_TEXT[config.noDataPolicy] ?? config.noDataPolicy) : '',
    ),
  ]
}

export function snapshotScript(config: MonitorRunConfig | undefined): string {
  return (config?.script ?? '').trim()
}

/** 冻结快照里本次选中的方法名（用于逐项区在无 checks 时说明「本该检查哪些项」）。 */
export function snapshotMethodLabels(config: MonitorRunConfig | undefined): string[] {
  return (config?.methods ?? []).filter(Boolean).map((method) => methodLabel(method))
}

export interface DeliveryRow {
  key: string
  channel: string
  target: string
  attempt: string
  status: string
  tone: RunTone
  at: string
  message: string
}

export function deliveryRows(deliveries: MonitorDelivery[]): DeliveryRow[] {
  return (deliveries ?? []).map((delivery, index) => ({
    key: `${delivery.channel || 'channel'}-${delivery.attempt}-${index}`,
    channel: valueText(delivery.channel, '—'),
    target: valueText(delivery.target, '—'),
    attempt: Number.isInteger(delivery.attempt) && delivery.attempt > 0 ? `第 ${delivery.attempt} 次` : MISSING_TEXT,
    status: notifyTextOf(delivery.status),
    tone: notifyTone(delivery.status),
    at: valueText(delivery.at, '—'),
    message: valueText(delivery.message, '—'),
  }))
}

/** 投递为空时的空态：未配置通知就是未配置，其余一律「未取得回执」，不写「已送达」。 */
export function deliveryEmptyText(run: MonitorRunView): string {
  if ((run.deliveries ?? []).length) return ''
  return run.notify === 'none' ? '未配置通知' : NO_RECEIPT_TEXT
}

/**
 * 日志正文：C06 结构化 logText 优先，旧日志只能读 raw.logMsg；两者不混用。
 * 拿不到正文时返回空串，页面显示「未取得日志内容」/logRef 入口，不伪造。
 */
export function logTextOf(run: MonitorRunView): string {
  const structured = (run.logText ?? '').trim()
  if (structured) return structured
  return (run.raw?.logMsg ?? '').trim()
}

export function logSourceText(run: MonitorRunView): string {
  if ((run.logText ?? '').trim()) return '结构化日志正文（C06）'
  if ((run.raw?.logMsg ?? '').trim()) return '旧日志文本（logMsg）'
  return ''
}

/** 服务端日志引用：正文拿不到时给入口，不给假内容。 */
export function logRefOf(run: MonitorRunView): string {
  return (run.logRef ?? '').trim()
}

export function notifyStatusOf(run: MonitorRunView): { text: string; tone: RunTone } {
  return { text: notifyTextOf(run.notify), tone: notifyTone(run.notify) }
}