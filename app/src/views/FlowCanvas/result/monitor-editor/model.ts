import type { MonitorCheckConf, MonitorKind, MonitorRecordView } from '@/api/types/monitorCenter'
import { defaultSystemPrompt, normalizeMethod } from '@/utils/monitor/methods'

/**
 * 编辑器表单模型。
 *
 * 为什么单独抽一份：弹窗里同时存在「记录的持久化定义」「页面候选脚本」「用户尚未保存的编辑」
 * 三种状态，只有把它们拆开，保存回执才能区分「已生效 vN」与「草稿未生效」（T01/T02）。
 * 表单只描述用户能改的字段，其余未知键由 `confFromForm` 从基线 conf 整包透传。
 */
export interface MonitorEditorForm {
  sourceId: string
  sourceName: string
  name: string
  kind: MonitorKind
  /** 关联表：AI 检查作为数据范围，规则检查作为旧面板的「表名」 */
  tableName: string
  /** cron 或 AFTER:30 */
  schedule: string
  /** AI 检查方法（METHOD_GROUPS 的 code） */
  methods: string[]
  desc: string
  systemPrompt: string
  providerCode: string
  modelCode: string
  nullPolicy: 'abnormal' | 'allow' | 'skip'
  noDataPolicy: 'no_data' | 'alarm' | 'unknown'
  /** 规则检查：时间口径 C/U/M/T */
  timeType: string
  minSize: string
  maxSize: string
  startDt: string
  endDt: string
  cond: string
  checkRule: string
  checkMsg: string
  notifyOn: 'error' | 'ok' | 'all' | 'none'
  channels: string[]
  /** 附加收件人，多个用逗号/分号/空格分隔，保存时拆成数组 */
  receivers: string
  /** 已生效版本号（页面只读，保存时写回 conf） */
  version: string
  /** 入库时间字段：执行器按它拼 `--time-column`；空 = 不传（脚本自报错，页面不伪造列名） */
  timeColumn: string
  /** 检查窗口三选一：当日 / 最近 N 小时 / 上一个周期 */
  windowType: MonitorWindowType
  /** 「最近 N 小时」的 N（字符串便于数字输入框双向绑定，保存时归一成 1–720 的整数） */
  windowHours: string
  /**
   * 超期无新增的预期更新周期（分钟）。空 = 不判定超期。
   *
   * 执行器按「距上次有新增数据过了多久」判断断流（`monitor_overdue.py`）。
   * 没配这个值时，窗口内无数据仍按 `noDataPolicy` 处理——这是旧记录的行为，不能默认打开。
   */
  overdueMinutes: string
  /** 超期判定的宽限（分钟），空按 0；给采集延迟留缓冲，避免整点抖动误报 */
  overdueGrace: string
}

export type MonitorWindowType = 'today' | 'hours' | 'period'

/** 检查窗口默认小时数（hours 与 period 的兜底值） */
export const DEFAULT_WINDOW_HOURS = 24
export const WINDOW_HOURS_MIN = 1
export const WINDOW_HOURS_MAX = 720
/** 入库时间字段的固定候选：拿不到主表字段清单时用它（不是伪造列名，是给用户手选） */
export const FALLBACK_TIME_COLUMNS = ['CREATE_DT', 'UPDATE_DT', 'MODIFY_DT', 'publish_time', 'time'] as const
export const MAX_TIME_COLUMN_OPTIONS = 20

const TIME_COLUMN_SUFFIXES = ['_dt', '_time', '_date'] as const
const TIME_COLUMN_NAMES = new Set(['time', 'date', 'publish_time', 'create_dt', 'update_dt', 'modify_dt'])

/** 「像时间列」的启发式：后缀 _DT/_TIME/_DATE 或约定的时间列名（大小写不敏感） */
export function looksLikeTimeColumn(field: string): boolean {
  const name = (field ?? '').trim().toLowerCase()
  if (!name) return false
  if (TIME_COLUMN_NAMES.has(name)) return true
  return TIME_COLUMN_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/**
 * 入库时间字段下拉候选。
 *
 * - 有真实字段清单时只列「像时间列」的（最多 20 个）；
 * - 拿不到清单（或清单里没有时间列）时退回固定候选，让用户手选，不猜；
 * - 已保存的值即使不在清单里也保留为可选项，避免打开旧记录时下拉显示空白。
 */
export function timeColumnOptionsOf(fields: readonly string[] | null | undefined, current = ''): string[] {
  const real = [...new Set((fields ?? []).map((field) => field.trim()).filter(Boolean))]
  const matched = real.filter(looksLikeTimeColumn)
  const base = matched.length ? matched : [...FALLBACK_TIME_COLUMNS]
  const value = current.trim()
  const options = value && !base.includes(value) ? [value, ...base] : base
  return options.slice(0, MAX_TIME_COLUMN_OPTIONS)
}

/** 1–720 的整数；空值/非法值退回 24（页面与执行器口径一致） */
export function normalizeWindowHours(value: unknown): number {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim()
  if (!text) return DEFAULT_WINDOW_HOURS
  const num = Number(text)
  if (!Number.isFinite(num)) return DEFAULT_WINDOW_HOURS
  return Math.min(WINDOW_HOURS_MAX, Math.max(WINDOW_HOURS_MIN, Math.round(num)))
}

function stepOf(field: string): number {
  const matched = /^\*\/(\d+)$/.exec((field ?? '').trim())
  return matched ? Number(matched[1]) : 0
}

function hourIntervalOfMinute(minute: string, hour: string): number {
  // 每 N 分钟/每 N 小时（小时单位下不足 1 小时按 1 小时）
  if (stepOf(minute)) return 1
  const hourStep = stepOf(hour)
  if (hourStep) return hourStep
  const text = (hour ?? '').trim()
  if (text === '*') return 1
  const range = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(text)
  if (range) return range[3] ? Number(range[3]) : 1
  const hours = [...new Set(text.split(',').map((item) => Number(item)).filter((num) => Number.isFinite(num)))].sort((a, b) => a - b)
  if (hours.length > 1) {
    const gaps: number[] = []
    for (let index = 1; index < hours.length; index += 1) gaps.push(hours[index]! - hours[index - 1]!)
    // 跨天循环：最后一个与第一个 + 24
    gaps.push(hours[0]! + 24 - hours[hours.length - 1]!)
    return Math.min(...gaps.filter((gap) => gap > 0))
  }
  // 固定小时 = 每天一次；日/周级计划统一按 24 小时近似
  return DEFAULT_WINDOW_HOURS
}

/**
 * 从执行计划推「当前计划间隔」小时数（`window.type='period'` 的 periodHours）。
 *
 * 只解析页面能确定的日内周期：每 N 分钟/N 小时、小时 *、小时范围/步长、小时列表。
 * 每天一次返回 24；AFTER:N、表达式无法解析或日/周级计划一律退回 24（页面算不出来不瞎猜）。
 */
export function scheduleIntervalHours(schedule: string): number {
  const text = (schedule ?? '').trim()
  if (!text) return DEFAULT_WINDOW_HOURS
  // 采集任务后延迟触发：真实间隔取决于采集频率，页面算不出来
  if (/^AFTER/i.test(text)) return DEFAULT_WINDOW_HOURS
  const parts = text.split(/\s+/)
  if (parts.length < 6) return DEFAULT_WINDOW_HOURS
  const interval = hourIntervalOfMinute(parts[1] ?? '', parts[2] ?? '')
  return Math.min(WINDOW_HOURS_MAX, Math.max(WINDOW_HOURS_MIN, Math.round(interval)))
}

/** 表单 → checkConf.window（执行器按它算 DQ_START_DATE / DQ_END_DATE） */
export function windowOfForm(form: MonitorEditorForm): NonNullable<MonitorCheckConf['window']> {
  if (form.windowType === 'hours') return { type: 'hours', hours: normalizeWindowHours(form.windowHours) }
  if (form.windowType === 'period') return { type: 'period', periodHours: scheduleIntervalHours(form.schedule) }
  return { type: 'today' }
}

/**
 * 表单 → 超期策略：更新周期留空/非法 = 不判定超期。
 * 现在只有脚本检查由执行器跑，所以策略只对 AI 检查有意义；规则检查由 Java 调度，不写这个键。
 */
function overdueOfForm(form: MonitorEditorForm): { expectEveryMinutes: number; graceMinutes: number } | null {
  if (form.kind !== 'ai') return null
  // `<input type="number">` 上的 v-model 会把值转成 number，这里不能假设一定是 string
  const every = integerOf(form.overdueMinutes)
  if (every === undefined || every <= 0) return null
  const grace = integerOf(form.overdueGrace)
  return { expectEveryMinutes: every, graceMinutes: grace !== undefined && grace >= 0 ? grace : 0 }
}

/** checkConf.window → 表单值；未配置按「当日」，旧值非法按默认 24 小时 */
function windowFormOfConf(conf: MonitorCheckConf): { windowType: MonitorWindowType; windowHours: string } {
  const raw = conf.window
  const spec = raw && typeof raw === 'object' ? raw : {}
  if (spec.type === 'hours') return { windowType: 'hours', windowHours: String(normalizeWindowHours(spec.hours)) }
  if (spec.type === 'period') return { windowType: 'period', windowHours: String(DEFAULT_WINDOW_HOURS) }
  return { windowType: 'today', windowHours: String(DEFAULT_WINDOW_HOURS) }
}

export interface SaveFeedbackInput {
  kind: MonitorKind
  /** 本次保存是否带上了页面新生成的候选脚本 */
  generated: boolean
  /** 描述/方法/检查表/时间列改过但没重新生成脚本 */
  needsRegenerate: boolean
  /** 具体改过的字段名（`regenerateReasons` 的结果），用于把回执说清楚 */
  regenerateReasons?: string[]
  /**
   * 本次保存的执行计划是否为空（由调用方按表单判定，model 不去猜）。
   *
   * 有脚本但没计划的检查保存后永远不会自动跑，回执不能再说「计划已生效」；
   * 只有 AI 分支会用到它，规则检查保持原口径。
   */
  scheduleEmpty?: boolean
}

export interface ValidateError {
  /** 定位到哪块表单：source/name 在基础页，methods/overdue 在检查页 */
  key: 'source' | 'name' | 'methods' | 'overdue'
  message: string
}

export const DEFAULT_SCHEDULE = '0 0 6-22 * * ?'

export function emptyForm(): MonitorEditorForm {
  return {
    sourceId: '',
    sourceName: '',
    name: '',
    // 规格：新建默认 AI 检查；规则检查只在用户显式切换或编辑旧记录时出现
    kind: 'ai',
    tableName: '',
    schedule: '',
    methods: [],
    desc: '',
    systemPrompt: defaultSystemPrompt(),
    providerCode: '',
    modelCode: '',
    nullPolicy: 'abnormal',
    noDataPolicy: 'no_data',
    timeType: 'C',
    minSize: '',
    maxSize: '',
    startDt: '',
    endDt: '',
    cond: '',
    checkRule: '',
    checkMsg: '',
    notifyOn: 'error',
    channels: ['mail'],
    receivers: '',
    version: '',
    timeColumn: '',
    windowType: 'today',
    windowHours: String(DEFAULT_WINDOW_HOURS),
    overdueMinutes: '',
    overdueGrace: '',
  }
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

function listOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => textOf(item)).filter(Boolean)
}

function orchestrationOf(conf: MonitorCheckConf): Record<string, unknown> {
  const raw = conf.orchestration
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
}

/** 旧记录的脚本正文只落在 orchestration.scriptPath，正文需要服务端按路径回读（C02 未就绪） */
export function effectiveScriptOf(conf: MonitorCheckConf | null | undefined): string {
  if (!conf) return ''
  if (typeof conf.script === 'string' && conf.script.trim()) return conf.script
  const orchestration = orchestrationOf(conf)
  const fromOrchestration = orchestration.script
  return typeof fromOrchestration === 'string' ? fromOrchestration : ''
}

export function effectiveScriptPathOf(conf: MonitorCheckConf | null | undefined): string {
  if (!conf) return ''
  if (typeof conf.scriptPath === 'string' && conf.scriptPath.trim()) return conf.scriptPath
  const orchestration = orchestrationOf(conf)
  const path = orchestration.scriptPath
  if (typeof path === 'string' && path.trim()) return path
  return ''
}

export function versionOf(conf: MonitorCheckConf | null | undefined): string {
  return conf && typeof conf.version === 'string' ? conf.version : ''
}

/** v3 → v4；没有版本号时第一次生效从 v1 起（不伪造更大的号） */
export function nextVersionOf(version: string): string {
  const matched = /^v?(\d+)$/i.exec(version.trim())
  const next = matched ? Number(matched[1]) + 1 : 1
  return `v${next}`
}

export function channelsOfConf(conf: MonitorCheckConf): string[] {
  const channels = listOf(conf.channels)
  if (channels.length) return channels.map((item) => (item === 'ding' ? 'dingtalk' : item))
  const legacy = textOf(conf.notifyType)
  if (legacy === 'mail') return ['mail']
  if (legacy === 'ding' || legacy === 'dingtalk') return ['dingtalk']
  return []
}

function integerOf(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'number' ? String(value) : String(value).trim()
  if (!text) return undefined
  const num = Number(text)
  return Number.isInteger(num) ? num : undefined
}

/**
 * 超期策略的读取顺序与执行器一致：`overduePolicy` > 旧键 `overdue` > 顶层 `expectEveryMinutes`。
 * 三种写法都在历史数据里出现过，页面要能打开旧记录；保存统一写回 `overduePolicy`。
 */
export function overduePolicyOf(
  conf: MonitorCheckConf | null | undefined,
): { expectEveryMinutes?: number; graceMinutes?: number } {
  if (!conf) return {}
  const candidates: unknown[] = [conf.overduePolicy, conf.overdue, conf]
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue
    const value = raw as Record<string, unknown>
    const every = integerOf(value.expectEveryMinutes)
    const grace = integerOf(value.graceMinutes)
    if (every !== undefined || grace !== undefined) return { expectEveryMinutes: every, graceMinutes: grace }
  }
  return {}
}

export function formFromRecord(record: MonitorRecordView): MonitorEditorForm {
  const conf = record.conf ?? {}
  const orchestration = orchestrationOf(conf)
  const base = emptyForm()
  const windowForm = windowFormOfConf(conf)
  const overdue = overduePolicyOf(conf)
  const methods = listOf(conf.methods).length ? listOf(conf.methods) : listOf(conf.monitorMethods)
  return {
    ...base,
    sourceId: textOf(record.sourceId),
    sourceName: textOf(record.sourceName),
    name: record.name,
    kind: record.kind,
    tableName: textOf(record.tableName ?? conf.tableName),
    schedule: textOf(record.schedule ?? conf.cron),
    methods: methods.map((item) => normalizeMethod(item)),
    desc: textOf(conf.desc ?? orchestration.describe),
    systemPrompt: textOf(conf.systemPrompt ?? orchestration.systemPrompt),
    providerCode: textOf(conf.modelProviderCode ?? orchestration.modelProviderCode),
    modelCode: textOf(conf.modelCode ?? orchestration.modelCode),
    nullPolicy: (conf.nullPolicy === 'allow' || conf.nullPolicy === 'skip' ? conf.nullPolicy : 'abnormal'),
    noDataPolicy: (conf.noDataPolicy === 'alarm' || conf.noDataPolicy === 'unknown' ? conf.noDataPolicy : 'no_data'),
    timeType: textOf(conf.timeType) || 'C',
    minSize: textOf(conf.minSize),
    maxSize: textOf(conf.maxSize),
    startDt: textOf(conf.startDt),
    endDt: textOf(conf.endDt),
    cond: textOf(conf.cond),
    checkRule: textOf(conf.checkRule),
    checkMsg: textOf(conf.checkMsg),
    notifyOn: (conf.notifyOn === 'ok' || conf.notifyOn === 'all' || conf.notifyOn === 'none' ? conf.notifyOn : 'error'),
    channels: channelsOfConf(conf),
    receivers: listOf(conf.receivers).join(', ') || textOf(conf.mailTo),
    version: textOf(conf.version),
    timeColumn: textOf(conf.timeColumn),
    windowType: windowForm.windowType,
    windowHours: windowForm.windowHours,
    overdueMinutes: overdue.expectEveryMinutes === undefined ? '' : String(overdue.expectEveryMinutes),
    overdueGrace: overdue.graceMinutes === undefined ? '' : String(overdue.graceMinutes),
  }
}

function parseNumberOrKeep(value: string): number | string | undefined {
  const text = value.trim()
  if (!text) return undefined
  const num = Number(text)
  return Number.isFinite(num) ? num : text
}

function splitReceivers(value: string): string[] {
  return value.split(/[,;，；\s]+/).map((item) => item.trim()).filter(Boolean)
}

/**
 * 用表单值覆盖基线 conf 中「用户可改」的定义字段，未知键原样保留。
 * 注意：脚本正文只在本次生成了候选时才写；否则保留基线的 script/orchestration，
 * 避免「打开记录 → 只改通知 → 保存」把生效脚本正文抹掉（T01 的根因之一）。
 */
export function confFromForm(
  form: MonitorEditorForm,
  base: MonitorCheckConf,
  extra: { script?: string; scriptPath?: string } = {},
): MonitorCheckConf {
  const conf: MonitorCheckConf = { ...base, kind: form.kind }
  conf.methods = form.kind === 'ai' ? [...form.methods] : (base.methods ?? undefined)
  // 旧消费方（ck_source 同步）读 monitorMethods；两边都写，避免升级期口径分叉
  conf.monitorMethods = form.kind === 'ai' ? [...form.methods] : (base.monitorMethods ?? undefined)
  conf.notifyOn = form.notifyOn
  conf.channels = [...form.channels]
  const receivers = splitReceivers(form.receivers)
  conf.receivers = receivers.length ? receivers : undefined
  conf.notifyType = form.channels.includes('mail') ? 'mail' : (form.channels.includes('dingtalk') ? 'dingtalk' : undefined)
  conf.mailTo = form.channels.includes('mail') && form.receivers.trim() ? form.receivers.trim() : undefined

  if (form.kind === 'ai') {
    conf.desc = form.desc
    conf.systemPrompt = form.systemPrompt
    conf.modelProviderCode = form.providerCode
    conf.modelCode = form.modelCode
    conf.nullPolicy = form.nullPolicy
    conf.noDataPolicy = form.noDataPolicy
    conf.version = form.version || undefined
    // 不猜列名：空就是不传，让脚本自报「无法自动识别入库时间列」，保存时页面只提示不阻断
    const timeColumn = form.timeColumn.trim()
    if (timeColumn) conf.timeColumn = timeColumn
    else delete conf.timeColumn
    conf.window = windowOfForm(form)
    const overdue = overdueOfForm(form)
    if (overdue) {
      conf.overduePolicy = overdue
    } else {
      // 清空时必须把三种历史写法一起删掉：执行器读 overduePolicy > overdue > expectEveryMinutes，
      // 只删新键会让旧键复活，页面显示「不判定超期」但实际还在报。
      delete conf.overduePolicy
      delete conf.overdue
      delete conf.expectEveryMinutes
    }
    if (extra.script !== undefined) conf.script = extra.script
    if (extra.scriptPath !== undefined) conf.scriptPath = extra.scriptPath
  } else {
    conf.timeType = form.timeType || 'C'
    conf.minSize = parseNumberOrKeep(form.minSize)
    conf.maxSize = parseNumberOrKeep(form.maxSize)
    conf.startDt = form.startDt.trim() || undefined
    conf.endDt = form.endDt.trim() || undefined
    conf.cond = form.cond.trim() || undefined
    conf.checkRule = form.checkRule.trim() || undefined
    conf.checkMsg = form.checkMsg.trim() || undefined
  }
  return conf
}

export function validateForm(form: MonitorEditorForm): ValidateError | null {
  if (!form.sourceId.trim()) return { key: 'source', message: '请先选择被监控源' }
  if (!form.name.trim()) return { key: 'name', message: '请填写监控名称' }
  if (form.kind === 'ai' && !form.methods.length) return { key: 'methods', message: 'AI 检查至少选择一个监控方法' }
  if (form.kind === 'ai' && String(form.overdueMinutes ?? '').trim()) {
    const every = Number(form.overdueMinutes)
    if (!Number.isInteger(every) || every <= 0) {
      return { key: 'overdue', message: '超期判定的更新周期必须是正整数分钟（留空表示不判定超期）' }
    }
  }
  if (form.kind === 'ai' && String(form.overdueGrace ?? '').trim()) {
    const grace = Number(form.overdueGrace)
    if (!Number.isInteger(grace) || grace < 0) {
      return { key: 'overdue', message: '超期宽限必须是不小于 0 的整数分钟' }
    }
  }
  return null
}

/**
 * 改过哪些「必须重新生成脚本才改变检查行为」的字段（T02）。返回可读字段名，空数组表示没改。
 *
 * 除描述/方法外还比检查表与入库时间字段：脚本的列名、时间列都是按生成时的表写死的
 *（2026-11-14 源结果检查改造后，生成只认本条检查选定的表），换表或换时间列后旧脚本
 * 读到的是另一份范围，回执再说「计划已生效」会误导。
 */
export function regenerateReasons(form: MonitorEditorForm, baseline: MonitorEditorForm): string[] {
  if (form.kind !== 'ai' || baseline.kind !== 'ai') return []
  const reasons: string[] = []
  if (form.sourceId.trim() !== baseline.sourceId.trim()) reasons.push('监控源')
  if (form.tableName.trim() !== baseline.tableName.trim()) reasons.push('检查表')
  if (form.timeColumn.trim() !== baseline.timeColumn.trim()) reasons.push('入库时间字段')
  if (form.desc.trim() !== baseline.desc.trim()) reasons.push('描述')
  if (signatureOfMethods(form.methods) !== signatureOfMethods(baseline.methods)) reasons.push('监控方法')
  return reasons
}

/** 是否改过「必须重新生成脚本才改变检查行为」的字段（T02） */
export function needsRegenerate(form: MonitorEditorForm, baseline: MonitorEditorForm): boolean {
  return regenerateReasons(form, baseline).length > 0
}

export function signatureOfMethods(methods: string[]): string {
  return [...methods].map((item) => normalizeMethod(item)).sort().join(',')
}

/** 用于 dirty 判定与「保存后重置基线」，必须覆盖所有可改字段 */
export function formSignature(form: MonitorEditorForm): string {
  return JSON.stringify({
    sourceId: form.sourceId.trim(),
    name: form.name.trim(),
    kind: form.kind,
    tableName: form.tableName.trim(),
    schedule: form.schedule.trim(),
    methods: signatureOfMethods(form.methods),
    desc: form.desc.trim(),
    systemPrompt: form.systemPrompt.trim(),
    providerCode: form.providerCode,
    modelCode: form.modelCode,
    nullPolicy: form.nullPolicy,
    noDataPolicy: form.noDataPolicy,
    timeType: form.timeType,
    minSize: form.minSize.trim(),
    maxSize: form.maxSize.trim(),
    startDt: form.startDt.trim(),
    endDt: form.endDt.trim(),
    cond: form.cond.trim(),
    checkRule: form.checkRule.trim(),
    checkMsg: form.checkMsg.trim(),
    notifyOn: form.notifyOn,
    channels: [...form.channels].sort(),
    receivers: form.receivers.trim(),
    version: form.version,
    timeColumn: form.timeColumn.trim(),
    windowType: form.windowType,
    windowHours: String(form.windowHours).trim(),
    overdueMinutes: String(form.overdueMinutes ?? '').trim(),
    overdueGrace: String(form.overdueGrace ?? '').trim(),
  })
}

/**
 * 保存回执文案：三种状态必须可区分，不能一律说「已生效」。
 *
 * AI 检查「有脚本但没有执行计划」时（186 上的 SCHEDULE='' 记录），保存本身成功、
 * 版本号照旧，但这条检查永远不会自动运行；回执只留「未设执行计划」这一段，
 * 不再声称计划已生效。
 */
export function buildSaveFeedback(conf: MonitorCheckConf | null, version: string, input: SaveFeedbackInput): string {
  const effectiveVersion = versionOf(conf) || version
  if (input.kind === 'ai') {
    const hasScript = !!effectiveScriptOf(conf) || !!effectiveScriptPathOf(conf)
    if (!hasScript) return '已保存草稿：未生效，不执行（没有可执行脚本，先生成脚本再保存）'
    if (input.needsRegenerate && !input.generated) {
      const what = input.regenerateReasons?.length ? input.regenerateReasons.join('、') : '描述或方法'
      if (input.scheduleEmpty) {
        return `已保存 ${effectiveVersion}。未设执行计划：保存后只能手动运行；如需定时，请填写执行计划；${what}有改动，检查逻辑仍是 ${effectiveVersion}，需重新生成脚本才会改变`
      }
      return `已保存：计划/通知/判定策略已生效；${what}有改动，检查逻辑仍是 ${effectiveVersion}，需重新生成脚本才会改变`
    }
    if (input.scheduleEmpty) {
      return `已保存并生效 ${effectiveVersion}。未设执行计划：保存后只能手动运行；如需定时，请填写执行计划`
    }
    return `已保存并生效 ${effectiveVersion}：计划/通知/判定策略已生效，保存的内容已发布，未自动运行一次检查`
  }
  return effectiveVersion ? `已保存并生效 ${effectiveVersion}：保存的内容已发布` : '已保存并生效：保存的内容已发布'
}
