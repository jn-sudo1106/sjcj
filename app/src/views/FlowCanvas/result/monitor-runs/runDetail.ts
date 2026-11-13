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
  /** 组件上的定位标识；只给新增字段加，既有 testid 不改名 */
  testid?: string
}

/** 有值 → trim 后的文本；null/undefined/空串 → 兜底文案。 */
export function valueText(value: unknown, fallback = MISSING_TEXT): string {
  if (value == null) return fallback
  const text = String(value).trim()
  return text || fallback
}

function field(
  label: string,
  value: unknown,
  opts: { mono?: boolean; wide?: boolean; testid?: string } = {},
): DetailField {
  const text = value == null ? '' : String(value).trim()
  // 翻译函数（窗口/时间口径）自己就会给出「未记录」，同样算缺失，否则样式上会被当成有值。
  if (!text || text === MISSING_TEXT) return { label, value: MISSING_TEXT, missing: true, ...opts }
  return { label, value: text, ...opts }
}

/** 「未知显示 —，不是 0」：0 是有效值。 */
export function countTextOf(value: number | undefined): string {
  return value == null ? '—' : String(value)
}

/** 脚本检查耗时（C06 durationMs）：<1s 用毫秒，<1min 用秒（一位小数），再长用「M 分 S 秒」。 */
export function durationTextOf(durationMs: number | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return MISSING_TEXT
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes} 分 ${seconds} 秒`
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

  // C06 结构化耗时（durationMs）；旧日志/未记录时按统一口径显示「未记录」，不补 0
  fields.push(field('耗时', durationTextOf(run.durationMs), { testid: 'run-duration' }))

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

/** 检查对象只有两个合法值；快照缺键说明是还没有 scopeType 的历史记录，不推断成「源结果」。 */
const SCOPE_TYPE_TEXT: Record<string, string> = {
  source_result: '源结果检查',
  node_input: '节点环节检查',
}
export const UNCLASSIFIED_SCOPE_TEXT = '未分类（历史记录）'

export function scopeTextOf(scopeType: MonitorRunConfig['scopeType'] | undefined): string {
  if (!scopeType) return UNCLASSIFIED_SCOPE_TEXT
  return SCOPE_TYPE_TEXT[scopeType] ?? UNCLASSIFIED_SCOPE_TEXT
}

/**
 * 入窗时间字段口径，与旧平台 TimeTypeEnum 一一对应（C=create_dt / U=update_dt / M、T=modify_dt）；
 * 不认识的值原样保留，别把历史枚举翻译成错的语义。
 */
const TIME_TYPE_TEXT: Record<string, string> = {
  C: '创建时间（create_dt）',
  U: '更新时间（update_dt）',
  M: '修改时间（modify_dt）',
  T: '修改时间（modify_dt，起点取源上次任务）',
}

export function timeTypeTextOf(timeType: string | undefined): string {
  const text = (timeType ?? '').trim()
  if (!text) return MISSING_TEXT
  return TIME_TYPE_TEXT[text] ?? text
}

/** 执行器对缺省/非法小时数的兜底值，展示层必须与 backend/runner_management/monitor_runner.py 保持一致。 */
const DEFAULT_WINDOW_HOURS = 24

/** 正整数才算有效配置；0 / 负数 / 非整数都交给执行器默认值兜底。 */
function positiveIntOf(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * 覆盖窗口说人话。
 * 只有 type 没有 start/end 是编辑器常态（起止由执行器按 type 现算），所以按 type 描述；
 * 显式给了 start/end 的快照才展示具体区间。
 */
export function windowSpecTextOf(window: MonitorRunConfig['window'] | undefined): string {
  if (!window) return MISSING_TEXT
  const type = (window.type ?? '').trim()
  if (type === 'hours') return `最近 ${positiveIntOf(window.hours) ?? DEFAULT_WINDOW_HOURS} 小时`
  if (type === 'period') {
    const periodHours = positiveIntOf(window.periodHours)
    return periodHours ? `上一个周期（${periodHours} 小时）` : '上一个周期'
  }
  if (!type || type === 'today') {
    if (window.start || window.end) return `${window.start ?? '—'} → ${window.end ?? '—'}`
    return '当日 00:00 → 现在'
  }
  // 未知 type（后端以后可能新增）原样展示，至少不会假装成「当日」。
  return type
}

/**
 * 超期策略：没有预期更新周期就返回空串，页面不显示这一行——
 * 只配宽限不配周期在判定上没有意义，展示出来反而误导。
 */
export function overdueTextOf(overduePolicy: MonitorRunConfig['overduePolicy'] | undefined): string {
  const expectEveryMinutes = positiveIntOf(overduePolicy?.expectEveryMinutes)
  if (expectEveryMinutes === undefined) return ''
  const graceMinutes = overduePolicy?.graceMinutes
  const graceText =
    typeof graceMinutes === 'number' && Number.isInteger(graceMinutes) && graceMinutes > 0
      ? `，宽限 ${graceMinutes} 分钟`
      : ''
  return `每 ${expectEveryMinutes} 分钟无新增即超期${graceText}`
}

export function receiversTextOf(receivers: string[] | undefined): string {
  return (receivers ?? [])
    .map((receiver) => receiver.trim())
    .filter(Boolean)
    .join('、')
}

/**
 * 冻结配置快照（只读 run.config）。
 * config 缺失时返回空数组，页面整段显示「未记录」，不用当前监控定义补齐。
 *
 * 有值才显示的行（收件人 / 超期策略）不占位，避免旧快照出现一堆「未记录」噪音；
 * 检查对象例外——它决定这次到底查了源结果还是节点环节，缺键也要明确写「未分类」。
 */
export function snapshotFields(config: MonitorRunConfig | undefined): DetailField[] {
  if (!config) return []
  const plan = config.plan
  const fields: DetailField[] = [
    field('版本', config.version, { mono: true }),
    field('快照摘要', config.digest, { mono: true }),
    field('监控名称', config.name),
    field('说明', config.desc, { wide: true }),
    field('检查对象', scopeTextOf(config.scopeType), { testid: 'run-snapshot-scope' }),
    field('检查表', config.tableName, { mono: true, testid: 'run-snapshot-table' }),
    field('入库时间字段', config.timeColumn, { mono: true, testid: 'run-snapshot-time-column' }),
    field('时间口径', timeTypeTextOf(config.timeType), { testid: 'run-snapshot-time-type' }),
    field('覆盖窗口', windowSpecTextOf(config.window), { testid: 'run-snapshot-window' }),
    field(
      '检查方法',
      config.methods?.length ? config.methods.map((method) => methodLabel(method)).join('、') : '',
    ),
    field('执行计划', plan?.text || plan?.cron, { mono: true }),
    field('通知策略', config.notifyOn ? (NOTIFY_ON_TEXT[config.notifyOn] ?? config.notifyOn) : ''),
    field('通知渠道', config.channels?.filter(Boolean).join('、')),
  ]
  const receivers = receiversTextOf(config.receivers)
  if (receivers) {
    fields.push({ label: '收件人', value: receivers, wide: true, testid: 'run-snapshot-receivers' })
  }
  fields.push(
    field('空值策略', config.nullPolicy ? (NULL_POLICY_TEXT[config.nullPolicy] ?? config.nullPolicy) : ''),
    field(
      '无数据策略',
      config.noDataPolicy ? (NO_DATA_POLICY_TEXT[config.noDataPolicy] ?? config.noDataPolicy) : '',
    ),
  )
  const overdue = overdueTextOf(config.overduePolicy)
  if (overdue) {
    fields.push({ label: '超期策略', value: overdue, wide: true, testid: 'run-snapshot-overdue' })
  }
  return fields
}

/**
 * 旧日志横幅文案。
 * 旧日志 = 没有 REMARKS 结构化结论，但 JOB_CONF 快照可能仍在（规则检查就是这种），
 * 所以有快照时不能说「没有冻结快照」，否则与下方快照区自相矛盾。
 */
export function legacyNoteText(run: MonitorRunView): string {
  if (!run.legacy) return ''
  if (run.config) {
    return `${LEGACY_NOTE}：本次运行只有旧日志文本，没有逐项结果；冻结快照来自 JOB_CONF，仅作参考。下方标「未记录」的地方不用当前监控定义补齐。`
  }
  return `${LEGACY_NOTE}：本次运行只有旧日志文本，没有逐项结果与冻结快照；下方「未记录」的地方不用当前监控定义补齐。`
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