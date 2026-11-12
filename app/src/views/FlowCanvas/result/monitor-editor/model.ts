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
}

export interface SaveFeedbackInput {
  kind: MonitorKind
  /** 本次保存是否带上了页面新生成的候选脚本 */
  generated: boolean
  /** 描述/方法改过但没重新生成脚本 */
  needsRegenerate: boolean
}

export interface ValidateError {
  key: 'source' | 'name' | 'methods'
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

export function formFromRecord(record: MonitorRecordView): MonitorEditorForm {
  const conf = record.conf ?? {}
  const orchestration = orchestrationOf(conf)
  const base = emptyForm()
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
  return null
}

/** 是否改过「必须重新生成脚本才改变检查行为」的字段（T02） */
export function needsRegenerate(form: MonitorEditorForm, baseline: MonitorEditorForm): boolean {
  if (form.kind !== 'ai' || baseline.kind !== 'ai') return false
  return form.desc.trim() !== baseline.desc.trim() || signatureOfMethods(form.methods) !== signatureOfMethods(baseline.methods)
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
  })
}

/** 保存回执文案：三种状态必须可区分，不能一律说「已生效」 */
export function buildSaveFeedback(conf: MonitorCheckConf | null, version: string, input: SaveFeedbackInput): string {
  const effectiveVersion = versionOf(conf) || version
  if (input.kind === 'ai') {
    const hasScript = !!effectiveScriptOf(conf) || !!effectiveScriptPathOf(conf)
    if (!hasScript) return '已保存草稿：未生效，不执行（没有可执行脚本，先生成脚本再保存）'
    if (input.needsRegenerate && !input.generated) {
      return `已保存：计划/通知/判定策略已生效；描述或方法有改动，检查逻辑仍是 ${effectiveVersion}，需重新生成脚本才会改变`
    }
    return `已保存并生效 ${effectiveVersion}：保存的内容已发布，未自动运行一次检查`
  }
  return effectiveVersion ? `已保存并生效 ${effectiveVersion}：保存的内容已发布` : '已保存并生效：保存的内容已发布'
}
